// Frames (Excalidraw-style, not nested) built from plain records, with no
// core change: a frame is a straight-edged, unfilled geo rectangle marked
// `isFrame`, sent to the back; its title is a text shape above its top-left
// corner; members carry `frameId`. The title is a member too, so it moves
// with the frame. exportFrame renders just the contents, cut at the edges.
//
// A frame may carry `aspect` (width / height, e.g. 16 / 9) to keep its shape.
// It also carries its own id as `frameKey`, and its title `isFrameTitle`:
// copies (the core's duplicate, paste, import) keep those fields but get new
// ids, which is how a copied frame is recognized and given its contents.
//
// bindFrames keeps it consistent on local edits:
// - a shape dropped with its center inside a frame joins it; dragged out, it leaves
// - moving a frame moves its members; resizing keeps the aspect, carries the
//   title along with the top-left corner and re-checks what is inside
// - deleting a frame deletes its title and releases its members
// - a copied frame gets a title and copies of the original's members, or
//   adopts the member copies made alongside it; it goes to the back
import { pageBounds, composeDiff, newId, drawShape } from '@quickdrawjs/core'

export { frameTools, FRAME_ICONS, FRAME_RATIOS } from './tools.js'

export const isFrame = (rec) => !!rec && rec.isFrame === true
const isTitle = (rec) => rec.isFrameTitle === true || rec.id === rec.frameId + '-title'

// aspect: width / height to keep (h follows w), or omitted for a free frame
export function createFrame(store, { x, y, w = 480, h = 320, aspect = null, title = 'Frame' }) {
  const id = newId()
  if (aspect) h = w / aspect
  store.transact(() => {
    store.put({
      id, typeName: 'shape', type: 'geo', isFrame: true, frameKey: id, ...(aspect ? { aspect } : {}), x, y, rot: 0, z: store.minZ() - 1,
      props: { geo: 'rectangle', w, h, color: 'grey', size: 's', dash: 'solid', fill: 'none', font: 'sans' },
    })
    putTitle(store, store.get(id), title)
    for (const s of store.shapes()) if (!isFrame(s) && s.frameId !== id && inside(pageBounds(s), store.get(id))) setFrame(store, s, id)
  })
  return id
}

function putTitle(store, frame, text) {
  store.put({
    id: frame.id + '-title', typeName: 'shape', type: 'text', isFrameTitle: true, frameId: frame.id, x: frame.x, y: frame.y - 34, rot: 0, z: store.maxZ() + 1,
    props: { text, color: 'grey', size: 's', font: 'sans', autosize: true, scale: 1 },
  })
}

/**
 * Free space for a w×h box with room `above` it for a frame's title, clear of
 * every shape (frame titles too) by `gap`: at `prefer` (its top-left) if free,
 * else the free spot nearest to it, else right of everything.
 */
export function freeSpot(store, w, h, prefer, { gap = 80, above = 40, step = 80, rings = 30 } = {}) {
  const all = store.shapes().map(pageBounds)
  const near = (a, b) => a.x < b.x + b.w + gap && a.x + a.w + gap > b.x && a.y < b.y + b.h + gap && a.y + a.h + gap > b.y
  const clear = (x, y) => !all.some((b) => near({ x, y: y - above, w, h: h + above }, b))
  const spots = []
  for (let i = -rings; i <= rings; i++) for (let j = -rings; j <= rings; j++) spots.push([i * i + j * j, prefer.x + i * step, prefer.y + j * step])
  spots.sort((a, b) => a[0] - b[0])
  for (const [, x, y] of spots) if (clear(x, y)) return { x: Math.round(x), y: Math.round(y) }
  return { x: Math.round(Math.max(...all.map((b) => b.x + b.w)) + gap), y: Math.round(prefer.y) }
}

export const frameTitle = (store, frameId) => store.get(frameId + '-title')?.props.text ?? ''

// sets the title text; recreates the title above the frame if it was deleted
export function renameFrame(store, frameId, title) {
  const t = store.get(frameId + '-title')
  if (t) store.update(t.id, { props: { text: title } })
  else if (isFrame(store.get(frameId))) putTitle(store, store.get(frameId), title)
}

// sets (keeping the width) or clears (null) a frame's aspect
export function setFrameAspect(store, frameId, aspect) {
  const f = store.get(frameId)
  if (!isFrame(f)) return
  const { aspect: _, ...rest } = f
  store.put(aspect ? { ...rest, aspect, props: { ...f.props, h: f.props.w / aspect } } : rest)
}

