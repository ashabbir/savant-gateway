/**
 * Lightweight, zero-dependency, XSS-safe Markdown & Code Highlighter
 * Built for Savant Gateway Chat & Arena UI (100% offline capable)
 */

(function (global) {
  'use strict'

  function escapeHtml(str) {
    if (!str) return ''
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;')
  }

  // Syntax highlighter supporting common languages and diffs/edits
  function highlightCode(code, lang) {
    const escaped = escapeHtml(code)
    const normalizedLang = (lang || '').toLowerCase().trim()

    // Handle diffs and patch edits
    if (normalizedLang === 'diff' || normalizedLang === 'patch') {
      const lines = escaped.split('\n')
      return lines
        .map((line) => {
          if (line.startsWith('+') && !line.startsWith('+++')) {
            return `<span class="diff-line diff-add">${line}</span>`
          }
          if (line.startsWith('-') && !line.startsWith('---')) {
            return `<span class="diff-line diff-del">${line}</span>`
          }
          if (line.startsWith('@@')) {
            return `<span class="diff-line diff-hunk">${line}</span>`
          }
          return line
        })
        .join('\n')
    }

    // Generic keyword list
    const keywords = [
      'const', 'let', 'var', 'function', 'return', 'if', 'else', 'for', 'while', 'do',
      'class', 'import', 'export', 'from', 'default', 'async', 'await', 'try',
      'catch', 'finally', 'throw', 'new', 'typeof', 'instanceof', 'void', 'delete',
      'in', 'of', 'this', 'super', 'extends', 'static', 'public', 'private',
      'protected', 'def', 'elif', 'lambda', 'with', 'as', 'pass', 'raise',
      'except', 'fn', 'mut', 'pub', 'struct', 'enum', 'impl', 'trait', 'match',
      'type', 'interface', 'package', 'func', 'select', 'defer', 'go', 'chan',
      'null', 'true', 'false', 'None', 'True', 'False', 'nil', 'undefined',
      'SELECT', 'FROM', 'WHERE', 'INSERT', 'UPDATE', 'DELETE', 'JOIN', 'GROUP', 'BY', 'ORDER'
    ]

    const keywordRegex = new RegExp(`\\b(${keywords.join('|')})\\b`, 'g')

    let highlighted = escaped
      // Comments: // or # or /* */ or --
      .replace(/(\/\/[^\n]*|#[^\n]*|\/\*[\s\S]*?\*\/|--[^\n]*)/g, '<span class="tok-comment">$1</span>')
      // Strings: "..." or '...' or `...`
      .replace(/(".*?"|'.*?'|`[\s\S]*?`)/g, '<span class="tok-string">$1</span>')
      // Numbers:
      .replace(/\b(\d+(?:\.\d+)?(?:e[+-]?\d+)?|0x[0-9a-fA-F]+)\b/g, '<span class="tok-number">$1</span>')

    // Apply keywords only outside tags
    highlighted = highlighted.replace(keywordRegex, '<span class="tok-keyword">$1</span>')

    return highlighted
  }

  // Parse markdown tables into clean HTML
  function parseMarkdownTables(text) {
    const lines = text.split('\n')
    const result = []
    let inTable = false
    let tableRows = []

    function flushTable() {
      if (tableRows.length < 2) {
        result.push(...tableRows)
        tableRows = []
        inTable = false
        return
      }

      // Check if row 1 is delimiter (|---|---|)
      const delimiterMatch = tableRows[1].trim().match(/^\|?[\s:-|-]+\|?$/)
      if (!delimiterMatch) {
        result.push(...tableRows)
        tableRows = []
        inTable = false
        return
      }

      const headers = tableRows[0]
        .split('|')
        .map((c) => c.trim())
        .filter((c, i, arr) => (i > 0 && i < arr.length - 1) || c !== '')

      let tableHtml = '<div class="table-scroll-wrapper"><table class="md-table"><thead><tr>'
      headers.forEach((h) => {
        tableHtml += `<th>${h}</th>`
      })
      tableHtml += '</tr></thead><tbody>'

      for (let r = 2; r < tableRows.length; r++) {
        const cells = tableRows[r]
          .split('|')
          .map((c) => c.trim())
          .filter((c, i, arr) => (i > 0 && i < arr.length - 1) || c !== '')

        if (cells.length > 0) {
          tableHtml += '<tr>'
          cells.forEach((cell) => {
            tableHtml += `<td>${cell}</td>`
          })
          tableHtml += '</tr>'
        }
      }

      tableHtml += '</tbody></table></div>'
      result.push(tableHtml)
      tableRows = []
      inTable = false
    }

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i]
      const isTableRow = line.trim().startsWith('|') && line.trim().endsWith('|')

      if (isTableRow) {
        inTable = true
        tableRows.push(line)
      } else {
        if (inTable) {
          flushTable()
        }
        result.push(line)
      }
    }

    if (inTable) {
      flushTable()
    }

    return result.join('\n')
  }

  function renderMarkdown(md) {
    if (!md) return ''

    let text = String(md)

    // Store code blocks to avoid them getting mangled by regexes
    const codeBlocks = []
    text = text.replace(/```([a-zA-Z0-9_-]*)\n([\s\S]*?)```/g, (match, lang, code) => {
      const id = `__CODE_BLOCK_${codeBlocks.length}__`
      const highlighted = highlightCode(code, lang)
      const langLabel = lang ? lang.toUpperCase() : 'CODE'
      const html = `
        <div class="code-container">
          <div class="code-header">
            <span class="code-lang">${escapeHtml(langLabel)}</span>
            <button class="copy-code-btn" type="button" data-code="${escapeHtml(code)}">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path></svg>
              <span>Copy</span>
            </button>
          </div>
          <pre class="code-body"><code>${highlighted}</code></pre>
        </div>`
      codeBlocks.push(html)
      return id
    })

    // Inline code `...`
    const inlineCodes = []
    text = text.replace(/`([^`\n]+)`/g, (match, code) => {
      const id = `__INLINE_CODE_${inlineCodes.length}__`
      inlineCodes.push(`<code class="inline-code">${escapeHtml(code)}</code>`)
      return id
    })

    // Escape raw HTML outside code blocks
    text = escapeHtml(text)

    // Task lists (- [ ] or - [x])
    text = text.replace(/^[\*\-\+] \[ \]\s+(.*$)/gim, '<ul class="task-list"><li class="task-list-item"><input type="checkbox" disabled /> <span>$1</span></li></ul>')
    text = text.replace(/^[\*\-\+] \[[xX]\]\s+(.*$)/gim, '<ul class="task-list"><li class="task-list-item"><input type="checkbox" checked disabled /> <span>$1</span></li></ul>')
    text = text.replace(/<\/ul>\s*<ul class="task-list">/gim, '')

    // Markdown Tables
    text = parseMarkdownTables(text)

    // Headers (# Header)
    text = text.replace(/^###### (.*$)/gim, '<h6>$1</h6>')
    text = text.replace(/^##### (.*$)/gim, '<h5>$1</h5>')
    text = text.replace(/^#### (.*$)/gim, '<h4>$1</h4>')
    text = text.replace(/^### (.*$)/gim, '<h3>$1</h3>')
    text = text.replace(/^## (.*$)/gim, '<h2>$1</h2>')
    text = text.replace(/^# (.*$)/gim, '<h1>$1</h1>')

    // Blockquotes & Callouts (> Quote or > [!NOTE])
    text = text.replace(/^\>\s*\[!NOTE\]\s*(.*$)/gim, '<blockquote class="callout callout-note"><strong>Note:</strong> $1</blockquote>')
    text = text.replace(/^\>\s*\[!TIP\]\s*(.*$)/gim, '<blockquote class="callout callout-tip"><strong>Tip:</strong> $1</blockquote>')
    text = text.replace(/^\>\s*\[!IMPORTANT\]\s*(.*$)/gim, '<blockquote class="callout callout-important"><strong>Important:</strong> $1</blockquote>')
    text = text.replace(/^\>\s*\[!WARNING\]\s*(.*$)/gim, '<blockquote class="callout callout-warning"><strong>Warning:</strong> $1</blockquote>')
    text = text.replace(/^\>\s*\[!CAUTION\]\s*(.*$)/gim, '<blockquote class="callout callout-caution"><strong>Caution:</strong> $1</blockquote>')
    text = text.replace(/^\> (.*$)/gim, '<blockquote>$1</blockquote>')

    // Bold (**text** or __text__)
    text = text.replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')
    text = text.replace(/__(.*?)__/g, '<strong>$1</strong>')

    // Italic (*text* or _text_)
    text = text.replace(/\*(.*?)\*/g, '<em>$1</em>')
    text = text.replace(/_([^_]+)_/g, '<em>$1</em>')

    // Strikethrough (~~text~~)
    text = text.replace(/~~(.*?)~~/g, '<del>$1</del>')

    // Links [text](url)
    text = text.replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2" target="_blank" rel="noopener noreferrer">$1</a>')

    // Horizontal rules (--- or ***)
    text = text.replace(/^(?:---|\*\*\*|___)\s*$/gim, '<hr/>')

    // Lists (unordered)
    text = text.replace(/^[\*\-\+] (.*$)/gim, '<ul><li>$1</li></ul>')
    text = text.replace(/<\/ul>\s*<ul>/gim, '')

    // Lists (ordered)
    text = text.replace(/^\d+\.\s+(.*$)/gim, '<ol><li>$1</li></ol>')
    text = text.replace(/<\/ol>\s*<ol>/gim, '')

    // Paragraphs / Linebreaks
    const paragraphs = text.split(/\n{2,}/).map((block) => {
      block = block.trim()
      if (!block) return ''
      if (
        block.startsWith('<h') ||
        block.startsWith('<ul') ||
        block.startsWith('<ol') ||
        block.startsWith('<blockquote') ||
        block.startsWith('<hr') ||
        block.startsWith('<div class="table-scroll-wrapper"') ||
        block.startsWith('__CODE_BLOCK_')
      ) {
        return block
      }
      return `<p>${block.replace(/\n/g, '<br/>')}</p>`
    })
    text = paragraphs.filter(Boolean).join('\n')

    // Restore inline codes
    for (let i = 0; i < inlineCodes.length; i++) {
      text = text.replace(`__INLINE_CODE_${i}__`, inlineCodes[i])
    }

    // Restore code blocks
    for (let i = 0; i < codeBlocks.length; i++) {
      text = text.replace(`__CODE_BLOCK_${i}__`, codeBlocks[i])
    }

    return text
  }

  global.SavantMarkdown = {
    render: renderMarkdown,
    escapeHtml: escapeHtml,
    highlight: highlightCode,
  }
})(typeof window !== 'undefined' ? window : globalThis)
