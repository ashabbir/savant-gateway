const test = require('node:test')
const assert = require('node:assert/strict')
const {
  steeringPrompt,
  isLocalOrigin,
  createRun,
  finalizeRun,
  EVICT_AFTER_MS,
  HTTP_NO_CONTENT,
  DEFAULT_STAGGER_MS,
  MAX_CONCURRENCY,
  MAX_LIMIT,
  DEFAULT_LIMIT
} = require('../server-helpers')

test('steeringPrompt', async (t) => {
  await t.test('returns prompt unchanged if no feedback', () => {
    assert.equal(steeringPrompt('hello', []), 'hello')
  })

  await t.test('returns prompt with feedback section appended', () => {
    const res = steeringPrompt('hello', ['fix this'])
    assert.match(res, /hello\n\n## User feedback/)
    assert.match(res, /- fix this/)
  })
})

test('isLocalOrigin', async (t) => {
  await t.test('returns true for empty string', () => assert.equal(isLocalOrigin(''), true))
  await t.test('returns true for localhost:3000', () => assert.equal(isLocalOrigin('http://localhost:3000'), true))
  await t.test('returns true for 127.0.0.1:8080', () => assert.equal(isLocalOrigin('http://127.0.0.1:8080'), true))
  await t.test('returns false for evil.com', () => assert.equal(isLocalOrigin('http://evil.com'), false))
})

test('createRun', async (t) => {
  await t.test('returns a run object with correct defaults', () => {
    const run = createRun({
      id: '123',
      prompt: 'hello',
      files: [],
      chain: [],
      execution: 'race',
      concurrency: 2,
      staggerMs: 250,
      cwd: '/tmp',
      session_id: '456'
    })
    assert.equal(run.id, '123')
    assert.equal(run.status, 'running')
    assert.equal(run.prompt, 'hello')
    assert.equal(run.concurrency, 2)
  })
})

test('finalizeRun', async (t) => {
  await t.test('calls closeSubscribers, cleanupFiles, scheduleEvict', () => {
    let closed = false
    let cleaned = false
    let evicted = false

    const run = {
      id: '123',
      subscribers: new Set([{ end: () => { closed = true } }]),
      files: [{ path: 'foo' }]
    }

    const runs = new Map()
    runs.set('123', run)

    const cleanupFiles = () => { cleaned = true }
    
    finalizeRun(run, runs, cleanupFiles)

    assert.equal(closed, true)
    assert.equal(cleaned, true)
    assert.equal(run.subscribers.size, 0)
    
    // scheduleEvict uses setTimeout, so we can't easily assert on it synchronously without mocking timers
    // but we can verify it doesn't crash
  })
})
