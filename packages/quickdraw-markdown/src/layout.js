// Lays parsed blocks out into a fixed width: fonts per block and run, word
// wrap (spaces, or between CJK characters), list markers, quote bars, code
// boxes. measure(font, text) -> width is injected so tests need no canvas.
// Returns { height, ops } in local px; ops are drawn by index.js.

const SIZES = { body: 15, code: 13, h: [0, 26, 21, 18, 16, 15, 15] }
const LINE = 1.45
const GAP = 8 // between blocks
const INDENT = 20 // per list level
const QUOTE = 14

// break opportunities: runs of spaces, single CJK characters, other words
const SEGMENT = /\s+|[　-ヿ㐀-鿿豈-﫿＀-￯]|[^\s　-ヿ㐀-鿿豈-﫿＀-￯]+/g

export function fontFor(run, size, fonts) {
  if (run.code) return `${size - 1}px ${fonts.mono}`
  return `${run.italic ? 'italic ' : ''}${run.bold ? 'bold ' : ''}${size}px ${fonts.sans}`
}

// op: { op: 'text', x, y (baseline), text, font, style: 'body' | 'link' | 'code' | 'muted' }
//   | { op: 'rect', x, y, w, h, style: 'code' | 'quote' | 'rule' }
export function layoutMarkdown(blocks, width, measure, fonts) {
  const ops = []
  let y = 0

  // wraps lines of runs into [x0, x0 + w); returns the new y
  function flow(lineRuns, x0, w, size, { bold = false, style = 'body' } = {}) {
    const lh = size * LINE
    for (const runs of lineRuns) {
      let x = x0
      let empty = true
      const newline = () => { y += lh; x = x0; empty = true }
      for (const run of runs) {
        const r = bold ? { ...run, bold: true } : run
        const font = fontFor(r, size, fonts)
        const s = r.code ? 'code' : r.link ? 'link' : style
        for (let seg of r.text.match(SEGMENT) || []) {
          const space = /^\s+$/.test(seg)
          if (space && empty) continue
          let sw = measure(font, seg)
          if (!space && !empty && x + sw > x0 + w) newline()
          if (space && x + sw > x0 + w) { newline(); continue }
          // a word wider than the whole line: break it by characters
          while (!space && sw > w && seg.length > 1) {
            let n = seg.length - 1
            while (n > 1 && measure(font, seg.slice(0, n)) > x0 + w - x) n--
            ops.push({ op: 'text', x, y: y + size, text: seg.slice(0, n), font, style: s })
            seg = seg.slice(n)
            sw = measure(font, seg)
            newline()
          }
          if (r.code && !space) ops.push({ op: 'rect', x: x - 2, y: y + size * 0.1, w: sw + 4, h: size * 1.25, style: 'code' })
          ops.push({ op: 'text', x, y: y + size, text: seg, font, style: s })
          x += sw
          empty = false
        }
      }
      y += lh
    }
  }

  blocks.forEach((b, i) => {
    if (i > 0) y += GAP
    switch (b.type) {
      case 'heading': {
        if (i > 0) y += GAP / 2
        flow([b.runs], 0, width, SIZES.h[b.level], { bold: true })
        break
      }
      case 'paragraph':
        flow(b.lines, 0, width, SIZES.body)
        break
      case 'quote': {
        const top = y
        flow(b.lines, QUOTE, width - QUOTE, SIZES.body, { style: 'muted' })
        ops.push({ op: 'rect', x: 2, y: top, w: 3, h: y - top, style: 'quote' })
        break
      }
      case 'item': {
        const x0 = b.depth * INDENT
        const marker = b.ordered ? `${b.n}.` : '•'
        const font = fontFor({}, SIZES.body, fonts)
        ops.push({ op: 'text', x: x0 + INDENT - 6 - measure(font, marker), y: y + SIZES.body, text: marker, font, style: 'muted' })
        flow([b.runs], x0 + INDENT, width - x0 - INDENT, SIZES.body)
        break
      }
      case 'code': {
        const size = SIZES.code, pad = 8, top = y
        const box = { op: 'rect', x: 0, y: top, w: width, h: 0, style: 'code' }
        ops.push(box)
        y += pad
        const font = `${size}px ${fonts.mono}`
        for (const line of b.text.split('\n')) {
          ops.push({ op: 'text', x: pad, y: y + size, text: line, font, style: 'body' })
          y += size * LINE
        }
        y += pad
        box.h = y - top
        break
      }
      case 'hr':
        y += GAP
        ops.push({ op: 'rect', x: 0, y, w: width, h: 1, style: 'rule' })
        y += GAP
        break
    }
  })
  return { height: y, ops }
}
