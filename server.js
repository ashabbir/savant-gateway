const express = require('express')
const path = require('path')
const { randomUUID } = require('crypto')
const { version } = require('./package.json')
const { ADAPTERS, DEFAULT_CHAIN, PROVIDER_NAMES, DISABLED_PROVIDERS, scheduleModelRefresh } = require('./adapters')
const { upload, buildPromptWithFiles, cleanupFiles, MAX_FILES, MAX_FILE_BYTES } = require('./uploads')
const { SessionStore, formatChatPrompt } = require('./sessions')
const { ComparisonStore, buildJudgePrompt } = require('./comparisons')
const { TournamentStore, BENCHMARK_QUESTION_SUITES } = require('./tournaments')
const {
  createRun,
  finalizeRun,
  DEFAULT_STAGGER_MS,
  MAX_LIMIT,
  DEFAULT_LIMIT,
  emit,
  executeRun,
  corsMiddleware,
  parseChain,
  filterActiveProviders,
} = require('./server-helpers')

const app = express()
app.use(express.json({ limit: '4mb' }))

// CORS — allow any local origin so Quorum renderer and savant-client can reach
// the gateway without a proxy. Restrict to localhost so nothing external can call it.
app.use(corsMiddleware)

// Serve UI static files from public/
const publicDir = path.join(__dirname, 'public')
app.use(express.static(publicDir))

app.get(['/', '/chat', '/ui', '/compare', '/arena', '/colosseum', '/tournament'], (_req, res) => {
  res.sendFile(path.join(publicDir, 'index.html'))
})

/**
 * In-memory run store
 * Keyed by run id.
 */
const runs = new Map()

/**
 * Chat session store (persisted to ~/.savant/gateway-sessions.json)
 */
const sessionStore = new SessionStore()

/**
 * Model comparison store (persisted to ~/.savant/gateway-comparisons.json)
 */
const comparisonStore = new ComparisonStore()

/**
 * Colosseum Tournament store (persisted to ~/.savant/gateway-tournaments.json)
 */
const tournamentStore = new TournamentStore()

// ── POST /runs ────────────────────────────────────────────────────────────────
app.post('/runs', upload.array('files', MAX_FILES), (req, res) => {
  let { prompt, cwd, session_id, execution } = req.body || {}

  // Handle messages array if provided instead of raw prompt
  if ((!prompt || typeof prompt !== 'string') && Array.isArray(req.body?.messages)) {
    prompt = formatChatPrompt(req.body.messages, req.body?.systemPrompt)
  }

  if (!prompt || typeof prompt !== 'string') {
    cleanupFiles(req.files)
    return res.status(400).json({ error: 'prompt (string) or messages (array) is required' })
  }

  let chain
  try {
    chain = parseChain(req.body?.chain, DEFAULT_CHAIN)
  } catch {
    cleanupFiles(req.files)
    return res.status(400).json({ error: 'chain must be valid JSON' })
  }

  const activeChain = filterActiveProviders(chain, PROVIDER_NAMES)
  if (activeChain.length === 0) {
    cleanupFiles(req.files)
    return res.status(503).json({
      error: 'NO_PROVIDERS_AVAILABLE',
      providers: PROVIDER_NAMES,
    })
  }

  const id = randomUUID()
  const runCwd = typeof cwd === 'string' && cwd ? cwd : undefined
  const requestedStagger = req.body?.stagger_ms ?? process.env.GATEWAY_RACE_STAGGER_MS ?? DEFAULT_STAGGER_MS
  const run = createRun({
    id,
    session_id,
    prompt: buildPromptWithFiles(prompt, req.files),
    files: req.files,
    chain: activeChain,
    execution,
    concurrency: req.body?.concurrency || process.env.GATEWAY_RACE_CONCURRENCY || 2,
    staggerMs: requestedStagger,
    cwd: runCwd,
  })
  runs.set(id, run)

  executeRun(run, runs, cleanupFiles, sessionStore)

  res.status(202).json({ id, status: 'running' })
})

