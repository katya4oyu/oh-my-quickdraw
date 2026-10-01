import { describe, it, expect } from 'vitest'
import { Store } from '@quickdrawjs/core'
import { bindFrames, createFrame } from 'quickdraw-frames'
import { bindLayouts, createLayout, addCell, setSpan, setColumns, isCell, isLayout } from '../src/index.js'

// the core measures frame titles with a canvas: a stand-in, 0.6em a character
globalThis.OffscreenCanvas ??= class {
  getContext() {
    return { font: '16px sans-serif', measureText(t) { return { width: [...t].length * parseFloat(this.font.match(/(\d+)px/)[1]) * 0.6 } } }
  }
}

// an area 1200 wide at 0,0 with 4 columns and a 24 gap: a unit is 274, a
// column starts every 298 from x 16, a row every 322 (274 + room for titles) from y 48
const col = (i) => 16 + i * 298
const row = (i) => 48 + i * 322
const box = (id, x, y, frameId) => ({ id, typeName: 'shape', type: 'geo', x, y, rot: 0, z: 1, ...(frameId ? { frameId } : {}), props: { geo: 'rectangle', w: 10, h: 10 } })

function setup() {
  const store = new Store()
  bindFrames(store)
  bindLayouts(store)
  const area = createLayout(store, { x: 0, y: 0, w: 1200, cols: 4, gap: 24 })
  return { store, area }
}

// a pointer gesture: one history batch, many transactions
function gesture(store, id, patch) {
  store.beginBatch()
  store.update(id, patch)
  store.endBatch()
}

const pos = (store, id) => { const s = store.get(id); return [s.x, s.y] }

