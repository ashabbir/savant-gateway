const test = require('node:test')
const assert = require('node:assert/strict')
const path = require('path')
const os = require('os')
const fs = require('fs')
const {
  TournamentStore,
  BENCHMARK_QUESTION_SUITES,
  buildPeerReviewPrompt,
  buildFrontierJudgePrompt,
  extractPeerScore,
} = require('../tournaments')

test('TournamentStore with Code Validation, Domain Suites, and Frontier Arbiter Verdict', async (t) => {
  const tmpFile = path.join(os.tmpdir(), `test-tournaments-${Date.now()}.json`)
  const store = new TournamentStore({ storagePath: tmpFile, persist: true })

  try {
    assert.ok(Array.isArray(BENCHMARK_QUESTION_SUITES))
    assert.ok(BENCHMARK_QUESTION_SUITES.length >= 4)

    // Verify all 4 primary domains and all-rounder pentathlon exist
    const codeSuite = BENCHMARK_QUESTION_SUITES.find((s) => s.id === 'code-suite')
    const speedSuite = BENCHMARK_QUESTION_SUITES.find((s) => s.id === 'speed-suite')
    const logicSuite = BENCHMARK_QUESTION_SUITES.find((s) => s.id === 'logic-suite')
    const convSuite = BENCHMARK_QUESTION_SUITES.find((s) => s.id === 'conversation-suite')
    const allRounderSuite = BENCHMARK_QUESTION_SUITES.find((s) => s.id === 'all-rounder-suite')

    assert.ok(codeSuite, 'code-suite exists')
    assert.ok(speedSuite, 'speed-suite exists')
    assert.ok(logicSuite, 'logic-suite exists')
    assert.ok(convSuite, 'conversation-suite exists')
    assert.ok(allRounderSuite, 'all-rounder-suite exists')

    assert.ok(codeSuite.questions[0].testCases.length > 0)
    assert.equal(codeSuite.questions[0].category, 'Code Test')
    assert.equal(speedSuite.questions[0].category, 'Speed Test')
    assert.equal(logicSuite.questions[0].category, 'Logic Test')
    assert.equal(convSuite.questions[0].category, 'Conversation Test')

    const tournament = store.createTournament({
      title: 'Colosseum Grand Championship',
      participants: [
        { provider: 'ollama', model: 'deepseek-r1:8b' },
        { provider: 'gemini', model: 'gemini-2.5-flash' },
      ],
      questions: [
        {
          id: 'q-two-sum',
          category: 'Code Test',
          title: 'Two Sum',
          language: 'javascript',
          functionName: 'twoSum',
          prompt: 'Write twoSum in JS',
          testCases: [
            { name: 'Test 1', input: [[2, 7, 11, 15], 9], expected: [0, 1] },
            { name: 'Test 2', input: [[3, 2, 4], 6], expected: [1, 2] },
          ],
        },
        {
          id: 'q-logic-river',
          category: 'Logic Test',
          title: 'River Crossing',
          prompt: 'Farmer, wolf, goat, cabbage riddle.',
        },
      ],
    })

    assert.equal(tournament.participants.length, 2)
    assert.equal(tournament.questions.length, 2)

    // Record Valid Response for Gladiator A on Trial 1
    const validJsCode = `
    \`\`\`javascript
    function twoSum(nums, target) {
      const map = new Map();
      for (let i = 0; i < nums.length; i++) {
        const diff = target - nums[i];
        if (map.has(diff)) return [map.get(diff), i];
        map.set(nums[i], i);
      }
      return [];
    }
    \`\`\`
    `
    store.recordTrialResult(tournament.id, 0, 'ollama:deepseek-r1:8b', {
      runId: 'run-1',
      response: validJsCode,
      stats: { totalTimeMs: 1000, firstTokenMs: 200, streamTimeMs: 800, tokenCount: 50 },
    })

    const updated1 = store.getTournament(tournament.id)
    const run1 = updated1.questions[0].runs['ollama:deepseek-r1:8b']
    assert.ok(run1.validation)
    assert.equal(run1.validation.status, 'passed')
    assert.equal(run1.validation.passedCount, 2)
    assert.equal(run1.validation.totalCount, 2)
    assert.equal(run1.validation.passRate, 100)

    // Record Flawed Response for Gladiator B on Trial 1
    const flawedJsCode = `
    \`\`\`javascript
    function twoSum(nums, target) {
      return [0, 1]; // Incorrect for test 2
    }
    \`\`\`
    `
    store.recordTrialResult(tournament.id, 0, 'gemini:gemini-2.5-flash', {
      runId: 'run-2',
      response: flawedJsCode,
      stats: { totalTimeMs: 500, firstTokenMs: 100, streamTimeMs: 400, tokenCount: 40 },
    })

    const updated2 = store.getTournament(tournament.id)
    const run2 = updated2.questions[0].runs['gemini:gemini-2.5-flash']
    assert.ok(run2.validation)
    assert.equal(run2.validation.status, 'failed')
    assert.equal(run2.validation.passedCount, 1)
    assert.equal(run2.validation.totalCount, 2)
    assert.equal(run2.validation.passRate, 50)

    // Record Trial 2 Responses
    store.recordTrialResult(tournament.id, 1, 'ollama:deepseek-r1:8b', {
      runId: 'run-3',
      response: 'Step 1: Take goat across. Step 2: Return empty. Step 3: Take wolf across. Step 4: Bring goat back...',
      stats: { totalTimeMs: 800, firstTokenMs: 150, streamTimeMs: 650, tokenCount: 70 },
    })
    store.recordTrialResult(tournament.id, 1, 'gemini:gemini-2.5-flash', {
      runId: 'run-4',
      response: '1. Take goat across. 2. Return alone. 3. Take cabbage across. 4. Bring goat back...',
      stats: { totalTimeMs: 400, firstTokenMs: 80, streamTimeMs: 320, tokenCount: 65 },
    })

    // Check Gladiator Summary Table with Validation Scores
    const summary = store.getTournament(tournament.id).charts.summaryTable
    assert.equal(summary[0].gladiator, 'Gladiator A')
    assert.equal(summary[0].codePassRate, 100)
    assert.equal(summary[1].gladiator, 'Gladiator B')
    assert.equal(summary[1].codePassRate, 50)

    // Peer Review prompt generator test
    const reviewPrompt = buildPeerReviewPrompt({
      question: tournament.questions[0],
      reviewer: tournament.participants[0],
      target: tournament.participants[1],
      targetResponse: flawedJsCode,
      targetValidation: run2.validation,
    })
    assert.match(reviewPrompt, /Gladiator Peer Code Review/)
    assert.match(reviewPrompt, /Gladiator A/)
    assert.match(reviewPrompt, /Gladiator B/)

    // Record Peer Review
    store.recordPeerReview(tournament.id, 0, {
      reviewerKey: 'ollama:deepseek-r1:8b',
      reviewerName: 'Gladiator A',
      reviewerModel: 'deepseek-r1:8b',
      targetKey: 'gemini:gemini-2.5-flash',
      targetName: 'Gladiator B',
      targetModel: 'gemini-2.5-flash',
      review: 'Hardcoded [0, 1] return value fails on non-standard index cases.\n\n**Score: 6.5/10**',
      score: 6.5,
    })

    const updatedWithReview = store.getTournament(tournament.id)
    assert.equal(updatedWithReview.questions[0].peerReviews.length, 1)
    assert.equal(updatedWithReview.questions[0].peerReviews[0].score, 6.5)
    assert.equal(updatedWithReview.participants[1].avgPeerScore, 6.5)

    // Score extractor helper test
    assert.equal(extractPeerScore('Great code! **Score: 9.5/10**'), 9.5)
    assert.equal(extractPeerScore('Rating: 8/10 overall.'), 8.0)

    // Test buildFrontierJudgePrompt
    const judgePrompt = buildFrontierJudgePrompt(updatedWithReview, {
      judgeProvider: 'gemini',
      judgeModel: 'gemini-2.5-pro',
    })
    assert.match(judgePrompt, /FRONTIER AI ARBITER TOURNAMENT VERDICT/)
    assert.match(judgePrompt, /gemini:gemini-2.5-pro/)
    assert.match(judgePrompt, /Code Test Verdict & Technical Assessment/)
    assert.match(judgePrompt, /Speed & Latency Verdict/)
    assert.match(judgePrompt, /Logic & Reasoning Verdict/)
    assert.match(judgePrompt, /Conversation & Instruction Verdict/)
    assert.match(judgePrompt, /Head-to-Head Gladiator Breakdown/)
    assert.match(judgePrompt, /Grand Domain Scorecard/)
    assert.match(judgePrompt, /Trial 1: Two Sum/)
    assert.match(judgePrompt, /Trial 2: River Crossing/)

    // Set Judge Verdict in Tournament
    store.setJudgeVerdict(tournament.id, {
      judgeProvider: 'gemini',
      judgeModel: 'gemini-2.5-pro',
      raw: '### 1. Champion: Gladiator A\n### 2. Code Test Verdict: Gladiator A achieved 100% test pass rate...',
    })
    const finalTourney = store.getTournament(tournament.id)
    assert.ok(finalTourney.aiJudgeVerdict)
    assert.equal(finalTourney.aiJudgeVerdict.judgeProvider, 'gemini')
    assert.match(finalTourney.aiJudgeVerdict.raw, /Champion: Gladiator A/)

    // Delete
    assert.equal(store.deleteTournament(tournament.id), true)
    assert.equal(store.getTournament(tournament.id), null)
  } finally {
    if (fs.existsSync(tmpFile)) {
      fs.unlinkSync(tmpFile)
    }
  }
})