// The frame's contents as a PNG, cut exactly at its edges: members only, no
// outline, title or margin. background: the theme's paper color, or transparent.
export async function exportFrame(editor, frameId, { scale = 2, background = true } = {}) {
  const f = editor.store.get(frameId)
  if (!isFrame(f)) return null
  const { w, h } = f.props
  const k = Math.min(scale, Math.sqrt(24e6 / (w * h))) // stay under ~24MP, like the core
  const canvas = document.createElement('canvas')
  canvas.width = Math.max(1, Math.round(w * k))
  canvas.height = Math.max(1, Math.round(h * k))
  const ctx = canvas.getContext('2d')
  if (background) {
    ctx.fillStyle = editor.theme.background
    ctx.fillRect(0, 0, canvas.width, canvas.height)
  }
  ctx.setTransform(k, 0, 0, k, -f.x * k, -f.y * k)
  const shapes = editor.shapesSorted().filter((s) => s.frameId === frameId && s.id !== frameId + '-title')
  await decodeImages(editor.store, shapes)
  for (const s of shapes) drawShape(ctx, s, { theme: editor.theme, store: editor.store, zoom: k })
  return new Promise((resolve) => canvas.toBlob(resolve, 'image/png'))
}

// images must be decoded before the snapshot, as in the core's own export
function decodeImages(store, shapes) {
  return Promise.all(shapes.map((s) => {
    const a = s.type === 'image' && store.asset(s.props.assetId)
    if (!a) return null
    const img = new Image()
    img.src = a.src
    return img.decode().catch(() => {})
  }))
}

// the frame, its title and its members
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

// a resized frame with an aspect, corrected: the side that changed more
// (relatively) leads, and the edges opposite the dragged ones stay put
function keepAspect(from, to) {
  if (!to.aspect) return to
  let { w, h } = to.props
  if (Math.abs(w / from.props.w - 1) >= Math.abs(h / from.props.h - 1)) h = w / to.aspect
  else w = h * to.aspect
  if (w === to.props.w && h === to.props.h) return to
  const x = to.x !== from.x ? to.x + to.props.w - w : to.x
  const y = to.y !== from.y ? to.y + to.props.h - h : to.y
  return { ...to, x, y, props: { ...to.props, w, h } }
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
    const handled = new Set() // shapes placed here, not by position
    busy = true
    try {
      store.transact(() => {
        for (const rec of Object.values(diff.added)) if (isFrame(rec) && rec.frameKey !== rec.id && store.has(rec.id)) adoptCopy(rec)
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
          if (!isFrame(to) || !store.has(id)) continue
          const resized = to.props.w !== from.props.w || to.props.h !== from.props.h
          if (resized) {
            const f = keepAspect(from, to)
            if (f !== to) store.put(f)
            // the title rides the top-left corner; members stay where they are
            const dx = f.x - from.x, dy = f.y - from.y
            const t = store.get(id + '-title')
            if (t && (dx || dy) && !touched.has(t.id)) store.update(t.id, { x: t.x + dx, y: t.y + dy })
            for (const s of store.shapes()) if (!isFrame(s) && !isTitle(s)) assign(s)
          } else if (to.x !== from.x || to.y !== from.y) {
            const dx = to.x - from.x, dy = to.y - from.y
            for (const s of store.shapes()) if (s.frameId === id && !touched.has(s.id)) store.update(s.id, { x: s.x + dx, y: s.y + dy })
          }
        }
        // added or moved shapes join or leave frames by where they land
        for (const id of touched) {
          const s = store.get(id)
          if (!s || s.typeName !== 'shape' || isFrame(s) || isTitle(s) || handled.has(id)) continue // not an image's asset
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

    // a frame copy: frameKey still names the original
    function adoptCopy(copy) {
      const id = copy.id, srcId = copy.frameKey
      const src = store.get(srcId)
      store.put({ ...copy, frameKey: id, z: store.minZ() - 1 })
      // shapes copied alongside it still point at the original
      const mates = srcId ? Object.values(diff.added).filter((s) => s.frameId === srcId && store.has(s.id)) : []
      let title = null
      for (const s of mates) {
        handled.add(s.id)
        if (isTitle(s)) { title ??= s.props.text; store.remove([s.id]) } // recreated below under the frame's id
        else setFrame(store, store.get(s.id), id)
      }
      // copied on its own: copy the original's members too, keeping their offsets
      if (!mates.some((s) => !isTitle(s)) && isFrame(src)) {
        const dx = copy.x - src.x, dy = copy.y - src.y
        let z = store.maxZ()
        for (const s of store.shapes().filter((m) => m.frameId === srcId && !isTitle(m)).sort((a, b) => a.z - b.z)) {
          store.put({ ...s, id: newId(), frameId: id, x: s.x + dx, y: s.y + dy, z: ++z })
        }
      }
      putTitle(store, store.get(id), title ?? ((src && frameTitle(store, srcId)) || 'Frame'))
    }
  }, { source: 'user' })
}
