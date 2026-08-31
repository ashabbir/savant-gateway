const fs = require('fs')
const path = require('path')
const os = require('os')
const { randomUUID } = require('crypto')
const { calculateBenchmarkMetrics } = require('./comparisons')
const { validateTrialResponse } = require('./code-validator')

const DEFAULT_TOURNAMENTS_PATH = path.join(os.homedir(), '.savant', 'gateway-tournaments.json')

/**
 * Standard Colosseum Benchmark Trial Questions Suites
 */
const BENCHMARK_QUESTION_SUITES = [
  {
    id: 'code-suite',
    name: '💻 Code Test Suite (Automated Tests & Verdict)',
    description: 'Algorithmic and structural coding challenges with automated unit test assertions and deep Frontier code evaluation.',
    questions: [
      {
        id: 'q-two-sum',
        category: 'Code Test',
        title: 'Two Sum Hash Map Algorithm',
        language: 'javascript',
        functionName: 'twoSum',
        functionSignature: 'function twoSum(nums, target)',
        prompt: 'Write a JavaScript function `twoSum(nums, target)` that returns the indices of the two numbers such that they add up to `target`. Each input has exactly one solution, and you may not use the same element twice. Return the indices in an array.',
        testCases: [
          { name: 'Standard case [2, 7, 11, 15], 9', input: [[2, 7, 11, 15], 9], expected: [0, 1] },
          { name: 'Consecutive indices [3, 2, 4], 6', input: [[3, 2, 4], 6], expected: [1, 2] },
          { name: 'Duplicate elements [3, 3], 6', input: [[3, 3], 6], expected: [0, 1] },
          { name: 'Negative numbers [-1, -2, -3, -4, -5], -8', input: [[-1, -2, -3, -4, -5], -8], expected: [2, 4] },
          { name: 'Large array values [10, 20, 30, 40, 50], 90', input: [[10, 20, 30, 40, 50], 90], expected: [3, 4] },
        ],
      },
      {
        id: 'q-is-palindrome',
        category: 'Code Test',
        title: 'Valid Palindrome String',
        language: 'javascript',
        functionName: 'isPalindrome',
        functionSignature: 'function isPalindrome(s)',
        prompt: 'Write a JavaScript function `isPalindrome(s)` that returns `true` if the string `s` is a palindrome (ignoring casing and all non-alphanumeric characters), or `false` otherwise.',
        testCases: [
          { name: 'Sentence with punctuation', input: 'A man, a plan, a canal: Panama', expected: true },
          { name: 'Non-palindrome word', input: 'race a car', expected: false },
          { name: 'Empty string / whitespace', input: '   ', expected: true },
          { name: 'Single character string', input: 'a.', expected: true },
          { name: 'Alphanumeric mix "0P"', input: '0P', expected: false },
        ],
      },
      {
        id: 'q-flatten-deep',
        category: 'Code Test',
        title: 'Deep Array Flattener (Recursion/Iteration)',
        language: 'javascript',
        functionName: 'flattenDeep',
        functionSignature: 'function flattenDeep(arr)',
        prompt: 'Write a JavaScript function `flattenDeep(arr)` that recursively flattens an array of arbitrarily nested arrays into a single-level array without using the native `Array.prototype.flat()`.',
        testCases: [
          { name: 'Nested 3 levels [1, [2, [3, [4]], 5]]', input: [[1, [2, [3, [4]], 5]]], expected: [1, 2, 3, 4, 5] },
          { name: 'Already flat array [1, 2, 3]', input: [[1, 2, 3]], expected: [1, 2, 3] },
          { name: 'Empty and deeply nested empty [[]]', input: [[[], [[]], [1]]], expected: [1] },
          { name: 'Multiple nested arrays [[1, 2], [3, [4, 5]]]', input: [[[1, 2], [3, [4, 5]]]], expected: [1, 2, 3, 4, 5] },
        ],
      },
      {
        id: 'q-valid-parens',
        category: 'Code Test',
        title: 'Valid Parentheses & Bracket Matching',
        language: 'javascript',
        functionName: 'isValid',
        functionSignature: 'function isValid(s)',
        prompt: 'Write a JavaScript function `isValid(s)` that determines if an input string containing only `()[]{}` characters is valid. Brackets must close in the correct order and with matching types.',
        testCases: [
          { name: 'Basic pair "()"', input: '()', expected: true },
          { name: 'Multiple types "()[]{}"', input: '()[]{}', expected: true },
          { name: 'Mismatched types "(]"', input: '(]', expected: false },
          { name: 'Properly nested "([{}])"', input: '([{}])', expected: true },
          { name: 'Unclosed open bracket "([)]"', input: '([)]', expected: false },
        ],
      },
      {
        id: 'q-fib-memo',
        category: 'Code Test',
        title: 'Fibonacci with Dynamic Programming',
        language: 'javascript',
        functionName: 'fib',
        functionSignature: 'function fib(n)',
        prompt: 'Write an efficient JavaScript function `fib(n)` that returns the n-th Fibonacci number (where fib(0)=0, fib(1)=1, fib(2)=1, fib(6)=8) in O(n) time without recursion stack overflow.',
        testCases: [
          { name: 'Base case fib(0)', input: 0, expected: 0 },
          { name: 'Base case fib(1)', input: 1, expected: 1 },
          { name: 'fib(6)', input: 6, expected: 8 },
          { name: 'fib(10)', input: 10, expected: 55 },
          { name: 'fib(20)', input: 20, expected: 6765 },
        ],
      },
    ],
  },
  {
    id: 'speed-suite',
    name: '⚡ Speed & Latency Test Suite',
    description: 'Rapid-fire velocity trials measuring Time-To-First-Token (TTFT), tokens/sec throughput, and prompt conciseness.',
    questions: [
      {
        id: 'q-sprint-418',
        category: 'Speed Test',
        title: 'HTTP 418 Rapid Origin',
        prompt: 'What is HTTP status code 418 and what is its historical origin? Answer directly in exactly 2 concise sentences.',
      },
      {
        id: 'q-sprint-binary-search',
        category: 'Speed Test',
        title: 'Binary Search in 20 Words',
        prompt: 'Explain the core intuition of binary search in 20 words or fewer.',
      },
      {
        id: 'q-sprint-big-o',
        category: 'Speed Test',
        title: 'Big-O Complexity Sprint',
        prompt: 'State the average and worst-case time complexity for Quick Sort and Merge Sort. Reply with only the values in bullet points.',
      },
      {
        id: 'q-sprint-quantum',
        category: 'Speed Test',
        title: 'Quantum Superposition Micro-Summary',
        prompt: 'Explain quantum superposition in one clear, punchy sentence without analogies.',
      },
    ],
  },
  {
    id: 'logic-suite',
    name: '🧠 Logic & Reasoning Test Suite',
    description: 'Complex multi-step deduction, mathematical rigor, riddle constraints, and game theory proofs.',
    questions: [
      {
        id: 'q-logic-river',
        category: 'Logic Test',
        title: 'River Crossing Constraint Riddle',
        prompt: 'A farmer needs to cross a river with a wolf, a goat, and a cabbage. The boat can only hold the farmer and one item at a time. If left alone together without the farmer, the wolf will eat the goat, or the goat will eat the cabbage. How can the farmer get all three across safely? Detail every crossing step and return trip in order.',
      },
      {
        id: 'q-logic-monty-hall',
        category: 'Logic Test',
        title: 'Monty Hall Probability & Game Theory',
        prompt: 'In the classic 3-door Monty Hall problem, prove mathematically using conditional probability (or Bayes theorem) why switching doors yields a 2/3 win probability compared to 1/3 for staying.',
      },
      {
        id: 'q-logic-knights-knaves',
        category: 'Logic Test',
        title: 'Knights & Knaves Island Mystery',
        prompt: 'On an island where Knights always tell the truth and Knaves always lie, you meet two inhabitants A and B. A says: "At least one of us is a Knave." Determine with step-by-step logical proof what A and B are.',
      },
      {
        id: 'q-logic-water-jug',
        category: 'Logic Test',
        title: 'Water Jug Puzzle (3L and 5L)',
        prompt: 'You have an infinite supply of water, an unmarked 3-liter jug, and an unmarked 5-liter jug. Explain the exact sequence of filling, pouring, and emptying operations to measure exactly 4 liters.',
      },
    ],
  },
  {
    id: 'conversation-suite',
    name: '💬 Conversation & Instruction Test Suite',
    description: 'Nuanced multi-turn communication, roleplay, pedagogical empathy, and strict negative constraint adherence.',
    questions: [
      {
        id: 'q-conv-architecture-debate',
        category: 'Conversation Test',
        title: 'Principal Architect Tech Debate',
        prompt: 'You are a Principal Software Architect in an executive design review. Provide a balanced, nuanced trade-off matrix comparing Modular Monolith vs Event-Driven Microservices for an e-commerce platform handling 50k RPS. Highlight failure modes, organizational team topology impacts, and operational cost.',
      },
      {
        id: 'q-conv-mentor-review',
        category: 'Conversation Test',
        title: 'Empathetic Mentor Code Feedback',
        prompt: 'A junior developer submitted a PR that has an N+1 query problem and lacks error handling. Write an encouraging, highly pedagogical, and kind code review comment that explains why N+1 hurts performance and gently guides them toward batching without making them feel discouraged.',
      },
      {
        id: 'q-conv-strict-matrix',
        category: 'Conversation Test',
        title: 'Strict Constraint Feature Matrix',
        prompt: 'Generate a Markdown comparison table comparing Rust, Go, and TypeScript on 4 dimensions: Concurrency Model, Memory Safety Mechanism, Compilation Target, and Primary Use Case. CRITICAL CONSTRAINT: Output ONLY the markdown table. Do not include any greeting, intro, outro, explanations, or backtick wrapper fences.',
      },
      {
        id: 'q-conv-incident-comm',
        category: 'Conversation Test',
        title: 'Production Outage Post-Mortem Memo',
        prompt: 'Draft an internal post-incident retrospective summary for a 45-minute database connection pool exhaustion incident. Address both VP of Engineering (strategic preventive measures) and on-call engineers (tactical connection pool configuration and alerts).',
      },
    ],
  },
  {
    id: 'all-rounder-suite',
    name: '🏛️ Grand Colosseum All-Rounder Pentathlon',
    description: 'Complete cross-domain tournament with 1 trial each from Code, Speed, Logic, and Conversation domains.',
    questions: [
      {
        id: 'q-all-code',
        category: 'Code Test',
        title: 'Two Sum Algorithm (Code Test)',
        language: 'javascript',
        functionName: 'twoSum',
        functionSignature: 'function twoSum(nums, target)',
        prompt: 'Write a JavaScript function `twoSum(nums, target)` that returns the indices of the two numbers such that they add up to `target`.',
        testCases: [
          { name: 'Standard case [2, 7, 11, 15], 9', input: [[2, 7, 11, 15], 9], expected: [0, 1] },
          { name: 'Consecutive indices [3, 2, 4], 6', input: [[3, 2, 4], 6], expected: [1, 2] },
          { name: 'Duplicate elements [3, 3], 6', input: [[3, 3], 6], expected: [0, 1] },
        ],
      },
      {
        id: 'q-all-speed',
        category: 'Speed Test',
        title: 'Rapid Binary Search Intuition (Speed Test)',
        prompt: 'Explain the core intuition of binary search in 20 words or fewer.',
      },
      {
        id: 'q-all-logic',
        category: 'Logic Test',
        title: 'Monty Hall Probability Proof (Logic Test)',
        prompt: 'Prove mathematically why switching doors in the 3-door Monty Hall problem gives a 2/3 winning probability.',
      },
      {
        id: 'q-all-conv',
        category: 'Conversation Test',
        title: 'Empathetic Junior Dev Mentoring (Conversation Test)',
        prompt: 'Write a kind, encouraging mentor review explaining an N+1 query issue to a junior developer with clear guidance.',
      },
    ],
  },
]

