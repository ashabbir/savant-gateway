const fs = require('fs')
const path = require('path')
const os = require('os')
const { randomUUID } = require('crypto')

const DEFAULT_COMPARISONS_PATH = path.join(os.homedir(), '.savant', 'gateway-comparisons.json')

/**
 * Calculates standard market benchmark metrics for an LLM response.
 * Follows industry benchmarks (Artificial Analysis / LMSYS Arena standards).
 *
 * @param {Object} params
 * @param {number} params.totalTimeMs - Total end-to-end latency in ms.
 * @param {number} params.firstTokenMs - Time to First Token (TTFT) in ms.
 * @param {number} params.streamTimeMs - Active streaming duration in ms.
 * @param {number} params.tokenCount - Total generated tokens.
 * @param {number} params.charCount - Total response characters.
 * @param {string} params.provider - AI provider name.
 * @returns {Object} Standardized benchmark metrics
 */
function calculateBenchmarkMetrics(params = {}) {
  const totalTimeMs = Math.max(0, Number(params.totalTimeMs) || 0)
  const firstTokenMs = Math.max(0, Number(params.firstTokenMs) || totalTimeMs)
  const streamTimeMs = Math.max(0, Number(params.streamTimeMs) || totalTimeMs)
  const charCount = Math.max(0, Number(params.charCount) || 0)
  const tokenCount = Math.max(1, Number(params.tokenCount) || Math.round(charCount / 3.8))

  const streamSec = streamTimeMs > 300 ? streamTimeMs / 1000 : Math.max(totalTimeMs / 1000, 0.05)
  const tokensPerSecond = Number((tokenCount / Math.max(streamSec, 0.05)).toFixed(1))
  const ttftSec = Number((firstTokenMs / 1000).toFixed(2))
  const totalSec = Number((totalTimeMs / 1000).toFixed(2))

  // Speed rating according to market standards
  let speedRating = 'Standard'
  if (tokensPerSecond >= 80) speedRating = 'Ultra Fast'
  else if (tokensPerSecond >= 40) speedRating = 'Fast'
  else if (tokensPerSecond < 15) speedRating = 'Moderate'

  // Latency rating
  let latencyRating = 'Good'
  if (ttftSec <= 0.8) latencyRating = 'Instant'
  else if (ttftSec <= 2.0) latencyRating = 'Good'
  else latencyRating = 'High Latency'

  // Cost tier indicator
  const isLocal = params.provider === 'ollama'
  const costTier = isLocal ? 'Free (Local Host)' : 'Cloud API'

  return {
    ttftMs: firstTokenMs,
    ttftSec,
    streamTimeMs,
    streamSec: Number(streamSec.toFixed(2)),
    totalTimeMs,
    totalSec,
    tokenCount,
    charCount,
    tokensPerSecond,
    speedRating,
    latencyRating,
    costTier,
    isLocal,
  }
}

/**
 * Builds a standardized prompt for AI-Judge evaluation of multiple model responses.
 *
 * @param {Object} params
 * @param {string} params.prompt - Original user prompt
 * @param {Array<{label: string, provider: string, model: string, response: string, benchmark: Object}>} params.candidates
 * @returns {string} Structured evaluation prompt
 */
