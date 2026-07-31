const test = require('node:test')
const assert = require('node:assert/strict')
const { spawnAgent } = require('../runner')

test('spawnAgent returns stdout and streams it to the caller', async () => {
  const chunks = []
  const output = await spawnAgent([process.execPath, '-e', 'process.stdout.write("done")'], {
    onChunk: (chunk) => chunks.push(chunk),
  })

  assert.equal(output, 'done')
  assert.deepEqual(chunks, ['done'])
})

test('spawnAgent rejects when the caller cancels an active child process', async () => {
  let cancel
  const promise = spawnAgent([process.execPath, '-e', 'setInterval(() => {}, 1_000)'], {
    onKill: (kill) => { cancel = kill },
  })

  assert.equal(typeof cancel, 'function')
  cancel()
  await assert.rejects(promise, /KILLED_BY_CLIENT/)
})
