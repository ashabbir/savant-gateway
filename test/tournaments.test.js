const test = require('node:test')
const assert = require('node:assert/strict')
const path = require('path')
const os = require('os')
const fs = require('fs')
const { TournamentStore, BENCHMARK_QUESTION_SUITES } = require('../tournaments')

test('TournamentStore', async (t) => {
  const tmpFile = path.join(os.tmpdir(), `test-tournaments-${Date.now()}.json`)
  const store = new TournamentStore({ storagePath: tmpFile, persist: true })

  try {
    assert.ok(Array.isArray(BENCHMARK_QUESTION_SUITES))
    assert.ok(BENCHMARK_QUESTION_SUITES.length >= 2)

    const tournament = store.createTournament({
      title: 'Colosseum Test Tourney',
      participants: [
        { provider: 'ollama', model: 'deepseek-r1:8b' },
        { provider: 'gemini', model: 'gemini-2.5-flash' },
      ],
      questions: [
        { id: 'q-1', title: 'Trial 1', prompt: 'Solve 2+2' },
        { id: 'q-2', title: 'Trial 2', prompt: 'Write python function' },
      ],
    })

    assert.equal(tournament.participants.length, 2)
    assert.equal(tournament.questions.length, 2)
    assert.equal(tournament.totalSteps, 4)

    // Record Trial Result 1
    store.recordTrialResult(tournament.id, 0, 'ollama:deepseek-r1:8b', {
      runId: 'run-1',
      response: '4 is the answer',
      stats: { totalTimeMs: 1000, firstTokenMs: 200, streamTimeMs: 800, tokenCount: 20 },
    })

    const updated = store.getTournament(tournament.id)
    assert.equal(updated.completedSteps, 1)
    assert.ok(updated.charts)
    assert.ok(Array.isArray(updated.charts.speedChart))
    assert.equal(updated.charts.speedChart[0].value, 25)

    // Record Trial Result 2
    store.recordTrialResult(tournament.id, 0, 'gemini:gemini-2.5-flash', {
      runId: 'run-2',
      response: '2+2 is 4',
      stats: { totalTimeMs: 500, firstTokenMs: 100, streamTimeMs: 400, tokenCount: 20 },
    })

    const tourney2 = store.getTournament(tournament.id)
    assert.equal(tourney2.completedSteps, 2)
    assert.ok(tourney2.champion)
    assert.equal(tourney2.champion.gladiatorKey, 'gemini:gemini-2.5-flash')

    // AI Judge Verdict
    store.setJudgeVerdict(tournament.id, {
      verdict: 'Gemini won on speed and precision',
      champion: 'gemini:gemini-2.5-flash',
    })

    const judged = store.getTournament(tournament.id)
    assert.ok(judged.aiJudgeVerdict)
    assert.equal(judged.aiJudgeVerdict.champion, 'gemini:gemini-2.5-flash')

    // Delete
    assert.equal(store.deleteTournament(tournament.id), true)
    assert.equal(store.getTournament(tournament.id), null)
  } finally {
    if (fs.existsSync(tmpFile)) {
      fs.unlinkSync(tmpFile)
    }
  }
})