// ── GET /runs/:id/stream ──────────────────────────────────────────────────────
app.get('/runs/:id/stream', (req, res) => {
  const run = runs.get(req.params.id)
  if (!run) return res.status(404).json({ error: 'run not found' })

  res.setHeader('Content-Type', 'text/event-stream')
  res.setHeader('Cache-Control', 'no-cache')
  res.setHeader('Connection', 'keep-alive')
  res.flushHeaders()

  const TERMINAL = new Set(['complete', 'error', 'killed'])
  for (const event of run.events) {
    res.write(`data: ${JSON.stringify(event)}\n\n`)
  }
  if (TERMINAL.has(run.status)) return res.end()

  run.subscribers.add(res)
  req.on('close', () => run.subscribers.delete(res))
})

// ── GET /runs/:id ─────────────────────────────────────────────────────────────
app.get('/runs/:id', (req, res) => {
  const run = runs.get(req.params.id)
  if (!run) return res.status(404).json({ error: 'run not found' })
  res.json({ id: run.id, status: run.status, result: run.result, error: run.error })
})

// ── DELETE /runs/:id ──────────────────────────────────────────────────────────
app.delete('/runs/:id', (req, res) => {
  const run = runs.get(req.params.id)
  if (!run) return res.status(404).json({ error: 'run not found' })
  if (run.status !== 'running') return res.json({ ok: true, note: `already ${run.status}` })

  run.cancelled = true
  run.generation++
  run.kill?.()
  run.status = 'killed'
  emit(run, { type: 'error', message: 'KILLED_BY_CLIENT' })
  finalizeRun(run, runs, cleanupFiles)
  res.json({ ok: true })
})

// ── POST /runs/:id/feedback ──────────────────────────────────────────────────
app.post('/runs/:id/feedback', (req, res) => {
  const run = runs.get(req.params.id)
  if (!run) return res.status(404).json({ error: 'run not found' })
  if (run.status !== 'running') return res.status(409).json({ error: `run is ${run.status}` })

  const { feedback } = req.body || {}
  if (!feedback || typeof feedback !== 'string' || !feedback.trim()) {
    return res.status(400).json({ error: 'feedback (non-empty string) is required' })
  }

  run.feedback.push(feedback.trim())
  emit(run, { type: 'steering', feedback: feedback.trim(), restart: true })
  run.kill?.()
  executeRun(run, runs, cleanupFiles, sessionStore)
  res.status(202).json({ id: run.id, status: 'steering', feedbackCount: run.feedback.length })
})

// ── GET /runs ─────────────────────────────────────────────────────────────────
app.get('/runs', (req, res) => {
  const { status, limit = `${DEFAULT_LIMIT}` } = req.query
  const max = Math.min(parseInt(limit, 10) || DEFAULT_LIMIT, MAX_LIMIT)

  let list = [...runs.values()]
    .sort((a, b) => b.startedAt - a.startedAt)

  if (status) list = list.filter((r) => r.status === status)
  list = list.slice(0, max)

  res.json(list.map((r) => ({
    id: r.id,
    session_id: r.session_id,
    status: r.status,
    cwd: r.cwd || null,
    startedAt: r.startedAt,
    elapsedMs: r.status !== 'running' ? Date.now() - r.startedAt : null,
    provider: r.result?.provider || null,
    model: r.result?.model || null,
    error: r.error || null,
    promptSnippet: null,
    eventCount: r.events.length,
  })))
})

// ── GET /runs/:id/events ──────────────────────────────────────────────────────
app.get('/runs/:id/events', (req, res) => {
  const run = runs.get(req.params.id)
  if (!run) return res.status(404).json({ error: 'run not found' })
  res.json({
    id: run.id,
    session_id: run.session_id,
    status: run.status,
    cwd: run.cwd || null,
    startedAt: run.startedAt,
    elapsedMs: Date.now() - run.startedAt,
    result: run.result,
    error: run.error,
    events: run.events,
  })
})

// ── GET /sessions ─────────────────────────────────────────────────────────────
app.get('/sessions', (_req, res) => {
  res.json({ sessions: sessionStore.listSessions() })
})

