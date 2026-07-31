const { spawn } = require('child_process')
const os = require('os')
const { buildChildEnv } = require('./adapters')

const HARD_TIMEOUT_MS = Number(process.env.GATEWAY_PROVIDER_TIMEOUT_MS) || 90_000

/**
 * Spawns a CLI agent subprocess and streams output.
 * @param {Array<string>} argv - Command and arguments array.
 * @param {Object} [options={}]
 * @param {Function} [options.onChunk] - Stream chunk callback.
 * @param {Function} [options.onKill] - Callback receiving kill function handle.
 * @param {string} [options.cwd] - Working directory.
 * @returns {Promise<string>} Full stdout/stderr content.
 */
function spawnAgent(argv, { onChunk, onKill, cwd } = {}) {
  return new Promise((resolve, reject) => {
    if (!Array.isArray(argv) || argv.length === 0) {
      return reject(new Error('Invalid command arguments array'))
    }

    const [cmd, ...args] = argv
    let stdout = ''
    let stderr = ''
    let killed = false
    let timedOut = false
    let settled = false
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
      if (settled) return
      settled = true
      clearTimers()
      if (error) reject(error)
      else resolve(output)
    }

    const stopChild = (forceAfterMs) => {
      try {
        child.kill('SIGTERM')
      } catch {
        // ignore process kill error
      }
      escalationTimer = setTimeout(() => {
        try {
          child.kill('SIGKILL')
        } catch {
          // ignore process kill error
        }
      }, forceAfterMs)
    }

    // Expose kill handle to caller before we await anything.
    if (typeof onKill === 'function') {
      onKill(() => {
        killed = true
        stopChild(1_500)
      })
    }

    timeoutTimer = setTimeout(() => {
      timedOut = true
      stopChild(2_000)
    }, HARD_TIMEOUT_MS)

    child.stdout.on('data', (data) => {
      const chunk = data.toString()
      stdout += chunk
      onChunk?.(chunk)
    })

    child.stderr.on('data', (data) => {
      const chunk = data.toString()
      stderr += chunk
      onChunk?.(chunk)
    })

    child.on('close', () => {
      if (killed) return settle(new Error('KILLED_BY_CLIENT'))
      if (timedOut) return settle(new Error(`AGENT_TIMEOUT after ${HARD_TIMEOUT_MS}ms (${cmd})`))
      settle(null, stdout || stderr)
    })

    child.on('error', (err) => {
      settle(err)
    })
  })
}

module.exports = { spawnAgent }

