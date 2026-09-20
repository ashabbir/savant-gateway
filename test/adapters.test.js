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

test('thinking level defaults to medium and accepts only low, medium, or high', () => {
  assert.equal(normalizeThinkingLevel(), 'medium')
  assert.equal(normalizeThinkingLevel('LOW'), 'low')
  assert.equal(normalizeThinkingLevel('high'), 'high')
  assert.throws(() => normalizeThinkingLevel('max'), /thinking_level/)
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
  ADAPTERS.hermes.availableModels = ['configured', 'openrouter/example/model']
  t.mock.method(ADAPTERS.hermes, 'discoverModels', async () => [])
  await refreshAdapterModels('hermes')
  assert.deepEqual(ADAPTERS.hermes.availableModels, ['configured', 'openrouter/example/model'])
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