// Backwards compatibility aliases for saved suites
BENCHMARK_QUESTION_SUITES.find((s) => s.id === 'code-suite').aliases = ['verified-coding-suite']
BENCHMARK_QUESTION_SUITES.find((s) => s.id === 'all-rounder-suite').aliases = ['core-suite']

/**
 * Builds prompt for the Frontier AI Judge to deliver comprehensive domain verdicts and compare gladiators.
 */
function buildFrontierJudgePrompt(tournament, judgeInfo = {}) {
  const sections = []
  const { judgeProvider = 'Frontier Judge', judgeModel = 'Frontier Model' } = judgeInfo

  sections.push('# 🏛️ SAVANT ARENA: FRONTIER AI ARBITER TOURNAMENT VERDICT')
  sections.push(`You are the **Frontier AI Grand Arbiter** (${judgeProvider}:${judgeModel}) presiding over the Savant Arena Model Tournament.`)
  sections.push(`Your duty is to conduct an authoritative, rigorous, and impartial evaluation of all competing AI gladiators across **Code Tests**, **Speed Tests**, **Logic Tests**, and **Conversation Tests**.\n`)

  sections.push('## ⚔️ Competing Gladiators')
  tournament.participants.forEach((p) => {
    sections.push(`- **${p.gladiatorName}**: \`${p.provider}:${p.model}\` (${p.label}) [${p.isLocal ? 'Local Host Model' : 'Cloud Frontier API'}]`)
  })
  sections.push('')

  sections.push('## 📜 Battle Trials, Responses & Execution Metrics')

  tournament.questions.forEach((q, qIdx) => {
    sections.push(`### Trial ${qIdx + 1}: ${q.title} [Domain: ${q.category}]`)
    sections.push(`**Prompt / Challenge:**\n"""\n${q.prompt}\n"""\n`)

    if (Array.isArray(q.testCases) && q.testCases.length > 0) {
      sections.push(`**Automated Unit Test Specification:** ${q.testCases.length} assertion test cases configured for \`${q.functionName || q.language}\`.`)
    }

    tournament.participants.forEach((p) => {
      const run = q.runs[p.gladiatorKey] || {}
      sections.push(`\n#### Gladiator: ${p.gladiatorName} (${p.provider}:${p.model})`)

      if (run.benchmark) {
        sections.push(`- **Speed Performance:** ${run.benchmark.tokensPerSecond} tok/s | TTFT: ${run.benchmark.ttftMs}ms | Total Duration: ${run.benchmark.totalSec}s | Tokens: ${run.benchmark.tokenCount}`)
      }

      if (run.validation) {
        sections.push(`- **Automated Code Test Result:** ${run.validation.status.toUpperCase()} (${run.validation.passedCount}/${run.validation.totalCount} tests passed — ${run.validation.passRate}%) in ${run.validation.durationMs}ms`)
      }

      sections.push(`**Response Given:**\n"""\n${(run.response || '(No response recorded)').trim()}\n"""`)
    })
    sections.push('\n---\n')
  })

  sections.push(`
## 🎯 Frontier Arbiter Verdict Requirements:

You must deliver an exhaustive, highly structured verdict adhering to the following sections:

### 1. 🏆 Grand Champion & Executive Summary
- Crown the **Definitive Tournament Champion** across all gladiators.
- Provide a concise executive rationale synthesizing code accuracy, reasoning depth, speed, and conversational fidelity.

### 2. 💻 Code Test Verdict & Technical Assessment
- **Automated Validation Analysis**: Review which gladiators passed the unit tests and where failures occurred.
- **Deep Algorithmic Review**: Compare Time/Space complexity (Big-O), edge-case handling (empty inputs, boundaries, negative numbers), and memory efficiency.
- **Code Quality & Idiomatic Style**: Clean variable naming, modern syntax, error handling, readability.
- **Code Domain Winner**: Crown the best coding gladiator with specific rationale.

### 3. ⚡ Speed & Latency Verdict
- **Throughput & TTFT Analysis**: Compare tokens per second (tok/s) and Time-To-First-Token latency.
- **Conciseness vs Verbosity**: Identify which models answered directly vs bloated answers with filler.
- **Speed Domain Winner**: Crown the best speed/latency gladiator.

### 4. 🧠 Logic & Reasoning Verdict
- **Deductive Soundness**: Assess step-by-step rigor in mathematical proofs, riddles, and constraint problems.
- **Hallucinations & Fallacies**: Point out any subtle logical fallacies, invalid steps, or mathematical inaccuracies in any gladiator's response.
- **Logic Domain Winner**: Crown the best reasoning gladiator.

### 5. 💬 Conversation & Instruction Verdict
- **Instruction Adherence**: Assess strict compliance with constraints (word limits, formatting constraints, tone).
- **Nuance, Depth & Empathy**: Evaluate communication quality, empathy, and clarity.
- **Conversation Domain Winner**: Crown the best conversational gladiator.

### 6. ⚔️ Head-to-Head Gladiator Breakdown
For each competing gladiator, provide:
- **Major Strengths**: What it excelled at compared to rivals.
- **Key Vulnerabilities**: Where it stumbled or fell behind.
- **Best Use Case Recommendation**: When an engineer should pick this specific model in production.

### 7. 📊 Grand Domain Scorecard
Provide a Markdown Scorecard table rating each gladiator from 1 to 10 in every domain:
| Gladiator | Model | Code (1-10) | Speed (1-10) | Logic (1-10) | Conversation (1-10) | Overall Score (1-10) | Verdict Title |
`)

  return sections.join('\n')
}

