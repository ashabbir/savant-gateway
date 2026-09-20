const os = require('os')
const path = require('path')
const fs = require('fs')
const { spawn, spawnSync } = require('child_process')

const THINKING_LEVELS = new Set(['low', 'medium', 'high'])

function normalizeThinkingLevel(value) {
  const level = String(value || 'medium').toLowerCase()
  if (!THINKING_LEVELS.has(level)) {
    throw new Error('thinking_level must be one of: low, medium, high')
  }
  return level
}

// Same PATH augmentation as Quorum's main.ts — GUI-launched processes don't
// inherit the shell PATH so homebrew/local bins are invisible otherwise.
const EXTRA_PATH_DIRS = [
  '/opt/homebrew/bin',
  '/opt/homebrew/sbin',
  '/usr/local/bin',
  '/usr/local/sbin',
  path.join(os.homedir(), '.local/bin'),
  path.join(os.homedir(), '.cargo/bin'),
  path.join(os.homedir(), '.bun/bin'),
  '/opt/homebrew/opt/node@20/bin',
  '/opt/homebrew/opt/node@22/bin',
]

/**
 * Builds child process environment with expanded PATH directories.
 * @param {Object} [extra={}]
 * @returns {Object}
 */
function buildChildEnv(extra = {}) {
  const current = process.env.PATH || ''
  const parts = current.split(':').filter(Boolean)
  const seen = new Set(parts)
  for (const dir of EXTRA_PATH_DIRS) {
    if (!seen.has(dir)) {
      parts.push(dir)
      seen.add(dir)
    }
  }
  return { ...process.env, ...extra, PATH: parts.join(':') }
}

// Quota / rate-limit detection — same patterns as Quorum's adapters.ts.
// The discriminator: real errors pair the keyword with an error verb,
// or use a canonical HTTP/CLI error signature.
const QUOTA_PATTERNS = [
  /\b(?:HTTP\s*)?429\b/,
  /\bQUOTA_EXHAUSTED\b/,
  /\bToo\s+Many\s+Requests\b/i,
  /\bquota\s+(?:exceeded|exhausted|reached)\b/i,
  /\bquota\s+limit\s+(?:exceeded|reached)\b/i,
  /\brate[\s_-]?limit(?:ed|s|ing)?\s+(?:exceeded|reached|hit|exhausted)\b/i,
  /\b(?:exhausted|exceeded)\s+your\s+(?:quota|capacity|rate[\s_-]?limit)\b/i,
  /\byou\s+(?:have\s+)?exceeded\s+your\s+(?:quota|rate)\b/i,
  /\brate[\s_-]?limit_exceeded\b/i,
]

/**
 * Checks if output/error string represents a quota error.
 * @param {string} res
 * @returns {boolean}
 */
const isQuotaError = (res) => typeof res === 'string' && QUOTA_PATTERNS.some((re) => re.test(res))

/**
 * Resolves alias to canonical model name.
 * @param {Object} adapter
 * @param {string} [model]
 * @returns {string}
 */
function resolveModel(adapter, model) {
  if (!adapter) return model || ''
  const requested = model || adapter.defaultModel
  if (requested === 'configured') return ''
  if (requested && adapter.modelAliases && Object.hasOwn(adapter.modelAliases, requested)) {
    return adapter.modelAliases[requested]
  }
  return requested
}

function runDiscovery(command, args, { timeout = 5_000, env = buildChildEnv() } = {}) {
  return new Promise((resolve) => {
    let settled = false
    let stdout = ''
    const child = spawn(command, args, { env, stdio: ['ignore', 'pipe', 'ignore'] })
    const finish = (value) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      resolve(value)
    }
    const timer = setTimeout(() => {
      try { child.kill('SIGKILL') } catch {}
      finish('')
    }, timeout)
    timer.unref?.()
    child.stdout.on('data', (chunk) => { stdout += chunk.toString() })
    child.on('error', () => finish(''))
    child.on('close', (code) => finish(code === 0 ? stdout : ''))
  })
}

const HERMES_PYTHON = process.env.HERMES_PYTHON || path.join(
  os.homedir(), '.hermes', 'hermes-agent', 'venv', 'bin', 'python',
)

/**
 * Discovers available models from local Hermes CLI if installed.
 * @returns {Array<string>}
 */
