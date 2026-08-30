const os = require('os')
const path = require('path')
const fs = require('fs')
const { spawnSync } = require('child_process')

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
  if (requested && adapter.modelAliases && Object.hasOwn(adapter.modelAliases, requested)) {
    return adapter.modelAliases[requested]
  }
  return requested
}

const HERMES_PYTHON = process.env.HERMES_PYTHON || path.join(
  os.homedir(), '.hermes', 'hermes-agent', 'venv', 'bin', 'python',
)

/**
 * Discovers available models from local Hermes CLI if installed.
 * @returns {Array<string>}
 */
function discoverHermesModels() {
  if (!fs.existsSync(HERMES_PYTHON)) return []

  const probe = spawnSync(HERMES_PYTHON, ['-c', [
    'import json',
    'from hermes_cli.model_switch import list_authenticated_providers',
    'print(json.dumps(list_authenticated_providers(max_models=10000)))',
  ].join('; ')], { encoding: 'utf8', timeout: 5_000 })

  if (probe.status !== 0 || !probe.stdout) return []
  try {
    const providers = JSON.parse(probe.stdout)
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
function discoverAgyModels() {
  const probe = spawnSync('agy', ['models'], {
    env: buildChildEnv(),
    encoding: 'utf8',
    timeout: 5_000,
  })
  if (probe.status !== 0 || !probe.stdout) return []
  return [...new Set(probe.stdout.split(/\r?\n/).map((model) => model.trim()).filter(Boolean))]
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
function discoverOllamaModels() {
  const probe = spawnSync('ollama', ['list'], {
    env: buildChildEnv(),
    encoding: 'utf8',
    timeout: 5_000,
  })
  if (probe.status !== 0 || !probe.stdout) return []
  return parseOllamaModels(probe.stdout)
}

const ADAPTERS = {
  claude: {
    name: 'claude',
    label: 'Claude',
    baseArgv: ['claude', '-p', '--dangerously-skip-permissions'],
    modelArgv: (model) => (model ? ['--model', model] : []),
    systemArgv: (system) => ['--system-prompt', system],
    promptArgv: (prompt) => [prompt],
    defaultModel: 'haiku',
    availableModels: [
      'haiku',
      'sonnet',
      'opus',
      'claude-haiku-4-5-20251001',
      'claude-sonnet-4-6',
      'claude-sonnet-5',
      'claude-opus-4-7',
      'claude-opus-4-8',
      'claude-fable-5',
    ],
  },
  copilot: {
    name: 'copilot',
    label: 'Copilot',
    baseArgv: ['copilot', '--allow-all'],
    modelArgv: (model) => (model ? ['--model', model] : []),
    promptArgv: (prompt) => ['--prompt', prompt],
    defaultModel: 'claude-haiku-4.5',
    availableModels: [
      'claude-haiku-4.5',
      'claude-sonnet-4.6',
      'claude-sonnet-5',
      'claude-opus-4.7',
      'claude-opus-4.8',
      'claude-fable-5',
      'gpt-4.1',
      'gpt-5-mini',
    ],
  },
  codex: {
    name: 'codex',
    label: 'Codex',
    baseArgv: ['codex', 'exec', '--sandbox', 'workspace-write', '--skip-git-repo-check'],
    modelAliases: {
      fast: 'gpt-5.5',
    },
    modelArgv: (model) => (model ? ['--model', model, '-c', 'service_tier="fast"'] : []),
    promptArgv: (prompt) => [prompt],
    defaultModel: 'fast',
    availableModels: [
      'fast',
      'gpt-5.5',
    ],
  },
  gemini: {
    name: 'gemini',
    label: 'Gemini',
    baseArgv: ['gemini', '--dangerously-skip-permissions'],
    modelArgv: (model) => (model ? ['--model', model] : []),
    promptArgv: (prompt) => ['--print', prompt],
    defaultModel: 'gemini-2.5-flash',
    availableModels: [
      'gemini-2.5-flash',
      'gemini-2.5-pro',
      'gemini-2.0-flash',
      'gemini-2.0-flash-exp',
    ],
  },
  agy: {
    name: 'agy',
    label: 'AGY',
    baseArgv: ['agy', '--dangerously-skip-permissions'],
    modelAliases: {
      fast: 'Gemini 3.5 Flash (Low)',
    },
    modelArgv: (model) => (model ? ['--model', model] : []),
    promptArgv: (prompt) => ['-p', prompt],
    defaultModel: 'fast',
    availableModels: [
      'fast',
      'Gemini 3.5 Flash (Medium)',
      'Gemini 3.5 Flash (High)',
      'Gemini 3.5 Flash (Low)',
      'Gemini 3.1 Pro (Low)',
      'Gemini 3.1 Pro (High)',
      'Claude Sonnet 4.6 (Thinking)',
      'Claude Sonnet 5 (Thinking)',
      'Claude Opus 4.6 (Thinking)',
      'Claude Opus 4.8 (Thinking)',
      'GPT-OSS 120B (Medium)',
    ],
  },
  hermes: {
    name: 'hermes',
    label: 'Hermes',
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
    promptArgv: (prompt) => ['--oneshot', prompt],
    defaultModel: 'configured',
    availableModels: ['configured'],
  },
  ollama: {
    name: 'ollama',
    label: 'Ollama',
    baseArgv: ['ollama', 'run'],
    modelArgv: (model) => (model ? [model] : []),
    promptArgv: (prompt) => [prompt],
    defaultModel: '',
    availableModels: [],
  },
}

function refreshHermesModels() {
  const models = discoverHermesModels()
  ADAPTERS.hermes.availableModels = ['configured', ...models]
  ADAPTERS.hermes.defaultModel = 'configured'
  return ADAPTERS.hermes
}

function refreshLocalModels() {
  const codexModels = discoverCodexModels()
  if (codexModels.length > 0) {
    ADAPTERS.codex.availableModels = codexModels
  }
  const agyModels = discoverAgyModels()
  if (agyModels.length > 0) {
    ADAPTERS.agy.availableModels = agyModels
  }
  const ollamaModels = discoverOllamaModels()
  ADAPTERS.ollama.availableModels = ollamaModels
  ADAPTERS.ollama.defaultModel = ollamaModels[0] || ''
  return { codex: ADAPTERS.codex, agy: ADAPTERS.agy, ollama: ADAPTERS.ollama }
}

refreshHermesModels()
refreshLocalModels()

const MODEL_REFRESH_TTL_MS = Number(process.env.GATEWAY_MODEL_REFRESH_TTL_MS) || 60_000
let lastModelRefresh = Date.now()
let modelRefreshPending = false

function scheduleModelRefresh(force = false) {
  if (modelRefreshPending || (!force && Date.now() - lastModelRefresh < MODEL_REFRESH_TTL_MS)) return
  modelRefreshPending = true
  setImmediate(() => {
    try {
      refreshHermesModels()
      refreshLocalModels()
      lastModelRefresh = Date.now()
    } finally {
      modelRefreshPending = false
    }
  })
}

const ALL_PROVIDER_NAMES = ['claude', 'copilot', 'codex', 'gemini', 'agy', 'hermes', 'ollama']

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

const DEFAULT_CHAIN = [
  { provider: 'codex', model: 'fast' },
  { provider: 'hermes', model: ADAPTERS.hermes.defaultModel },
  { provider: 'claude', model: 'haiku' },
  { provider: 'copilot', model: 'claude-haiku-4.5' },
  { provider: 'gemini', model: 'gemini-2.5-flash' },
  { provider: 'agy', model: 'fast' },
  { provider: 'ollama', model: ADAPTERS.ollama.defaultModel },
].filter((step) => PROVIDER_NAMES.includes(step.provider) && step.model)

/**
 * Builds array of command line arguments for spawning an agent.
 * @param {Object} step
 * @param {string} prompt
 * @param {string} [system]
 * @returns {Array<string>}
 */
function buildArgv(step, prompt, system) {
  if (!step || !step.provider) throw new Error('Invalid chain step')
  const adapter = ADAPTERS[step.provider]
  if (!adapter) throw new Error(`Unknown provider: ${step.provider}`)
  const model = resolveModel(adapter, step.model)
  const systemArgv = system && adapter.systemArgv ? adapter.systemArgv(system) : []
  return [
    ...adapter.baseArgv,
    ...adapter.modelArgv(model),
    ...systemArgv,
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
  discoverOllamaModels,
  parseOllamaModels,
  refreshLocalModels,
  scheduleModelRefresh,
  resolveModel,
}
