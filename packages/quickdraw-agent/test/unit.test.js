import { describe, it, expect } from 'vitest'
import { Store, pageBounds } from '@quickdrawjs/core'
import { bindFrames } from 'quickdraw-frames'
import { applySteps, BOARD_TOOLS, installMeasure, lintBoard } from '../src/index.js'

installMeasure() // Node has no canvas to measure text with

const board = () => { const s = new Store(); bindFrames(s); return s }
const human = (id, text, x, y) => ({ id, typeName: 'shape', type: 'note', x, y, rot: 0, z: 1, props: { text, color: 'yellow', size: 'm', font: 'draw', scale: 1 } })

// a unit: one unit of thought, drawn as written (applySteps with an origin)
describe('a unit', () => {
  it('puts each item at its at, from the origin', () => {
    const store = board()
    const { result: [q, a] } = applySteps(store, 'C', { unit: 'options', origin: [1000, 500], items: [
      { do: 'shape', shape: 'diamond', text: 'Which first?', at: [0, 60], w: 240, h: 160, ref: 'q' },
      { do: 'shape', shape: 'rectangle', text: 'Sample data', at: { x: 320, y: 0 }, w: 240, h: 90, ref: 'a' },
      { do: 'arrow', from: '@q', to: '@a' },
    ] })
    expect(pageBounds(store.get(q))).toMatchObject({ x: 1000, y: 560, w: 240, h: 160 })
    expect(pageBounds(store.get(a))).toMatchObject({ x: 1320, y: 500 })
  })

  it('looks for no free space: over what is there, it stays where it was written', () => {
    const store = board()
    store.put(human('shape:h', 'a person\'s note', 0, 0))
    const { result: [n] } = applySteps(store, 'C', { origin: [0, 0], items: [{ do: 'note', text: 'on top', at: [20, 20] }] })
    expect(store.get(n)).toMatchObject({ x: 20, y: 20 })
    expect(lintBoard(store, { ids: [n] }).some((i) => i.kind === 'overlap')).toBe(true) // reported, not moved
  })

  it('wants at for whatever it puts, and puts nothing when one lacks it', () => {
    const store = board()
    expect(() => applySteps(store, 'C', { origin: [0, 0], items: [
      { do: 'note', text: 'ok', at: [0, 0] },
      { do: 'shape', shape: 'rectangle', text: 'where?', ref: 'b' },
    ] })).toThrow(/item 2 \(b\) shape: give it at/)
    expect(store.shapes()).toHaveLength(0)
    expect(() => applySteps(store, 'C', { items: [{ do: 'note', text: 'x', at: [0, 0] }] })).toThrow(/needs an origin/)
    expect(() => applySteps(store, 'C', { origin: [0, 0], items: [{ do: 'note', text: 'x', at: [0] }] })).toThrow(/is a point/)
  })

  it('a frame around what it made needs no at', () => {
    const store = board()
    const { result: [, , f] } = applySteps(store, 'C', { origin: [0, 0], items: [
      { do: 'shape', shape: 'rectangle', text: 'A', at: [0, 0], ref: 'a' },
      { do: 'shape', shape: 'rectangle', text: 'B', at: [300, 0], ref: 'b' },
      { do: 'frame', title: 'Two', around: ['@a', '@b'] },
    ] })
    expect(store.get(f).isFrame).toBe(true)
    // a unit that only encloses what is there needs no origin
    const { result: [g] } = applySteps(store, 'C', { unit: 'around it', items: [{ do: 'frame', title: 'All', around: [f] }] })
    expect(store.get(g).isFrame).toBe(true)
  })

  it('reports where each item is, how big, its label\'s lines and whether it fits', () => {
    const store = board()
    const { placed, unit } = applySteps(store, 'C', { unit: 'q', origin: [100, 100], items: [
      { do: 'shape', shape: 'rectangle', text: 'Short', at: [0, 0], w: 200, h: 80, ref: 'a' },
      { do: 'shape', shape: 'rectangle', text: 'A label far too long to fit in a small box like this one', at: [300, 0], w: 120, h: 40, ref: 'b' },
      { do: 'note', text: 'a note with quite a lot of words in it, so that it wraps over several lines and grows', at: [0, 200], ref: 'n' },
      { do: 'arrow', from: '@a', to: '@b', label: 'too' },
    ] })
    expect(unit).toBe('q')
    const [a, b, n, arrow] = placed
    expect(a).toMatchObject({ ref: 'a', do: 'shape', at: [0, 0], size: [200, 80], lines: 1, fits: true })
    expect(b).toMatchObject({ ref: 'b', at: [300, 0], size: [120, 40], fits: false })
    expect(b.lines).toBeGreaterThan(1)
    // the core keeps a note 200 wide and lets it grow down: what it became, not what was written
    expect(n.size[0]).toBe(200)
    expect(n.size[1]).toBeGreaterThan(200)
    expect(arrow).toMatchObject({ do: 'arrow', from: a.id, to: b.id })
    expect(arrow.label).toMatchObject({ at: expect.any(Array), size: expect.any(Array) })
  })

  it('does not change what does not fit: the size written is kept', () => {
    const store = board()
    const { result: [id] } = applySteps(store, 'C', { origin: [0, 0], items: [{ do: 'shape', shape: 'diamond', text: 'A rather long question here?', at: [0, 0], w: 100, h: 60 }] })
    expect(store.get(id).props).toMatchObject({ w: 100, h: 60 })
  })

  it('in a frame: the origin is from its top-left, and says whether each item lies inside it', () => {
    const store = board()
    const [f] = applySteps(store, 'C', [{ do: 'frame', title: 'Decision', at: { x: 500, y: 300 }, w: 400, h: 300 }]).result
    const { placed } = applySteps(store, 'C', { in: f, origin: [40, 40], items: [
      { do: 'shape', shape: 'rectangle', text: 'in', at: [0, 0], w: 120, h: 60, ref: 'in' },
      { do: 'shape', shape: 'rectangle', text: 'out', at: [300, 0], w: 120, h: 60, ref: 'out' },
    ] })
    expect(pageBounds(store.get(placed[0].id))).toMatchObject({ x: 540, y: 340 })
    expect(placed.map((p) => p.inside)).toEqual([true, false])
    expect(store.get(placed[0].id).frameId).toBe(f) // it joins the frame it lies in
    expect(() => applySteps(store, 'C', { in: placed[0].id, origin: [0, 0], items: [{ do: 'note', text: 'x', at: [0, 0] }] })).toThrow(/not one/)
  })

  it('moves and pen points are from the origin too', () => {
    const store = board()
    const { result: [a, , pen] } = applySteps(store, 'C', { origin: [1000, 1000], items: [
      { do: 'shape', shape: 'rectangle', text: 'A', at: [0, 0], ref: 'a' },
      { do: 'move', id: '@a', x: 50, y: 60 },
      { do: 'pen', points: [[0, 0], [100, 0]] },
    ] })
    expect(store.get(a)).toMatchObject({ x: 1050, y: 1060 })
    expect(store.get(pen)).toMatchObject({ x: 1000, y: 1000 })
  })

  it('the board tool takes a unit and gives back placed', () => {
    const store = board()
    const tool = BOARD_TOOLS.find((t) => t.name === 'apply_steps')
    const r = tool.run(store, { unit: 'u', origin: [0, 0], items: [
      { do: 'shape', shape: 'rectangle', at: [10, 20], w: 180, h: 100, ref: 'a' },
      { do: 'text', text: 'A', font_size: 16, w: 180, align: 'middle', at: [10, 50] },
    ] }, { name: 'C' })
    expect(r.placed).toEqual([expect.objectContaining({ ref: 'a', at: [10, 20], size: [180, 100] }), expect.objectContaining({ at: [10, 50], font_size: 16, lines: 1 })])
    expect(r.ids).toHaveLength(2)
  })

  it('drawn by an agent, a unit has one way to write each thing: every size a number, every word a text', () => {
    const store = board()
    const tool = BOARD_TOOLS.find((t) => t.name === 'apply_steps')
    const one = (item) => () => tool.run(store, { origin: [0, 0], items: [item] }, { name: 'C' })
    expect(one({ do: 'shape', shape: 'rectangle', at: [0, 0] })).toThrow(/w and h/)
    expect(one({ do: 'shape', shape: 'rectangle', at: [0, 0], w: 100, h: 60, text: 'A' })).toThrow(/holds no words/)
    expect(one({ do: 'text', text: 'A', at: [0, 0] })).toThrow(/font_size in px/)
    expect(one({ do: 'text', text: 'A', at: [0, 0], font_size: 16, text_size: 'l' })).toThrow(/not text_size/)
    expect(one({ do: 'note', text: 'A', at: [0, 0] })).toThrow(/not in a unit/)
    expect(one({ do: 'frame', title: 'F', at: [0, 0] })).toThrow(/w and h/)
    expect(() => tool.run(store, { origin: [0, 0], items: [
      { do: 'shape', shape: 'rectangle', at: [0, 0], w: 100, h: 60, ref: 'a' },
      { do: 'shape', shape: 'rectangle', at: [200, 0], w: 100, h: 60, ref: 'b' },
      { do: 'arrow', from: '@a', to: '@b', label: 'yes' },
    ] }, { name: 'C' })).toThrow(/takes no label/)
    expect(() => tool.run(store, { origin: [0, 0], items: [
      { do: 'shape', shape: 'rectangle', at: [0, 0], w: 100, h: 60, ref: 'a' },
      { do: 'shape', shape: 'rectangle', at: [200, 0], w: 100, h: 60, ref: 'b' },
      { do: 'arrow', from: '@a', to: '@b' },
    ] }, { name: 'C' })).toThrow(/from_at and to_at/)
    expect(store.shapes()).toHaveLength(0)
  })

  it('a text in px, and wrapped at a width: placed gives its size, px and lines', () => {
    const store = board()
    const { placed } = applySteps(store, 'C', { origin: [0, 0], items: [
      { do: 'shape', shape: 'rectangle', at: [0, 0], w: 220, h: 80 },
      { do: 'text', text: 'Relay', font_size: 16, w: 220, align: 'middle', at: [0, 14] },
      { do: 'text', text: 'shares every update with the other pages and keeps them', font_size: 12, w: 200, align: 'middle', at: [10, 40] },
    ] })
    const [, name, detail] = placed
    expect(name).toMatchObject({ font_size: 16, size: [220, expect.any(Number)], lines: 1 })
    expect(detail).toMatchObject({ font_size: 12, size: [200, expect.any(Number)] })
    expect(detail.lines).toBeGreaterThan(1)
    expect(store.get(name.id).props).toMatchObject({ size: 's', scale: 0.8, autosize: false, w: 220, align: 'middle' })
    applySteps(store, 'C', [{ do: 'update', id: name.id, font_size: 30 }])
    expect(store.get(name.id).props.scale).toBe(1.5)
    expect(() => applySteps(store, 'C', [{ do: 'text', text: 'x', font_size: 2 }])).toThrow(/8 to 160/)
    expect(() => applySteps(store, 'C', [{ do: 'text', text: 'x', align: 'left' }])).toThrow(/unknown align/)
  })

  it('an arrow goes exactly where its ends are written, and they stay at those spots when a shape moves', () => {
    const store = board()
    const { placed } = applySteps(store, 'C', { origin: [100, 100], items: [
      { do: 'shape', shape: 'rectangle', at: [0, 0], w: 200, h: 100, ref: 'a' },
      { do: 'shape', shape: 'rectangle', at: [400, 200], w: 200, h: 100, ref: 'b' },
      { do: 'arrow', from: '@a', to: '@b', from_at: [204, 30], to_at: [396, 270] },
    ] }, { drawing: 'units' })
    const arrow = placed[2]
    expect(arrow.ends).toEqual([[204, 30], [396, 270]])
    expect(store.get(arrow.id)).toMatchObject({ x: 304, y: 130, props: { dx: 192, dy: 240 } })
    applySteps(store, 'C', [{ do: 'move', id: placed[1].id, dx: 0, dy: 100 }])
    const moved = store.get(arrow.id)
    expect([moved.x, moved.y, moved.x + moved.props.dx, moved.y + moved.props.dy]).toEqual([304, 130, 496, 470]) // the same spot on b, 100 lower
    expect(() => applySteps(store, 'C', { origin: [100, 100], items: [
      { do: 'arrow', from: placed[0].id, to: placed[1].id, from_at: [600, 600], to_at: [396, 370] },
    ] }, { drawing: 'units' })).toThrow(/from_at .* is not on or by/)
  })

  it('a ref points at what the same agent named so before, in an earlier unit', () => {
    const store = board()
    applySteps(store, 'C', { origin: [0, 0], items: [{ do: 'shape', shape: 'rectangle', at: [0, 0], w: 100, h: 60, ref: 'q' }] }, { drawing: 'units' })
    const { placed } = applySteps(store, 'C', { origin: [0, 0], items: [
      { do: 'shape', shape: 'rectangle', at: [300, 0], w: 100, h: 60, ref: 'a' },
      { do: 'arrow', from: '@q', to: '@a', from_at: [104, 30], to_at: [296, 30] },
    ] }, { drawing: 'units' })
    expect(placed[1].from).toBe(store.shapes().find((s) => s.agent?.ref === 'q').id)
    // another agent's names are not this one's
    expect(() => applySteps(store, 'D', [{ do: 'update', id: '@q', color: 'red' }])).toThrow(/unknown ref @q/)
  })

  it('placed says what each item runs into, as drawn: arrows crossing, an arrow over a shape, words on a line, overlaps', () => {
    const store = board()
    const { placed } = applySteps(store, 'C', { origin: [0, 0], items: [
      { do: 'shape', shape: 'rectangle', at: [0, 0], w: 100, h: 60, ref: 'a' },
      { do: 'shape', shape: 'rectangle', at: [400, 0], w: 100, h: 60, ref: 'b' },
      { do: 'shape', shape: 'rectangle', at: [0, 300], w: 100, h: 60, ref: 'c' },
      { do: 'shape', shape: 'rectangle', at: [400, 300], w: 100, h: 60, ref: 'd' },
      { do: 'shape', shape: 'rectangle', at: [200, 0], w: 100, h: 60, ref: 'mid' },
      { do: 'arrow', from: '@a', to: '@b', from_at: [104, 30], to_at: [396, 30], ref: 'ab' },
      { do: 'arrow', from: '@a', to: '@d', from_at: [104, 60], to_at: [396, 300], ref: 'ad' },
      { do: 'arrow', from: '@c', to: '@b', from_at: [104, 300], to_at: [396, 60], ref: 'cb' },
      { do: 'text', text: 'sends', font_size: 12, at: [130, 24], ref: 'word' },
      { do: 'text', text: 'Box C', font_size: 16, w: 100, align: 'middle', at: [0, 320], ref: 'inC' },
      { do: 'text', text: 'half out', font_size: 16, at: [70, 345], ref: 'edge' },
    ] })
    const by = Object.fromEntries(placed.map((p) => [p.ref, p.hits ?? []]))
    expect(by.ab).toEqual(expect.arrayContaining(['over rectangle @mid', 'over text "sends" @word']))
    expect(by.ad).toContain('crosses arrow @cb')
    expect(by.cb).toContain('crosses arrow @ad')
    expect(by.ad.some((h) => h.includes('@ab'))).toBe(false) // they start at the same box side: meeting, not crossing
    expect(by.word).toContain('on arrow @ab')
    expect(by.mid).toContain('under arrow @ab')
    expect(by.inC).toEqual([]) // a name in its box
    expect(by.edge).toEqual(expect.arrayContaining(['overlaps rectangle @c']))
    expect(by.a).toEqual([])
  })
})
