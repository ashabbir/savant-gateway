const express = require('express')
const { randomUUID } = require('crypto') // built-in, no dep needed
const { version } = require('./package.json')
const { walkChain, raceChain } = require('./chain')
const { ADAPTERS, DEFAULT_CHAIN, PROVIDER_NAMES, DISABLED_PROVIDERS, scheduleModelRefresh } = require('./adapters')
const { upload, buildPromptWithFiles, cleanupFiles, MAX_FILES, MAX_FILE_BYTES } = require('./uploads')
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
  DEFAULT_LIMIT,
  emit,
  executeRun,
  corsMiddleware,
  parseChain,
  filterActiveProviders
} = require('./server-helpers')

const app = express()
app.use(express.json({ limit: '4mb' }))

// CORS — allow any local origin so Quorum renderer and savant-client can reach
// the gateway without a proxy. Restrict to localhost so nothing external can call it.
app.use(corsMiddleware)

// ── In-memory run store ───────────────────────────────────────────────────────
// Keyed by run id. Each run holds:
//   status: 'running' | 'complete' | 'error' | 'killed'
//   result: { response, provider, model } | null
//   error:  string | null
//   events: SSE event objects (append-only ring for active SSE consumers)
//   kill:   fn | null  (set by the chain walker when a subprocess is active)
const runs = new Map()

// Evict completed runs after 10 min so we don't leak memory on a long session.
function scheduleEvict(id) {
  setTimeout(() => runs.delete(id), EVICT_AFTER_MS)
}



// ── POST /runs ────────────────────────────────────────────────────────────────
// Body: { prompt: string, chain?: ChainStep[], model?: string }
// Returns: { id: string, status: 'running' }
app.post('/runs', upload.array('files', MAX_FILES), (req, res) => {
  const { prompt, cwd, session_id, execution } = req.body || {}
  if (!prompt || typeof prompt !== 'string') {
    cleanupFiles(req.files)
    return res.status(400).json({ error: 'prompt (string) is required' })
  }

  let chain;
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

  // Fire-and-forget — active SSE consumers receive events immediately.
  executeRun(run, runs, cleanupFiles)

  res.status(202).json({ id, status: 'running' })
})

// ── GET /runs/:id/stream ──────────────────────────────────────────────────────
// SSE stream. Replays buffered events, then receives new events immediately.
// Each event: `data: <json>\n\n`
// Closes when the run reaches a terminal state.
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
// Polling endpoint — for clients that don't want SSE.
app.get('/runs/:id', (req, res) => {
  const run = runs.get(req.params.id)
  if (!run) return res.status(404).json({ error: 'run not found' })
  res.json({ id: run.id, status: run.status, result: run.result, error: run.error })
})

// ── DELETE /runs/:id ──────────────────────────────────────────────────────────
// Kill an in-flight run.
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
// One-shot CLI providers cannot safely consume a second prompt on stdin. Stop
// the active process and restart it with the original prompt plus all feedback.
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
  executeRun(run, runs, cleanupFiles)
  res.status(202).json({ id: run.id, status: 'steering', feedbackCount: run.feedback.length })
})

// ── GET /runs ─────────────────────────────────────────────────────────────────
// Debug: list all runs currently in memory, newest first.
// Query params:
//   ?status=running|complete|error|killed   filter by status
//   ?limit=N                                 max results (default 50)
app.get('/runs', (req, res) => {
  const { status, limit = `${DEFAULT_LIMIT}` } = req.query
  const max = Math.min(parseInt(limit, 10) || DEFAULT_LIMIT, MAX_LIMIT)

  let list = [...runs.values()]
    .sort((a, b) => b.startedAt - a.startedAt)

  if (status) list = list.filter(r => r.status === status)
  list = list.slice(0, max)

  res.json(list.map(r => ({
    id:          r.id,
    session_id:  r.session_id,
    status:      r.status,
    cwd:         r.cwd || null,
    startedAt:   r.startedAt,
    elapsedMs:   r.status !== 'running' ? Date.now() - r.startedAt : null,
    provider:    r.result?.provider || null,
    model:       r.result?.model    || null,
    error:       r.error            || null,
    // Truncated prompt from the first chunk or complete event
    promptSnippet: null, // prompt not stored — see /runs/:id/events for full event log
    eventCount:  r.events.length,
  })))
})

// ── GET /runs/:id/events ──────────────────────────────────────────────────────
// Debug: full event log for a specific run (thinking steps, chunks, result).
app.get('/runs/:id/events', (req, res) => {
  const run = runs.get(req.params.id)
  if (!run) return res.status(404).json({ error: 'run not found' })
  res.json({
    id:         run.id,
    session_id: run.session_id,
    status:     run.status,
    cwd:        run.cwd || null,
    startedAt:  run.startedAt,
    elapsedMs:  Date.now() - run.startedAt,
    result:     run.result,
    error:      run.error,
    events:     run.events,
  })
})

// ── GET /models ──────────────────────────────────────────────────────────────
// List all defined providers and their models, indicating if they are enabled.
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
    activeRuns: [...runs.values()].filter(r => r.status === 'running').length,
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

app.listen(PORT, HOST, () => {
  console.log(`[savant-gateway] listening on http://${HOST}:${PORT}`)
  console.log(`[savant-gateway] providers: ${PROVIDER_NAMES.join(', ')}`)
  if (DISABLED_PROVIDERS.length > 0) {
    console.log(`[savant-gateway] disabled providers (cli not found): ${DISABLED_PROVIDERS.join(', ')}`)
  }
})

process.on('uncaughtException',  (e) => console.error('[gateway] uncaughtException', e))
process.on('unhandledRejection', (e) => console.error('[gateway] unhandledRejection', e))
