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

class RaceChainSession {
  constructor(prompt, steps, concurrency, staggerMs, spawn, callbacks, resolve, reject) {
    this.prompt = prompt
    this.steps = steps
    this.concurrency = concurrency
    this.staggerMs = staggerMs
    this.spawn = spawn
    this.callbacks = callbacks
    this.resolve = resolve
    this.reject = reject

    this.activeKills = new Map()
    this.launchTimers = new Set()
    this.nextIndex = 0
    this.active = 0
    this.finished = 0
    this.settled = false
    this.lastError = null
  }

  cancelOutstanding() {
    this.launchTimers.forEach(clearTimeout)
    this.launchTimers.clear()
    this.activeKills.forEach(kill => kill())
    this.activeKills.clear()
  }

  cancel() {
    if (this.settled) return
    this.settled = true
    this.cancelOutstanding()
    this.reject(new Error('KILLED_BY_CLIENT'))
  }

  async launch(step, index) {
    if (this.settled) return

    const adapter = ADAPTERS[step.provider]
    const tag = adapter ? (step.model ? `${adapter.label}:${step.model}` : adapter.label) : step.provider
    if (adapter) {
      this.callbacks.onThinking?.({ provider: step.provider, model: step.model, tag, status: 'pending', parallel: true })
    }

    const { status, response, error, chunks } = await launchProvider(
      step, this.prompt, this.spawn, this.callbacks.cwd, (kill) => this.activeKills.set(index, kill)
    )

    this.active--
    this.finished++
    this.activeKills.delete(index)
    if (this.settled) return

    const shouldSettle = this._handleStatus(status, response, error, chunks, step, tag)
    if (shouldSettle) {
      this.settled = true
      this.cancelOutstanding()
      return
    }

    if (this.finished === this.steps.length) {
      this.settled = true
      this.reject(new Error(`ALL_PROVIDERS_EXHAUSTED. Last: ${this.lastError?.message || 'unknown'}`))
    } else {
      this.pump()
    }
  }

  _handleStatus(status, response, error, chunks, step, tag) {
    switch (status) {
      case 'skip':
        this.callbacks.onThinking?.({ provider: step.provider, model: step.model, tag, status: 'skip', reason: 'unknown provider' })
        break
      case 'ok':
        this.callbacks.onThinking?.({ provider: step.provider, model: step.model, tag, status: 'ok', parallel: true })
        chunks.forEach(c => this.callbacks.onChunk?.(c))
        this.resolve({ response, step })
        return true
      case 'killed':
        this.reject(error)
        return true
      default:
        this.lastError = error
        this.callbacks.onThinking?.({
          provider: step.provider,
          model: step.model,
          tag,
          status: status === 'fallback' ? 'fallback' : 'error',
          reason: error?.message?.slice(0, 120)
        })
        break
    }
    return false
  }

  pump() {
    while (!this.settled && this.active < this.concurrency && this.nextIndex < this.steps.length) {
      const index = this.nextIndex++
      const step = this.steps[index]
      this.active++
      const delay = this.staggerMs * index
      if (delay) {
        const timer = setTimeout(() => {
          this.launchTimers.delete(timer)
          this.launch(step, index)
        }, delay)
        this.launchTimers.add(timer)
      } else {
        this.launch(step, index)
      }
    }
  }
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
    const session = new RaceChainSession(prompt, steps, concurrency, staggerMs, spawn, callbacks, resolve, reject)
    callbacks.onKill?.(() => session.cancel())
    session.pump()
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
