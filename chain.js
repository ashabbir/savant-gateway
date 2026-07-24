const os = require('os')
const path = require('path')
const fs = require('fs')
const { ADAPTERS, DEFAULT_CHAIN, isQuotaError, buildArgv } = require('./adapters')
const { spawnAgent } = require('./runner')

// Providers that maintain a visible session history tied to the CWD (e.g.
// Copilot CLI records each invocation and shows it when the user opens the
// CLI in that directory). Running them in a Quorum-internal staging dir
// keeps the user's project directories clean.
const ISOLATED_CWD_PROVIDERS = new Set(['copilot', 'codex', 'gemini', 'agy', 'hermes'])

const QUORUM_STAGING_DIR = path.join(os.homedir(), '.savant', 'quorum', 'gateway-staging')
try { fs.mkdirSync(QUORUM_STAGING_DIR, { recursive: true }) } catch {}

function resolveProviderCwd(providerName, requestedCwd) {
  if (requestedCwd) return requestedCwd;
  if (ISOLATED_CWD_PROVIDERS.has(providerName)) {
    if (fs.existsSync('/Users/home/code/project-x')) {
      return '/Users/home/code/project-x';
    }
    return QUORUM_STAGING_DIR;
  }
  return os.homedir();
}

/**
 * Walk a provider chain until one succeeds.
 *
 * callbacks:
 *   onThinking({ provider, model, tag, status, reason? }) — called at each step
 *   onChunk(string)   — stdout chunks from the winning provider (for SSE streaming)
 *   onKill(fn)        — called with a kill handle for the in-flight subprocess
 *
 * Returns { response: string, step: { provider, model } }
 * Throws  'ALL_PROVIDERS_EXHAUSTED' if every step fails.
 */
async function walkChain(prompt, chain = DEFAULT_CHAIN, callbacks = {}) {
  const { onThinking, onChunk, onKill, cwd, spawnAgent: spawn = spawnAgent } = callbacks
  const steps = resolveSteps(chain)
  let lastError = null

  for (const step of steps) {
    const adapter = ADAPTERS[step.provider]
    if (!adapter) {
      onThinking?.({ provider: step.provider, model: step.model, tag: step.provider, status: 'skip', reason: 'unknown provider' })
      continue
    }

    const tag = step.model ? `${adapter.label}:${step.model}` : adapter.label
    onThinking?.({ provider: step.provider, model: step.model, tag, status: 'pending' })

    let argv
    try {
      argv = buildArgv(step, prompt)
    } catch (err) {
      onThinking?.({ provider: step.provider, model: step.model, tag, status: 'error', reason: err.message })
      lastError = err
      continue
    }

    try {
      const providerCwd = resolveProviderCwd(step.provider, cwd)
      const response = await spawn(argv, { onChunk, onKill, cwd: providerCwd })

      if (isQuotaError(response) || invalidResponse(response)) {
        const errorReason = isQuotaError(response) ? 'quota exhausted' : response.slice(0, 120).trim()
        onThinking?.({ provider: step.provider, model: step.model, tag, status: 'fallback', reason: errorReason })
        lastError = new Error(response)
        continue
      }

      onThinking?.({ provider: step.provider, model: step.model, tag, status: 'ok' })
      return { response, step }

    } catch (err) {
      // KILLED_BY_CLIENT should propagate — don't try the next provider.
      if (err.message === 'KILLED_BY_CLIENT') throw err

      onThinking?.({ provider: step.provider, model: step.model, tag, status: 'error', reason: err.message })
      lastError = err
      continue
    }
  }

  throw new Error(`ALL_PROVIDERS_EXHAUSTED. Last: ${lastError?.message || 'unknown'}`)
}

function invalidResponse(response) {
  if (!response || !response.trim()) return true
  const lower = response.toLowerCase()
  if (response.startsWith('Error:') || response.startsWith('ERROR:')) return true
  return [
    'not logged in', 'please run /login', 'no authentication information found',
    'ineligibletiererror', 'usage limit', 'upgrade to pro',
    'resource has been exhausted', 'critical error occurred',
    'transport channel closed', 'quota exhausted', 'rate limit', 'authrequired',
    'flags provided but not defined:', 'unknown option',
  ].some((phrase) => lower.includes(phrase))
}

