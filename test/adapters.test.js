const test = require('node:test')
const assert = require('node:assert/strict')
const {
  buildArgv,
  normalizeThinkingLevel,
  parseDiscoveredModels,
  parseOllamaModels,
} = require('../adapters')

test('Gemini uses the installed non-interactive CLI contract', () => {
  assert.deepEqual(
    buildArgv({ provider: 'gemini', model: 'gemini-2.5-flash' }, 'hello'),
    [
      'gemini', '--dangerously-skip-permissions', '--model', 'gemini-2.5-flash',
      '--effort', 'medium', '--print', 'hello',
    ],
  )
})

test('Ollama model discovery parses the CLI table', () => {
  assert.deepEqual(
    parseOllamaModels('NAME                 ID              SIZE\ngemma4:12b-it-qat    abc             7.2 GB\ndeepseek-r1:8b       def             5.2 GB\n'),
    ['gemma4:12b-it-qat', 'deepseek-r1:8b'],
  )
})

test('Ollama runs with the selected model before the prompt', () => {
  assert.deepEqual(
    buildArgv({ provider: 'ollama', model: 'deepseek-r1:8b' }, 'hello'),
    ['ollama', 'run', 'deepseek-r1:8b', '--think', 'medium', 'hello'],
  )
})

test('thinking level defaults to medium and accepts any provider-supported level', () => {
  assert.equal(normalizeThinkingLevel(), 'medium')
  assert.equal(normalizeThinkingLevel('LOW'), 'low')
  assert.equal(normalizeThinkingLevel('max'), 'max')
  assert.throws(() => normalizeThinkingLevel('bogus'), /thinking_level/)
})

test('provider argv receives native thinking effort with per-step overrides', () => {
  assert.deepEqual(
    buildArgv({ provider: 'claude', model: 'configured' }, 'hello', 'high'),
    ['claude', '-p', '--dangerously-skip-permissions', '--effort', 'high', 'hello'],
  )
  assert.deepEqual(
    buildArgv({ provider: 'codex', model: 'fast', thinking_level: 'low' }, 'hello', 'high'),
    [
      'codex', 'exec', '--sandbox', 'workspace-write', '--skip-git-repo-check',
      '-c', 'service_tier="fast"',
      '-c', 'model_reasoning_effort="low"', 'hello',
    ],
  )
})

test('tabular CLI model discovery uses provider output rather than static lists', () => {
  assert.deepEqual(
    parseDiscoveredModels('gemini-3.8-flash-high\tGemini 3.8 Flash (High)\nclaude-sonnet-4-6\tClaude Sonnet\n'),
    ['gemini-3.8-flash-high', 'claude-sonnet-4-6'],
  )
})

test('adapter-owned discovery populates the provider model catalog', async (t) => {
  const { ADAPTERS, refreshAdapterModels } = require('../adapters')
  t.mock.method(ADAPTERS.gemini, 'discoverModels', async () => ['live-one', 'live-two'])
  await refreshAdapterModels('gemini')
  assert.deepEqual(ADAPTERS.gemini.availableModels, ['configured', 'live-one', 'live-two'])
})

test('transient empty discovery preserves the last good model catalog', async (t) => {
  const { ADAPTERS, refreshAdapterModels } = require('../adapters')
  ADAPTERS.gemini.availableModels = ['configured', 'live-one']
  t.mock.method(ADAPTERS.gemini, 'discoverModels', async () => [])
  await refreshAdapterModels('gemini')
  assert.deepEqual(ADAPTERS.gemini.availableModels, ['configured', 'live-one'])
})

test('Hermes exposes only its configured model', async () => {
  const { ADAPTERS, refreshAdapterModels } = require('../adapters')
  ADAPTERS.hermes.availableModels = ['configured']
  await refreshAdapterModels('hermes')
  assert.deepEqual(ADAPTERS.hermes.availableModels, ['configured'])
  assert.equal(ADAPTERS.hermes.discoverModels, undefined)
})

test('Copilot discovery keeps only entitled chat models with their effort support', () => {
  const { parseCopilotEntitledModels } = require('../adapters')
  const catalog = [
    { id: 'claude-sonnet-5', model_picker_enabled: true, policy: { state: 'enabled' }, capabilities: { type: 'chat', supports: { reasoning_effort: ['low', 'high'] } } },
    { id: 'claude-haiku-4.5', model_picker_enabled: true, policy: { state: 'enabled' }, capabilities: { type: 'chat', supports: {} } },
    { id: 'gpt-5.6-luna-utility', model_picker_enabled: false, capabilities: { type: 'chat' } },
    { id: 'blocked', model_picker_enabled: true, policy: { state: 'disabled' }, capabilities: { type: 'chat' } },
    { id: 'text-embedding-3-small', model_picker_enabled: true, capabilities: { type: 'embeddings' } },
  ]
  const log = `2026-09-29T01:59:12Z [DEBUG] [rust:capi_models] fetched models from CAPI /models ${JSON.stringify({ count: 5, models: JSON.stringify(catalog) })}`
  assert.deepEqual(parseCopilotEntitledModels(log), {
    models: ['claude-sonnet-5', 'claude-haiku-4.5'],
    thinkingLevels: { 'claude-sonnet-5': ['low', 'high'], 'claude-haiku-4.5': [] },
  })
})

