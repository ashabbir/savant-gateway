const test = require('node:test')
const assert = require('node:assert/strict')
const { raceChain, resolveSteps, launchProvider } = require('../chain')
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

test('launchProvider: unknown adapter -> skip', async () => {
  const result = await launchProvider({ provider: 'unknown' }, 'prompt', () => {}, '.')
  assert.equal(result.status, 'skip')
})

test('launchProvider: valid provider, ok', async () => {
  const spawn = async (argv, { onChunk }) => {
    onChunk('chunk1')
    return 'hello world'
  }
  const result = await launchProvider({ provider: 'codex' }, 'prompt', spawn, '.')
  assert.equal(result.status, 'ok')
  assert.equal(result.response, 'hello world')
  assert.deepEqual(result.chunks, ['chunk1'])
})

test('launchProvider: valid provider, fallback', async () => {
  const spawn = async () => 'quota exhausted'
  const result = await launchProvider({ provider: 'codex' }, 'prompt', spawn, '.')
  assert.equal(result.status, 'fallback')
  assert.ok(result.error)
})

test('launchProvider: valid provider, killed', async () => {
  const spawn = async () => { throw new Error('KILLED_BY_CLIENT') }
  const result = await launchProvider({ provider: 'codex' }, 'prompt', spawn, '.')
  assert.equal(result.status, 'killed')
})

test('launchProvider: valid provider, error', async () => {
  const spawn = async () => { throw new Error('other error') }
  const result = await launchProvider({ provider: 'codex' }, 'prompt', spawn, '.')
  assert.equal(result.status, 'error')
})

test('raceChain: All providers fail -> rejects with ALL_PROVIDERS_EXHAUSTED', async () => {
  const spawn = async () => { throw new Error('fail') }
  await assert.rejects(
    raceChain('hello', [{ provider: 'codex' }, { provider: 'gemini' }], { spawnAgent: spawn }),
    /ALL_PROVIDERS_EXHAUSTED/
  )
})

test('raceChain: Single provider succeeds immediately -> resolves with response', async () => {
  const spawn = async () => 'success'
  const result = await raceChain('hello', [{ provider: 'codex' }], { spawnAgent: spawn })
  assert.equal(result.response, 'success')
})

test('raceChain: Stagger delay works', async () => {
  const started = []
  const spawn = async (argv) => {
    started.push({ provider: argv[0], time: Date.now() })
    return new Promise(resolve => setTimeout(() => resolve('ok'), 50))
  }
  await raceChain('hello', [{ provider: 'codex' }, { provider: 'gemini' }], { spawnAgent: spawn, staggerMs: 20 })
  assert.equal(started.length, 2)
  assert.ok(started[1].time - started[0].time >= 15) // at least ~20ms stagger
})

test('raceChain: onKill callback receives a kill function', async () => {
  let killed = false
  let doKill = null
  const spawn = async (argv, { onKill }) => {
    onKill(() => { killed = true })
    return new Promise(resolve => setTimeout(() => resolve('ok'), 50))
  }
  const promise = raceChain('hello', [{ provider: 'codex' }], { spawnAgent: spawn, onKill: (k) => { doKill = k } })
  setTimeout(() => doKill(), 10)
  await promise
  assert.ok(killed)
})

test('raceChain: Chunks are delivered to onChunk callback only from winning provider', async () => {
  const chunks = []
  const spawn = async (argv, { onChunk }) => {
    if (argv[0] === 'codex') {
      onChunk('bad-chunk')
      throw new Error('fail')
    } else {
      onChunk('good-chunk')
      return 'win'
    }
  }
  const result = await raceChain('hello', [{ provider: 'codex' }, { provider: 'gemini' }], {
    spawnAgent: spawn,
    onChunk: (c) => chunks.push(c)
  })
  assert.equal(result.response, 'win')
  assert.deepEqual(chunks, ['good-chunk'])
})