async function discoverHermesModels() {
  if (!fs.existsSync(HERMES_PYTHON)) return []

  const output = await runDiscovery(HERMES_PYTHON, ['-c', [
    'import json',
    'from hermes_cli.model_switch import list_authenticated_providers',
    'print(json.dumps(list_authenticated_providers(max_models=10000)))',
  ].join('; ')])

  if (!output) return []
  try {
    const providers = JSON.parse(output)
    if (!Array.isArray(providers)) return []
    return providers.flatMap((provider) => (provider && Array.isArray(provider.models) ? provider.models : []).map(
      (model) => `${provider.slug}/${model}`,
    ))
  } catch {
    return []
  }
}

/**
 * Discovers models from local Codex config directory.
 * @returns {Array<string>}
 */
function discoverCodexModels() {
  const codexHome = process.env.CODEX_HOME || path.join(os.homedir(), '.codex')
  const cachePath = path.join(codexHome, 'models_cache.json')
  try {
    const payload = JSON.parse(fs.readFileSync(cachePath, 'utf8'))
    const models = Array.isArray(payload.models) ? payload.models : []
    const ids = models
      .filter((model) => model && typeof model.slug === 'string')
      .filter((model) => !['hide', 'hidden'].includes(String(model.visibility || '').toLowerCase()))
      .map((model) => model.slug.trim())
      .filter(Boolean)
    return [...new Set(ids)]
  } catch {
    return []
  }
}

/**
 * Discovers models from AGY CLI.
 * @returns {Array<string>}
 */
function parseDiscoveredModels(output) {
  if (typeof output !== 'string') return []
  return [...new Set(output
    .split(/\r?\n/)
    .map((line) => line.trim().split(/\t|\s{2,}/)[0]?.trim())
    .filter((model) => model && !/^fetching\b/i.test(model)))]
}

async function discoverCliModels(command) {
  return parseDiscoveredModels(await runDiscovery(command, ['models']))
}

async function discoverAgyModels() {
  return discoverCliModels('agy')
}

async function discoverGeminiModels() {
  return discoverCliModels('gemini')
}

/**
 * Parses the tabular output of `ollama list` into model names.
 *
 * @param {string} output
 * @returns {Array<string>}
 */
function parseOllamaModels(output) {
  if (typeof output !== 'string') return []
  return [...new Set(output
    .split(/\r?\n/)
    .slice(1)
    .map((line) => line.trim().split(/\s+/)[0])
    .filter((model) => model && model !== 'NAME'))]
}

/**
 * Discovers locally installed Ollama models.
 *
 * @returns {Array<string>}
 */
async function discoverOllamaModels() {
  return parseOllamaModels(await runDiscovery('ollama', ['list']))
}