/**
 * Builds prompt for peer reviewing an opponent gladiator's code & solution.
 */
function buildPeerReviewPrompt(params = {}) {
  const { question, reviewer, target, targetResponse, targetValidation } = params
  const sections = []

  sections.push('# Gladiator Peer Code Review & Critique')
  sections.push(`You are **${reviewer.gladiatorName}** (${reviewer.provider}:${reviewer.model}) competing in the Savant Arena.`)
  sections.push(`Your task is to conduct an impartial, expert peer review of opponent **${target.gladiatorName}** (${target.provider}:${target.model}).\n`)

  sections.push('## Battle Trial Challenge')
  sections.push(`**Title:** ${question.title} (${question.category})`)
  sections.push(`**Prompt:**\n"""\n${question.prompt}\n"""\n`)

  if (targetValidation) {
    sections.push('## Automated Test Validation Results')
    sections.push(`- **Status:** ${targetValidation.status.toUpperCase()}`)
    sections.push(`- **Test Pass Rate:** ${targetValidation.passedCount} / ${targetValidation.totalCount} passed (${targetValidation.passRate}%)`)
    sections.push(`- **Execution Duration:** ${targetValidation.durationMs}ms\n`)
  }

  sections.push('## Opponent Solution to Review')
  sections.push(`"""\n${(targetResponse || '').trim()}\n"""\n`)

  sections.push(`
## Peer Review Criteria:
1. **Technical Correctness & Edge Cases:** Does the solution correctly solve the problem? Are boundary conditions and edge cases properly handled?
2. **Algorithmic Efficiency & Complexity:** Time and space complexity optimality.
3. **Code Quality, Readability & Style:** Clean naming, structure, and idiomatic practices.
4. **Actionable Suggestions:** Concrete recommendations for improvement.
5. **Peer Rating:** A rating from 1 to 10.

## Required Output Format:
Provide your review strictly following this markdown structure:

### 1. Correctness & Efficiency Analysis
[1-2 paragraphs analyzing correctness, edge cases, and Big-O efficiency]

### 2. Strengths
- [Key strength 1]
- [Key strength 2]

### 3. Weaknesses & Improvement Areas
- [Weakness or potential bug 1]
- [Weakness or potential bug 2]

### 4. Concrete Recommendations
[1-2 actionable tips]

### 5. Final Peer Rating
**Score: X/10** (e.g. **Score: 8.5/10**)
**Rationale:** [1 sentence explaining why this score was given]
`)

  return sections.join('\n')
}