// ── POST /sessions ────────────────────────────────────────────────────────────
app.post('/sessions', (req, res) => {
  const { title, provider, model, systemPrompt } = req.body || {}
  const session = sessionStore.createSession({ title, provider, model, systemPrompt })
  res.status(201).json(session)
})

// ── GET /sessions/:id ─────────────────────────────────────────────────────────
app.get('/sessions/:id', (req, res) => {
  const session = sessionStore.getSession(req.params.id)
  if (!session) return res.status(404).json({ error: 'session not found' })
  res.json(session)
})

// ── PATCH /sessions/:id ───────────────────────────────────────────────────────
app.patch('/sessions/:id', (req, res) => {
  const session = sessionStore.updateSession(req.params.id, req.body || {})
  if (!session) return res.status(404).json({ error: 'session not found' })
  res.json(session)
})

// ── DELETE /sessions/:id ──────────────────────────────────────────────────────
app.delete('/sessions/:id', (req, res) => {
  const ok = sessionStore.deleteSession(req.params.id)
  if (!ok) return res.status(404).json({ error: 'session not found' })
  res.json({ ok: true })
})

// ── DELETE /sessions/:id/messages ─────────────────────────────────────────────
app.delete('/sessions/:id/messages', (req, res) => {
  const session = sessionStore.clearSession(req.params.id)
  if (!session) return res.status(404).json({ error: 'session not found' })
  res.json({ ok: true })
})

// ── POST /sessions/:id/messages ───────────────────────────────────────────────
app.post('/sessions/:id/messages', upload.array('files', MAX_FILES), (req, res) => {
  const session = sessionStore.getSession(req.params.id)
  if (!session) {
    cleanupFiles(req.files)
    return res.status(404).json({ error: 'session not found' })
  }

  const rawPrompt = req.body?.prompt || req.body?.message || req.body?.content
  if (!rawPrompt || typeof rawPrompt !== 'string' || !rawPrompt.trim()) {
    cleanupFiles(req.files)
    return res.status(400).json({ error: 'prompt or message (string) is required' })
  }

  // Add user message to session
  const userMsg = sessionStore.addMessage(session.id, {
    role: 'user',
    content: rawPrompt.trim(),
    files: (req.files || []).map((f) => ({
      originalname: f.originalname,
      filename: f.filename,
      size: f.size,
      mimetype: f.mimetype,
    })),
  })

  // Determine provider / model chain
  let chain
  try {
    if (req.body?.chain) {
      chain = parseChain(req.body.chain, DEFAULT_CHAIN)
    } else {
      const provider = req.body?.provider || session.provider
      const model = req.body?.model || session.model
      if (provider && model) {
        chain = [{ provider, model }]
      } else if (provider) {
        const adapter = ADAPTERS[provider]
        chain = [{ provider, model: adapter?.defaultModel || '' }]
      } else {
        chain = DEFAULT_CHAIN
      }
    }
  } catch {
    cleanupFiles(req.files)
    return res.status(400).json({ error: 'chain must be valid JSON' })
  }

  const activeChain = filterActiveProviders(chain, PROVIDER_NAMES)
  if (activeChain.length === 0) {
    cleanupFiles(req.files)
    return res.status(503).json({
      error: 'NO_PROVIDERS_AVAILABLE',
      providers: PROVIDER_NAMES,
    })
  }

  // Format conversational prompt from message history
  const chatPrompt = formatChatPrompt(session.messages, req.body?.systemPrompt || session.systemPrompt)
  const promptWithFiles = buildPromptWithFiles(chatPrompt, req.files)

  const id = randomUUID()
  const runCwd = typeof req.body?.cwd === 'string' && req.body.cwd ? req.body.cwd : undefined
  const requestedStagger = req.body?.stagger_ms ?? process.env.GATEWAY_RACE_STAGGER_MS ?? DEFAULT_STAGGER_MS
  const run = createRun({
    id,
    session_id: session.id,
    prompt: promptWithFiles,
    files: req.files,
    chain: activeChain,
    execution: req.body?.execution,
    concurrency: req.body?.concurrency || process.env.GATEWAY_RACE_CONCURRENCY || 2,
    staggerMs: requestedStagger,
    cwd: runCwd,
  })
  runs.set(id, run)

  executeRun(run, runs, cleanupFiles, sessionStore)

  res.status(202).json({
    id,
    sessionId: session.id,
    status: 'running',
    userMessage: userMsg,
  })
})

