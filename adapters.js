const os = require('os')
const path = require('path')
const fs = require('fs')
const { spawn, spawnSync } = require('child_process')

const BASE_THINKING_LEVELS = ['low', 'medium', 'high']
const CLAUDE_THINKING_LEVELS = ['low', 'medium', 'high', 'xhigh', 'max']
const COPILOT_THINKING_LEVELS = ['none', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max']
const HERMES_THINKING_LEVELS = ['none', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max', 'ultra']
const ALL_THINKING_LEVELS = new Set([...BASE_THINKING_LEVELS, ...CLAUDE_THINKING_LEVELS, ...COPILOT_THINKING_LEVELS, ...HERMES_THINKING_LEVELS])

/**
 * Validates a requested effort against the union of every provider's levels.
 * Per-provider clamping happens in {@link thinkingLevelFor}.
 * @param {string} [value]
 * @returns {string}
 */
function normalizeThinkingLevel(value) {
  const level = String(value || 'medium').toLowerCase()
  if (!ALL_THINKING_LEVELS.has(level)) {
    throw new Error(`thinking_level must be one of: ${[...ALL_THINKING_LEVELS].join(', ')}`)
  }
  return level
}

/**
 * Returns the effort the adapter supports, falling back to its default so
 * mixed-provider chains never fail on a level only some CLIs accept.
 * @param {Object} adapter
 * @param {string} level
 * @returns {string}
 */
function thinkingLevelFor(adapter, level) {
  const levels = adapter?.thinkingLevels || BASE_THINKING_LEVELS
  return levels.includes(level) ? level : (adapter?.defaultThinkingLevel || 'medium')
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

function runDiscovery(command, args, { timeout = 5_000, env = buildChildEnv(), allowFailure = false } = {}) {
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
    child.on('close', (code) => finish(code === 0 || allowFailure ? stdout : ''))
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
  // Retained for diagnostics; the Hermes adapter only exposes its configured model.
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
 * Reads the model Hermes is configured to use (display only).
 * @returns {string}
 */
function readHermesConfiguredModel() {
  try {
    const yaml = fs.readFileSync(path.join(os.homedir(), '.hermes', 'config.yaml'), 'utf8')
    const block = yaml.match(/^model:\s*\n((?:[ \t]+.*\n?)*)/m)?.[1] || ''
    const model = block.match(/^\s+default:\s*(\S+)/m)?.[1]
    const provider = block.match(/^\s+provider:\s*(\S+)/m)?.[1]
    if (!model) return ''
    return provider ? `${provider}/${model}` : model
  } catch {
    return ''
  }
}

/**
 * Parses the entitled model catalog Copilot logs at debug level
 * (`[rust:capi_models] fetched models from CAPI /models {...}`).
 * Keeps chat models the account can pick; returns per-model effort support.
 * @param {string} logText
 * @returns {{ models: Array<string>, thinkingLevels: Object<string, Array<string>> }}
 */
function parseCopilotEntitledModels(logText) {
  const empty = { models: [], thinkingLevels: {} }
  if (typeof logText !== 'string') return empty
  const line = logText.split(/\r?\n/).reverse().find((entry) => entry.includes('fetched models from CAPI /models'))
  if (!line) return empty
  try {
    const payload = JSON.parse(line.slice(line.indexOf('{"count"')))
    const catalog = typeof payload.models === 'string' ? JSON.parse(payload.models) : payload.models
    const result = { models: [], thinkingLevels: {} }
    for (const model of Array.isArray(catalog) ? catalog : []) {
      if (!model?.id || !model.model_picker_enabled) continue
      if (model.capabilities?.type !== 'chat') continue
      if (model.policy?.state && model.policy.state !== 'enabled') continue
      result.models.push(model.id)
      const efforts = model.capabilities?.supports?.reasoning_effort
      result.thinkingLevels[model.id] = Array.isArray(efforts) ? efforts : []
    }
    return result
  } catch {
    return empty
  }
}

const COPILOT_MODELS_TTL_MS = 30 * 60 * 1000
let copilotModelsCache = null

/**
 * Discovers the Copilot models this account is entitled to. Requesting an
 * unknown model makes the CLI fetch the catalog and exit before any LLM call.
 * @returns {Promise<Array<string>>}
 */
async function discoverCopilotModels() {
  if (copilotModelsCache) {
    // Stale-while-revalidate: the probe takes seconds and /models must stay fast
    if (Date.now() - copilotModelsCache.at >= COPILOT_MODELS_TTL_MS && !copilotModelsCache.refreshing) {
      copilotModelsCache.refreshing = probeCopilotModels().finally(() => { if (copilotModelsCache) copilotModelsCache.refreshing = null })
    }
    return copilotModelsCache.models
  }
  return probeCopilotModels()
}

async function probeCopilotModels() {
  const logDir = fs.mkdtempSync(path.join(os.tmpdir(), 'savant-copilot-models-'))
  try {
    await runDiscovery('copilot', [
      '--log-level', 'all', '--log-dir', logDir,
      '--model', '__savant_model_probe__', '--prompt', 'probe',
    ], { timeout: 30_000, allowFailure: true })
    const logText = fs.readdirSync(logDir).map((name) => fs.readFileSync(path.join(logDir, name), 'utf8')).join('\n')
    const { models, thinkingLevels } = parseCopilotEntitledModels(logText)
    if (!models.length) return copilotModelsCache?.models || []
    ADAPTERS.copilot.modelThinkingLevels = thinkingLevels
    copilotModelsCache = { at: Date.now(), models: ['auto', ...models] }
    return copilotModelsCache.models
  } finally {
    fs.rmSync(logDir, { recursive: true, force: true })
  }
}

// Claude Code has no model-list command: aliases from `claude --help` plus current full IDs.
const CLAUDE_MODELS = [
  'fable', 'opus', 'sonnet', 'haiku',
  'claude-fable-5-1', 'claude-opus-5-5', 'claude-sonnet-5', 'claude-haiku-4-5-20251001',
]

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
    const levels = models
      .flatMap((model) => (Array.isArray(model?.supported_reasoning_levels) ? model.supported_reasoning_levels : []))
      .map((level) => String(level?.effort || level || '').toLowerCase())
      .filter(Boolean)
    if (levels.length) ADAPTERS.codex.thinkingLevels = [...new Set(levels)]
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
    discoverModels: async () => CLAUDE_MODELS,
    thinkingLevels: CLAUDE_THINKING_LEVELS,
    defaultThinkingLevel: 'medium',
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
    // `auto` and models without reasoning support reject an explicit effort
    thinkingArgv(level, model) {
      if (!model || model === 'auto') return model === 'auto' ? [] : ['--reasoning-effort', level]
      const supported = this.modelThinkingLevels?.[model]
      if (!supported) return ['--reasoning-effort', level]
      if (!supported.length) return []
      return ['--reasoning-effort', supported.includes(level) ? level : (supported.includes('medium') ? 'medium' : supported[0])]
    },
    promptArgv: (prompt) => ['--prompt', prompt],
    discoverModels: discoverCopilotModels,
    thinkingLevels: COPILOT_THINKING_LEVELS,
    defaultThinkingLevel: 'medium',
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
    thinkingArgv: (level) => ['--reasoning', level],
    promptArgv: (prompt) => ['--oneshot', prompt],
    // Only the configured model: full catalog discovery returns thousands of options.
    thinkingLevels: HERMES_THINKING_LEVELS,
    defaultThinkingLevel: 'medium',
    configuredModel: readHermesConfiguredModel,
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
  // Explicit opt-in so tests (and CI without every CLI) see the full provider set
  if (process.env.GATEWAY_ASSUME_ALL_PROVIDERS === '1') return true
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
  const thinkingLevel = thinkingLevelFor(adapter, normalizeThinkingLevel(step.thinking_level ?? step.thinkingLevel ?? defaultThinkingLevel))
  return [
    ...adapter.baseArgv,
    ...adapter.modelArgv(model),
    ...(adapter.thinkingArgv?.(thinkingLevel, model) || []),
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
  thinkingLevelFor,
  parseCopilotEntitledModels,
  discoverCopilotModels,
  readHermesConfiguredModel,
  BASE_THINKING_LEVELS,
}