function buildJudgePrompt(params = {}) {
  const { prompt, candidates = [] } = params
  const sections = []

  sections.push('# LLM Comparison & Benchmark Evaluation Task')
  sections.push('You are an impartial, expert AI benchmark judge evaluating model responses side-by-side.')
  sections.push(`\n## Original User Prompt\n"""\n${prompt}\n"""\n`)
  sections.push('## Model Responses to Evaluate\n')

  candidates.forEach((c, idx) => {
    const letter = String.fromCharCode(65 + idx) // Model A, Model B...
    sections.push(`### Model ${letter} (${c.provider}:${c.model})`)
    sections.push(`"""\n${(c.response || '').trim()}\n"""\n`)
  })

  sections.push(`
## Standard Evaluation Criteria (Market Benchmarks):
1. Correctness & Accuracy (0-10): Factual precision, validity of logic and code.
2. Completeness & Depth (0-10): Fully addresses all implicit and explicit prompt requirements.
3. Clarity, Structure & Formatting (0-10): Markdown readability, code blocks, clean organization.
4. Conciseness & Efficiency (0-10): Avoids fluff, stays directly on point.

## Output Format Requirements:
Provide your evaluation in this exact structured markdown format:

### Scores Summary
| Model | Correctness (10) | Completeness (10) | Clarity (10) | Conciseness (10) | Total Score (40) |
|---|---|---|---|---|---|
${candidates.map((_, i) => `| Model ${String.fromCharCode(65 + i)} | - | - | - | - | - |`).join('\n')}

### Detailed Analysis
- **Model A**: [1-2 sentences on strengths and weaknesses]
- **Model B**: [1-2 sentences on strengths and weaknesses]

### Verdict & Winner
- **Declared Winner**: [Model A / Model B / Tie]
- **Rationale**: [2-3 sentences explaining why the winner produced the superior response]
`)

  return sections.join('\n')
}

