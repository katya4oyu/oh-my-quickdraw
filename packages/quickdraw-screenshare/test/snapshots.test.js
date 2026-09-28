import { describe, it, expect } from 'vitest'
import { Store, pageBounds } from '@quickdrawjs/core'
import { createFrame, frameShapeIds } from 'quickdraw-frames'
import { installMeasure } from 'quickdraw-agent'
import { placeSnapshot, snapshotFeedback, pendingFeedback, markSent, snapshots } from '../src/snapshots.js'

installMeasure() // Node has no canvas to measure the frame's title with

const PNG = 'data:image/png;base64,iVBORw0KGgo='
const board = () => {
  const store = new Store()
  return { store, viewportPageBounds: () => ({ x: 0, y: 0, w: 1600, h: 1000 }) }
}
// a note put where a person would: in the frame, belonging to it (bindFrames does that on a page)
const note = (store, frameId, x, y, text) => {
  const id = 'shape:n' + Math.random().toString(36).slice(2)
  store.put({ id, typeName: 'shape', type: 'note', x, y, rot: 0, z: store.maxZ() + 1, frameId, props: { text, color: 'yellow', size: 'm', font: 'draw', scale: 1 } })
  return id
}

describe('snapshots', () => {
  it('puts a still in a frame of its own: mid-view first, then right of the last', () => {
    const editor = board()
    const a = placeSnapshot(editor, { src: PNG, w: 1920, h: 1080 }, { at: 1, by: 'Ann', title: '10:32 · Ann' })
    const frame = editor.store.get(a.frameId)
    expect(frame.snapshot).toEqual({ at: 1, by: 'Ann', imageId: a.imageId })
    const image = editor.store.get(a.imageId)
    expect(image).toMatchObject({ type: 'image', frameId: a.frameId, props: { w: 720, h: 405 } }) // shown at most 720 wide
    expect(editor.store.asset(image.props.assetId)).toMatchObject({ src: PNG, w: 1920, h: 1080 })
    expect(frame.x + frame.props.w / 2).toBeCloseTo(800) // mid-view
    expect([...frameShapeIds(editor.store, a.frameId)]).toContain(a.frameId + '-title')

    const b = placeSnapshot(editor, { src: PNG, w: 400, h: 300 }, { at: 2, by: 'Bo' })
    const second = editor.store.get(b.frameId)
    expect(second.x).toBe(frame.x + frame.props.w + 80)
    expect(second.y).toBe(frame.y)
    expect(editor.store.get(b.imageId).props.w).toBe(400) // never enlarged
    expect(snapshots(editor.store).map((f) => f.id)).toEqual([a.frameId, b.frameId])
    expect(() => placeSnapshot(editor, { src: 'https://x/y.png', w: 1, h: 1 })).toThrow(TypeError)
  })

  it('never lands on what is there: the nearest free spot to mid-view, not taking in the notes under it', () => {
    const editor = board()
    const { store } = editor
    const n = note(store, undefined, 700, 400, 'Already here') // mid-view
    const { frameId } = placeSnapshot(editor, { src: PNG, w: 1920, h: 1080 }, { at: 1 })
    const f = pageBounds(store.get(frameId)), b = pageBounds(store.get(n))
    const apart = f.x > b.x + b.w || f.x + f.w < b.x || f.y - 34 > b.y + b.h || f.y + f.h < b.y // title included
    expect(apart).toBe(true)
    expect(store.get(n).frameId).toBeUndefined()
    expect(snapshotFeedback(store, frameId).shapeIds).toEqual([])
  })

  it('goes on along the row, past a frame in the way, leaving what is in it alone', () => {
    const editor = board()
    const { store } = editor
    const a = store.get(placeSnapshot(editor, { src: PNG, w: 800, h: 600 }, { at: 1 }).frameId)
    const other = createFrame(store, { x: a.x + a.props.w + 80, y: a.y, w: 400, h: 300, title: 'Ideas' })
    const n = note(store, other, a.x + a.props.w + 180, a.y + 50, 'Mine')
    const b = store.get(placeSnapshot(editor, { src: PNG, w: 800, h: 600 }, { at: 2 }).frameId)
    expect(b.y).toBe(a.y)
    expect(b.x).toBeGreaterThanOrEqual(store.get(other).x + 400 + 80)
    expect(store.get(n).frameId).toBe(other)
    expect([...frameShapeIds(store, other)].sort()).toEqual([other, other + '-title', n].sort())
  })

  it('counts what people put on a snapshot, until it is sent; then only what changes after', () => {
    const editor = board()
    const { store } = editor
    const { frameId } = placeSnapshot(editor, { src: PNG, w: 800, h: 600 }, { at: 5, by: 'Ann' })
    expect(snapshotFeedback(store, frameId)).toMatchObject({ shapeIds: [], pending: false }) // just the still
    expect(pendingFeedback(store)).toEqual([])

    const n1 = note(store, frameId, 100, 100, 'Button is cut off')
    expect(snapshotFeedback(store, frameId)).toMatchObject({ shapeIds: [n1], pending: true, by: 'Ann', at: 5 })
    expect(pendingFeedback(store).map((f) => f.frameId)).toEqual([frameId])

    markSent(store, [frameId])
    expect(pendingFeedback(store)).toEqual([])
    store.update(n1, { props: { text: 'Button is cut off on narrow screens' } })
    expect(snapshotFeedback(store, frameId).pending).toBe(true) // changed since
    markSent(store, [frameId])
    note(store, frameId, 300, 100, 'Too much space here')
    expect(snapshotFeedback(store, frameId).shapeIds).toHaveLength(2)
    expect(pendingFeedback(store)).toHaveLength(1)
    // a note elsewhere is not feedback on it
    note(store, undefined, 5000, 5000, 'Unrelated')
    expect(snapshotFeedback(store, frameId).shapeIds).toHaveLength(2)
    expect(snapshotFeedback(store, 'shape:nope')).toBeNull()
  })
})
