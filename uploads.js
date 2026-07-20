const fs = require('fs')
const os = require('os')
const path = require('path')
const multer = require('multer')

const MAX_FILE_BYTES = Number(process.env.GATEWAY_MAX_FILE_BYTES) || 25 * 1024 * 1024
const MAX_FILES = Number(process.env.GATEWAY_MAX_FILES) || 10
const uploadRoot = path.join(os.tmpdir(), 'savant-gateway-uploads')
fs.mkdirSync(uploadRoot, { recursive: true, mode: 0o700 })

function safeFilename(value) {
  const base = path.basename(String(value || 'file'))
  return base.replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 180) || 'file'
}

const upload = multer({
  storage: multer.diskStorage({
    destination: uploadRoot,
    filename: (_req, file, cb) => cb(null, `${Date.now()}-${Math.random().toString(16).slice(2)}-${safeFilename(file.originalname)}`),
  }),
  limits: { files: MAX_FILES, fileSize: MAX_FILE_BYTES, fields: 20 },
})

function buildPromptWithFiles(prompt, files = []) {
  if (files.length === 0) return prompt
  const manifest = files.map((file) =>
    `- ${safeFilename(file.originalname)} (${file.mimetype || 'application/octet-stream'}, ${file.size} bytes): ${path.resolve(file.path)}`,
  ).join('\n')
  return `${prompt}\n\n## Attached files\nThe user uploaded the files below. Read them from their absolute paths when relevant.\n${manifest}`
}

function cleanupFiles(files = []) {
  for (const file of files) fs.rm(file.path, { force: true }, () => {})
}

module.exports = { upload, buildPromptWithFiles, cleanupFiles, safeFilename, MAX_FILE_BYTES, MAX_FILES }
