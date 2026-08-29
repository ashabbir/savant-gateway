const test = require('node:test')
const assert = require('node:assert/strict')
const { buildArgv, parseOllamaModels } = require('../adapters')

test('Gemini uses the installed non-interactive CLI contract', () => {
  assert.deepEqual(
    buildArgv({ provider: 'gemini', model: 'gemini-2.5-flash' }, 'hello'),
    ['gemini', '--dangerously-skip-permissions', '--model', 'gemini-2.5-flash', '--print', 'hello'],
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
    ['ollama', 'run', 'deepseek-r1:8b', 'hello'],
  )
})
