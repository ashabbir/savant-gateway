const chainLib = require('./chain')

const EVICT_AFTER_MS = 10 * 60 * 1000
const HTTP_NO_CONTENT = 204
const DEFAULT_STAGGER_MS = 250
const MAX_CONCURRENCY = 6
const MAX_LIMIT = 200
const DEFAULT_LIMIT = 50

/**
 * Appends user feedback received during runtime to the prompt string.
 * @param {string} prompt
 * @param {Array<string>} feedback
 * @returns {string}
 */
function steeringPrompt(prompt, feedback = []) {
  if (!Array.isArray(feedback) || feedback.length === 0) return prompt
  const list = feedback.map((item) => `- ${item}`).join('\n')
  return `${prompt}\n\n## User feedback received while you were responding\n${list}\n\nRevise your approach and answer using this feedback.`
}

/**
 * Validates if an origin is local (localhost, 127.0.0.1, [::1]).
 * @param {string} [origin='']
 * @returns {boolean}
 */
function isLocalOrigin(origin) {
  if (!origin) return true
  try {
    const { hostname, protocol } = new URL(origin)
    return (protocol === 'http:' || protocol === 'https:')
      && (hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '[::1]')
  } catch {
    return false
  }
}

/**
 * Express middleware for CORS handling local origins.
 */
function corsMiddleware(req, res, next) {
  const origin = req.headers.origin || ''
  if (isLocalOrigin(origin)) {
    res.setHeader('Access-Control-Allow-Origin', origin || '*')
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, DELETE, OPTIONS')
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type')
  }
  if (req.method === 'OPTIONS') {
    return res.sendStatus(HTTP_NO_CONTENT)
  }
  next()
}

/**
 * Parses chain raw input or returns default chain.
 * @param {string|Array} rawChain
 * @param {Array} defaultChain
 * @returns {Array}
 */
function parseChain(rawChain, defaultChain) {
  if (rawChain === undefined) return defaultChain
  let parsed = rawChain
  if (typeof rawChain === 'string') {
    parsed = JSON.parse(rawChain)
  }
  return Array.isArray(parsed) && parsed.length > 0 ? parsed : defaultChain
}

/**
 * Filters chain steps to only active available providers.
 * @param {Array} chain
 * @param {Array<string>} activeProviderNames
 * @returns {Array}
 */
function filterActiveProviders(chain = [], activeProviderNames = []) {
  if (!Array.isArray(chain)) return []
  return chain.filter((step) => step && typeof step.provider === 'string' && activeProviderNames.includes(step.provider))
}

/**
 * Creates a run state object.
 * @param {Object} params
 * @returns {Object}
 */
function createRun(params = {}) {
  return {
    id: params.id,
    session_id: typeof params.session_id === 'string' ? params.session_id : null,
    status: 'running',
    result: null,
    error: null,
    events: [],
    subscribers: new Set(),
    kill: null,
    prompt: params.prompt,
    files: Array.isArray(params.files) ? params.files : [],
    chain: Array.isArray(params.chain) ? params.chain : [],
    feedback: [],
    cancelled: false,
    generation: 0,
    execution: params.execution === 'serial' ? 'serial' : 'race',
    concurrency: Math.max(1, Math.min(Number(params.concurrency) || 2, MAX_CONCURRENCY)),
    staggerMs: Math.max(0, Number(params.staggerMs) || 0),
    startedAt: Date.now(),
    cwd: typeof params.cwd === 'string' && params.cwd ? params.cwd : undefined,
  }
}

/**
 * Finalizes a run state, closes subscriber SSE connections, cleans up files, and schedules eviction.
 * @param {Object} run
 * @param {Map} runsMap
 * @param {Function} [cleanupFiles]
 */
function finalizeRun(run, runsMap, cleanupFiles) {
  if (run.subscribers) {
    for (const client of run.subscribers) {
      try {
        client.end()
      } catch {
        // ignore client close errors
      }
    }
    run.subscribers.clear()
  }
  if (typeof cleanupFiles === 'function') {
    cleanupFiles(run.files)
  }
  scheduleRunEviction(runsMap, run.id)
}

/**
 * Schedules run entry deletion from in-memory map.
 * @param {Map} runsMap
 * @param {string} runId
 * @returns {NodeJS.Timeout}
 */
function scheduleRunEviction(runsMap, runId) {
  const timer = setTimeout(() => runsMap.delete(runId), EVICT_AFTER_MS)
  timer.unref?.()
  return timer
}

/**
 * Emits an event to all connected SSE clients of a run.
 * @param {Object} run
 * @param {Object} event
 */
function emit(run, event) {
  run.events.push(event)
  for (const client of run.subscribers) {
    try {
      client.write(`data: ${JSON.stringify(event)}\n\n`)
    } catch {
      // ignore broken connection writes
    }
  }
}

/**
 * Executes a run using serial walking or parallel racing.
 * @param {Object} run
 * @param {Map} runsMap
 * @param {Function} [cleanupFiles]
 */
async function executeRun(run, runsMap, cleanupFiles) {
  const prompt = steeringPrompt(run.prompt, run.feedback)
  run.kill = null
  const generation = ++run.generation
  const execute = run.execution === 'serial' ? chainLib.walkChain : chainLib.raceChain

  try {
    const { response, step } = await execute(prompt, run.chain, {
      onThinking: (t) => emit(run, { type: 'thinking', ...t }),
      onChunk: (c) => emit(run, { type: 'chunk', content: c }),
      onKill: (fn) => { run.kill = fn },
      cwd: run.cwd,
      concurrency: run.concurrency,
      staggerMs: run.staggerMs,
    })

    if (run.cancelled || generation !== run.generation) return

    run.status = 'complete'
    run.result = { response, provider: step.provider, model: step.model }
    emit(run, { type: 'complete', content: response, provider: step.provider, model: step.model })

    finalizeRun(run, runsMap, cleanupFiles)
  } catch (err) {
    if (generation !== run.generation) return

    if (err.message === 'KILLED_BY_CLIENT') {
      run.status = 'killed'
    } else {
      run.status = 'error'
      run.error = err.message
    }
    emit(run, { type: 'error', message: err.message })

    finalizeRun(run, runsMap, cleanupFiles)
  }
}

module.exports = {
  steeringPrompt,
  isLocalOrigin,
  createRun,
  finalizeRun,
  scheduleRunEviction,
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
  filterActiveProviders,
}

