const fs = require('fs')
const path = require('path')
const os = require('os')
const { randomUUID } = require('crypto')

const DEFAULT_STORE_PATH = path.join(os.homedir(), '.savant', 'gateway-sessions.json')

/**
 * Strips ANSI terminal escape sequences.
 * @param {string} str
 * @returns {string}
 */
function stripAnsi(str) {
  if (typeof str !== 'string') return ''
  // eslint-disable-next-line no-control-regex
  return str.replace(/\x1B(?:[@-Z\\-_]|\[[0-?]*[ -/]*[@-~])/g, '')
}

/**
 * Parses out thinking sections (DeepSeek-R1 / XML thinking tags) and cleans content.
 * @param {string} text
 * @returns {{thinking: string, answer: string, raw: string}}
 */
function parseThinking(text) {
  const cleaned = stripAnsi(text || '')
  let thinking = ''
  let answer = cleaned

  // Check for CLI format: "Thinking...\n...done thinking.\n\n"
  const cliMatch = cleaned.match(/^Thinking\.\.\.\r?\n([\s\S]*?)\.\.\.done thinking\.\r?\n*([\s\S]*)$/)
  if (cliMatch) {
    thinking = cliMatch[1].trim()
    answer = cliMatch[2].trim()
    return { thinking, answer, raw: cleaned }
  }

  // Check for XML tag format: <think>...</think>
  const xmlMatch = cleaned.match(/<think>([\s\S]*?)<\/think>([\s\S]*)/i)
  if (xmlMatch) {
    thinking = xmlMatch[1].trim()
    answer = xmlMatch[2].trim()
    return { thinking, answer, raw: cleaned }
  }

  return { thinking: '', answer: cleaned, raw: cleaned }
}

/**
 * Formats an array of chat messages into a structured prompt for single-turn CLI agents.
 * @param {Array<{role: string, content: string}>} messages
 * @param {string} [systemPrompt='']
 * @returns {string}
 */
function formatChatPrompt(messages = [], systemPrompt = '') {
  if (!Array.isArray(messages) || messages.length === 0) return ''

  if (messages.length === 1 && (!systemPrompt || !systemPrompt.trim())) {
    const single = messages[0]
    return typeof single.content === 'string' ? single.content : ''
  }

  const sections = []
  if (systemPrompt && typeof systemPrompt === 'string' && systemPrompt.trim()) {
    sections.push(`[System Instructions]\n${systemPrompt.trim()}`)
  }

  const history = messages.slice(0, -1)
  const latest = messages[messages.length - 1]

  if (history.length > 0) {
    const historyLines = []
    for (const msg of history) {
      const role = msg.role === 'assistant' ? 'Assistant' : (msg.role === 'system' ? 'System' : 'User')
      const { answer } = parseThinking(msg.content || '')
      historyLines.push(`${role}: ${answer || msg.content || ''}`)
    }
    sections.push(`[Conversation History]\n${historyLines.join('\n')}`)
  }

  const latestRole = latest.role === 'assistant' ? 'Assistant' : (latest.role === 'system' ? 'System' : 'User')
  const { answer: latestAnswer } = parseThinking(latest.content || '')
  const latestContent = latestAnswer || latest.content || ''

  if (history.length > 0 || (systemPrompt && systemPrompt.trim())) {
    sections.push(`[Latest ${latestRole} Message]\n${latestContent}`)
  } else {
    sections.push(latestContent)
  }

  return sections.join('\n\n')
}

/**
 * Generates a concise title from the first user prompt.
 * @param {string} content
 * @returns {string}
 */
function generateTitle(content = '') {
  const { answer } = parseThinking(content)
  const text = (answer || content).replace(/[\r\n]+/g, ' ').trim()
  if (!text) return 'New Chat'
  return text.length > 40 ? `${text.slice(0, 37)}...` : text
}

class SessionStore {
  /**
   * @param {Object} [options={}]
   * @param {string} [options.storagePath]
   * @param {boolean} [options.persist=true]
   */
  constructor(options = {}) {
    this.storagePath = options.storagePath || DEFAULT_STORE_PATH
    this.persist = options.persist !== false
    this.sessions = new Map()
    this.saveTimeout = null
    this.load()
  }

  load() {
    if (!this.persist) return
    try {
      if (fs.existsSync(this.storagePath)) {
        const raw = fs.readFileSync(this.storagePath, 'utf8')
        const data = JSON.parse(raw)
        if (Array.isArray(data)) {
          for (const s of data) {
            if (s && s.id) {
              this.sessions.set(s.id, {
                id: s.id,
                title: s.title || 'New Chat',
                createdAt: s.createdAt || new Date().toISOString(),
                updatedAt: s.updatedAt || new Date().toISOString(),
                provider: s.provider || null,
                model: s.model || null,
                systemPrompt: s.systemPrompt || '',
                messages: Array.isArray(s.messages) ? s.messages : [],
              })
            }
          }
        }
      }
    } catch (err) {
      console.warn('[gateway] Could not load sessions:', err.message)
    }
  }

  scheduleSave() {
    if (!this.persist) return
    if (this.saveTimeout) clearTimeout(this.saveTimeout)
    this.saveTimeout = setTimeout(() => {
      this.save()
    }, 500)
    this.saveTimeout.unref?.()
  }

  save() {
    if (!this.persist) return
    try {
      const dir = path.dirname(this.storagePath)
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true })
      }
      const data = Array.from(this.sessions.values())
      fs.writeFileSync(this.storagePath, JSON.stringify(data, null, 2), 'utf8')
    } catch (err) {
      console.warn('[gateway] Could not save sessions:', err.message)
    }
  }

  /**
   * Creates a new chat session.
   * @param {Object} [params={}]
   * @returns {Object}
   */
  createSession(params = {}) {
    const id = params.id || randomUUID()
    const session = {
      id,
      title: params.title || 'New Chat',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      provider: params.provider || null,
      model: params.model || null,
      systemPrompt: params.systemPrompt || '',
      messages: Array.isArray(params.messages) ? params.messages : [],
    }
    this.sessions.set(id, session)
    this.scheduleSave()
    return session
  }

  /**
   * Gets a session by ID.
   * @param {string} id
   * @returns {Object|null}
   */
  getSession(id) {
    return this.sessions.get(id) || null
  }

  /**
   * Lists all sessions sorted by updatedAt descending.
   * @returns {Array<Object>}
   */
  listSessions() {
    return Array.from(this.sessions.values())
      .sort((a, b) => new Date(b.updatedAt) - new Date(a.updatedAt))
      .map((s) => ({
        id: s.id,
        title: s.title,
        createdAt: s.createdAt,
        updatedAt: s.updatedAt,
        provider: s.provider,
        model: s.model,
        systemPrompt: s.systemPrompt,
        messageCount: s.messages.length,
        lastMessageSnippet: s.messages.length > 0
          ? (s.messages[s.messages.length - 1].content || '').slice(0, 80)
          : null,
      }))
  }

  /**
   * Updates session metadata.
   * @param {string} id
   * @param {Object} updates
   * @returns {Object|null}
   */
  updateSession(id, updates = {}) {
    const session = this.sessions.get(id)
    if (!session) return null

    if (typeof updates.title === 'string') session.title = updates.title
    if (updates.provider !== undefined) session.provider = updates.provider
    if (updates.model !== undefined) session.model = updates.model
    if (typeof updates.systemPrompt === 'string') session.systemPrompt = updates.systemPrompt
    session.updatedAt = new Date().toISOString()

    this.scheduleSave()
    return session
  }

  /**
   * Deletes a session.
   * @param {string} id
   * @returns {boolean}
   */
  deleteSession(id) {
    const result = this.sessions.delete(id)
    if (result) this.scheduleSave()
    return result
  }

  /**
   * Clears messages in a session.
   * @param {string} id
   * @returns {Object|null}
   */
  clearSession(id) {
    const session = this.sessions.get(id)
    if (!session) return null
    session.messages = []
    session.updatedAt = new Date().toISOString()
    this.scheduleSave()
    return session
  }

  /**
   * Adds a message to a session.
   * @param {string} sessionId
   * @param {Object} message
   * @returns {Object|null}
   */
  addMessage(sessionId, message = {}) {
    const session = this.sessions.get(sessionId)
    if (!session) return null

    const msg = {
      id: message.id || randomUUID(),
      role: message.role || 'user',
      content: stripAnsi(message.content || ''),
      raw: message.raw || undefined,
      thinking: message.thinking || undefined,
      provider: message.provider || undefined,
      model: message.model || undefined,
      stats: message.stats || undefined,
      files: Array.isArray(message.files) ? message.files : undefined,
      createdAt: message.createdAt || new Date().toISOString(),
    }

    if (msg.role === 'assistant' && !msg.thinking) {
      const parsed = parseThinking(msg.content)
      if (parsed.thinking) {
        msg.thinking = parsed.thinking
        msg.content = parsed.answer
      }
    }

    session.messages.push(msg)
    session.updatedAt = new Date().toISOString()

    // Auto-update title on first user message if title is default
    if (session.title === 'New Chat' && msg.role === 'user' && msg.content) {
      session.title = generateTitle(msg.content)
    }

    this.scheduleSave()
    return msg
  }
}

module.exports = {
  stripAnsi,
  parseThinking,
  formatChatPrompt,
  generateTitle,
  SessionStore,
  DEFAULT_STORE_PATH,
}
