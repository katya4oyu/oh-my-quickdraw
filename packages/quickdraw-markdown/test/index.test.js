import { describe, it, expect } from 'vitest'
import { Store, pageBounds, hitShape, FONTS } from '@quickdrawjs/core'
import { scaleShape } from '../../../vendor/quickdraw/packages/core/src/shapes.js'
import { parseMarkdown, parseInline, layoutMarkdown, createMarkdown, validateMarkdown, MAX_MD_LENGTH, MAX_H, hiddenLines, linkAt } from '../src/index.js'
import { exportJSON } from '../../quickdraw-export/src/index.js'
import { importJSON } from '../../quickdraw-import/src/index.js'

// every character is half the font size wide
const measure = (font, text) => [...text].length * parseFloat(font.match(/(\d+)px/)[1]) * 0.5
const lay = (md, w = 300) => layoutMarkdown(parseMarkdown(md), w, measure, FONTS)
const texts = (l) => l.ops.filter((o) => o.op === 'text').map((o) => o.text)

describe('parseMarkdown', () => {
  it('reads the supported blocks', () => {
    const blocks = parseMarkdown('# Title\n\nline one\nline two\n\n- a\n  - b\n1. c\n\n> quote\n\n```\ncode  here\n```\n---')
    expect(blocks.map((b) => b.type)).toEqual(['heading', 'paragraph', 'item', 'item', 'item', 'quote', 'code', 'hr'])
    expect(blocks[1].lines).toHaveLength(2) // each newline is a break
    expect(blocks[3]).toMatchObject({ depth: 1, ordered: false })
    expect(blocks[4]).toMatchObject({ ordered: true, n: 1 })
    expect(blocks[6].text).toBe('code  here')
  })

  it('reads inline styles, one level deep', () => {
    expect(parseInline('a **b** *c* `d` [e](https://x.test) snake_case_name')).toEqual([
      { text: 'a ' }, { text: 'b', bold: true }, { text: ' ' }, { text: 'c', italic: true }, { text: ' ' },
      { text: 'd', code: true }, { text: ' ' }, { text: 'e', link: 'https://x.test' }, { text: ' snake_case_name' },
    ])
  })

  it('treats HTML as plain text', () => {
    expect(parseMarkdown('<script>alert(1)</script>')[0].lines[0]).toEqual([{ text: '<script>alert(1)</script>' }])
  })
})

describe('layoutMarkdown', () => {
  it('wraps words at the width', () => {
    const l = lay('aaaa bbbb cccc', 75) // 15px body: 7.5px per char, 10 chars per line
    const lines = Object.values(Object.groupBy(l.ops, (o) => o.y)).map((ops) => ops.map((o) => o.text).join(''))
    expect(lines).toEqual(['aaaa bbbb ', 'cccc'])
  })

  it('wraps Japanese between characters, without adding spaces', () => {
    const l = lay('日本語の文章です', 45) // 6 characters per line
    expect(texts(l).join('')).toBe('日本語の文章です')
    expect(new Set(l.ops.map((o) => o.y)).size).toBe(2)
  })

  it('breaks a word longer than the line', () => {
    const l = lay('x'.repeat(20), 60)
    expect(texts(l).join('')).toBe('x'.repeat(20))
    expect(Math.max(...l.ops.map((o) => o.x + measure(o.font, o.text)))).toBeLessThanOrEqual(60)
  })

  it('grows with content, and draws markers, bars and boxes', () => {
    expect(lay('a\nb').height).toBeGreaterThan(lay('a').height)
    const l = lay('- item\n\n> q\n\n```\nx\n```')
    expect(texts(l)).toContain('•')
    expect(l.ops.filter((o) => o.op === 'rect').map((o) => o.style)).toEqual(['quote', 'code'])
  })
})

describe('markdown shapes in the core', () => {
  it('have bounds from their layout, hit inside, and resize by width', () => {
    const store = new Store()
    const id = createMarkdown(store, { x: 10, y: 20, w: 300, md: '# Hi\n\ntext' })
    const s = store.get(id)
    const b = pageBounds(s)
    expect([b.x, b.y, b.w]).toEqual([10, 20, 300])
    expect(b.h).toBeGreaterThan(40)
    expect(hitShape(s, 100, 30, 0)).toBe(true)
    expect(scaleShape(s, 2, 3).props.w).toBe(600)
    expect(pageBounds({ ...s, props: { ...s.props, md: '# Hi\n\ntext\n\nmore\n\nmore' } }).h).toBeGreaterThan(b.h)
  })
})