const ADAPTERS = {
  claude: {
    name: 'claude',
    label: 'Claude',
    priority: 30,
    baseArgv: ['claude', '-p', '--dangerously-skip-permissions'],
    modelArgv: (model) => (model ? ['--model', model] : []),
    thinkingArgv: (level) => ['--effort', level],
    promptArgv: (prompt) => [prompt],
    usesConfiguredModel: true,
    defaultModel: 'configured',
    availableModels: ['configured'],
  },
  copilot: {
    name: 'copilot',
    label: 'Copilot',
    priority: 40,
    baseArgv: ['copilot', '--allow-all'],
    modelArgv: (model) => (model ? ['--model', model] : []),
    thinkingArgv: (level) => ['--effort', level],
    promptArgv: (prompt) => ['--prompt', prompt],
    usesConfiguredModel: true,
    defaultModel: 'configured',
    availableModels: ['configured'],
  },
  codex: {
    name: 'codex',
    label: 'Codex',
    priority: 10,
    baseArgv: ['codex', 'exec', '--sandbox', 'workspace-write', '--skip-git-repo-check'],
    modelAliases: {
      fast: '',
    },
    modelArgv: (model) => [
      ...(model ? ['--model', model] : []),
      '-c', 'service_tier="fast"',
    ],
    thinkingArgv: (level) => ['-c', `model_reasoning_effort="${level}"`],
    promptArgv: (prompt) => [prompt],
    discoverModels: async () => discoverCodexModels(),
    usesConfiguredModel: true,
    defaultModel: 'configured',
    availableModels: ['configured'],
  },
  gemini: {
    name: 'gemini',
    label: 'Gemini',
    priority: 50,
    baseArgv: ['gemini', '--dangerously-skip-permissions'],
    modelArgv: (model) => (model ? ['--model', model] : []),
    thinkingArgv: (level) => ['--effort', level],
    promptArgv: (prompt) => ['--print', prompt],
    discoverModels: discoverGeminiModels,
    usesConfiguredModel: true,
    defaultModel: 'configured',
    availableModels: ['configured'],
  },
  agy: {
    name: 'agy',
    label: 'AGY',
    priority: 60,
    baseArgv: ['agy', '--dangerously-skip-permissions'],
    modelAliases: {
      fast: '',
    },
    modelArgv: (model) => (model ? ['--model', model] : []),
    thinkingArgv: (level) => ['--effort', level],
    promptArgv: (prompt) => ['-p', prompt],
    discoverModels: discoverAgyModels,
    usesConfiguredModel: true,
    defaultModel: 'configured',
    availableModels: ['configured'],
  },
  hermes: {
    name: 'hermes',
    label: 'Hermes',
    priority: 20,
    baseArgv: ['hermes', '--yolo'],
    modelArgv: (model) => {
      if (!model || model === 'configured') return []
      const separator = model.indexOf('/')
      if (separator === -1) return ['--model', model]
      return [
        '--provider', model.slice(0, separator),
        '--model', model.slice(separator + 1),
      ]
    },
    thinkingArgv: () => [],
    promptArgv: (prompt) => ['--oneshot', prompt],
    discoverModels: discoverHermesModels,
    usesConfiguredModel: true,
    defaultModel: 'configured',
    availableModels: ['configured'],
  },
  ollama: {
    name: 'ollama',
    label: 'Ollama',
    priority: 70,
    baseArgv: ['ollama', 'run'],
    modelArgv: (model) => (model ? [model] : []),
    thinkingArgv: (level) => ['--think', level],
    promptArgv: (prompt) => [prompt],
    discoverModels: discoverOllamaModels,
    selectDefaultModel: (models) => models.find((model) => !/embed/i.test(model)) || models[0] || '',
    defaultModel: '',
    availableModels: [],
  },
}

async function refreshHermesModels() {
  return refreshAdapterModels('hermes')
}

async function refreshLocalModels() {
  const names = Object.keys(ADAPTERS).filter((name) => name !== 'hermes')
  const refreshed = await Promise.all(names.map(refreshAdapterModels))
  return Object.fromEntries(names.map((name, index) => [name, refreshed[index]]))
}

async function refreshAdapterModels(providerName) {
  const adapter = ADAPTERS[providerName]
  if (!adapter) return null
  const discovered = adapter.discoverModels ? await adapter.discoverModels() : []
  const models = [...new Set(discovered.filter((model) => typeof model === 'string' && model.trim()))]
  const configuredOnly = adapter.usesConfiguredModel && adapter.availableModels.length === 1
  if (models.length === 0 && adapter.availableModels.length > 0 && !configuredOnly) return adapter
  adapter.availableModels = adapter.usesConfiguredModel ? ['configured', ...models] : models
  if (!adapter.usesConfiguredModel) {
    const selectedDefault = adapter.selectDefaultModel?.(adapter.availableModels)
    if (selectedDefault || !adapter.availableModels.includes(adapter.defaultModel)) {
      adapter.defaultModel = selectedDefault || adapter.availableModels[0] || ''
    }
  }
  return adapter
}

const ALL_PROVIDER_NAMES = Object.keys(ADAPTERS)

function isCommandAvailable(command) {
  const probe = spawnSync('which', [command], {
    env: buildChildEnv(),
    stdio: 'ignore',
  })
  return probe.status === 0
}

const PROVIDER_NAMES = ALL_PROVIDER_NAMES.filter((providerName) => {
  const adapter = ADAPTERS[providerName]
  const cliCommand = adapter?.baseArgv?.[0]
  return Boolean(cliCommand) && isCommandAvailable(cliCommand)
})

const DISABLED_PROVIDERS = ALL_PROVIDER_NAMES.filter(
  (providerName) => !PROVIDER_NAMES.includes(providerName),
)

const DEFAULT_PROVIDER_ORDER = [...ALL_PROVIDER_NAMES]
  .sort((left, right) => ADAPTERS[left].priority - ADAPTERS[right].priority)
