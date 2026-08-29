const test = require('node:test')
const assert = require('node:assert/strict')
const path = require('path')
const os = require('os')
const fs = require('fs')
const {
  calculateBenchmarkMetrics,
  buildJudgePrompt,
  ComparisonStore,
} = require('../comparisons')

test('calculateBenchmarkMetrics', async (t) => {
  await t.test('calculates correct TTFT, TPS, and ratings', () => {
    const metrics = calculateBenchmarkMetrics({
      totalTimeMs: 4000,
      firstTokenMs: 500,
      streamTimeMs: 3500,
      tokenCount: 140,
      charCount: 560,
      provider: 'ollama',
    })

    assert.equal(metrics.ttftSec, 0.5)
    assert.equal(metrics.totalSec, 4.0)
    assert.equal(metrics.tokensPerSecond, 40)
    assert.equal(metrics.speedRating, 'Fast')
    assert.equal(metrics.latencyRating, 'Instant')
    assert.equal(metrics.isLocal, true)
    assert.equal(metrics.costTier, 'Free (Local Host)')
  })
})

test('buildJudgePrompt', async (t) => {
  await t.test('builds structured prompt with candidate responses', () => {
    const prompt = buildJudgePrompt({
      prompt: 'Write hello world in Python',
      candidates: [
        { label: 'Model A', provider: 'ollama', model: 'deepseek-r1:8b', response: 'print("hello world")' },
        { label: 'Model B', provider: 'gemini', model: 'gemini-2.5-flash', response: 'print("Hello, World!")' },
      ],
    })

    assert.match(prompt, /LLM Comparison & Benchmark Evaluation Task/)
    assert.match(prompt, /Model A \(ollama:deepseek-r1:8b\)/)
    assert.match(prompt, /Model B \(gemini:gemini-2.5-flash\)/)
    assert.match(prompt, /Correctness & Accuracy/)
  })
})

test('ComparisonStore', async (t) => {
  const tmpFile = path.join(os.tmpdir(), `test-comparisons-${Date.now()}.json`)
  const store = new ComparisonStore({ storagePath: tmpFile, persist: true })

  try {
    const comp = store.createComparison({
      prompt: 'Compare algorithms',
      participants: [
        { runId: 'run-1', provider: 'ollama', model: 'deepseek-r1:8b', status: 'running' },
        { runId: 'run-2', provider: 'gemini', model: 'gemini-2.5-flash', status: 'running' },
      ],
    })

    assert.equal(comp.prompt, 'Compare algorithms')
    assert.equal(comp.participants.length, 2)

    // Update participant 1 completion
    store.updateParticipantByRunId(comp.id, 'run-1', {
      status: 'complete',
      response: 'Algorithm A explanation',
      stats: { totalTimeMs: 2000, firstTokenMs: 400, streamTimeMs: 1600, tokenCount: 80 },
    })

    const updated = store.getComparison(comp.id)
    assert.equal(updated.participants[0].status, 'complete')
    assert.equal(updated.participants[0].benchmark.tokensPerSecond, 50)

    // Cast vote
    store.setVote(comp.id, { winner: 'run-1', feedback: 'Model A was clearer' })
    const voted = store.getComparison(comp.id)
    assert.equal(voted.vote.winner, 'run-1')

    // Check leaderboard
    const { leaderboard } = store.getLeaderboard()
    assert.ok(Array.isArray(leaderboard))
    assert.ok(leaderboard.some((l) => l.provider === 'ollama' && l.wins === 1))

    // Delete comparison
    assert.equal(store.deleteComparison(comp.id), true)
    assert.equal(store.getComparison(comp.id), null)
  } finally {
    if (fs.existsSync(tmpFile)) {
      fs.unlinkSync(tmpFile)
    }
  }
})
