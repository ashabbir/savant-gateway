const { spawn } = require('child_process')
const os = require('os')
const { buildChildEnv } = require('./adapters')

const HARD_TIMEOUT_MS = Number(process.env.GATEWAY_PROVIDER_TIMEOUT_MS) || 90_000
const { defaultAgyPool, parseAgyArgv } = require('./agy-runner')

/**
 * Spawns a CLI agent subprocess and streams output.
 * When the provider is AGY and a prompt is supplied, routes to the high-performance
 * native stream-json driver with persistent session reuse.
 * @param {Array<string>} argv - Command and arguments array.
 * @param {Object} [options={}]
 * @param {Function} [options.onChunk] - Stream chunk callback.
 * @param {Function} [options.onThinking] - Thinking update callback.
 * @param {Function} [options.onKill] - Callback receiving kill function handle.
 * @param {string} [options.cwd] - Working directory.
 * @returns {Promise<string>} Full stdout/stderr content.
 */
function spawnAgent(argv, { onChunk, onThinking, onKill, cwd } = {}) {
  if (!Array.isArray(argv) || argv.length === 0) {
    return Promise.reject(new Error('Invalid command arguments array'))
  }

  const [cmd, ...args] = argv
  if (cmd === 'agy' && process.env.AGY_NATIVE_STREAM !== 'false') {
    const parsed = parseAgyArgv(argv)
    if (parsed.prompt) {
      return defaultAgyPool.runTurn(parsed.prompt, {
        cwd,
        model: parsed.model,
        effort: parsed.effort,
        onChunk,
        onThinking,
        onKill,
      })
    }
  }
  return new Promise((resolve, reject) => {
    const state = { stdout: '', stderr: '', killed: false, timedOut: false, settled: false }
    let timeoutTimer
    let escalationTimer

    const child = spawn(cmd, args, {
      cwd: cwd || os.homedir(),
      env: buildChildEnv({ GEMINI_CLI_TRUST_WORKSPACE: 'true' }),
    })

    child.stdin.end()

    const clearTimers = () => {
      clearTimeout(timeoutTimer)
      clearTimeout(escalationTimer)
    }

    const settle = (error, output) => {
      if (state.settled) return
      state.settled = true
      clearTimers()
      if (error) reject(error)
      else resolve(output)
    }

    const stopChild = (forceAfterMs) => {
      try { child.kill('SIGTERM') } catch {}
      escalationTimer = setTimeout(() => {
        try { child.kill('SIGKILL') } catch {}
      }, forceAfterMs)
    }

    if (typeof onKill === 'function') {
      onKill(() => {
        state.killed = true
        stopChild(1_500)
      })
    }

    timeoutTimer = setTimeout(() => {
      state.timedOut = true
      stopChild(2_000)
    }, HARD_TIMEOUT_MS)

    attachChildOutputListeners(child, state, onChunk)
    attachChildLifecycleListeners(child, state, cmd, settle)
  })
}

function attachChildOutputListeners(child, state, onChunk) {
  child.stdout.on('data', (data) => {
    const chunk = data.toString()
    state.stdout += chunk
    onChunk?.(chunk)
  })

  child.stderr.on('data', (data) => {
    const chunk = data.toString()
    state.stderr += chunk
    onChunk?.(chunk)
  })
}

function attachChildLifecycleListeners(child, state, cmd, settle) {
  child.on('close', () => {
    if (state.killed) return settle(new Error('KILLED_BY_CLIENT'))
    if (state.timedOut) return settle(new Error(`AGENT_TIMEOUT after ${HARD_TIMEOUT_MS}ms (${cmd})`))
    settle(null, state.stdout || state.stderr)
  })

  child.on('error', (err) => {
    settle(err)
  })
}

module.exports = { spawnAgent }

