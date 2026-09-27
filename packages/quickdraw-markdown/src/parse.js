// A small Markdown subset, parsed into flat blocks for canvas layout:
//   # headings (1–6), paragraphs, - / * / + and 1. lists (nested by indent),
//   > quotes, ``` fenced code, --- rules
//   inline: **bold** __bold__ *italic* _italic_ `code` [text](url)
// Every newline inside a paragraph is a line break (as in chat and notes),
// so Japanese text never gains stray spaces. No HTML, tables or images.

// block: { type: 'heading', level, runs } | { type: 'paragraph' | 'quote', lines: [runs] }
//      | { type: 'item', ordered, n, depth, runs } | { type: 'code', text } | { type: 'hr' }
export function parseMarkdown(src) {
  const blocks = []
  const lines = String(src).replace(/\r\n?/g, '\n').split('\n')
  let para = null // open paragraph or quote block
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    let m
    if ((m = line.match(/^\s*```/))) {
      para = null
      const body = []
      while (++i < lines.length && !/^\s*```/.test(lines[i])) body.push(lines[i])
      blocks.push({ type: 'code', text: body.join('\n') })
    } else if (!line.trim()) {
      para = null
    } else if ((m = line.match(/^(#{1,6})\s+(.*)$/))) {
      para = null
      blocks.push({ type: 'heading', level: m[1].length, runs: parseInline(m[2].replace(/\s+#+\s*$/, '')) })
    } else if (/^\s*([-*_])(\s*\1){2,}\s*$/.test(line)) {
      para = null
      blocks.push({ type: 'hr' })
    } else if ((m = line.match(/^(\s*)([-*+]|(\d+)[.)])\s+(.*)$/))) {
      para = null
      blocks.push({ type: 'item', ordered: m[3] != null, n: m[3] != null ? Number(m[3]) : 0, depth: Math.floor(m[1].replace(/\t/g, '  ').length / 2), runs: parseInline(m[4]) })
    } else if ((m = line.match(/^\s*>\s?(.*)$/))) {
      if (para?.type !== 'quote') blocks.push(para = { type: 'quote', lines: [] })
      para.lines.push(parseInline(m[1]))
    } else {
      if (para?.type !== 'paragraph') blocks.push(para = { type: 'paragraph', lines: [] })
      para.lines.push(parseInline(line.trim()))
    }
  }
  return blocks
}

// run: { text, bold?, italic?, code?, link? } — one level, no nesting
const INLINE = /`([^`]+)`|\*\*(.+?)\*\*|__(.+?)__|\*(.+?)\*|(?<![\w])_(.+?)_(?![\w])|\[([^\]]+)\]\(([^)\s]+)\)/g
export function parseInline(text) {
  const runs = []
  let last = 0
  for (const m of text.matchAll(INLINE)) {
    if (m.index > last) runs.push({ text: text.slice(last, m.index) })
    if (m[1] != null) runs.push({ text: m[1], code: true })
    else if (m[2] != null || m[3] != null) runs.push({ text: m[2] ?? m[3], bold: true })
    else if (m[4] != null || m[5] != null) runs.push({ text: m[4] ?? m[5], italic: true })
    else runs.push({ text: m[6], link: m[7] })
    last = m.index + m[0].length
  }
  if (last < text.length) runs.push({ text: text.slice(last) })
  return runs
}