// ── GET /models ──────────────────────────────────────────────────────────────
app.get('/models', (_req, res) => {
  scheduleModelRefresh()
  const providers = Object.keys(ADAPTERS).map((id) => {
    const adapter = ADAPTERS[id]
    return {
      id,
      name: adapter.name,
      label: adapter.label,
      enabled: PROVIDER_NAMES.includes(id),
      defaultModel: adapter.defaultModel,
      models: adapter.availableModels,
    }
  })
  res.json({ providers })
})

// ── GET /comparisons ──────────────────────────────────────────────────────────
app.get('/comparisons', (_req, res) => {
  res.json({ comparisons: comparisonStore.listComparisons() })
})

// ── POST /comparisons ─────────────────────────────────────────────────────────
app.post('/comparisons', upload.array('files', MAX_FILES), (req, res) => {
  const { prompt, systemPrompt, cwd } = req.body || {}
  let rawParticipants = req.body?.participants

  if (typeof rawParticipants === 'string') {
    try {
      rawParticipants = JSON.parse(rawParticipants)
    } catch {
      cleanupFiles(req.files)
      return res.status(400).json({ error: 'participants must be valid JSON' })
    }
  }

  if (!prompt || typeof prompt !== 'string' || !prompt.trim()) {
    cleanupFiles(req.files)
    return res.status(400).json({ error: 'prompt (string) is required' })
  }

  if (!Array.isArray(rawParticipants) || rawParticipants.length < 2) {
    cleanupFiles(req.files)
    return res.status(400).json({ error: 'at least 2 participants are required for comparison' })
  }

  const validParticipants = rawParticipants.filter(
    (p) => p && p.provider && PROVIDER_NAMES.includes(p.provider)
  )

  if (validParticipants.length < 2) {
    cleanupFiles(req.files)
    return res.status(400).json({
      error: 'at least 2 valid, active participants are required',
      availableProviders: PROVIDER_NAMES,
    })
  }

  const comparisonId = randomUUID()
  const participantRuns = []
  const formattedPrompt = buildPromptWithFiles(prompt.trim(), req.files)

  for (const p of validParticipants) {
    const runId = randomUUID()
    const adapter = ADAPTERS[p.provider]
    const model = p.model || adapter?.defaultModel || ''
    const singleChain = [{ provider: p.provider, model }]

    const run = createRun({
      id: runId,
      session_id: `comp:${comparisonId}`,
      prompt: formattedPrompt,
      files: req.files,
      chain: singleChain,
      execution: 'serial',
      cwd: typeof cwd === 'string' && cwd ? cwd : undefined,
    })

    runs.set(runId, run)

    participantRuns.push({
      runId,
      provider: p.provider,
      model,
      label: adapter?.label || p.provider,
      status: 'running',
      response: null,
      error: null,
      benchmark: null,
    })

    executeRun(run, runs, null, null).then(() => {
      const currentRun = runs.get(runId)
      if (currentRun?.status === 'complete') {
        comparisonStore.updateParticipantByRunId(comparisonId, runId, {
          status: 'complete',
          response: currentRun.result?.response,
          stats: currentRun.result?.stats,
        })
      } else if (currentRun?.status === 'error' || currentRun?.status === 'killed') {
        comparisonStore.updateParticipantByRunId(comparisonId, runId, {
          status: currentRun.status,
          error: currentRun.error,
        })
      }
    })
  }

  const comparison = comparisonStore.createComparison({
    id: comparisonId,
    prompt: prompt.trim(),
    systemPrompt: systemPrompt || '',
    cwd: typeof cwd === 'string' && cwd ? cwd : undefined,
    participants: participantRuns,
  })

  res.status(202).json(comparison)
})

