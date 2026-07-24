const EVICT_AFTER_MS = 10 * 60 * 1000
const HTTP_NO_CONTENT = 204
const DEFAULT_STAGGER_MS = 250
const MAX_CONCURRENCY = 6
const MAX_LIMIT = 200
const DEFAULT_LIMIT = 50

function steeringPrompt(prompt, feedback) {
  if (feedback.length === 0) return prompt
  const list = feedback.map((item) => `- ${item}`).join('\n')
  return `${prompt}\n\n## User feedback received while you were responding\n${list}\n\nRevise your approach and answer using this feedback.`
}

function isLocalOrigin(origin) {
  if (!origin) return true
  if (origin.startsWith('http://localhost')) return true
  if (origin.startsWith('http://127.0.0.1')) return true
  return false
}

function createRun(params) {
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
    files: params.files || [],
    chain: params.chain || [],
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

function finalizeRun(run, runsMap, cleanupFiles) {
  for (const client of run.subscribers) client.end()
  run.subscribers.clear()
  if (cleanupFiles && typeof cleanupFiles === 'function') {
    cleanupFiles(run.files)
  }
  setTimeout(() => runsMap.delete(run.id), EVICT_AFTER_MS)
}

module.exports = {
  steeringPrompt,
  isLocalOrigin,
  createRun,
  finalizeRun,
  EVICT_AFTER_MS,
  HTTP_NO_CONTENT,
  DEFAULT_STAGGER_MS,
  MAX_CONCURRENCY,
  MAX_LIMIT,
  DEFAULT_LIMIT
}
