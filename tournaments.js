const fs = require('fs')
const path = require('path')
const os = require('os')
const { randomUUID } = require('crypto')
const { calculateBenchmarkMetrics, buildJudgePrompt } = require('./comparisons')

const DEFAULT_TOURNAMENTS_PATH = path.join(os.homedir(), '.savant', 'gateway-tournaments.json')

/**
 * Standard Colosseum Benchmark Trial Questions Suites
 */
const BENCHMARK_QUESTION_SUITES = [
  {
    id: 'core-suite',
    name: '🏛️ Colosseum Standard Trial Suite',
    description: 'Balanced mix of Coding, Logic, Speed, and Reasoning.',
    questions: [
      {
        id: 'q-code',
        category: 'Coding & Algorithms',
        title: 'LRU Cache Implementation',
        prompt: 'Implement an LRU (Least Recently Used) Cache class in Python with get(key) and put(key, value) operations running in O(1) time complexity. Provide clean code and a brief explanation.',
      },
      {
        id: 'q-logic',
        category: 'Logic & Reasoning',
        title: 'River Crossing Riddle',
        prompt: 'A farmer needs to cross a river with a wolf, a goat, and a cabbage. The boat can only hold the farmer and one item at a time. If left alone together, the wolf will eat the goat, or the goat will eat the cabbage. How can the farmer get all three across safely? List step-by-step.',
      },
      {
        id: 'q-speed',
        category: 'Speed & Conciseness',
        title: 'One-Sentence Explanations',
        prompt: 'Explain the concept of "Recursion in computer science" in exactly one clear, insightful sentence.',
      },
      {
        id: 'q-math',
        category: 'Math & Analysis',
        title: 'Probability & Strategy',
        prompt: 'In the Monty Hall problem with 3 doors, why is it mathematically advantageous to switch doors after the host opens a goat door? Provide the exact probability proof concisely.',
      },
    ],
  },
  {
    id: 'coding-suite',
    name: '💻 Pure Code & Engineering Suite',
    description: 'Deep coding, system design, and algorithmic trials.',
    questions: [
      {
        id: 'q-async',
        category: 'Async Programming',
        title: 'Debounce with TypeScript',
        prompt: 'Write a type-safe debounce function in TypeScript with immediate execution option and cancel() method.',
      },
      {
        id: 'q-sql',
        category: 'Database Querying',
        title: 'Window Functions in SQL',
        prompt: 'Write an SQL query using window functions to find the top 3 highest earning employees in each department from an Employee(id, name, salary, department_id) table.',
      },
      {
        id: 'q-regex',
        category: 'Regex & Parsing',
        title: 'URL Parser Regex',
        prompt: 'Write a regular expression to extract protocol, hostname, port, and pathname from a URL string, and show how to use it in JavaScript.',
      },
    ],
  },
  {
    id: 'speed-suite',
    name: '⚡ Fast Sprint Trial',
    description: 'Rapid-fire short prompts to test pure TTFT and raw generation velocity.',
    questions: [
      {
        id: 'q-sprint-1',
        category: 'Sprint',
        title: 'HTTP Status 418',
        prompt: 'What is HTTP status code 418 and what is its origin? Answer in 2 sentences.',
      },
      {
        id: 'q-sprint-2',
        category: 'Sprint',
        title: 'Binary Search Intuition',
        prompt: 'Give a 20-word explanation of how binary search works.',
      },
      {
        id: 'q-sprint-3',
        category: 'Sprint',
        title: 'Big-O Quick Test',
        prompt: 'What is the time and space complexity of merge sort? Answer directly with values.',
      },
    ],
  },
]

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
      wins: 0,
      score: 0,
    }))

    const questions = (params.questions || []).map((q, qIdx) => ({
      id: q.id || `q-${qIdx + 1}`,
      category: q.category || 'General Trial',
      title: q.title || `Trial ${qIdx + 1}`,
      prompt: q.prompt || '',
      runs: {}, // keyed by gladiatorKey: { runId, status, response, benchmark, error }
      judgeEvaluation: null, // { winnerKey, rationale, scores }
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
      }))
  }

  /**
   * Updates a single gladiator trial run result.
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

    q.runs[gladiatorKey] = {
      runId: runData.runId,
      status: runData.status || 'complete',
      response: runData.response || '',
      benchmark,
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
        scores: 0,
      }
    }

    // Tally per-trial metrics
    for (const q of tournament.questions) {
      for (const [key, run] of Object.entries(q.runs || {})) {
        if (run && run.status === 'complete' && run.benchmark && gladiatorStats[key]) {
          const s = gladiatorStats[key]
          s.completedTrials++
          s.totalTokens += run.benchmark.tokenCount || 0
          s.totalTps += run.benchmark.tokensPerSecond || 0
          s.totalTtftMs += run.benchmark.ttftMs || 0
          s.totalDurationMs += run.benchmark.totalTimeMs || 0
        }
      }
    }

    // Chart-ready data series
    const speedChart = []
    const latencyChart = []
    const durationChart = []
    const summaryTable = []

    for (const p of tournament.participants) {
      const s = gladiatorStats[p.gladiatorKey]
      const count = s.completedTrials || 1
      const avgTps = s.completedTrials > 0 ? Number((s.totalTps / count).toFixed(1)) : 0
      const avgTtftSec = s.completedTrials > 0 ? Number(((s.totalTtftMs / count) / 1000).toFixed(2)) : 0
      const avgDurationSec = s.completedTrials > 0 ? Number(((s.totalDurationMs / count) / 1000).toFixed(2)) : 0

      p.avgTps = avgTps
      p.avgTtftMs = s.completedTrials > 0 ? Math.round(s.totalTtftMs / count) : 0
      p.totalTokens = s.totalTokens
      p.totalDurationMs = s.totalDurationMs

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

      durationChart.push({
        label: `${p.provider}:${p.model}`,
        name: p.gladiatorName,
        value: avgDurationSec,
        unit: 's',
        isLocal: p.isLocal,
      })

      summaryTable.push({
        gladiator: p.gladiatorName,
        model: `${p.provider}:${p.model}`,
        avgTps,
        avgTtftSec,
        avgDurationSec,
        totalTokens: s.totalTokens,
        completedTrials: s.completedTrials,
        isLocal: p.isLocal,
      })
    }

    // Determine fast speed champion
    const sortedBySpeed = [...tournament.participants].sort((a, b) => b.avgTps - a.avgTps)
    if (sortedBySpeed.length > 0 && sortedBySpeed[0].avgTps > 0) {
      tournament.champion = {
        gladiatorKey: sortedBySpeed[0].gladiatorKey,
        gladiatorName: sortedBySpeed[0].gladiatorName,
        provider: sortedBySpeed[0].provider,
        model: sortedBySpeed[0].model,
        avgTps: sortedBySpeed[0].avgTps,
        isLocal: sortedBySpeed[0].isLocal,
      }
    }

    tournament.charts = {
      speedChart,
      latencyChart,
      durationChart,
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
}
