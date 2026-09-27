import { describe, it, expect } from 'vitest'
import { Store, pageBounds, hitShape, FONTS } from '@quickdrawjs/core'
import { scaleShape } from '../../../vendor/quickdraw/packages/core/src/shapes.js'
import { parseMarkdown, parseInline, layoutMarkdown, createMarkdown } from '../src/index.js'

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
