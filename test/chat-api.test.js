const test = require('node:test')
const assert = require('node:assert/strict')
const app = require('../server')
const chainLib = require('../chain')

let server
let baseUrl

test.before(async () => {
  await new Promise((resolve) => {
    server = app.listen(0, '127.0.0.1', () => {
      const port = server.address().port
      baseUrl = `http://127.0.0.1:${port}`
      resolve()
    })
  })
})

test.after(async () => {
  await new Promise((resolve) => server.close(resolve))
})

test('Chat and Session API Endpoints', async (t) => {
  let createdSessionId = ''

  await t.test('GET / serves UI HTML', async () => {
    const res = await fetch(`${baseUrl}/`)
    assert.equal(res.status, 200)
    const text = await res.text()
    assert.match(text, /Savant Arena|Savant Colosseum|Savant Gateway/)
    assert.match(text, /id="chat-textarea"/)
  })

  await t.test('POST /sessions creates a new session', async () => {
    const res = await fetch(`${baseUrl}/sessions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        title: 'Test Session',
        provider: 'ollama',
        model: 'deepseek-r1:8b',
        systemPrompt: 'You are helpful',
      }),
    })
    assert.equal(res.status, 201)
    const data = await res.json()
    assert.equal(data.title, 'Test Session')
    assert.equal(data.provider, 'ollama')
    assert.equal(data.model, 'deepseek-r1:8b')
    assert.ok(data.id)
    createdSessionId = data.id
  })

  await t.test('GET /sessions lists sessions', async () => {
    const res = await fetch(`${baseUrl}/sessions`)
    assert.equal(res.status, 200)
    const data = await res.json()
    assert.ok(Array.isArray(data.sessions))
    assert.ok(data.sessions.some((s) => s.id === createdSessionId))
  })

  await t.test('GET /sessions/:id returns session details', async () => {
    const res = await fetch(`${baseUrl}/sessions/${createdSessionId}`)
    assert.equal(res.status, 200)
    const data = await res.json()
    assert.equal(data.id, createdSessionId)
    assert.equal(data.title, 'Test Session')
  })

  await t.test('PATCH /sessions/:id updates session metadata', async () => {
    const res = await fetch(`${baseUrl}/sessions/${createdSessionId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title: 'Updated Title' }),
    })
    assert.equal(res.status, 200)
    const data = await res.json()
    assert.equal(data.title, 'Updated Title')
  })

  await t.test('POST /sessions/:id/messages triggers chat run and stores messages', async () => {
    // Mock chain execution so it doesn't try to invoke external binaries in this unit test
    test.mock.method(chainLib, 'raceChain', async () => {
      return {
        response: 'Here is the assistant answer',
        step: { provider: 'ollama', model: 'deepseek-r1:8b' },
      }
    })

    const res = await fetch(`${baseUrl}/sessions/${createdSessionId}/messages`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        prompt: 'What is 2+2?',
        provider: 'ollama',
        model: 'deepseek-r1:8b',
      }),
    })
    assert.equal(res.status, 202)
    const data = await res.json()
    assert.equal(data.sessionId, createdSessionId)
    assert.ok(data.id)
    assert.equal(data.status, 'running')

    // Wait briefly for execution and store update
    await new Promise((r) => setTimeout(r, 100))

    const sessionRes = await fetch(`${baseUrl}/sessions/${createdSessionId}`)
    const sessionData = await sessionRes.json()
    assert.equal(sessionData.messages.length, 2)
    assert.equal(sessionData.messages[0].role, 'user')
    assert.equal(sessionData.messages[0].content, 'What is 2+2?')
    assert.equal(sessionData.messages[1].role, 'assistant')
    assert.equal(sessionData.messages[1].content, 'Here is the assistant answer')
  })

  await t.test('POST /runs supports messages array input', async () => {
    const res = await fetch(`${baseUrl}/runs`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        messages: [
          { role: 'user', content: 'First message' },
          { role: 'assistant', content: 'First response' },
          { role: 'user', content: 'Second message' },
        ],
        chain: [{ provider: 'ollama', model: 'deepseek-r1:8b' }],
      }),
    })
    assert.equal(res.status, 202)
    const data = await res.json()
    assert.ok(data.id)
  })

  await t.test('DELETE /sessions/:id deletes the session', async () => {
    const res = await fetch(`${baseUrl}/sessions/${createdSessionId}`, { method: 'DELETE' })
    assert.equal(res.status, 200)

    const checkRes = await fetch(`${baseUrl}/sessions/${createdSessionId}`)
    assert.equal(checkRes.status, 404)
  })

  await t.test('POST /comparisons creates multi-model benchmark run', async () => {
    test.mock.method(chainLib, 'walkChain', async () => {
      return {
        response: 'Benchmark candidate response',
        step: { provider: 'ollama', model: 'deepseek-r1:8b' },
      }
    })

    const res = await fetch(`${baseUrl}/comparisons`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        prompt: 'Compare quicksort and mergesort',
        participants: [
          { provider: 'ollama', model: 'deepseek-r1:8b' },
          { provider: 'gemini', model: 'gemini-2.5-flash' },
        ],
      }),
    })

    assert.equal(res.status, 202)
    const data = await res.json()
    assert.ok(data.id)
    assert.equal(data.participants.length, 2)

    // Wait briefly for execution
    await new Promise((r) => setTimeout(r, 100))

    // Fetch comparison details
    const compRes = await fetch(`${baseUrl}/comparisons/${data.id}`)
    assert.equal(compRes.status, 200)
    const compData = await compRes.json()
    assert.equal(compData.participants[0].status, 'complete')
    assert.ok(compData.participants[0].benchmark)

    // Vote on winner
    const voteRes = await fetch(`${baseUrl}/comparisons/${data.id}/vote`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        winner: 'ollama:deepseek-r1:8b',
        feedback: 'Great detail',
      }),
    })
    assert.equal(voteRes.status, 200)
    const voteData = await voteRes.json()
    assert.equal(voteData.vote.winner, 'ollama:deepseek-r1:8b')

    // Check leaderboard
    const leaderRes = await fetch(`${baseUrl}/leaderboard`)
    assert.equal(leaderRes.status, 200)
    const leaderData = await leaderRes.json()
    assert.ok(Array.isArray(leaderData.leaderboard))
  })

  await t.test('Tournament API endpoints', async () => {
    // Questions suites
    const qRes = await fetch(`${baseUrl}/tournaments/questions`)
    assert.equal(qRes.status, 200)
    const qData = await qRes.json()
    assert.ok(Array.isArray(qData.suites))

    // Create tournament
    const tourneyRes = await fetch(`${baseUrl}/tournaments`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        title: 'Colosseum Test Championship',
        participants: [
          { provider: 'ollama', model: 'deepseek-r1:8b' },
          { provider: 'gemini', model: 'gemini-2.5-flash' },
        ],
        questions: qData.suites[0].questions.slice(0, 1),
      }),
    })

    assert.equal(tourneyRes.status, 202)
    const tourney = await tourneyRes.json()
    assert.ok(tourney.id)
    assert.equal(tourney.participants.length, 2)

    // Wait briefly for sequential run step
    await new Promise((r) => setTimeout(r, 150))

    const getRes = await fetch(`${baseUrl}/tournaments/${tourney.id}`)
    assert.equal(getRes.status, 200)
    const getData = await getRes.json()
    assert.equal(getData.id, tourney.id)
  })
})
