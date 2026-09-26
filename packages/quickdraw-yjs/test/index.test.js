import { describe, it, expect } from 'vitest'
import * as Y from 'yjs'
import { Store } from '../../../vendor/quickdraw/packages/core/src/store.js'
import { bindYjs } from '../src/index.js'

const rect = (id, x = 0) => ({ id, typeName: 'shape', type: 'geo', x, y: 0, z: 1, props: { w: 10, h: 10 } })

// two docs wired together in memory, like peers over a transport
function connect(a, b) {
  a.on('update', (u, origin) => { if (origin !== b) Y.applyUpdate(b, u, a) })
  b.on('update', (u, origin) => { if (origin !== a) Y.applyUpdate(a, u, b) })
}

function pair() {
  const [s1, s2, d1, d2] = [new Store(), new Store(), new Y.Doc(), new Y.Doc()]
  connect(d1, d2)
  bindYjs(s1, d1)
  bindYjs(s2, d2)
  return { s1, s2, d1, d2 }
}

describe('bindYjs', () => {
  it('syncs add, update and remove both ways', () => {
    const { s1, s2 } = pair()
    s1.put(rect('shape:a'))
    expect(s2.get('shape:a')).toEqual(rect('shape:a'))

    s2.update('shape:a', { x: 50 })
    expect(s1.get('shape:a').x).toBe(50)

    s1.remove(['shape:a'])
    expect(s2.has('shape:a')).toBe(false)
  })

  it('keeps remote changes out of local history and does not echo', () => {
    const { s1, s2, d1 } = pair()
    let updates = 0
    d1.on('update', () => updates++)
    s1.put(rect('shape:a'))
    expect(updates).toBe(1)
    expect(s2.canUndo).toBe(false)
    expect(s1.canUndo).toBe(true)
  })

  it('syncs undo and redo', () => {
    const { s1, s2 } = pair()
    s1.put(rect('shape:a'))
    s1.undo()
    expect(s2.has('shape:a')).toBe(false)
    s1.redo()
    expect(s2.has('shape:a')).toBe(true)
  })

  it('converges on concurrent edits to the same record', () => {
    const [s1, s2, d1, d2] = [new Store(), new Store(), new Y.Doc(), new Y.Doc()]
    bindYjs(s1, d1)
    bindYjs(s2, d2)
    s1.put(rect('shape:a', 1))
    s2.put(rect('shape:a', 2))
    s2.put(rect('shape:b'))
    connect(d1, d2)
    Y.applyUpdate(d2, Y.encodeStateAsUpdate(d1), d1)
    Y.applyUpdate(d1, Y.encodeStateAsUpdate(d2), d2)
    expect(s1.getSnapshot()).toEqual(s2.getSnapshot())
    expect(s1.has('shape:b')).toBe(true)
  })

  it('seeds an empty doc from the store, otherwise loads from the doc', () => {
    const d = new Y.Doc()
    const s1 = new Store()
    s1.put(rect('shape:a'))
    bindYjs(s1, d)
    expect(d.getMap('quickdraw').get('shape:a')).toEqual(rect('shape:a'))

    const s2 = new Store()
    s2.put(rect('shape:local'))
    bindYjs(s2, d)
    expect(s2.ids()).toEqual(['shape:a'])
  })

  it('stops syncing after unbind', () => {
    const [s1, s2, d1, d2] = [new Store(), new Store(), new Y.Doc(), new Y.Doc()]
    connect(d1, d2)
    const unbind = bindYjs(s1, d1)
    bindYjs(s2, d2)
    unbind()
    s1.put(rect('shape:a'))
    s2.put(rect('shape:b'))
    expect(s2.has('shape:a')).toBe(false)
    expect(s1.has('shape:b')).toBe(false)
  })
})
