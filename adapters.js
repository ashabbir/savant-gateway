const os = require('os')
const path = require('path')
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

function buildChildEnv(extra = {}) {
  const current = process.env.PATH || ''
  const parts = current.split(':').filter(Boolean)
  const seen = new Set(parts)
  for (const dir of EXTRA_PATH_DIRS) {
    if (!seen.has(dir)) { parts.push(dir); seen.add(dir) }
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

const isQuotaError = (res) => res && QUOTA_PATTERNS.some(re => re.test(res))

function resolveModel(adapter, model) {
  const requested = model || adapter.defaultModel
  return adapter.modelAliases?.[requested] || requested
}

const ADAPTERS = {
  claude: {
    name: 'claude',
    label: 'Claude',
    baseArgv: ['claude', '-p', '--dangerously-skip-permissions'],
    modelArgv: (model) => model ? ['--model', model] : [],
    promptArgv: (prompt) => [prompt],
    defaultModel: 'haiku',
    availableModels: [
      'haiku',
      'sonnet',
      'opus',
      'claude-haiku-4-5-20251001',
      'claude-sonnet-4-6',
      'claude-opus-4-7',
    ],
  },
  copilot: {
    name: 'copilot',
    label: 'Copilot',
    // --allow-all = --allow-all-tools + --allow-all-paths + --allow-all-urls
    // Prompt must be passed as a flag value, not a positional arg.
    baseArgv: ['copilot', '--allow-all'],
    modelArgv: (model) => model ? ['--model', model] : [],
    promptArgv: (prompt) => ['--prompt', prompt],
    defaultModel: 'claude-haiku-4.5',
    availableModels: [
      'claude-haiku-4.5',
      'claude-sonnet-4.6',
      'claude-opus-4.7',
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
    modelArgv: (model) => model ? ['--model', model, '-c', 'service_tier="fast"'] : [],
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
    baseArgv: ['gemini', '--yolo'],
    modelArgv: (model) => model ? ['-m', model] : [],
    promptArgv: (prompt) => [prompt],
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
    baseArgv: ['agy', '-p'],
    modelAliases: {
      fast: 'Gemini 3.5 Flash (Low)',
    },
    modelArgv: (model) => model ? ['--model', model] : [],
    promptArgv: (prompt) => [prompt],
    defaultModel: 'fast',
    availableModels: [
      'fast',
      'Gemini 3.5 Flash (Medium)',
      'Gemini 3.5 Flash (High)',
      'Gemini 3.5 Flash (Low)',
      'Gemini 3.1 Pro (Low)',
      'Gemini 3.1 Pro (High)',
      'Claude Sonnet 4.6 (Thinking)',
      'Claude Opus 4.6 (Thinking)',
      'GPT-OSS 120B (Medium)',
    ],
  },
}

const ALL_PROVIDER_NAMES = ['claude', 'copilot', 'codex', 'gemini', 'agy']

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
  { provider: 'claude',  model: 'haiku' },
  { provider: 'copilot', model: 'claude-haiku-4.5' },
  { provider: 'gemini',  model: 'gemini-2.5-flash' },
  { provider: 'agy',     model: 'fast' },
  { provider: 'codex',   model: 'fast' },
].filter((step) => PROVIDER_NAMES.includes(step.provider))

function buildArgv(step, prompt) {
  const adapter = ADAPTERS[step.provider]
  if (!adapter) throw new Error(`Unknown provider: ${step.provider}`)
  const model = resolveModel(adapter, step.model)
  return [
    ...adapter.baseArgv,
    ...adapter.modelArgv(model),
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
  resolveModel,
}