/** Race a bounded number of isolated provider subprocesses. The first valid
 * response wins and every losing process is cancelled. Chunks are buffered so
 * clients never receive a mixed response from losing providers. */
function raceChain(prompt, chain = DEFAULT_CHAIN, callbacks = {}) {
  const steps = resolveSteps(chain)
  const concurrency = Math.max(1, Math.min(Number(callbacks.concurrency) || 2, steps.length, 6))
  const staggerMs = Math.max(0, Number(callbacks.staggerMs) || 0)
  const spawn = callbacks.spawnAgent || spawnAgent

  return new Promise((resolve, reject) => {
    const activeKills = new Map()
    const launchTimers = new Set()
    let nextIndex = 0
    let active = 0
    let finished = 0
    let settled = false
    let lastError = null

    const killAll = () => {
      for (const timer of launchTimers) clearTimeout(timer)
      launchTimers.clear()
      for (const kill of activeKills.values()) kill()
      activeKills.clear()
    }
    callbacks.onKill?.(killAll)

    const maybeFinish = () => {
      if (!settled && finished === steps.length) {
        settled = true
        reject(new Error(`ALL_PROVIDERS_EXHAUSTED. Last: ${lastError?.message || 'unknown'}`))
      }
    }

    const launch = (step, index) => {
      if (settled) return
      const adapter = ADAPTERS[step.provider]
      const tag = adapter ? (step.model ? `${adapter.label}:${step.model}` : adapter.label) : step.provider
      if (adapter) {
        callbacks.onThinking?.({ provider: step.provider, model: step.model, tag, status: 'pending', parallel: true })
      }

      launchProvider(step, prompt, spawn, callbacks.cwd, (kill) => activeKills.set(index, kill))
        .then(({ status, response, error, chunks }) => {
          active--
          finished++
          activeKills.delete(index)
          if (settled) return

          if (status === 'skip') {
            callbacks.onThinking?.({ provider: step.provider, model: step.model, tag, status: 'skip', reason: 'unknown provider' })
            maybeFinish()
          } else if (status === 'argv_error' || status === 'error') {
            lastError = error
            callbacks.onThinking?.({ provider: step.provider, model: step.model, tag, status: 'error', reason: error.message })
            pump()
          } else if (status === 'fallback') {
            lastError = error
            callbacks.onThinking?.({ provider: step.provider, model: step.model, tag, status: 'fallback', reason: error.message.slice(0, 120) })
            pump()
            maybeFinish()
          } else if (status === 'killed') {
            settled = true
            killAll()
            reject(error)
          } else if (status === 'ok') {
            settled = true
            callbacks.onThinking?.({ provider: step.provider, model: step.model, tag, status: 'ok', parallel: true })
            killAll()
            for (const chunk of chunks) callbacks.onChunk?.(chunk)
            resolve({ response, step })
          }
        })
    }

    const pump = () => {
      while (!settled && active < concurrency && nextIndex < steps.length) {
        const index = nextIndex++
        active++
        let timer = null
        const start = () => { launchTimers.delete(timer); launch(steps[index], index) }
        const delay = staggerMs * index
        if (delay > 0) { timer = setTimeout(start, delay); launchTimers.add(timer) } else start()
      }
      maybeFinish()
    }
    pump()
  })
}

function resolveSteps(chain) {
  return Array.isArray(chain) && chain.length > 0 ? chain : DEFAULT_CHAIN
}

async function launchProvider(step, prompt, spawn, cwd, onKill) {
  const adapter = ADAPTERS[step.provider]
  if (!adapter) return { status: 'skip' }

  let argv
  try {
    argv = buildArgv(step, prompt)
  } catch (error) {
    return { status: 'argv_error', error }
  }

  const chunks = []
  try {
    const response = await spawn(argv, {
      cwd: resolveProviderCwd(step.provider, cwd),
      onChunk: (chunk) => chunks.push(chunk),
      onKill
    })

    if (isQuotaError(response) || invalidResponse(response)) {
      return { status: 'fallback', error: new Error(response || 'empty provider response') }
    }

    return { status: 'ok', response, chunks }
  } catch (error) {
    if (error && error.message === 'KILLED_BY_CLIENT') {
      return { status: 'killed', error }
    }
    return { status: 'error', error }
  }
}

module.exports = { walkChain, raceChain, resolveSteps, launchProvider }