// ── GET /comparisons/:id ──────────────────────────────────────────────────────
app.get('/comparisons/:id', (req, res) => {
  const comparison = comparisonStore.getComparison(req.params.id)
  if (!comparison) return res.status(404).json({ error: 'comparison not found' })

  // Sync any in-memory run statuses
  for (const p of comparison.participants) {
    if (p.status === 'running') {
      const liveRun = runs.get(p.runId)
      if (liveRun?.status === 'complete') {
        comparisonStore.updateParticipantByRunId(comparison.id, p.runId, {
          status: 'complete',
          response: liveRun.result?.response,
          stats: liveRun.result?.stats,
        })
      } else if (liveRun?.status === 'error' || liveRun?.status === 'killed') {
        comparisonStore.updateParticipantByRunId(comparison.id, p.runId, {
          status: liveRun.status,
          error: liveRun.error,
        })
      }
    }
  }

  res.json(comparisonStore.getComparison(req.params.id))
})

// ── POST /comparisons/:id/vote ────────────────────────────────────────────────
app.post('/comparisons/:id/vote', (req, res) => {
  const { winner, feedback } = req.body || {}
  if (!winner) return res.status(400).json({ error: 'winner identifier is required' })

  const updated = comparisonStore.setVote(req.params.id, { winner, feedback })
  if (!updated) return res.status(404).json({ error: 'comparison not found' })
  res.json(updated)
})

// ── POST /comparisons/:id/judge ───────────────────────────────────────────────
app.post('/comparisons/:id/judge', (req, res) => {
  const comparison = comparisonStore.getComparison(req.params.id)
  if (!comparison) return res.status(404).json({ error: 'comparison not found' })

  const completed = comparison.participants.filter((p) => p.status === 'complete' && p.response)
  if (completed.length < 2) {
    return res.status(400).json({ error: 'at least 2 completed candidate responses are required to evaluate' })
  }

  const judgePrompt = buildJudgePrompt({
    prompt: comparison.prompt,
    candidates: completed,
  })

  const judgeProvider = req.body?.provider || (PROVIDER_NAMES.includes('gemini') ? 'gemini' : (PROVIDER_NAMES.includes('ollama') ? 'ollama' : PROVIDER_NAMES[0]))
  const adapter = ADAPTERS[judgeProvider]
  const judgeModel = req.body?.model || adapter?.defaultModel || ''

  const runId = randomUUID()
  const run = createRun({
    id: runId,
    session_id: `judge:${comparison.id}`,
    prompt: judgePrompt,
    chain: [{ provider: judgeProvider, model: judgeModel }],
    execution: 'serial',
  })
  runs.set(runId, run)

  executeRun(run, runs, cleanupFiles, null).then(() => {
    const currentRun = runs.get(runId)
    if (currentRun?.status === 'complete') {
      comparisonStore.setJudgeResult(comparison.id, {
        judgeProvider,
        judgeModel,
        raw: currentRun.result?.response,
        runId,
      })
    }
  })

  res.status(202).json({
    comparisonId: comparison.id,
    judgeRunId: runId,
    judgeProvider,
    judgeModel,
    status: 'running',
  })
})

// ── DELETE /comparisons/:id ───────────────────────────────────────────────────
app.delete('/comparisons/:id', (req, res) => {
  const ok = comparisonStore.deleteComparison(req.params.id)
  if (!ok) return res.status(404).json({ error: 'comparison not found' })
  res.json({ ok: true })
})

// ── GET /leaderboard ──────────────────────────────────────────────────────────
app.get('/leaderboard', (_req, res) => {
  res.json(comparisonStore.getLeaderboard())
})

