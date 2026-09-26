// Frames (Excalidraw-style, not nested) built from plain records, with no
// core change: a frame is a straight-edged, unfilled geo rectangle marked
// `isFrame`, sent to the back; its title is a text shape above its top-left
// corner; members carry `frameId`. The title is a member too, so it moves
// and exports with the frame.
//
// bindFrames keeps it consistent on local edits:
// - a shape dropped with its center inside a frame joins it; dragged out, it leaves
// - moving a frame moves its members; resizing re-checks what is inside
// - deleting a frame deletes its title and releases its members
import { pageBounds, composeDiff, newId } from '@quickdrawjs/core'

export const isFrame = (rec) => !!rec && rec.isFrame === true

export function createFrame(store, { x, y, w = 480, h = 320, title = 'Frame' }) {
  const id = newId()
  store.transact(() => {
    store.put({
      id, typeName: 'shape', type: 'geo', isFrame: true, x, y, rot: 0, z: store.minZ() - 1,
      props: { geo: 'rectangle', w, h, color: 'grey', size: 's', dash: 'solid', fill: 'none', font: 'sans' },
    })
    store.put({
      id: id + '-title', typeName: 'shape', type: 'text', frameId: id, x, y: y - 34, rot: 0, z: store.maxZ() + 1,
      props: { text: title, color: 'grey', size: 's', font: 'sans', autosize: true, scale: 1 },
    })
    for (const s of store.shapes()) if (!isFrame(s) && s.frameId !== id && inside(pageBounds(s), store.get(id))) setFrame(store, s, id)
  })
  return id
}

// the frame, its title and its members: pass to editor.exportImage({ ids })
export function frameShapeIds(store, frameId) {
  const ids = new Set([frameId])
  for (const s of store.shapes()) if (s.frameId === frameId) ids.add(s.id)
  return ids
}

// sets or clears a shape's frameId (cleared = no key, not undefined)
function setFrame(store, s, frameId) {
  if (s.frameId === frameId) return
  const { frameId: _, ...rest } = s
  store.put(frameId ? { ...rest, frameId } : rest)
}

function inside(b, frame) {
  const cx = b.x + b.w / 2, cy = b.y + b.h / 2
  const p = frame.props
  return cx >= frame.x && cx <= frame.x + p.w && cy >= frame.y && cy <= frame.y + p.h
}

// the frame a shape belongs in by position: the topmost containing its center
function frameAt(store, shape) {
  const b = pageBounds(shape)
  let best = null
  for (const f of store.shapes()) if (isFrame(f) && inside(b, f) && (!best || f.z > best.z)) best = f
  return best
}

export function bindFrames(store) {
  let busy = false

  return store.listen((diff) => {
    if (busy) return
    const touched = new Set([...Object.keys(diff.added), ...Object.keys(diff.updated), ...Object.keys(diff.removed)])
    const before = store.undos.length
    busy = true
    try {
      store.transact(() => {
        // deleted frames: drop the title, release the members
        for (const [id, rec] of Object.entries(diff.removed)) {
          if (!isFrame(rec)) continue
          for (const s of store.shapes()) {
            if (s.frameId !== id) continue
            if (s.id === id + '-title') store.remove([s.id])
            else setFrame(store, s, undefined)
          }
        }
        // moved frames drag their members along, unless those moved in the
        // same change (a joint drag, or an undo/redo of one)
        for (const [id, [from, to]] of Object.entries(diff.updated)) {
          if (!isFrame(to)) continue
          const dx = to.x - from.x, dy = to.y - from.y
          if (dx || dy) {
            for (const s of store.shapes()) if (s.frameId === id && !touched.has(s.id)) store.update(s.id, { x: s.x + dx, y: s.y + dy })
          }
          if (to.props.w !== from.props.w || to.props.h !== from.props.h) {
            for (const s of store.shapes()) if (!isFrame(s) && s.id !== s.frameId + '-title') assign(s)
          }
        }
        // added or moved shapes join or leave frames by where they land
        for (const id of touched) {
          const s = store.get(id)
          if (!s || isFrame(s) || s.id === s.frameId + '-title') continue
          const [from] = diff.updated[id] || []
          if (!from || from.x !== s.x || from.y !== s.y || from.rot !== s.rot) assign(s)
        }
      })
    } finally { busy = false }
    // a change outside a gesture batch (e.g. a keyboard nudge) left our
    // follow-up as its own history entry: fold it into the change it follows
    if (store.undos.length === before + 1 && before > 0) {
      const ours = store.undos.pop()
      store.undos.push(composeDiff(store.undos.pop(), ours))
    }

    function assign(s) {
      setFrame(store, s, frameAt(store, s)?.id)
    }
  }, { source: 'user' })
}
