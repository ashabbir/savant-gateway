const test = require('node:test')
const assert = require('node:assert/strict')
const path = require('path')
const { buildPromptWithFiles, safeFilename } = require('../uploads')

test('safeFilename strips path traversal and unsafe characters', () => {
  assert.equal(safeFilename('../../secret file?.txt'), 'secret_file_.txt')
})

test('buildPromptWithFiles gives agents absolute attachment paths and metadata', () => {
  const prompt = buildPromptWithFiles('Review this', [{
    originalname: 'notes.txt',
    mimetype: 'text/plain',
    size: 12,
    path: '/tmp/run/notes.txt',
  }])
  assert.match(prompt, /Review this/)
  assert.match(prompt, /notes\.txt \(text\/plain, 12 bytes\)/)
  assert.match(prompt, /\/tmp\/run\/notes\.txt/)
  assert.equal(path.isAbsolute('/tmp/run/notes.txt'), true)
})
