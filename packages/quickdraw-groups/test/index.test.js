import { describe, it, expect } from 'vitest'
import { Store } from '@quickdrawjs/core'
import { bindFrames, createFrame } from 'quickdraw-frames'
import { bindGroups, bindGroupSelection, groupShapes, ungroup, groups, groupMembers } from '../src/index.js'

const box = (id, x, y) => ({ id, typeName: 'shape', type: 'geo', x, y, rot: 0, z: 1, props: { geo: 'rectangle', w: 100, h: 60, color: 'black' } })
function board(n = 3) {
  const store = new Store()
  bindFrames(store)
  bindGroups(store)
  for (let i = 0; i < n; i++) store.put(box('shape:' + 'abcdef'[i], i * 200, 0))
  return store
}

describe('groups', () => {
  it('moving one member moves the others by as much', () => {
    const store = board()
    const g = groupShapes(store, ['shape:a', 'shape:b'], { name: 'pair' })
    store.update('shape:a', { x: 50, y: 40 })
    expect(store.get('shape:b')).toMatchObject({ x: 250, y: 40 })
    expect(store.get('shape:c')).toMatchObject({ x: 400, y: 0 }) // not in it
    expect(groups(store)).toEqual([{ id: g, name: 'pair', members: ['shape:a', 'shape:b'] }])
  })

  it('does not move what moved in the same change, nor when a member is only resized', () => {
    const store = board()
    groupShapes(store, ['shape:a', 'shape:b'])
    store.transact(() => { store.update('shape:a', { x: 10 }); store.update('shape:b', { x: 500 }) })
    expect(store.get('shape:b').x).toBe(500)
    store.update('shape:a', { x: 0, props: { ...store.get('shape:a').props, w: 300 } })
    expect(store.get('shape:b').x).toBe(500)
  })

  it('moves as one undo step', () => {
    const store = board()
    groupShapes(store, ['shape:a', 'shape:b'])
    store.update('shape:a', { x: 90 })
    store.undo()
    expect(store.get('shape:a').x).toBe(0)
    expect(store.get('shape:b').x).toBe(200)
  })

  it('ungroup lets them go; a frame, or one shape, cannot be grouped', () => {
    const store = board()
    const g = groupShapes(store, ['shape:a', 'shape:b'])
    expect(ungroup(store, 'shape:a')).toEqual(['shape:a', 'shape:b'])
    store.update('shape:a', { x: 70 })
    expect(store.get('shape:b').x).toBe(200)
    expect(groupMembers(store, g)).toEqual([])
    const f = createFrame(store, { x: 0, y: 400, w: 300, h: 200, title: 'F' })
    expect(() => groupShapes(store, ['shape:a', f])).toThrow(/frame/)
    expect(() => groupShapes(store, ['shape:a'])).toThrow(/two/)
  })

  it('a copy of members is a group of its own', () => {
    const store = board()
    const g = groupShapes(store, ['shape:a', 'shape:b'])
    store.transact(() => { store.put({ ...store.get('shape:a'), id: 'shape:a2', y: 300 }); store.put({ ...store.get('shape:b'), id: 'shape:b2', y: 300 }) })
    expect(store.get('shape:a2').groupId).not.toBe(g)
    expect(store.get('shape:a2').groupId).toBe(store.get('shape:b2').groupId)
    store.update('shape:a', { y: 10 })
    expect(store.get('shape:a2').y).toBe(300) // the copy did not follow
    expect(store.get('shape:b').y).toBe(10)
  })

  it('moves with its frame once, not twice', () => {
    const store = board(0)
    const f = createFrame(store, { x: 0, y: 0, w: 800, h: 400, title: 'F' })
    store.put(box('shape:a', 50, 100)); store.put(box('shape:b', 300, 100))
    groupShapes(store, ['shape:a', 'shape:b'])
    store.update(f, { x: 100, y: 100 })
    expect(store.get('shape:a')).toMatchObject({ x: 150, y: 200 })
    expect(store.get('shape:b')).toMatchObject({ x: 400, y: 200 })
  })
})

describe('selecting a group on a page', () => {
  function page() {
    const store = board()
    groupShapes(store, ['shape:a', 'shape:b'])
    const handlers = {}
    const editor = {
      store, selection: new Set(), container: new EventTarget(),
      on: (ev, fn) => { handlers[ev] = fn; return () => {} },
      setSelection(ids) { this.selection = new Set(ids); handlers.selection?.() },
    }
    globalThis.document ??= new EventTarget()
    bindGroupSelection(editor)
    return editor
  }
  it('a member selects the group; others stay alone', () => {
    const e = page()
    e.setSelection(['shape:a'])
    expect([...e.selection].sort()).toEqual(['shape:a', 'shape:b'])
    e.setSelection(['shape:c'])
    expect([...e.selection]).toEqual(['shape:c'])
  })
  it('the clean click that follows still selects the whole group', () => {
    const e = page()
    e.setSelection(['shape:a'])
    e.setSelection(['shape:a']) // pointer up: selection settles to the pressed shape
    expect([...e.selection].sort()).toEqual(['shape:a', 'shape:b'])
  })
})
