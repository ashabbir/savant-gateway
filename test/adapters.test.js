const test = require('node:test')
const assert = require('node:assert/strict')
const { buildArgv } = require('../adapters')

test('Gemini uses the installed non-interactive CLI contract', () => {
  assert.deepEqual(
    buildArgv({ provider: 'gemini', model: 'gemini-2.5-flash' }, 'hello'),
    ['gemini', '--dangerously-skip-permissions', '--model', 'gemini-2.5-flash', '--print', 'hello'],
  )
})
