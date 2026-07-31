const fs = require('fs')
const fsPromises = require('fs').promises
const os = require('os')
const path = require('path')
const multer = require('multer')

const DEFAULT_MAX_FILE_BYTES = 25 * 1024 * 1024
const DEFAULT_MAX_FILES = 10

const MAX_FILE_BYTES = Number(process.env.GATEWAY_MAX_FILE_BYTES) || DEFAULT_MAX_FILE_BYTES
const MAX_FILES = Number(process.env.GATEWAY_MAX_FILES) || DEFAULT_MAX_FILES

const uploadRoot = path.join(os.tmpdir(), 'savant-gateway-uploads')
fs.mkdirSync(uploadRoot, { recursive: true, mode: 0o700 })

/**
 * Sanitizes a filename to prevent path traversal and unsafe file system characters.
 * @param {string} value
 * @returns {string}
 */
function safeFilename(value) {
  const base = path.basename(String(value || 'file'))
  const sanitized = base.replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 180)
  return sanitized || 'file'
}

const upload = multer({
  storage: multer.diskStorage({
    destination: uploadRoot,
    filename: (_req, file, cb) => {
      const uniquePrefix = `${Date.now()}-${Math.random().toString(16).slice(2)}`
      cb(null, `${uniquePrefix}-${safeFilename(file.originalname)}`)
    },
  }),
  limits: { files: MAX_FILES, fileSize: MAX_FILE_BYTES, fields: 20 },
})

/**
 * Appends attachment manifest to prompt string if files are attached.
 * @param {string} prompt
 * @param {Array<{originalname: string, mimetype?: string, size: number, path: string}>} [files=[]]
 * @returns {string}
 */
function buildPromptWithFiles(prompt, files = []) {
  if (!Array.isArray(files) || files.length === 0) {
    return prompt
  }

  const manifest = files.map((file) => {
    const filename = safeFilename(file.originalname)
    const mime = file.mimetype || 'application/octet-stream'
    const absPath = path.resolve(file.path)
    return `- ${filename} (${mime}, ${file.size} bytes): ${absPath}`
  }).join('\n')

  return `${prompt}\n\n## Attached files\nThe user uploaded the files below. Read them from their absolute paths when relevant.\n${manifest}`
}

/**
 * Asynchronously cleans up temporary uploaded files.
 * @param {Array<{path: string}>} [files=[]]
 */
function cleanupFiles(files = []) {
  if (!Array.isArray(files)) return
  for (const file of files) {
    if (file && file.path) {
      fsPromises.rm(file.path, { force: true }).catch(() => {})
    }
  }
}

module.exports = {
  upload,
  buildPromptWithFiles,
  cleanupFiles,
  safeFilename,
  MAX_FILE_BYTES,
  MAX_FILES,
}