describe('bento layouts', () => {
  it('packs new cells in order, a big one first, and fits the area around them', () => {
    const { store, area } = setup()
    const big = addCell(store, area, { c: 2, r: 2 })
    const a = addCell(store, area)
    const b = addCell(store, area)
    const c = addCell(store, area)
    expect(pos(store, big)).toEqual([col(0), row(0)])
    expect(store.get(big).props).toMatchObject({ w: 572, h: 596 })
    expect(pos(store, a)).toEqual([col(2), row(0)])
    expect(pos(store, b)).toEqual([col(3), row(0)])
    expect(pos(store, c)).toEqual([col(2), row(1)])
    expect(store.get(area).props.h).toBe(48 + 2 * 322 - 48 + 16)
    expect(isLayout(store.get(area))).toBe(true)
    expect(isCell(store.get(a))).toBe(true)
  })

  it('a wider cell pushes the others along, with what is in them and their titles', () => {
    const { store, area } = setup()
    const a = addCell(store, area)
    const b = addCell(store, area)
    store.put(box('shape:in-b', col(1) + 20, row(0) + 20))
    expect(store.get('shape:in-b').frameId).toBe(b)
    setSpan(store, a, { c: 3 })
    expect(pos(store, b)).toEqual([col(3), row(0)])
    expect(pos(store, 'shape:in-b')).toEqual([col(3) + 20, row(0) + 20])
    expect(pos(store, b + '-title')).toEqual([col(3), row(0) - 34])
    setSpan(store, a, { c: 4 })
    expect(pos(store, b)).toEqual([col(0), row(1)])
  })

  it('a resized cell snaps to whole units on release, in one undo step', () => {
    const { store, area } = setup()
    const a = addCell(store, area)
    const b = addCell(store, area)
    gesture(store, a, { props: { w: 520, h: 300 } }) // about 2 × 1
    expect(store.get(a).span).toMatchObject({ c: 2, r: 1 })
    expect(store.get(a).props).toMatchObject({ w: 572, h: 274 })
    expect(pos(store, b)).toEqual([col(2), row(0)])
    store.undo()
    expect(store.get(a).span).toMatchObject({ c: 1, r: 1 })
    expect(store.get(a).props.w).toBe(274)
    expect(pos(store, b)).toEqual([col(1), row(0)])
  })

  it('does not pack mid-gesture', () => {
    const { store, area } = setup()
    const a = addCell(store, area)
    store.beginBatch()
    store.update(a, { x: 700, y: 60 })
    expect(pos(store, a)).toEqual([700, 60])
    store.endBatch()
    expect(pos(store, a)).not.toEqual([700, 60])
  })

  it('never shrinks a cell below what it holds', () => {
    const { store, area } = setup()
    const a = addCell(store, area, { c: 2, r: 1 })
    store.put(box('shape:far', col(0) + 400, row(0) + 100)) // reaches past the first column
    expect(store.get('shape:far').frameId).toBe(a)
    gesture(store, a, { props: { w: 200 } })
    expect(store.get(a).span.c).toBe(2)
    expect(store.get('shape:far').frameId).toBe(a)
  })

  it('a cell dragged onto another slot moves there in the order', () => {
    const { store, area } = setup()
    const a = addCell(store, area)
    const b = addCell(store, area)
    const c = addCell(store, area)
    store.put(box('shape:in-c', col(2) + 20, row(0) + 20))
    // drag c onto a's slot; frames bring its member along
    store.beginBatch()
    store.update(c, { x: col(0) + 10, y: row(0) + 10 })
    store.endBatch()
    expect(pos(store, c)).toEqual([col(0), row(0)])
    expect(pos(store, a)).toEqual([col(1), row(0)])
    expect(pos(store, b)).toEqual([col(2), row(0)])
    expect(pos(store, 'shape:in-c')).toEqual([col(0) + 20, row(0) + 20])
  })

  it('undoes and redoes a reorder as it was', () => {
    const { store, area } = setup()
    const big = addCell(store, area, { c: 2, r: 2 })
    const a = addCell(store, area)
    const b = addCell(store, area)
    const c = addCell(store, area)
    const before = [big, a, b, c].map((id) => pos(store, id))
    store.beginBatch()
    store.update(a, { x: col(0) + 10, y: row(0) + 10 })
    store.endBatch()
    const after = [big, a, b, c].map((id) => pos(store, id))
    expect(after).not.toEqual(before)
    store.undo()
    expect([big, a, b, c].map((id) => pos(store, id))).toEqual(before)
    store.redo()
    expect([big, a, b, c].map((id) => pos(store, id))).toEqual(after)
  })

  it('a cell dragged out is a plain frame again, and the rest close up', () => {
    const { store, area } = setup()
    const a = addCell(store, area)
    const b = addCell(store, area)
    gesture(store, a, { x: 3000, y: 3000 })
    expect(isCell(store.get(a))).toBe(false)
    expect(pos(store, a)).toEqual([3000, 3000])
    expect(pos(store, b)).toEqual([col(0), row(0)])
  })

  it('a frame dropped into an area becomes a cell at its size in units', () => {
    const { store, area } = setup()
    addCell(store, area)
    const f = createFrame(store, { x: 3000, y: 0, w: 560, h: 260 })
    gesture(store, f, { x: col(2), y: row(0) })
    expect(store.get(f)).toMatchObject({ layoutId: area, span: { c: 2, r: 1 } })
    expect(pos(store, f)).toEqual([col(1), row(0)])
  })

  it('a deleted cell leaves no gap', () => {
    const { store, area } = setup()
    const a = addCell(store, area)
    const b = addCell(store, area)
    store.remove([a])
    expect(pos(store, b)).toEqual([col(0), row(0)])
  })

  it('moving the area moves its cells and what is in them', () => {
    const { store, area } = setup()
    const a = addCell(store, area)
    store.put(box('shape:in-a', col(0) + 20, row(0) + 20))
    gesture(store, area, { x: 100, y: 50 })
    expect(pos(store, a)).toEqual([col(0) + 100, row(0) + 50])
    expect(pos(store, 'shape:in-a')).toEqual([col(0) + 120, row(0) + 70])
  })

  it('fewer columns pack the cells again; the area height follows', () => {
    const { store, area } = setup()
    const cells = [addCell(store, area), addCell(store, area), addCell(store, area)]
    setColumns(store, area, 2)
    // a unit is now (1200 - 32 - 24) / 2 = 572
    expect(pos(store, cells[2])).toEqual([16, 48 + 572 + 48])
    expect(store.get(area).props.h).toBe(48 + 2 * (572 + 48) - 48 + 16)
  })

  it('an auto cell grows rows with what is in it, and shrinks back', () => {
    const { store, area } = setup()
    const a = addCell(store, area, { auto: true })
    const b = addCell(store, area, { c: 4 })
    expect(pos(store, b)).toEqual([col(0), row(1)])
    store.put(box('shape:low', col(0) + 20, row(0) + 260)) // reaches below one row
    expect(store.get(a).span.r).toBe(2)
    expect(pos(store, b)).toEqual([col(0), row(2)])
    store.remove(['shape:low'])
    expect(store.get(a).span.r).toBe(1)
    expect(pos(store, b)).toEqual([col(0), row(1)])
  })

  it('deleting the area leaves its cells as plain frames', () => {
    const { store, area } = setup()
    const a = addCell(store, area)
    store.remove([area])
    expect(isCell(store.get(a))).toBe(false)
    expect(store.get(a).isFrame).toBe(true)
  })

  it('ignores remote changes (the sending peer already applied the rules)', () => {
    const { store, area } = setup()
    const a = addCell(store, area)
    store.update(a, { props: { w: 900 } }, 'remote')
    expect(store.get(a).span.c).toBe(1)
  })
})