test('Copilot effort follows per-model support', () => {
  const { ADAPTERS } = require('../adapters')
  ADAPTERS.copilot.modelThinkingLevels = { 'claude-haiku-4.5': [], 'kimi-k3': ['low', 'high', 'max'] }
  assert.deepEqual(buildArgv({ provider: 'copilot', model: 'claude-haiku-4.5', thinking_level: 'high' }, 'hi'),
    ['copilot', '--allow-all', '--model', 'claude-haiku-4.5', '--prompt', 'hi'])
  assert.deepEqual(buildArgv({ provider: 'copilot', model: 'kimi-k3', thinking_level: 'medium' }, 'hi'),
    ['copilot', '--allow-all', '--model', 'kimi-k3', '--reasoning-effort', 'low', '--prompt', 'hi'])
  delete ADAPTERS.copilot.modelThinkingLevels
})

test('effort is passed natively per provider and clamped to supported levels', () => {
  assert.deepEqual(
    buildArgv({ provider: 'copilot', model: 'gpt-5.6-luna', thinking_level: 'xhigh' }, 'hi'),
    ['copilot', '--allow-all', '--model', 'gpt-5.6-luna', '--reasoning-effort', 'xhigh', '--prompt', 'hi'],
  )
  assert.deepEqual(
    buildArgv({ provider: 'copilot', model: 'auto', thinking_level: 'high' }, 'hi'),
    ['copilot', '--allow-all', '--model', 'auto', '--prompt', 'hi'],
  )
  assert.deepEqual(
    buildArgv({ provider: 'hermes', model: 'configured', thinking_level: 'ultra' }, 'hi'),
    ['hermes', '--yolo', '--reasoning', 'ultra', '--oneshot', 'hi'],
  )
  assert.deepEqual(
    buildArgv({ provider: 'claude', model: 'opus', thinking_level: 'max' }, 'hi'),
    ['claude', '-p', '--dangerously-skip-permissions', '--model', 'opus', '--effort', 'max', 'hi'],
  )
  // Gemini only supports low/medium/high, so an unsupported level falls back to its default
  assert.deepEqual(
    buildArgv({ provider: 'gemini', model: 'configured', thinking_level: 'max' }, 'hi'),
    ['gemini', '--dangerously-skip-permissions', '--effort', 'medium', '--print', 'hi'],
  )
})

test('Ollama avoids choosing an embedding model as its chat default', async (t) => {
  const { ADAPTERS, refreshAdapterModels } = require('../adapters')
  t.mock.method(ADAPTERS.ollama, 'discoverModels', async () => ['nomic-embed-text:latest', 'llama3:latest'])
  ADAPTERS.ollama.defaultModel = ''
  await refreshAdapterModels('ollama')
  assert.equal(ADAPTERS.ollama.defaultModel, 'llama3:latest')
})

test('refreshActiveProviders updates PROVIDER_NAMES, DISABLED_PROVIDERS, and DEFAULT_CHAIN', () => {
  const { refreshActiveProviders, PROVIDER_NAMES, DISABLED_PROVIDERS, DEFAULT_CHAIN } = require('../adapters')
  const result = refreshActiveProviders()
  assert.ok(Array.isArray(result.PROVIDER_NAMES))
  assert.ok(Array.isArray(result.DISABLED_PROVIDERS))
  assert.ok(Array.isArray(result.DEFAULT_CHAIN))
  assert.equal(result.PROVIDER_NAMES, PROVIDER_NAMES)
  assert.equal(result.DISABLED_PROVIDERS, DISABLED_PROVIDERS)
  assert.equal(result.DEFAULT_CHAIN, DEFAULT_CHAIN)
})

test('refreshAllModels discovers and refreshes all model adapters', async () => {
  const { refreshAllModels, ADAPTERS } = require('../adapters')
  const result = await refreshAllModels()
  assert.ok(result.adapters)
  assert.ok(Array.isArray(result.providers))
  assert.ok(Array.isArray(result.adapters.ollama.availableModels))
  assert.ok(typeof result.adapters.ollama.defaultModel === 'string')
})
