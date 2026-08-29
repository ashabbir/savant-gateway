const test = require('node:test')
const assert = require('node:assert/strict')
const path = require('path')
const os = require('os')
const fs = require('fs')
const {
  stripAnsi,
  parseThinking,
  formatChatPrompt,
  generateTitle,
  SessionStore,
} = require('../sessions')

test('stripAnsi', async (t) => {
  await t.test('strips ANSI color and cursor codes', () => {
    const raw = '\u001b[?25l\u001b[?25hHello \u001b[32mWorld\u001b[0m\u001b[2D'
    assert.equal(stripAnsi(raw), 'Hello World')
  })

  await t.test('handles empty or non-string input', () => {
    assert.equal(stripAnsi(''), '')
    assert.equal(stripAnsi(null), '')
  })
})

test('parseThinking', async (t) => {
  await t.test('parses CLI thinking block', () => {
    const raw = 'Thinking...\nConsidering option A vs B\n...done thinking.\n\nHere is the answer.'
    const result = parseThinking(raw)
    assert.equal(result.thinking, 'Considering option A vs B')
    assert.equal(result.answer, 'Here is the answer.')
  })

  await t.test('parses XML think tags', () => {
    const raw = '<think>I should calculate 2+2</think> The result is 4.'
    const result = parseThinking(raw)
    assert.equal(result.thinking, 'I should calculate 2+2')
    assert.equal(result.answer, 'The result is 4.')
  })

  await t.test('returns text as answer when no thinking block', () => {
    const raw = 'Simple plain answer'
    const result = parseThinking(raw)
    assert.equal(result.thinking, '')
    assert.equal(result.answer, 'Simple plain answer')
  })
})

test('formatChatPrompt', async (t) => {
  await t.test('returns single prompt content when 1 message and no system prompt', () => {
    const messages = [{ role: 'user', content: 'What is 2+2?' }]
    assert.equal(formatChatPrompt(messages), 'What is 2+2?')
  })

  await t.test('formats multi-turn conversation with system instructions', () => {
    const messages = [
      { role: 'user', content: 'Hello' },
      { role: 'assistant', content: 'Hi there!' },
      { role: 'user', content: 'What was my first message?' },
    ]
    const formatted = formatChatPrompt(messages, 'You are a concise bot.')
    assert.match(formatted, /\[System Instructions\]\nYou are a concise bot\./)
    assert.match(formatted, /\[Conversation History\]\nUser: Hello\nAssistant: Hi there!/)
    assert.match(formatted, /\[Latest User Message\]\nWhat was my first message\?/)
  })

  await t.test('strips thinking artifacts from assistant history in prompt', () => {
    const messages = [
      { role: 'user', content: 'Hello' },
      { role: 'assistant', content: '<think>Pondering</think>Hi there!' },
      { role: 'user', content: 'Next step' },
    ]
    const formatted = formatChatPrompt(messages)
    assert.match(formatted, /Assistant: Hi there!/)
    assert.doesNotMatch(formatted, /Pondering/)
  })
})

test('generateTitle', async (t) => {
  await t.test('generates short title from text', () => {
    assert.equal(generateTitle('Write a rust http server'), 'Write a rust http server')
  })

  await t.test('truncates long prompt', () => {
    const long = 'This is a very long prompt that exceeds forty characters easily and should be truncated'
    const title = generateTitle(long)
    assert.equal(title.length <= 40, true)
    assert.match(title, /\.\.\.$/)
  })
})

test('SessionStore', async (t) => {
  const tmpFile = path.join(os.tmpdir(), `test-sessions-${Date.now()}.json`)
  const store = new SessionStore({ storagePath: tmpFile, persist: true })

  try {
    const session = store.createSession({
      title: 'New Chat',
      provider: 'ollama',
      model: 'deepseek-r1:8b',
    })

    assert.equal(session.title, 'New Chat')
    assert.equal(session.provider, 'ollama')
    assert.equal(store.getSession(session.id).id, session.id)

    // Add user message -> should update title
    const userMsg = store.addMessage(session.id, {
      role: 'user',
      content: 'Explain quantum computing in simple terms',
    })
    assert.equal(userMsg.role, 'user')
    assert.equal(session.title.startsWith('Explain quantum computing'), true)

    // Add assistant message with thinking
    const assistantMsg = store.addMessage(session.id, {
      role: 'assistant',
      content: '<think>Let me explain qubits</think>Quantum computing uses qubits.',
      provider: 'ollama',
      model: 'deepseek-r1:8b',
    })
    assert.equal(assistantMsg.thinking, 'Let me explain qubits')
    assert.equal(assistantMsg.content, 'Quantum computing uses qubits.')

    // List sessions
    const list = store.listSessions()
    assert.equal(list.length, 1)
    assert.equal(list[0].messageCount, 2)

    // Update session
    store.updateSession(session.id, { title: 'Quantum Computing' })
    assert.equal(store.getSession(session.id).title, 'Quantum Computing')

    // Delete session
    assert.equal(store.deleteSession(session.id), true)
    assert.equal(store.getSession(session.id), null)
  } finally {
    if (fs.existsSync(tmpFile)) {
      fs.unlinkSync(tmpFile)
    }
  }
})