const DEFAULT_CHAIN = DEFAULT_PROVIDER_ORDER
  .filter((provider) => PROVIDER_NAMES.includes(provider) && ADAPTERS[provider].defaultModel)
  .map((provider) => ({ provider, model: ADAPTERS[provider].defaultModel }))

function refreshActiveProviders() {
  const active = ALL_PROVIDER_NAMES.filter((providerName) => {
    const adapter = ADAPTERS[providerName]
    const cliCommand = adapter?.baseArgv?.[0]
    return Boolean(cliCommand) && isCommandAvailable(cliCommand)
  })

  PROVIDER_NAMES.length = 0
  PROVIDER_NAMES.push(...active)

  const disabled = ALL_PROVIDER_NAMES.filter((providerName) => !active.includes(providerName))
  DISABLED_PROVIDERS.length = 0
  DISABLED_PROVIDERS.push(...disabled)

  const newDefaultChain = DEFAULT_PROVIDER_ORDER
    .filter((provider) => PROVIDER_NAMES.includes(provider) && ADAPTERS[provider].defaultModel)
    .map((provider) => ({ provider, model: ADAPTERS[provider].defaultModel }))

  DEFAULT_CHAIN.length = 0
  DEFAULT_CHAIN.push(...newDefaultChain)

  return { PROVIDER_NAMES, DISABLED_PROVIDERS, DEFAULT_CHAIN }
}

async function refreshAllModels() {
  await Promise.all(ALL_PROVIDER_NAMES.map(refreshAdapterModels))
  refreshActiveProviders()
  lastModelRefresh = Date.now()
  return {
    adapters: ADAPTERS,
    providers: PROVIDER_NAMES,
    disabled: DISABLED_PROVIDERS,
    defaultChain: DEFAULT_CHAIN,
  }
}

const MODEL_REFRESH_TTL_MS = Number(process.env.GATEWAY_MODEL_REFRESH_TTL_MS) || 60_000
let lastModelRefresh = 0
let modelRefreshPromise = null
let queuedFreshRefreshPromise = null

function scheduleModelRefresh(force = false) {
  if (modelRefreshPromise) return modelRefreshPromise
  if (!force && Date.now() - lastModelRefresh < MODEL_REFRESH_TTL_MS) return null
  modelRefreshPromise = refreshAllModels().finally(() => { modelRefreshPromise = null })
  return modelRefreshPromise
}

function refreshModelsFresh() {
  if (!modelRefreshPromise) return scheduleModelRefresh(true)
  if (!queuedFreshRefreshPromise) {
    queuedFreshRefreshPromise = modelRefreshPromise
      .catch(() => undefined)
      .then(() => scheduleModelRefresh(true))
      .finally(() => { queuedFreshRefreshPromise = null })
  }
  return queuedFreshRefreshPromise
}

/**
 * Builds array of command line arguments for spawning an agent.
 * @param {Object} step
 * @param {string} prompt
 * @returns {Array<string>}
 */
function buildArgv(step, prompt, defaultThinkingLevel = 'medium') {
  if (!step || !step.provider) throw new Error('Invalid chain step')
  const adapter = ADAPTERS[step.provider]
  if (!adapter) throw new Error(`Unknown provider: ${step.provider}`)
  const model = resolveModel(adapter, step.model)
  const thinkingLevel = normalizeThinkingLevel(step.thinking_level ?? step.thinkingLevel ?? defaultThinkingLevel)
  return [
    ...adapter.baseArgv,
    ...adapter.modelArgv(model),
    ...(adapter.thinkingArgv?.(thinkingLevel) || []),
    ...adapter.promptArgv(prompt),
  ]
}

module.exports = {
  ADAPTERS,
  PROVIDER_NAMES,
  DISABLED_PROVIDERS,
  DEFAULT_CHAIN,
  buildChildEnv,
  isQuotaError,
  buildArgv,
  discoverHermesModels,
  refreshHermesModels,
  discoverCodexModels,
  discoverAgyModels,
  discoverGeminiModels,
  discoverOllamaModels,
  parseDiscoveredModels,
  parseOllamaModels,
  refreshLocalModels,
  refreshAdapterModels,
  refreshActiveProviders,
  refreshAllModels,
  scheduleModelRefresh,
  refreshModelsFresh,
  resolveModel,
  normalizeThinkingLevel,
}
