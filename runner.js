const { spawn } = require('child_process')
const os = require('os')
const { buildChildEnv } = require('./adapters')

const HARD_TIMEOUT_MS = 300_000

/**
 * Spawn a CLI agent and return a promise that resolves to its full stdout.
 * Calls onChunk(string) for each stdout chunk so callers can stream.
 * Calls onKill(fn) immediately so callers can wire a kill handle before
 * the process finishes.
 */
function spawnAgent(argv, { onChunk, onKill, cwd } = {}) {
  return new Promise((resolve, reject) => {
    const [cmd, ...args] = argv
    let stdout = ''
    let stderr = ''
    let killed = false
    let timedOut = false

    const child = spawn(cmd, args, {
      cwd: cwd || os.homedir(),
      env: buildChildEnv({ GEMINI_CLI_TRUST_WORKSPACE: 'true' }),
    })

    // Expose kill handle to caller before we await anything.
    onKill?.(() => {
      killed = true
      try { child.kill('SIGTERM') } catch {}
      setTimeout(() => { try { child.kill('SIGKILL') } catch {} }, 1500)
    })

    const killer = setTimeout(() => {
      timedOut = true
      try { child.kill('SIGTERM') } catch {}
      setTimeout(() => { try { child.kill('SIGKILL') } catch {} }, 2000)
    }, HARD_TIMEOUT_MS)

    child.stdout.on('data', (data) => {
      const chunk = data.toString()
      stdout += chunk
      onChunk?.(chunk)
    })

    child.stderr.on('data', (data) => {
      stderr += data.toString()
    })

    child.on('close', () => {
      clearTimeout(killer)
      if (killed)    return reject(new Error('KILLED_BY_CLIENT'))
      if (timedOut)  return reject(new Error(`AGENT_TIMEOUT after ${HARD_TIMEOUT_MS}ms (${cmd})`))
      resolve(stdout || stderr)
    })

    child.on('error', (err) => {
      clearTimeout(killer)
      reject(err)
    })
  })
}

module.exports = { spawnAgent }
