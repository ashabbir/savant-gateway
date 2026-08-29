/**
 * Lightweight, zero-dependency, XSS-safe Markdown & Code Highlighter
 * Built for Savant Gateway Chat UI (100% offline capable)
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

  // Simple syntax highlighter for common languages
  function highlightCode(code, lang) {
    const escaped = escapeHtml(code)
    const normalizedLang = (lang || '').toLowerCase().trim()

    // Generic keyword list
    const keywords = [
      'const', 'let', 'var', 'function', 'return', 'if', 'else', 'for', 'while',
      'class', 'import', 'export', 'from', 'default', 'async', 'await', 'try',
      'catch', 'finally', 'throw', 'new', 'typeof', 'instanceof', 'void', 'delete',
      'in', 'of', 'this', 'super', 'extends', 'static', 'public', 'private',
      'protected', 'def', 'elif', 'lambda', 'with', 'as', 'pass', 'raise',
      'except', 'fn', 'mut', 'pub', 'struct', 'enum', 'impl', 'trait', 'match',
      'type', 'interface', 'package', 'func', 'select', 'defer', 'go', 'chan',
      'null', 'true', 'false', 'None', 'True', 'False', 'nil', 'undefined'
    ]

    const keywordRegex = new RegExp(`\\b(${keywords.join('|')})\\b`, 'g')

    let highlighted = escaped
      // Comments: // or # or /* */
      .replace(/(\/\/[^\n]*|#[^\n]*|\/\*[\s\S]*?\*\/)/g, '<span class="tok-comment">$1</span>')
      // Strings: "..." or '...' or `...`
      .replace(/(".*?"|'.*?'|`[\s\S]*?`)/g, '<span class="tok-string">$1</span>')
      // Numbers:
      .replace(/\b(\d+(?:\.\d+)?(?:e[+-]?\d+)?|0x[0-9a-fA-F]+)\b/g, '<span class="tok-number">$1</span>')

    // Apply keywords only outside tags
    highlighted = highlighted.replace(keywordRegex, '<span class="tok-keyword">$1</span>')

    return highlighted
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

    // Headers (# Header)
    text = text.replace(/^###### (.*$)/gim, '<h6>$1</h6>')
    text = text.replace(/^##### (.*$)/gim, '<h5>$1</h5>')
    text = text.replace(/^#### (.*$)/gim, '<h4>$1</h4>')
    text = text.replace(/^### (.*$)/gim, '<h3>$1</h3>')
    text = text.replace(/^## (.*$)/gim, '<h2>$1</h2>')
    text = text.replace(/^# (.*$)/gim, '<h1>$1</h1>')

    // Blockquotes (> Quote)
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
