import { describe, it, expect } from 'vitest'
import { Store, newId } from '@quickdrawjs/core'
import { bindFrames, createFrame, frameShapeIds, frameTitle, isFrame, renameFrame, setFrameAspect } from '../src/index.js'

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

  it('takes in an image dropped inside, added with its asset in one change (as a paste does)', () => {
    const { store, frame } = setup()
    store.transact(() => {
      store.put({ id: 'asset:img', typeName: 'asset', src: 'data:image/png;base64,xx', w: 20, h: 20 })
      store.put({ id: 'shape:img', typeName: 'shape', type: 'image', x: 60, y: 60, rot: 0, z: 2, props: { w: 20, h: 20, assetId: 'asset:img' } })
    })
    expect(store.get('shape:img').frameId).toBe(frame)
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

  it('never takes in a shape marked frameless', () => {
    const { store, frame } = setup()
    store.put({ ...box('shape:free', 60, 60), frameless: true })
    expect(store.get('shape:free').frameId).toBeUndefined()
    store.update(frame, { props: { w: 300 } }) // a resize re-checks everything
    expect(store.get('shape:free').frameId).toBeUndefined()
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

  it('resizing from the left or top keeps members in place and carries the title', () => {
    const { store, frame } = setup()
    store.update(frame, { x: -100, y: -50, props: { w: 300, h: 250 } }) // top-left handle
    expect(store.get('shape:in')).toMatchObject({ x: 50, y: 50 })
    expect(store.get(frame + '-title')).toMatchObject({ x: -100, y: -84 })
  })

  describe('aspect', () => {
    const framed = (aspect) => {
      const store = new Store()
      bindFrames(store)
      return { store, frame: createFrame(store, { x: 0, y: 0, w: 320, aspect }) }
    }

    it('creates the frame at that aspect', () => {
      const { store, frame } = framed(16 / 9)
      expect(store.get(frame).props).toMatchObject({ w: 320, h: 180 })
    })

    it('keeps it when the width is dragged, in the same undo step', () => {
      const { store, frame } = framed(16 / 9)
      store.update(frame, { props: { w: 640 } }) // right handle
      expect(store.get(frame)).toMatchObject({ x: 0, y: 0, props: { w: 640, h: 360 } })
      store.undo()
      expect(store.get(frame).props).toMatchObject({ w: 320, h: 180 })
    })

    it('keeps it when the height leads, anchoring the dragged-from edges', () => {
      const { store, frame } = framed(1)
      store.update(frame, { x: 0, y: -80, props: { w: 330, h: 400 } }) // mostly the top edge
      expect(store.get(frame)).toMatchObject({ x: 0, y: -80, props: { w: 400, h: 400 } }) // left edge untouched, so it stays
    })

    it('can be set or cleared later', () => {
      const { store, frame } = framed(null)
      setFrameAspect(store, frame, 4 / 3)
      expect(store.get(frame).props.h).toBe(240)
      setFrameAspect(store, frame, null)
      store.update(frame, { props: { w: 100 } })
      expect(store.get(frame).props).toMatchObject({ w: 100, h: 240 })
      expect('aspect' in store.get(frame)).toBe(false)
    })
  })

  describe('copies', () => {
    // what the core's duplicateSelection (and paste, and import) writes: the
    // records spread into new ids, offset, on top
    function duplicate(store, ids, offset = 16) {
      const map = {}
      let z = store.maxZ()
      store.transact(() => {
        for (const id of ids) {
          const s = store.get(id)
          map[id] = newId()
          store.put({ ...s, id: map[id], x: s.x + offset, y: s.y + offset, z: ++z })
        }
      })
      return map
    }
    const members = (store, frameId) => store.shapes().filter((s) => s.frameId === frameId && s.id !== frameId + '-title')

    it('gives a frame copied on its own a title and copies of its members, at the back, in one undo step', () => {
      const { store, frame } = setup()
      renameFrame(store, frame, 'Plan')
      const before = store.size
      const copy = duplicate(store, [frame])[frame]
      expect(store.get(copy)).toMatchObject({ frameKey: copy, x: 16, y: 16 })
      expect(store.get(copy).z).toBeLessThan(store.get(frame).z)
      expect(frameTitle(store, copy)).toBe('Plan')
      expect(members(store, copy).map((s) => [s.x, s.y])).toEqual([[66, 66]])
      expect(members(store, frame).map((s) => s.id)).toEqual(['shape:in'])
      store.undo()
      expect(store.size).toBe(before)
    })

    it('adopts member and title copies made alongside it instead of copying again', () => {
      const { store, frame } = setup()
      const before = store.size
      const map = duplicate(store, [frame, 'shape:in', frame + '-title'])
      const copy = map[frame]
      expect(store.size).toBe(before + 3)
      expect(store.get(map['shape:in']).frameId).toBe(copy)
      expect(store.has(map[frame + '-title'])).toBe(false) // replaced by the copy's own title
      expect(frameTitle(store, copy)).toBe('Plan')
      expect(members(store, frame).map((s) => s.id)).toEqual(['shape:in'])
    })

    it('relinks an imported frame whose original is not on the board', () => {
      const src = setup()
      const records = [src.frame, src.frame + '-title', 'shape:in'].map((id) => src.store.get(id))
      const store = new Store()
      bindFrames(store)
      const ids = Object.fromEntries(records.map((r) => [r.id, newId()]))
      store.transact(() => { for (const r of records) store.put({ ...r, id: ids[r.id], x: r.x + 1000 }) }) // like quickdraw-import
      const copy = ids[src.frame]
      expect(store.get(copy).frameKey).toBe(copy)
      expect(frameTitle(store, copy)).toBe('Plan')
      expect(store.get(ids['shape:in']).frameId).toBe(copy)
      expect(store.shapes()).toHaveLength(3)
    })
  })
})

describe('frames in frames', () => {
  function nested() {
    const store = new Store()
    bindFrames(store)
    const outer = createFrame(store, { x: 0, y: 0, w: 600, h: 400, title: 'Project' })
    store.put(box('shape:o', 20, 300)) // in the outer frame only
    const inner = createFrame(store, { x: 100, y: 100, w: 200, h: 150, title: 'Step 1' })
    store.put(box('shape:i', 150, 150)) // in the inner one
    return { store, outer, inner }
  }

  it('a frame wholly inside another is its member, above it; a shape belongs to the innermost frame', () => {
    const { store, outer, inner } = nested()
    expect(store.get(inner).frameId).toBe(outer)
    expect(store.get(inner).z).toBeGreaterThan(store.get(outer).z)
    expect(store.get('shape:i').frameId).toBe(inner)
    expect(store.get('shape:o').frameId).toBe(outer)
    expect(store.get(inner + '-title').frameId).toBe(inner)
    expect([...frameShapeIds(store, outer)].sort()).toEqual([outer, outer + '-title', 'shape:o', inner, inner + '-title', 'shape:i'].sort())
  })

  it('a frame made around a frame takes it in; one only partly inside stays out', () => {
    const store = new Store()
    bindFrames(store)
    const a = createFrame(store, { x: 100, y: 100, w: 100, h: 100, title: 'A' })
    const b = createFrame(store, { x: 450, y: 100, w: 200, h: 100, title: 'B' }) // will hang over the edge
    const around = createFrame(store, { x: 0, y: 0, w: 500, h: 400, title: 'Around' })
    expect(store.get(a).frameId).toBe(around)
    expect(store.get(a).z).toBeGreaterThan(store.get(around).z)
    expect(store.get(b).frameId).toBeUndefined()
  })

  it('moving the outer frame moves the inner one and what is in it, once', () => {
    const { store, outer, inner } = nested()
    snapshot(store)
    drag(store, [outer], 1000, 50)
    expect(store.get(inner)).toMatchObject({ x: 1100, y: 150 })
    expect(store.get('shape:i')).toMatchObject({ x: 1150, y: 200 })
    expect(store.get(inner + '-title')).toMatchObject({ x: orig[inner + '-title'].x + 1000 })
    expect(store.get('shape:o')).toMatchObject({ x: 1020, y: 350 })
  })

  it('dragging the inner frame out of the outer one takes it out, with what is in it', () => {
    const { store, outer, inner } = nested()
    snapshot(store)
    drag(store, [inner], 900, 0)
    expect(store.get(inner).frameId).toBeUndefined()
    expect(store.get('shape:i')).toMatchObject({ x: 1050, frameId: inner })
    // and back in: a member again, above the outer frame
    snapshot(store)
    drag(store, [inner], -900, 0)
    expect(store.get(inner).frameId).toBe(outer)
    expect(store.get(inner).z).toBeGreaterThan(store.get(outer).z)
  })

  it('deleting the outer frame leaves the inner one (and its members) as they were', () => {
    const { store, outer, inner } = nested()
    store.remove([outer])
    expect(store.get(inner).frameId).toBeUndefined()
    expect(store.get('shape:i').frameId).toBe(inner)
    expect(store.get('shape:o').frameId).toBeUndefined()
    // deleting the inner one: what was in it goes to the frame around it
    const { store: s2, outer: o2, inner: i2 } = nested()
    s2.remove([i2])
    expect(s2.get('shape:i').frameId).toBe(o2)
  })

  it('a copy of the outer frame alone copies the inner one, with its title and members', () => {
    const { store, outer, inner } = nested()
    const copy = { ...store.get(outer), id: newId(), x: 2000 }
    store.put(copy)
    const ids = frameShapeIds(store, copy.id)
    const copies = [...ids].map((id) => store.get(id))
    const innerCopy = copies.find((s) => isFrame(s) && s.id !== copy.id)
    expect(innerCopy).toBeTruthy()
    expect(innerCopy.frameId).toBe(copy.id)
    expect(innerCopy.x).toBe(2100)
    expect(frameTitle(store, innerCopy.id)).toBe('Step 1')
    expect(copies.some((s) => s.frameId === innerCopy.id && s.type === 'geo' && !isFrame(s) && s.x === 2150)).toBe(true)
    expect(innerCopy.z).toBeGreaterThan(store.get(copy.id).z)
  })
})

describe('a title inside the frame', () => {
  it('goes just inside the top-left corner, follows the frame, and goes back above when asked', async () => {
    const { setTitleInside } = await import('../src/index.js')
    const store = new Store()
    bindFrames(store)
    const f = createFrame(store, { x: 100, y: 100, w: 300, h: 200, title: 'Inside', titleInside: true })
    expect(store.get(f + '-title')).toMatchObject({ x: 112, y: 108, frameId: f })
    snapshot(store)
    drag(store, [f], 50, 0)
    expect(store.get(f + '-title')).toMatchObject({ x: 162, y: 108 })
    setTitleInside(store, f, false)
    expect(store.get(f).titleInside).toBeUndefined()
    expect(store.get(f + '-title')).toMatchObject({ x: 150, y: 66 })
    setTitleInside(store, f, true)
    expect(store.get(f + '-title')).toMatchObject({ x: 162, y: 108 })
    // a copy keeps it inside
    const copy = { ...store.get(f), id: newId(), x: 1000 }
    store.put(copy)
    expect(store.get(copy.id + '-title')).toMatchObject({ x: 1012, y: 108 })
  })
})