describe('long cards, and links', () => {
  const long = Array.from({ length: 60 }, (_, i) => `Line ${i + 1}`).join('\n\n')
  it('stops at a height, and says how much more there is; a person can make it taller', () => {
    const store = new Store()
    const id = createMarkdown(store, { x: 0, y: 0, w: 300, md: long })
    const s = store.get(id)
    expect(pageBounds(s).h).toBe(MAX_H)
    expect(hiddenLines(s)).toBeGreaterThan(30)
    const taller = scaleShape(s, 1, 1.5) // from the bottom handle
    expect(taller.props.h).toBe(MAX_H * 1.5)
    expect(pageBounds(taller).h).toBe(MAX_H * 1.5)
    expect(hiddenLines(taller)).toBeLessThan(hiddenLines(s))
    expect(scaleShape(s, 2, 1).props.h).toBeUndefined() // a side handle: the width only
    const short = store.get(createMarkdown(store, { x: 0, y: 0, w: 300, md: '# Hi' }))
    expect(hiddenLines(short)).toBe(0)
    expect(pageBounds(short).h).toBeLessThan(MAX_H)
    expect(validateMarkdown({ props: { md: 'x', w: 300, h: -1 } })).toBe('bad props.h')
  })

  it('finds the link under a point, only where it shows, and only http(s)', () => {
    const store = new Store()
    const s = store.get(createMarkdown(store, { x: 0, y: 0, w: 400, md: 'See [the docs](https://example.com/docs) and [this](javascript:alert(1))' }))
    // "See " is 4 characters of 15px: the link starts about 14 + 4 × 9 = 50 from the card's left
    const hits = []
    for (let x = 0; x < 400; x += 4) { const h = linkAt(s, x, 14 + 12); if (h) hits.push([x, h]) }
    expect(hits.length).toBeGreaterThan(5)
    expect(new Set(hits.map(([, h]) => h))).toEqual(new Set(['https://example.com/docs']))
    expect(linkAt(s, 200, 200)).toBeNull()
  })
})

describe('JSON files', () => {
  const editorFor = (store) => ({
    store, tool: 'select',
    viewportPageBounds: () => ({ x: 0, y: 0, w: 800, h: 600 }),
    setTool() {}, setSelection() {},
  })
  const card = (props) => ({ id: 'shape:c', typeName: 'shape', type: 'markdown', x: 0, y: 0, rot: 0, z: 1, props: { md: '# a', w: 300, ...props } })

  it('round-trip through export and import when the type is allowed', () => {
    const src = new Store()
    createMarkdown(src, { x: 0, y: 0, md: '# Notes\n\n- one' })
    const data = JSON.parse(JSON.stringify(exportJSON(src)))
    const dst = new Store()
    const [id] = importJSON(editorFor(dst), data, { types: { markdown: validateMarkdown } })
    expect(dst.get(id)).toMatchObject({ type: 'markdown', props: { md: '# Notes\n\n- one' } })
  })

  it('are rejected without the validator, and with bad cards', () => {
    const file = (props) => ({ quickdraw: 1, shapes: [card(props)], assets: {} })
    const opts = { types: { markdown: validateMarkdown } }
    expect(() => importJSON(editorFor(new Store()), file({}))).toThrow(/unknown shape type/)
    expect(() => importJSON(editorFor(new Store()), file({ md: 42 }), opts)).toThrow(/props.md/)
    expect(() => importJSON(editorFor(new Store()), file({ md: 'x'.repeat(MAX_MD_LENGTH + 1) }), opts)).toThrow(/too long/)
    expect(() => importJSON(editorFor(new Store()), file({ w: Infinity }), opts)).toThrow(/props.w/)
    expect(() => importJSON(editorFor(new Store()), file({ color: 'url(x)' }), opts)).toThrow(/props.color/)
  })
})
