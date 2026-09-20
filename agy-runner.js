const { spawn } = require('child_process')
const readline = require('readline')
const os = require('os')
const { buildChildEnv } = require('./adapters')

const DEFAULT_AGY_TIMEOUT_MS = Number(process.env.GATEWAY_PROVIDER_TIMEOUT_MS) || 90_000
const DEFAULT_IDLE_TIMEOUT_MS = Number(process.env.AGY_SESSION_IDLE_TIMEOUT_MS) || 120_000

/**
 * Parses agy CLI arguments to extract flags and prompt.
 * @param {Array<string>} argv
 * @returns {{ model: string|null, effort: string|null, prompt: string|null }}
 */
function parseAgyArgv(argv) {
  let model = null
  let effort = null
  let prompt = null

  for (let i = 1; i < argv.length; i++) {
    const arg = argv[i]
    if (arg === '--model' && i + 1 < argv.length) {
      model = argv[++i]
    } else if (arg === '--effort' && i + 1 < argv.length) {
      effort = argv[++i]
    } else if ((arg === '-p' || arg === '--print' || arg === '--prompt') && i + 1 < argv.length) {
      prompt = argv[++i]
    }
  }

  return { model, effort, prompt }
}

class AgySession {
  constructor({ cwd, model, effort } = {}) {
    this.cwd = cwd || os.homedir()
    this.model = model || null
    this.effort = effort || null
    this.child = null
    this.rl = null
    this.busy = false
    this.ready = false
    this.initPromise = null
    this.conversationId = null
    this.lastActive = Date.now()
    this.idleTimer = null
  }

  start() {
    if (this.initPromise) return this.initPromise

    const args = [
      '--input-format', 'stream-json',
      '--output-format', 'stream-json',
      '--dangerously-skip-permissions',
      '--disable-slash-commands',
    ]
    if (this.model) args.push('--model', this.model)
    if (this.effort) args.push('--effort', this.effort)

    this.child = spawn('agy', args, {
      cwd: this.cwd,
      stdio: ['pipe', 'pipe', 'pipe'],
      env: buildChildEnv({ GEMINI_CLI_TRUST_WORKSPACE: 'true' }),
    })

    this.rl = readline.createInterface({ input: this.child.stdout })

    this.initPromise = new Promise((resolve, reject) => {
      let initTimeout = setTimeout(() => {
        reject(new Error('AGY_INIT_TIMEOUT'))
      }, 20_000)

      const onLine = (line) => {
        try {
          const evt = JSON.parse(line)
          if (evt.event === 'init') {
            clearTimeout(initTimeout)
            this.ready = true
            this.conversationId = evt.conversation_id || null
            this.rl.removeListener('line', onLine)
            resolve()
          }
        } catch {
          // ignore non-JSON startup banners if any
        }
      }

      this.rl.on('line', onLine)

      this.child.on('error', (err) => {
        clearTimeout(initTimeout)
        this.destroy()
        reject(err)
      })

      this.child.on('exit', () => {
        clearTimeout(initTimeout)
        this.ready = false
        this.child = null
      })
    })

    return this.initPromise
  }

  clearIdleTimer() {
    if (this.idleTimer) {
      clearTimeout(this.idleTimer)
      this.idleTimer = null
    }
  }

  resetIdleTimer(onTimeout) {
    this.clearIdleTimer()
    if (DEFAULT_IDLE_TIMEOUT_MS > 0) {
      this.idleTimer = setTimeout(() => {
        onTimeout?.()
      }, DEFAULT_IDLE_TIMEOUT_MS)
      if (this.idleTimer.unref) this.idleTimer.unref()
    }
  }

  sendTurn(prompt, { onChunk, onThinking, onKill, timeoutMs = DEFAULT_AGY_TIMEOUT_MS } = {}) {
    this.clearIdleTimer()

    return new Promise((resolve, reject) => {
      let settled = false
      let timer = null
      let onLine = null

      const settle = (err, result) => {
        if (settled) return
        settled = true
        if (timer) clearTimeout(timer)
        this.busy = false
        this.lastActive = Date.now()
        if (onLine) this.rl?.removeListener('line', onLine)

        if (err) {
          reject(err)
        } else {
          resolve(result)
        }
      }

      if (typeof onKill === 'function') {
        onKill(() => {
          this.destroy()
          settle(new Error('KILLED_BY_CLIENT'))
        })
      }

      this.start().then(() => {
        if (settled) return
        if (this.busy) {
          return settle(new Error('AGY_SESSION_BUSY'))
        }
        this.busy = true
        this.lastActive = Date.now()

        timer = setTimeout(() => {
          settle(new Error(`AGENT_TIMEOUT after ${timeoutMs}ms (agy)`))
        }, timeoutMs)

        let responseText = ''

        onLine = (line) => {
          try {
            const evt = JSON.parse(line)
            if (evt.event === 'step_update') {
              const step = evt.step_update
              if (step?.step_type === 'thought' || step?.thought) {
                onThinking?.(step.thought || step.text_delta || '')
              }
              if (step?.text_delta) {
                responseText += step.text_delta
                onChunk?.(step.text_delta)
              }
            } else if (evt.event === 'result') {
              const res = evt.result
              if (res?.status === 'ERROR') {
                settle(new Error(res.error || 'AGY_ERROR'))
              } else {
                const finalResponse = res?.response || responseText
                settle(null, finalResponse)
              }
            }
          } catch {
            // ignore unparseable lines
          }
        }

        this.rl?.on('line', onLine)

        const payload = JSON.stringify({
          event: 'user',
          message: { content: prompt },
        }) + '\n'

        try {
          this.child.stdin.write(payload)
        } catch (err) {
          settle(err)
        }
      }).catch((err) => {
        settle(err)
      })
    })
  }

  destroy() {
    this.clearIdleTimer()
    this.ready = false
    this.busy = false
    this.initPromise = null
    if (this.child) {
      try { this.child.stdin?.end() } catch {}
      try { this.child.kill('SIGTERM') } catch {}
      this.child = null
    }
  }
}

class AgySessionPool {
  constructor() {
    this.pool = new Map()
  }

  getPoolKey(cwd, model, effort) {
    return `${cwd || 'default'}:${model || 'default'}:${effort || 'medium'}`
  }

  getOrCreate(cwd, model, effort) {
    const key = this.getPoolKey(cwd, model, effort)
    let session = this.pool.get(key)
    if (!session || (session.child && (session.child.killed || session.child.exitCode !== null))) {
      session = new AgySession({ cwd, model, effort })
      this.pool.set(key, session)
    }
    return session
  }

  async runTurn(prompt, { cwd, model, effort, onChunk, onThinking, onKill, timeoutMs } = {}) {
    const session = this.getOrCreate(cwd, model, effort)
    const key = this.getPoolKey(cwd, model, effort)

    try {
      const response = await session.sendTurn(prompt, {
        onChunk,
        onThinking,
        onKill: (killFn) => {
          onKill?.(() => {
            this.pool.delete(key)
            killFn()
          })
        },
        timeoutMs,
      })

      session.resetIdleTimer(() => {
        session.destroy()
        this.pool.delete(key)
      })

      return response
    } catch (err) {
      session.destroy()
      this.pool.delete(key)
      throw err
    }
  }

  closeAll() {
    for (const session of this.pool.values()) {
      session.destroy()
    }
    this.pool.clear()
  }
}

const defaultAgyPool = new AgySessionPool()

module.exports = {
  AgySession,
  AgySessionPool,
  parseAgyArgv,
  defaultAgyPool,
}