// ── TOURNAMENTS ENGINE (One model at a time sequential execution) ─────────────
async function runTournamentSequentially(tournamentId) {
  const tournament = tournamentStore.getTournament(tournamentId)
  if (!tournament) return

  tournament.status = 'running'
  tournamentStore.scheduleSave()

  for (let qIdx = 0; qIdx < tournament.questions.length; qIdx++) {
    const q = tournament.questions[qIdx]
    tournament.currentQuestionIndex = qIdx

    for (let pIdx = 0; pIdx < tournament.participants.length; pIdx++) {
      const p = tournament.participants[pIdx]
      tournament.currentParticipantIndex = pIdx
      tournamentStore.scheduleSave()

      const runId = randomUUID()
      const adapter = ADAPTERS[p.provider]
      const model = p.model || adapter?.defaultModel || ''
      const singleChain = [{ provider: p.provider, model }]

      const run = createRun({
        id: runId,
        session_id: `tourney:${tournamentId}:${q.id}:${p.gladiatorKey}`,
        prompt: q.prompt,
        chain: singleChain,
        execution: 'serial',
      })
      runs.set(runId, run)

      // Await execution to ensure ONE model runs at a time (pure unthrottled benchmarking)
      await executeRun(run, runs, cleanupFiles, null)

      const finishedRun = runs.get(runId)
      tournamentStore.recordTrialResult(tournamentId, qIdx, p.gladiatorKey, {
        runId,
        status: finishedRun?.status || 'complete',
        response: finishedRun?.result?.response || '',
        stats: finishedRun?.result?.stats || null,
        error: finishedRun?.error || null,
      })
    }
  }

  const finishedTourney = tournamentStore.getTournament(tournamentId)
  if (finishedTourney) {
    finishedTourney.status = 'completed'
    tournamentStore.scheduleSave()
  }
}

// ── GET /tournaments/questions ────────────────────────────────────────────────
app.get('/tournaments/questions', (_req, res) => {
  res.json({ suites: BENCHMARK_QUESTION_SUITES })
})

// ── GET /tournaments ──────────────────────────────────────────────────────────
app.get('/tournaments', (_req, res) => {
  res.json({ tournaments: tournamentStore.listTournaments() })
})

// ── POST /tournaments ─────────────────────────────────────────────────────────
app.post('/tournaments', (req, res) => {
  const { title, participants, questions } = req.body || {}

  if (!Array.isArray(participants) || participants.length < 2) {
    return res.status(400).json({ error: 'at least 2 gladiators/participants are required' })
  }

  if (!Array.isArray(questions) || questions.length < 1) {
    return res.status(400).json({ error: 'at least 1 trial question is required' })
  }

  const validParticipants = participants.filter(
    (p) => p && p.provider && PROVIDER_NAMES.includes(p.provider)
  )

  if (validParticipants.length < 2) {
    return res.status(400).json({
      error: 'at least 2 active, installed providers are required for tournament',
      availableProviders: PROVIDER_NAMES,
    })
  }

  const tournament = tournamentStore.createTournament({
    title,
    participants: validParticipants,
    questions,
  })

  // Start sequential battle in background
  runTournamentSequentially(tournament.id)

  res.status(202).json(tournament)
})

// ── GET /tournaments/:id ──────────────────────────────────────────────────────
app.get('/tournaments/:id', (req, res) => {
  const tournament = tournamentStore.getTournament(req.params.id)
  if (!tournament) return res.status(404).json({ error: 'tournament not found' })
  res.json(tournament)
})