class ComparisonStore {
  /**
   * @param {Object} [options={}]
   * @param {string} [options.storagePath]
   * @param {boolean} [options.persist=true]
   */
  constructor(options = {}) {
    this.storagePath = options.storagePath || DEFAULT_COMPARISONS_PATH
    this.persist = options.persist !== false
    this.comparisons = new Map()
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
              this.comparisons.set(item.id, item)
            }
          }
        }
      }
    } catch (err) {
      console.warn('[gateway] Could not load comparisons:', err.message)
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
      const data = Array.from(this.comparisons.values())
      fs.writeFileSync(this.storagePath, JSON.stringify(data, null, 2), 'utf8')
    } catch (err) {
      console.warn('[gateway] Could not save comparisons:', err.message)
    }
  }

  /**
   * Creates a new multi-model comparison record.
   * @param {Object} params
   * @returns {Object}
   */
  createComparison(params = {}) {
    const id = params.id || randomUUID()
    const comparison = {
      id,
      prompt: params.prompt || '',
      systemPrompt: params.systemPrompt || '',
      cwd: params.cwd || null,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      participants: Array.isArray(params.participants) ? params.participants : [],
      vote: null, // { winner: string, feedback: string, votedAt: string }
      judgeResult: null, // { judgeProvider, judgeModel, verdict, rationale, scores, raw }
    }
    this.comparisons.set(id, comparison)
    this.scheduleSave()
    return comparison
  }

  /**
   * Gets a comparison by ID.
   * @param {string} id
   * @returns {Object|null}
   */
  getComparison(id) {
    return this.comparisons.get(id) || null
  }

  /**
   * Lists all comparisons sorted by createdAt desc.
   * @returns {Array<Object>}
   */
  listComparisons() {
    return Array.from(this.comparisons.values())
      .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))
      .map((c) => ({
        id: c.id,
        prompt: c.prompt ? (c.prompt.length > 80 ? `${c.prompt.slice(0, 77)}...` : c.prompt) : 'Comparison',
        createdAt: c.createdAt,
        updatedAt: c.updatedAt,
        participantCount: c.participants.length,
        participantsSummary: c.participants.map((p) => `${p.provider}:${p.model}`).join(' vs '),
        winner: c.vote?.winner || c.judgeResult?.winner || null,
      }))
  }

  /**
   * Updates a participant's result within a comparison.
   * @param {string} comparisonId
   * @param {string} runId
   * @param {Object} updates
   * @returns {Object|null}
   */
  updateParticipantByRunId(comparisonId, runId, updates = {}) {
    const comparison = this.comparisons.get(comparisonId)
    if (!comparison) return null

    const participant = comparison.participants.find((p) => p.runId === runId)
    if (!participant) return null

    Object.assign(participant, updates)
    if (updates.response && updates.stats) {
      participant.benchmark = calculateBenchmarkMetrics({
        ...updates.stats,
        charCount: updates.response.length,
        provider: participant.provider,
      })
    }

    comparison.updatedAt = new Date().toISOString()
    this.scheduleSave()
    return comparison
  }

  /**
   * Casts a user vote for a winner.
   * @param {string} id
   * @param {Object} voteData
   * @returns {Object|null}
   */
  setVote(id, voteData = {}) {
    const comparison = this.comparisons.get(id)
    if (!comparison) return null

    comparison.vote = {
      winner: voteData.winner, // e.g. "Model A", participant runId, or "tie"
      feedback: voteData.feedback || '',
      votedAt: new Date().toISOString(),
    }
    comparison.updatedAt = new Date().toISOString()
    this.scheduleSave()
    return comparison
  }

  /**
   * Saves AI Judge evaluation.
   * @param {string} id
   * @param {Object} judgeData
   * @returns {Object|null}
   */
  setJudgeResult(id, judgeData = {}) {
    const comparison = this.comparisons.get(id)
    if (!comparison) return null

    comparison.judgeResult = {
      ...judgeData,
      judgedAt: new Date().toISOString(),
    }
    comparison.updatedAt = new Date().toISOString()
    this.scheduleSave()
    return comparison
  }

  /**
   * Deletes a comparison.
   * @param {string} id
   * @returns {boolean}
   */
  deleteComparison(id) {
    const ok = this.comparisons.delete(id)
    if (ok) this.scheduleSave()
    return ok
  }

  /**
   * Computes market leaderboard statistics across all comparisons.
   * @returns {Object} Leaderboard data
   */
  getLeaderboard() {
    const statsMap = new Map()

    for (const comp of this.comparisons.values()) {
      for (const p of comp.participants || []) {
        const key = `${p.provider}:${p.model}`
        if (!statsMap.has(key)) {
          statsMap.set(key, {
            provider: p.provider,
            model: p.model,
            totalRuns: 0,
            wins: 0,
            completedRuns: 0,
            totalTokens: 0,
            totalTps: 0,
            totalTtftMs: 0,
          })
        }

        const entry = statsMap.get(key)
        entry.totalRuns++

        if (p.benchmark && p.status === 'complete') {
          entry.completedRuns++
          entry.totalTokens += p.benchmark.tokenCount || 0
          entry.totalTps += p.benchmark.tokensPerSecond || 0
          entry.totalTtftMs += p.benchmark.ttftMs || 0
        }

        if (comp.vote?.winner === p.runId || comp.vote?.winner === key || comp.judgeResult?.winnerKey === key) {
          entry.wins++
        }
      }
    }

    const leaderboard = Array.from(statsMap.values()).map((entry) => {
      const avgTps = entry.completedRuns > 0 ? Number((entry.totalTps / entry.completedRuns).toFixed(1)) : 0
      const avgTtftSec = entry.completedRuns > 0 ? Number(((entry.totalTtftMs / entry.completedRuns) / 1000).toFixed(2)) : 0
      const winRate = entry.totalRuns > 0 ? Number(((entry.wins / entry.totalRuns) * 100).toFixed(1)) : 0

      return {
        provider: entry.provider,
        model: entry.model,
        totalRuns: entry.totalRuns,
        wins: entry.wins,
        winRate,
        avgTps,
        avgTtftSec,
        isLocal: entry.provider === 'ollama',
      }
    }).sort((a, b) => b.winRate - a.winRate || b.avgTps - a.avgTps)

    return { leaderboard }
  }
}

module.exports = {
  calculateBenchmarkMetrics,
  buildJudgePrompt,
  ComparisonStore,
  DEFAULT_COMPARISONS_PATH,
}
