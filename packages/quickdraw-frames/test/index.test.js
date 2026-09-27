import { describe, it, expect } from 'vitest'
import { Store } from '@quickdrawjs/core'
import { bindFrames, createFrame, frameShapeIds, frameTitle, isFrame, renameFrame } from '../src/index.js'

// 10×10 box at (x, y): center at (x + 5, y + 5)
const box = (id, x, y) => ({ id, typeName: 'shape', type: 'geo', x, y, rot: 0, z: 1, props: { geo: 'rectangle', w: 10, h: 10 } })

function setup() {
  const store = new Store()
  bindFrames(store)
  store.put(box('shape:in', 50, 50))
  store.put(box('shape:out', 500, 500))
  const frame = createFrame(store, { x: 0, y: 0, w: 200, h: 200, title: 'Plan' })
  return { store, frame }
}

// a pointer drag: one gesture batch, many transactions
function drag(store, ids, dx, dy) {
  store.beginBatch()
  for (const step of [0.5, 1]) {
    store.transact(() => { for (const id of ids) store.update(id, { x: orig[id].x + dx * step, y: orig[id].y + dy * step }) })
  }
  store.endBatch()
}
let orig
const snapshot = (store) => { orig = Object.fromEntries(store.all().map((r) => [r.id, r])) }

describe('frames', () => {
  it('creates a frame at the back with a title, capturing what is inside', () => {
    const { store, frame } = setup()
    const f = store.get(frame)
    expect(isFrame(f)).toBe(true)
    expect(f.z).toBeLessThan(Math.min(...store.shapes().filter((s) => s !== f).map((s) => s.z)))
    expect(store.get(frame + '-title').props.text).toBe('Plan')
    expect([...frameShapeIds(store, frame)].sort()).toEqual([frame, frame + '-title', 'shape:in'].sort())
    expect(store.get('shape:out').frameId).toBeUndefined()
  })

  it('moves members with the frame and undoes in one step', () => {
    const { store, frame } = setup()
    snapshot(store)
    drag(store, [frame], 100, 30)
    expect(store.get('shape:in')).toMatchObject({ x: 150, y: 80 })
    expect(store.get(frame + '-title')).toMatchObject({ x: 100, y: -4 })
    expect(store.get('shape:out')).toMatchObject({ x: 500, y: 500 })
    store.undo()
    expect(store.get('shape:in')).toMatchObject({ x: 50, y: 50 })
    expect(store.get(frame)).toMatchObject({ x: 0, y: 0 })
    store.redo()
    expect(store.get('shape:in')).toMatchObject({ x: 150, y: 80 })
  })

  it('folds a keyboard nudge and its follow-up into one undo step', () => {
    const { store, frame } = setup()
    const depth = store.undos.length
    store.update(frame, { x: 8 }) // nudge: a plain transaction, no batch
    expect(store.get('shape:in').x).toBe(58)
    expect(store.undos.length).toBe(depth + 1)
    store.undo()
    expect(store.get(frame).x).toBe(0)
    expect(store.get('shape:in').x).toBe(50)
  })

  it('does not double-move members dragged together with the frame', () => {
    const { store, frame } = setup()
    snapshot(store)
    drag(store, [frame, 'shape:in'], 10, 0)
    expect(store.get('shape:in').x).toBe(60)
  })

  it('joins a shape dropped inside and releases one dragged out', () => {
    const { store, frame } = setup()
    snapshot(store)
    drag(store, ['shape:out'], -400, -400) // center lands at (105, 105)
    expect(store.get('shape:out').frameId).toBe(frame)
    snapshot(store)
    drag(store, ['shape:in'], 300, 0)
    expect('frameId' in store.get('shape:in')).toBe(false)
  })

  it('joins a newly added shape by position', () => {
    const { store, frame } = setup()
    store.put(box('shape:new', 20, 20))
    expect(store.get('shape:new').frameId).toBe(frame)
  })

  it('re-checks membership when the frame is resized', () => {
    const { store, frame } = setup()
    store.update(frame, { props: { w: 40, h: 40 } })
    expect('frameId' in store.get('shape:in')).toBe(false)
    store.update(frame, { props: { w: 600, h: 600 } })
    expect(store.get('shape:out').frameId).toBe(frame)
    expect(store.get(frame + '-title').frameId).toBe(frame)
  })

  it('deleting a frame removes its title and keeps its members, in one undo step', () => {
    const { store, frame } = setup()
    store.remove([frame])
    expect(store.has(frame + '-title')).toBe(false)
    expect(store.has('shape:in')).toBe(true)
    expect('frameId' in store.get('shape:in')).toBe(false)
    store.undo()
    expect(store.has(frame + '-title')).toBe(true)
    expect(store.get('shape:in').frameId).toBe(frame)
  })

  it('ignores remote changes (the sending peer already applied the rules)', () => {
    const { store, frame } = setup()
    store.applyDiff({ added: {}, removed: {}, updated: { [frame]: [store.get(frame), { ...store.get(frame), x: 100 }] } }, 'remote')
    expect(store.get('shape:in').x).toBe(50)
  })

  it('renames a frame, recreating a deleted title', () => {
    const { store, frame } = setup()
    renameFrame(store, frame, 'Ideas')
    expect(frameTitle(store, frame)).toBe('Ideas')
    store.remove([frame + '-title'])
    expect(frameTitle(store, frame)).toBe('')
    renameFrame(store, frame, 'Back')
    expect(store.get(frame + '-title')).toMatchObject({ frameId: frame, x: 0, props: { text: 'Back' } })
  })
})