// ── POST /tournaments/:id/judge ───────────────────────────────────────────────
app.post('/tournaments/:id/judge', (req, res) => {
  const tournament = tournamentStore.getTournament(req.params.id)
  if (!tournament) return res.status(404).json({ error: 'tournament not found' })

  // Build composite evaluation prompt across all questions
  const promptSections = [
    '# Colosseum Tournament AI Judge Evaluation',
    `Tournament: ${tournament.title}`,
    'Evaluate the performance of all participating gladiators across all benchmark trials.\n',
  ]

  tournament.questions.forEach((q, qIdx) => {
    promptSections.push(`## Trial ${qIdx + 1}: ${q.title} (${q.category})`)
    promptSections.push(`Prompt: "${q.prompt}"\n`)

    for (const p of tournament.participants) {
      const run = q.runs[p.gladiatorKey]
      const answer = run ? (run.response || '(No response)') : '(Not completed)'
      promptSections.push(`### ${p.gladiatorName} (${p.gladiatorKey})\n"""\n${answer.slice(0, 1000)}\n"""\n`)
    }
  })

  promptSections.push(`
## Instructions:
1. Provide a concise trial-by-trial evaluation.
2. Score each gladiator on a 1-10 scale for Accuracy, Logic, and Speed.
3. Crown the definitive Tournament Champion with clear rationale.
`)

  const judgePrompt = promptSections.join('\n')
  const judgeProvider = req.body?.provider || (PROVIDER_NAMES.includes('gemini') ? 'gemini' : (PROVIDER_NAMES.includes('ollama') ? 'ollama' : PROVIDER_NAMES[0]))
  const adapter = ADAPTERS[judgeProvider]
  const judgeModel = req.body?.model || adapter?.defaultModel || ''

  const runId = randomUUID()
  const run = createRun({
    id: runId,
    session_id: `judge:tourney:${tournament.id}`,
    prompt: judgePrompt,
    chain: [{ provider: judgeProvider, model: judgeModel }],
    execution: 'serial',
  })
  runs.set(runId, run)

  executeRun(run, runs, cleanupFiles, null).then(() => {
    const currentRun = runs.get(runId)
    if (currentRun?.status === 'complete') {
      tournamentStore.setJudgeVerdict(tournament.id, {
        judgeProvider,
        judgeModel,
        raw: currentRun.result?.response,
        runId,
      })
    }
  })

  res.status(202).json({
    tournamentId: tournament.id,
    judgeRunId: runId,
    judgeProvider,
    judgeModel,
    status: 'running',
  })
})

// ── DELETE /tournaments/:id ───────────────────────────────────────────────────
app.delete('/tournaments/:id', (req, res) => {
  const ok = tournamentStore.deleteTournament(req.params.id)
  if (!ok) return res.status(404).json({ error: 'tournament not found' })
  res.json({ ok: true })
})

// ── GET /health ───────────────────────────────────────────────────────────────
app.get('/health', (_req, res) => {
  scheduleModelRefresh()
  res.json({
    ok: true,
    service: 'savant-gateway',
    version,
    providers: PROVIDER_NAMES,
    providerDetails: PROVIDER_NAMES.map((providerName) => {
      const adapter = ADAPTERS[providerName]
      return {
        id: providerName,
        name: adapter.name,
        label: adapter.label,
        defaultModel: adapter.defaultModel,
        models: adapter.availableModels,
      }
    }),
    disabledProviders: DISABLED_PROVIDERS,
    activeRuns: [...runs.values()].filter((r) => r.status === 'running').length,
    execution: {
      default: 'race',
      concurrency: Number(process.env.GATEWAY_RACE_CONCURRENCY) || 2,
      staggerMs: Number(process.env.GATEWAY_RACE_STAGGER_MS) || 250,
    },
    uploads: { maxFiles: MAX_FILES, maxFileBytes: MAX_FILE_BYTES },
    uptime: process.uptime(),
  })
})

app.use((err, _req, res, _next) => {
  if (err?.name === 'MulterError') return res.status(413).json({ error: err.code, message: err.message })
  console.error('[gateway] request error', err)
  res.status(500).json({ error: 'INTERNAL_ERROR' })
})

// ── Start ─────────────────────────────────────────────────────────────────────
const PORT = Number(process.env.GATEWAY_PORT) || 3100
const HOST = '127.0.0.1'

if (require.main === module) {
  app.listen(PORT, HOST, () => {
    console.log(`[savant-gateway] listening on http://${HOST}:${PORT}`)
    console.log(`[savant-gateway] web UI available at http://${HOST}:${PORT}`)
    console.log(`[savant-gateway] providers: ${PROVIDER_NAMES.join(', ')}`)
    if (DISABLED_PROVIDERS.length > 0) {
      console.log(`[savant-gateway] disabled providers (cli not found): ${DISABLED_PROVIDERS.join(', ')}`)
    }
  })
}

process.on('uncaughtException', (e) => console.error('[gateway] uncaughtException', e))
process.on('unhandledRejection', (e) => console.error('[gateway] unhandledRejection', e))

module.exports = app
