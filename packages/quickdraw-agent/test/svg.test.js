import { describe, it, expect } from 'vitest'
import { Store, pageBounds } from '@quickdrawjs/core'
import { bindFrames } from 'quickdraw-frames'
import { applySteps, BOARD_TOOLS, boardToMarkdown, describeBoard, installMeasure, undoDiff } from '../src/index.js'

installMeasure() // Node has no canvas to measure text with

const board = () => { const s = new Store(); bindFrames(s); return s }
const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 400 200"><title>Page to relay</title>
  <rect x="20" y="40" width="120" height="80" fill="none" stroke="#4263eb"/><text x="30" y="85" font-size="16">Page</text>
  <rect x="260" y="40" width="120" height="80" fill="none" stroke="#4263eb"/><text x="270" y="85" font-size="16">Relay</text>
  <line x1="140" y1="80" x2="260" y2="80" stroke="#1d1d1d" marker-end="url(#a)"/></svg>`

describe('an SVG drawn again', () => {
  it('keeps the SVG\'s order: a fill drawn again stays under what follows it', () => {
    const store = board()
    const art = (body) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 300 200"><title>Cat</title><path d="${body}" fill="#f1ac4b" data-fill="tint" stroke="#e16919"/><path d="M60 60 Q70 80 60 100" fill="none" stroke="#e16919"/></svg>`
    const { result: [[frame]] } = applySteps(store, 'C', [{ do: 'svg', svg: art('M20 120 C20 40 180 40 180 120 Z'), at: [0, 0] }])
    applySteps(store, 'C', [{ do: 'svg', svg: art('M30 120 C30 40 180 40 180 120 Z'), replace: frame }])
    const drawn = store.shapes().filter((s) => s.svg?.el && s.id !== frame).sort((a, b) => a.z - b.z).map((s) => `${s.type === 'draw' ? 'line' : 'fill'} ${s.svg.el}`)
    expect(drawn).toEqual(['fill path1', 'line path1', 'line path2']) // the stripe on top, as written
  })
})

describe('an SVG drawn on the board', () => {
  it('is a frame its size with its strokes and words where the SVG has them, each saying its element', () => {
    const store = board()
    const { result: [ids] } = applySteps(store, 'C', [{ do: 'svg', svg, at: [1000, 500] }])
    const [frame, ...parts] = ids
    expect(pageBounds(store.get(frame))).toMatchObject({ x: 1000, y: 500, w: 400, h: 200 })
    expect(parts.map((id) => [store.get(id).type, store.get(id).svg.el])).toEqual([['draw', 'rect1'], ['text', 'text1'], ['draw', 'rect2'], ['text', 'text2'], ['draw', 'line1'], ['draw', 'line1']])
    const box = store.get(parts[0]) // the stroke's points start at the box's corner
    expect([box.x, box.y]).toEqual([1020, 540])
    const kept = store.asset(store.get(frame).svg.asset)
    expect(kept.src).toBe(svg) // the SVG is kept on the board, as the source
    expect(describeBoard(store).frames[0].svg).toBe(kept.id)
  })

  it('reads as its SVG: its words, not its strokes, and what is gone since', () => {
    const store = board()
    const { result: [[frame, ...parts]] } = applySteps(store, 'C', [{ do: 'svg', svg, at: [0, 0] }])
    let md = boardToMarkdown(store)
    expect(md).toContain(`## Page to relay (drawn from an SVG; id ${frame})`)
    expect(md).toContain(`omq draw --show ${frame}`)
    expect(md).toContain('Page (id')
    expect(md).not.toContain('(drawing)')
    store.remove([parts[2]]) // someone rubs out the second box
    md = boardToMarkdown(store)
    expect(md).toContain('- gone since drawn: rect2 (a box)')
  })

  it('is one operation: undoing it takes back the frame, the strokes, the words and the kept SVG', () => {
    const store = board()
    const { diff } = applySteps(store, 'C', [{ do: 'svg', svg, at: [0, 0] }])
    undoDiff(store, diff)
    expect(store.all()).toEqual([])
  })

  it('says what is wrong with what is not an SVG', () => {
    expect(() => applySteps(board(), 'C', [{ do: 'svg', svg: '<html></html>' }])).toThrow(/not an SVG/)
    expect(() => applySteps(board(), 'C', [{ do: 'svg', svg, write: 'words' }])).toThrow(/chars or lines/)
  })

  it('is the draw_svg tool: answered with the frame and what will be drawn, not every stroke', () => {
    const store = board()
    const r = BOARD_TOOLS.find((t) => t.name === 'draw_svg').run(store, { svg, x: 10, y: 20, write: 'lines' }, { name: 'C' })
    expect(r.ids).toHaveLength(1)
    expect(r.drawing).toMatchObject({ frame: r.ids[0], at: [10, 20], size: [400, 200], units: 3, strokes: 4, words: 2 })
    expect(store.asset(store.get(r.ids[0]).svg.asset).write).toBe('lines')
  })

  it('draws a changed SVG again over its drawing: what is the same stays (where people moved it), only what changed goes and comes', () => {
    const store = board()
    const { result: [[frame, box1, word1, box2, word2]] } = applySteps(store, 'C', [{ do: 'svg', svg, at: [0, 0] }])
    store.update(box1, { x: store.get(box1).x + 30 }) // someone moves the first box
    const note = applySteps(store, 'Yuya', [{ do: 'note', text: 'mine', at: [100, 100] }]).result[0]
    const changed = svg.replace('>Relay<', '>Server<')
    const { result: [[again, ...parts]], diff } = applySteps(store, 'C', [{ do: 'svg', svg: changed, replace: frame }])
    expect(again).toBe(frame)
    expect(parts).toContain(box1)
    expect(store.get(box1).x).toBe(50) // kept where it was moved to
    expect(Object.keys(diff.removed)).toEqual([word2])
    expect(Object.values(diff.added).filter((r) => r.typeName === 'shape').map((r) => r.props.text)).toEqual(['Server'])
    expect(store.get(note)).toBeTruthy() // what people added stays
    expect(store.asset(store.get(frame).svg.asset).src).toBe(changed)
    expect(() => applySteps(store, 'C', [{ do: 'svg', svg, replace: note }])).toThrow(/not a drawing from an SVG/)
  })
})