/**
 * Extracts numeric score (e.g. "Score: 8.5/10" -> 8.5) from peer review text.
 */
function extractPeerScore(reviewText) {
  if (!reviewText || typeof reviewText !== 'string') return 7.5
  const match = /\b(?:Score|Rating):\s*\*?(\d+(?:\.\d+)?)\s*\/\s*10/i.exec(reviewText)
  if (match && match[1]) {
    const val = parseFloat(match[1])
    if (!isNaN(val) && val >= 0 && val <= 10) return Number(val.toFixed(1))
  }
  const scoreMatch = /\b(\d+(?:\.\d+)?)\s*\/\s*10\b/.exec(reviewText)
  if (scoreMatch && scoreMatch[1]) {
    const val = parseFloat(scoreMatch[1])
    if (!isNaN(val) && val >= 0 && val <= 10) return Number(val.toFixed(1))
  }
  return 8.0
}

class TournamentStore {
  /**
   * @param {Object} [options={}]
   * @param {string} [options.storagePath]
   * @param {boolean} [options.persist=true]
   */
  constructor(options = {}) {
    this.storagePath = options.storagePath || DEFAULT_TOURNAMENTS_PATH
    this.persist = options.persist !== false
    this.tournaments = new Map()
    this.saveTimeout = null
    this.load()
  }

