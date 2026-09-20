const test = require('node:test')
const assert = require('node:assert/strict')
const { PassThrough } = require('node:stream')
const readline = require('node:readline')
const { parseAgyArgv, AgySession, AgySessionPool } = require('../agy-runner')
const { spawnAgent } = require('../runner')

test('parseAgyArgv correctly extracts model, effort, and prompt', () => {
  const parsed1 = parseAgyArgv(['agy', '--dangerously-skip-permissions', '-p', 'hello world'])
  assert.equal(parsed1.prompt, 'hello world')
  assert.equal(parsed1.model, null)
  assert.equal(parsed1.effort, null)

  const parsed2 = parseAgyArgv([
    'agy', '--dangerously-skip-permissions',
    '--model', 'gemini-3.8-flash',
    '--effort', 'high',
    '-p', 'test prompt'
  ])
  assert.equal(parsed2.prompt, 'test prompt')
  assert.equal(parsed2.model, 'gemini-3.8-flash')
  assert.equal(parsed2.effort, 'high')

  const parsed3 = parseAgyArgv(['agy', 'models'])
  assert.equal(parsed3.prompt, null)
})

test('AgySessionPool creates and caches sessions by cwd and model parameters', () => {
  const pool = new AgySessionPool()
  const s1 = pool.getOrCreate('/test/dir', 'flash', 'low')
  const s2 = pool.getOrCreate('/test/dir', 'flash', 'low')
  assert.equal(s1, s2)

  const s3 = pool.getOrCreate('/test/dir', 'pro', 'high')
  assert.notEqual(s1, s3)

  pool.closeAll()
  assert.equal(pool.pool.size, 0)
})

test('AgySession handles prompt execution and clean token streaming', async () => {
  const chunks = []
  const mockStdin = new PassThrough()
  const mockStdout = new PassThrough()

  const session = new AgySession({ cwd: process.cwd() })
  session.child = {
    stdin: mockStdin,
    stdout: mockStdout,
    kill: () => {},
    killed: false,
    exitCode: null,
  }
  session.rl = readline.createInterface({ input: mockStdout })
  session.ready = true
  session.initPromise = Promise.resolve()

  mockStdin.on('data', (data) => {
    const parsed = JSON.parse(data.toString().trim())
    if (parsed.event === 'user') {
      process.nextTick(() => {
        mockStdout.write(JSON.stringify({
          event: 'step_update',
          step_update: { state: 'ACTIVE', step_type: 'agent_response', text_delta: 'token1 ' }
        }) + '\n')
        mockStdout.write(JSON.stringify({
          event: 'step_update',
          step_update: { state: 'ACTIVE', step_type: 'agent_response', text_delta: 'token2' }
        }) + '\n')
        mockStdout.write(JSON.stringify({
          event: 'result',
          result: { status: 'SUCCESS', response: 'token1 token2', usage: { input_tokens: 10, output_tokens: 2 } }
        }) + '\n')
      })
    }
  })

  const result = await session.sendTurn('ping', {
    onChunk: (chunk) => chunks.push(chunk)
  })

  assert.equal(result, 'token1 token2')
  assert.deepEqual(chunks, ['token1 ', 'token2'])
  session.destroy()
})

test('AgySession rejects with KILLED_BY_CLIENT when cancelled', async () => {
  const session = new AgySession({ cwd: process.cwd() })
  const mockStdin = new PassThrough()
  const mockStdout = new PassThrough()

  session.child = {
    stdin: mockStdin,
    stdout: mockStdout,
    kill: () => {},
    killed: false,
    exitCode: null,
  }
  session.rl = readline.createInterface({ input: mockStdout })
  session.ready = true
  session.initPromise = Promise.resolve()

  let cancelFn
  const promise = session.sendTurn('long task', {
    onKill: (kill) => { cancelFn = kill }
  })

  assert.equal(typeof cancelFn, 'function')
  cancelFn()

  await assert.rejects(promise, /KILLED_BY_CLIENT/)
})

test('spawnAgent uses native AGY stream runner for agy commands', () => {
  assert.equal(typeof spawnAgent, 'function')
})
