const os = require('os')
const path = require('path')
const fs = require('fs')
const { ADAPTERS, DEFAULT_CHAIN, isQuotaError, buildArgv } = require('./adapters')
const { spawnAgent } = require('./runner')

// Providers that maintain a visible session history tied to the CWD (e.g.
// Copilot CLI records each invocation and shows it when the user opens the
// CLI in that directory). Running them in a Quorum-internal staging dir
// keeps the user's project directories clean.
const ISOLATED_CWD_PROVIDERS = new Set(['copilot', 'codex', 'gemini', 'agy'])

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
  const { onThinking, onChunk, onKill, cwd } = callbacks
  const steps = Array.isArray(chain) && chain.length > 0 ? chain : DEFAULT_CHAIN
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
      const response = await spawnAgent(argv, { onChunk, onKill, cwd: providerCwd })

      const isErrorResponse = (res) => {
        if (!res) return false
        const lower = res.toLowerCase()
        if (res.startsWith('Error:') || res.startsWith('ERROR:')) return true
        
        const errorPhrases = [
          'not logged in',
          'please run /login',
          'no authentication information found',
          'ineligibletiererror',
          'usage limit',
          'upgrade to pro',
          'resource has been exhausted',
          'critical error occurred',
          'transport channel closed',
          'quota exhausted',
          'rate limit',
          'authrequired'
        ]
        return errorPhrases.some(phrase => lower.includes(phrase))
      }

      if (isQuotaError(response) || isErrorResponse(response)) {
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

module.exports = { walkChain }