  load() {
    if (!this.persist) return
    try {
      if (fs.existsSync(this.storagePath)) {
        const raw = fs.readFileSync(this.storagePath, 'utf8')
        const data = JSON.parse(raw)
        if (Array.isArray(data)) {
          for (const item of data) {
            if (item && item.id) {
              this.tournaments.set(item.id, item)
            }
          }
        }
      }
    } catch (err) {
      console.warn('[gateway] Could not load tournaments:', err.message)
    }
  }

  scheduleSave() {
    if (!this.persist) return
    if (this.saveTimeout) clearTimeout(this.saveTimeout)
    this.saveTimeout = setTimeout(() => {
      this.save()
    }, 500)
    this.saveTimeout.unref?.()
  }

  save() {
    if (!this.persist) return
    try {
      const dir = path.dirname(this.storagePath)
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true })
      }
      const data = Array.from(this.tournaments.values())
      fs.writeFileSync(this.storagePath, JSON.stringify(data, null, 2), 'utf8')
    } catch (err) {
      console.warn('[gateway] Could not save tournaments:', err.message)
    }
  }

  /**
   * Creates a new tournament record.
   * @param {Object} params
   * @returns {Object}
   */
  createTournament(params = {}) {
    const id = params.id || randomUUID()
    const participants = (params.participants || []).map((p, idx) => ({
      index: idx,
      gladiatorKey: `${p.provider}:${p.model}`,
      gladiatorName: `Gladiator ${String.fromCharCode(65 + idx)}`,
      provider: p.provider,
      model: p.model,
      label: p.label || p.provider,
      isLocal: p.provider === 'ollama',
      totalTokens: 0,
      totalDurationMs: 0,
      avgTps: 0,
      avgTtftMs: 0,
      totalTestsPassed: 0,
      totalTestsCount: 0,
      codePassRate: 0,
      avgPeerScore: 0,
      peerReviewsReceived: 0,
      wins: 0,
      score: 0,
    }))

    const questions = (params.questions || []).map((q, qIdx) => ({
      id: q.id || `q-${qIdx + 1}`,
      category: q.category || 'General Trial',
      title: q.title || `Trial ${qIdx + 1}`,
      language: q.language || 'javascript',
      functionName: q.functionName || '',
      functionSignature: q.functionSignature || '',
      prompt: q.prompt || '',
      testCases: Array.isArray(q.testCases) ? q.testCases : [],
      customTestHarness: q.customTestHarness || '',
      runs: {}, // keyed by gladiatorKey: { runId, status, response, benchmark, validation, error }
      peerReviews: [], // array of { reviewerKey, reviewerName, reviewerModel, targetKey, targetName, targetModel, review, score, createdAt }
      judgeEvaluation: null,
    }))

    const tournament = {
      id,
      title: params.title || `Colosseum Battle #${this.tournaments.size + 1}`,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      status: 'pending', // 'pending' | 'running' | 'completed' | 'cancelled'
      currentQuestionIndex: 0,
      currentParticipantIndex: 0,
      totalSteps: participants.length * questions.length,
      completedSteps: 0,
      participants,
      questions,
      charts: null, // synthesized chart-ready stats
      champion: null, // winning gladiator summary
      aiJudgeVerdict: null,
      peerReviewsCount: 0,
    }

    this.tournaments.set(id, tournament)
    this.scheduleSave()
    return tournament
  }

  getTournament(id) {
    return this.tournaments.get(id) || null
  }

  listTournaments() {
    return Array.from(this.tournaments.values())
      .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))
      .map((t) => ({
        id: t.id,
        title: t.title,
        createdAt: t.createdAt,
        status: t.status,
        gladiatorsCount: t.participants.length,
        trialsCount: t.questions.length,
        champion: t.champion,
        completedSteps: t.completedSteps,
        totalSteps: t.totalSteps,
        peerReviewsCount: t.peerReviewsCount || 0,
      }))
  }

  /**
   * Updates a single gladiator trial run result, running automated code validation if configured.
   */
  recordTrialResult(tournamentId, questionIndex, gladiatorKey, runData = {}) {
    const tournament = this.tournaments.get(tournamentId)
    if (!tournament) return null

    const q = tournament.questions[questionIndex]
    if (!q) return null

    const benchmark = runData.stats
      ? calculateBenchmarkMetrics({
          ...runData.stats,
          charCount: (runData.response || '').length,
          provider: gladiatorKey.split(':')[0],
        })
      : null

    // Run automated code validation if trial has test cases
    let validation = null
    if (runData.response && (q.testCases?.length > 0 || q.customTestHarness)) {
      try {
        validation = validateTrialResponse(runData.response, q)
      } catch (err) {
        console.warn('[gateway] Code validation error:', err.message)
      }
    }

    q.runs[gladiatorKey] = {
      runId: runData.runId,
      status: runData.status || 'complete',
      response: runData.response || '',
      benchmark,
      validation,
      error: runData.error || null,
      completedAt: new Date().toISOString(),
    }

    tournament.completedSteps++
    this.synthesizeTournamentStats(tournament)
    tournament.updatedAt = new Date().toISOString()
    this.scheduleSave()
    return tournament
  }

  /**
   * Records a gladiator-to-gladiator peer review for a specific trial.
   */
  recordPeerReview(tournamentId, questionIndex, reviewData = {}) {
    const tournament = this.tournaments.get(tournamentId)
    if (!tournament) return null

    const q = tournament.questions[questionIndex]
    if (!q) return null

    if (!Array.isArray(q.peerReviews)) {
      q.peerReviews = []
    }

    const score = reviewData.score !== undefined ? Number(reviewData.score) : extractPeerScore(reviewData.review)

    const peerReviewRecord = {
      id: randomUUID(),
      reviewerKey: reviewData.reviewerKey,
      reviewerName: reviewData.reviewerName,
      reviewerModel: reviewData.reviewerModel,
      targetKey: reviewData.targetKey,
      targetName: reviewData.targetName,
      targetModel: reviewData.targetModel,
      review: reviewData.review || '',
      score,
      createdAt: new Date().toISOString(),
    }

    // Replace existing review from this reviewer for this target on this question if present
    const existingIdx = q.peerReviews.findIndex(
      (r) => r.reviewerKey === reviewData.reviewerKey && r.targetKey === reviewData.targetKey
    )
    if (existingIdx >= 0) {
      q.peerReviews[existingIdx] = peerReviewRecord
    } else {
      q.peerReviews.push(peerReviewRecord)
    }

    let totalReviews = 0
    tournament.questions.forEach((question) => {
      totalReviews += (question.peerReviews || []).length
    })
    tournament.peerReviewsCount = totalReviews

    this.synthesizeTournamentStats(tournament)
    tournament.updatedAt = new Date().toISOString()
    this.scheduleSave()
    return tournament
  }

  /**
   * Computes aggregated charts and rankings for the tournament.
   */
  synthesizeTournamentStats(tournament) {
    const gladiatorStats = {}

    for (const p of tournament.participants) {
      gladiatorStats[p.gladiatorKey] = {
        gladiatorKey: p.gladiatorKey,
        gladiatorName: p.gladiatorName,
        provider: p.provider,
        model: p.model,
        isLocal: p.isLocal,
        completedTrials: 0,
        totalTokens: 0,
        totalTps: 0,
        totalTtftMs: 0,
        totalDurationMs: 0,
        testsPassed: 0,
        testsTotal: 0,
        peerScores: [],
      }
    }

    // Tally per-trial metrics and validations
    for (const q of tournament.questions) {
      for (const [key, run] of Object.entries(q.runs || {})) {
        if (run && run.status === 'complete' && gladiatorStats[key]) {
          const s = gladiatorStats[key]
          s.completedTrials++

          if (run.benchmark) {
            s.totalTokens += run.benchmark.tokenCount || 0
            s.totalTps += run.benchmark.tokensPerSecond || 0
            s.totalTtftMs += run.benchmark.ttftMs || 0
            s.totalDurationMs += run.benchmark.totalTimeMs || 0
          }

          if (run.validation) {
            s.testsPassed += run.validation.passedCount || 0
            s.testsTotal += run.validation.totalCount || 0
          }
        }
      }

      // Tally peer review scores for each gladiator
      for (const pr of q.peerReviews || []) {
        if (pr && pr.targetKey && gladiatorStats[pr.targetKey]) {
          gladiatorStats[pr.targetKey].peerScores.push(pr.score)
        }
      }
    }

    // Chart-ready data series
    const speedChart = []
    const latencyChart = []
    const validationChart = []
    const peerScoreChart = []
    const summaryTable = []

    for (const p of tournament.participants) {
      const s = gladiatorStats[p.gladiatorKey]
      const count = s.completedTrials || 1
      const avgTps = s.completedTrials > 0 ? Number((s.totalTps / count).toFixed(1)) : 0
      const avgTtftSec = s.completedTrials > 0 ? Number(((s.totalTtftMs / count) / 1000).toFixed(2)) : 0
      const avgDurationSec = s.completedTrials > 0 ? Number(((s.totalDurationMs / count) / 1000).toFixed(2)) : 0

      const codePassRate = s.testsTotal > 0 ? Math.round((s.testsPassed / s.testsTotal) * 100) : null
      const avgPeerScore = s.peerScores.length > 0
        ? Number((s.peerScores.reduce((acc, v) => acc + v, 0) / s.peerScores.length).toFixed(1))
        : null

      p.avgTps = avgTps
      p.avgTtftMs = s.completedTrials > 0 ? Math.round(s.totalTtftMs / count) : 0
      p.totalTokens = s.totalTokens
      p.totalDurationMs = s.totalDurationMs
      p.totalTestsPassed = s.testsPassed
      p.totalTestsCount = s.testsTotal
      p.codePassRate = codePassRate
      p.avgPeerScore = avgPeerScore
      p.peerReviewsReceived = s.peerScores.length

      speedChart.push({
        label: `${p.provider}:${p.model}`,
        name: p.gladiatorName,
        value: avgTps,
        unit: 'tok/s',
        isLocal: p.isLocal,
      })

      latencyChart.push({
        label: `${p.provider}:${p.model}`,
        name: p.gladiatorName,
        value: avgTtftSec,
        unit: 's',
        isLocal: p.isLocal,
      })

      if (codePassRate !== null) {
        validationChart.push({
          label: `${p.provider}:${p.model}`,
          name: p.gladiatorName,
          value: codePassRate,
          passed: s.testsPassed,
          total: s.testsTotal,
          unit: '%',
          isLocal: p.isLocal,
        })
      }

      if (avgPeerScore !== null) {
        peerScoreChart.push({
          label: `${p.provider}:${p.model}`,
          name: p.gladiatorName,
          value: avgPeerScore,
          unit: '/10',
          isLocal: p.isLocal,
        })
      }

      summaryTable.push({
        gladiator: p.gladiatorName,
        model: `${p.provider}:${p.model}`,
        avgTps,
        avgTtftSec,
        avgDurationSec,
        totalTokens: s.totalTokens,
        completedTrials: s.completedTrials,
        codePassRate,
        testsPassed: s.testsPassed,
        testsTotal: s.testsTotal,
        avgPeerScore,
        peerReviewsReceived: s.peerScores.length,
        isLocal: p.isLocal,
      })
    }

    // Determine champion taking into account code validation, peer rating and speed
    const ranked = [...tournament.participants].sort((a, b) => {
      // Prioritize code pass rate if tests exist
      if (a.codePassRate !== null && b.codePassRate !== null && a.codePassRate !== b.codePassRate) {
        return b.codePassRate - a.codePassRate
      }
      // Then peer score if available
      if (a.avgPeerScore !== null && b.avgPeerScore !== null && a.avgPeerScore !== b.avgPeerScore) {
        return b.avgPeerScore - a.avgPeerScore
      }
      // Then speed
      return b.avgTps - a.avgTps
    })

    if (ranked.length > 0 && (ranked[0].avgTps > 0 || ranked[0].codePassRate !== null)) {
      tournament.champion = {
        gladiatorKey: ranked[0].gladiatorKey,
        gladiatorName: ranked[0].gladiatorName,
        provider: ranked[0].provider,
        model: ranked[0].model,
        avgTps: ranked[0].avgTps,
        codePassRate: ranked[0].codePassRate,
        avgPeerScore: ranked[0].avgPeerScore,
        isLocal: ranked[0].isLocal,
      }
    }

    tournament.charts = {
      speedChart,
      latencyChart,
      validationChart,
      peerScoreChart,
      summaryTable,
    }
  }

  /**
   * Saves overall AI Judge evaluation for the tournament.
   */
  setJudgeVerdict(tournamentId, verdictData = {}) {
    const tournament = this.tournaments.get(tournamentId)
    if (!tournament) return null

    tournament.aiJudgeVerdict = {
      ...verdictData,
      judgedAt: new Date().toISOString(),
    }
    tournament.updatedAt = new Date().toISOString()
    this.scheduleSave()
    return tournament
  }

  deleteTournament(id) {
    const ok = this.tournaments.delete(id)
    if (ok) this.scheduleSave()
    return ok
  }
}

module.exports = {
  TournamentStore,
  BENCHMARK_QUESTION_SUITES,
  DEFAULT_TOURNAMENTS_PATH,
  buildPeerReviewPrompt,
  buildFrontierJudgePrompt,
  extractPeerScore,
}
