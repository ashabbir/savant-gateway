const test = require('node:test')
const assert = require('node:assert/strict')
const { raceChain, resolveSteps } = require('../chain')
const { DEFAULT_CHAIN } = require('../adapters')

test('resolveSteps handles edge cases and returns valid chains', () => {
  assert.equal(resolveSteps(null), DEFAULT_CHAIN)
  assert.equal(resolveSteps(undefined), DEFAULT_CHAIN)
  assert.equal(resolveSteps([]), DEFAULT_CHAIN)
  assert.equal(resolveSteps('not an array'), DEFAULT_CHAIN)
  
  const valid = [{ provider: 'test' }]
  assert.equal(resolveSteps(valid), valid)
})
test('raceChain returns the first successful provider and kills slower attempts', async () => {
  const killed = []
  const spawn = (argv, { onKill }) => new Promise((resolve) => {
    const provider = argv[0]
    const timer = setTimeout(() => resolve(provider), provider === 'codex' ? 30 : 5)
    onKill(() => { killed.push(provider); clearTimeout(timer) })
  })

  const result = await raceChain('hello', [
    { provider: 'codex', model: 'fast' },
    { provider: 'gemini', model: 'gemini-2.5-flash' },
  ], { spawnAgent: spawn, concurrency: 2, staggerMs: 0 })

  assert.equal(result.step.provider, 'gemini')
  assert.ok(killed.includes('codex'))
})

test('raceChain continues after an early provider failure', async () => {
  const spawn = (argv, { onKill }) => new Promise((resolve, reject) => {
    onKill(() => {})
    if (argv[0] === 'codex') reject(new Error('quota exhausted'))
    else setTimeout(() => resolve('ok'), 5)
  })

  const result = await raceChain('hello', [
    { provider: 'codex', model: 'fast' },
    { provider: 'gemini', model: 'gemini-2.5-flash' },
  ], { spawnAgent: spawn, concurrency: 2, staggerMs: 0 })

  assert.equal(result.response, 'ok')
})
