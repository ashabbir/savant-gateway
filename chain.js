const os = require('os')
const path = require('path')
const fs = require('fs')
const { ADAPTERS, DEFAULT_CHAIN, isQuotaError, buildArgv } = require('./adapters')
const { spawnAgent } = require('./runner')

// Providers that maintain a visible session history tied to the CWD
const ISOLATED_CWD_PROVIDERS = new Set(['copilot', 'codex', 'gemini', 'agy', 'hermes'])

const QUORUM_STAGING_DIR = path.join(os.homedir(), '.savant', 'quorum', 'gateway-staging')
try {
  fs.mkdirSync(QUORUM_STAGING_DIR, { recursive: true })
} catch {
  // ignore directory creation error
}

/**
 * Resolves working directory for provider execution.
 * @param {string} providerName
 * @param {string} [requestedCwd]
 * @returns {string}
 */
function resolveProviderCwd(providerName, requestedCwd) {
  if (requestedCwd) return requestedCwd
  if (ISOLATED_CWD_PROVIDERS.has(providerName)) {
    if (fs.existsSync('/Users/home/code/project-x')) {
      return '/Users/home/code/project-x'
    }
    return QUORUM_STAGING_DIR
  }
  return os.homedir()
}

/**
 * Walk a provider chain sequentially until one succeeds.
 * @param {string} prompt
 * @param {Array} [chain=DEFAULT_CHAIN]
 * @param {Object} [callbacks={}]
 * @returns {Promise<{response: string, step: Object}>}
 */
async function walkChain(prompt, chain = DEFAULT_CHAIN, callbacks = {}) {
  const steps = resolveSteps(chain)
  let lastError = null

  for (const step of steps) {
    const result = await executeWalkStep(step, prompt, callbacks)
    if (result.type === 'skip') continue
    if (result.type === 'error') {
      lastError = result.error
      continue
    }
    if (result.type === 'ok') {
      return { response: result.response, step }
    }
  }

  throw new Error(`ALL_PROVIDERS_EXHAUSTED. Last: ${lastError?.message || 'unknown'}`)
}

async function executeWalkStep(step, prompt, callbacks) {
  const { onThinking, onChunk, onKill, cwd, system, spawnAgent: spawn = spawnAgent } = callbacks
  const adapter = ADAPTERS[step.provider]
  if (!adapter) {
    onThinking?.({ provider: step.provider, model: step.model, tag: step.provider, status: 'skip', reason: 'unknown provider' })
    return { type: 'skip' }
  }

  const tag = step.model ? `${adapter.label}:${step.model}` : adapter.label
  onThinking?.({ provider: step.provider, model: step.model, tag, status: 'pending' })

  let argv
  try {
    argv = buildArgv(step, prompt, system)
  } catch (err) {
    onThinking?.({ provider: step.provider, model: step.model, tag, status: 'error', reason: err.message })
    return { type: 'error', error: err }
  }

  try {
    const providerCwd = resolveProviderCwd(step.provider, cwd)
    const response = await spawn(argv, { onChunk, onKill, cwd: providerCwd })

    if (isQuotaError(response) || invalidResponse(response)) {
      const errorReason = isQuotaError(response) ? 'quota exhausted' : String(response).slice(0, 120).trim()
      onThinking?.({ provider: step.provider, model: step.model, tag, status: 'fallback', reason: errorReason })
      return { type: 'error', error: new Error(response) }
    }

    onThinking?.({ provider: step.provider, model: step.model, tag, status: 'ok' })
    return { type: 'ok', response }
  } catch (err) {
    if (err && err.message === 'KILLED_BY_CLIENT') throw err

    onThinking?.({ provider: step.provider, model: step.model, tag, status: 'error', reason: err?.message || 'Unknown error' })
    return { type: 'error', error: err }
  }
}

/**
 * Checks if a response string is invalid or an error message.
 * @param {string} response
 * @returns {boolean}
 */
function invalidResponse(response) {
  if (!response || typeof response !== 'string' || !response.trim()) return true
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
    this.activeKills.forEach((kill) => kill())
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

    const outcome = await launchProvider(
      step, this.prompt, this.spawn, this.callbacks.cwd, (kill) => this.activeKills.set(index, kill),
    )

    this.active--
    this.finished++
    this.activeKills.delete(index)
    if (this.settled) return

    this._processOutcome(outcome, step, tag)
  }

  _processOutcome(outcome, step, tag) {
    const { status, response, error, chunks } = outcome
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
    if (status === 'skip') {
      this.callbacks.onThinking?.({ provider: step.provider, model: step.model, tag, status: 'skip', reason: 'unknown provider' })
      return false
    }
    if (status === 'ok') {
      this.callbacks.onThinking?.({ provider: step.provider, model: step.model, tag, status: 'ok', parallel: true })
      if (Array.isArray(chunks)) {
        chunks.forEach((c) => this.callbacks.onChunk?.(c))
      }
      this.resolve({ response, step })
      return true
    }
    if (status === 'killed') {
      this.reject(error)
      return true
    }

    this.lastError = error
    this.callbacks.onThinking?.({
      provider: step.provider,
      model: step.model,
      tag,
      status: status === 'fallback' ? 'fallback' : 'error',
      reason: error?.message?.slice(0, 120),
    })
    return false
  }

  pump() {
    while (!this.settled && this.active < this.concurrency && this.nextIndex < this.steps.length) {
      const index = this.nextIndex++
      const step = this.steps[index]
      this.active++
      this._scheduleStepLaunch(step, index)
    }
  }

  _scheduleStepLaunch(step, index) {
    const delay = this.staggerMs * index
    if (!delay) {
      this.launch(step, index)
      return
    }

    const timer = setTimeout(() => {
      this.launchTimers.delete(timer)
      this.launch(step, index)
    }, delay)
    this.launchTimers.add(timer)
  }
}

/**
 * Race a bounded number of isolated provider subprocesses. First valid response wins.
 * @param {string} prompt
 * @param {Array} [chain=DEFAULT_CHAIN]
 * @param {Object} [callbacks={}]
 * @returns {Promise<{response: string, step: Object}>}
 */
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

/**
 * Resolves chain array or defaults.
 * @param {Array} chain
 * @returns {Array}
 */
function resolveSteps(chain) {
  return Array.isArray(chain) && chain.length > 0 ? chain : DEFAULT_CHAIN
}

/**
 * Spawns provider process and manages output streams.
 * @param {Object} step
 * @param {string} prompt
 * @param {Function} spawn
 * @param {string} cwd
 * @param {Function} onKill
 * @returns {Promise<Object>}
 */
async function launchProvider(step, prompt, spawn, cwd, onKill) {
  const adapter = ADAPTERS[step.provider]
  if (!adapter) return { status: 'skip' }

  let argv
  try {
    argv = buildArgv(step, prompt)
  } catch (error) {
    return { status: 'argv_error', error }
  }

  return executeProviderSpawn(step, argv, spawn, cwd, onKill)
}

/**
 * Executes spawn for a valid provider step and formats result outcome.
 */
async function executeProviderSpawn(step, argv, spawn, cwd, onKill) {
  const chunks = []
  try {
    const response = await spawn(argv, {
      cwd: resolveProviderCwd(step.provider, cwd),
      onChunk: (chunk) => chunks.push(chunk),
      onKill,
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

