// Snapshots on the board: a frame holding a still of the shared screen, and
// whatever people draw or write in it — the feedback. A snapshot is marked on
// its frame record (`snapshot: { at, by, imageId, sent? }`), so it travels with
// the board: synced, saved, exported, like any shape.
import { newId, pageBounds } from '@quickdrawjs/core'
import { createFrame, frameTitle, isFrame } from 'quickdraw-frames'

const GAP = 80
const PAD = 24 // around the image, inside the frame
const NOTES = 240 // room on the right for notes
const TITLE = 34 // the frame's title sits this far above it
const STEP = 80 // how finely free space is looked for around the view
const RINGS = 30 // how far (in steps) before giving up and going right of everything

export const isSnapshot = (rec) => isFrame(rec) && typeof rec.snapshot?.at === 'number'

/** The snapshot frames on the board, oldest first. */
export const snapshots = (store) => store.shapes().filter(isSnapshot).sort((a, b) => a.snapshot.at - b.snapshot.at)

/**
 * Puts a still on the board in a frame of its own, clear of what is there:
 * right of the last snapshot, on its row, or as near the middle of the view as
 * there is room. `image`: `{ src: 'data:image/…', w, h }` (its
 * natural size). Returns the frame's and the image's ids.
 */
export function placeSnapshot(editor, image, { title, by = '', at = Date.now(), width = 720 } = {}) {
  if (typeof image?.src !== 'string' || !image.src.startsWith('data:image/') || !(image.w > 0 && image.h > 0)) {
    throw new TypeError('placeSnapshot needs { src: data:image/… URL, w, h }')
  }
  const { store } = editor
  const w = Math.min(width, image.w), h = (w * image.h) / image.w
  const fw = w + PAD * 2 + NOTES, fh = h + PAD * 2
  const last = snapshots(store).at(-1)
  const { x, y } = last ? nextInRow(store, fw, fh, last) : nearView(store, fw, fh, editor.viewportPageBounds())
  const assetId = newId('asset'), imageId = newId()
  let frameId
  store.transact(() => {
    store.put({ id: assetId, typeName: 'asset', src: image.src, w: image.w, h: image.h })
    store.put({ id: imageId, typeName: 'shape', type: 'image', x: x + PAD, y: y + PAD, rot: 0, z: store.maxZ() + 1, props: { w, h, assetId } })
    frameId = createFrame(store, { x, y, w: fw, h: fh, title: title ?? `Snapshot${by ? ' · ' + by : ''}` })
    store.update(frameId, { snapshot: { at, by, imageId } })
  })
  return { frameId, imageId }
}

// Free space for a snapshot, so it never lands on what is there: a frame takes
// in the shapes under it (their notes would become its feedback), and frames
// that overlap confuse which one a shape belongs to.
const overlaps = (a, b) => a.x < b.x + b.w + GAP && a.x + a.w + GAP > b.x && a.y < b.y + b.h + GAP && a.y + a.h + GAP > b.y
// the frame at (x, y) with its title above
const area = (x, y, w, h) => ({ x, y: y - TITLE, w, h: h + TITLE })
const taken = (store) => store.shapes().map(pageBounds)

// right of the last snapshot, on its row; past whatever is in the way
function nextInRow(store, w, h, last) {
  const all = taken(store)
  let x = last.x + last.props.w + GAP
  for (;;) {
    const box = area(x, last.y, w, h)
    const hit = all.filter((b) => overlaps(box, b))
    if (!hit.length) return { x, y: last.y }
    x = Math.max(...hit.map((b) => b.x + b.w)) + GAP
  }
}

// the first: mid-view if free, else the free spot nearest to it, else right of everything
function nearView(store, w, h, v) {
  const all = taken(store)
  const x0 = v.x + (v.w - w) / 2, y0 = v.y + (v.h - h) / 2
  const spots = []
  for (let i = -RINGS; i <= RINGS; i++) for (let j = -RINGS; j <= RINGS; j++) spots.push([i * i + j * j, x0 + i * STEP, y0 + j * STEP])
  spots.sort((a, b) => a[0] - b[0])
  for (const [, x, y] of spots) if (!all.some((b) => overlaps(area(x, y, w, h), b))) return { x, y }
  return { x: Math.max(...all.map((b) => b.x + b.w)) + GAP, y: y0 }
}

// a short, stable fingerprint of what is written in a snapshot
function fingerprint(shapes) {
  const text = JSON.stringify(shapes.map((s) => [s.id, s.type, Math.round(s.x), Math.round(s.y), s.props]).sort())
  let h = 0x811c9dc5
  for (let i = 0; i < text.length; i++) h = Math.imul(h ^ text.charCodeAt(i), 0x01000193) >>> 0
  return h.toString(36)
}

/**
 * What people put on a snapshot: the shapes in its frame other than the still
 * and the title. `pending`: something is there that was not sent yet (see markSent).
 */
export function snapshotFeedback(store, frameId) {
  const f = store.get(frameId)
  if (!isSnapshot(f)) return null
  const shapes = store.shapes().filter((s) => s.frameId === frameId && s.id !== f.snapshot.imageId && !s.isFrameTitle && s.id !== frameId + '-title')
  const key = fingerprint(shapes)
  return {
    frameId, title: frameTitle(store, frameId), at: f.snapshot.at, by: f.snapshot.by, imageId: f.snapshot.imageId,
    shapeIds: shapes.map((s) => s.id), key, pending: shapes.length > 0 && key !== f.snapshot.sent,
  }
}

/** Snapshots with feedback not sent yet, oldest first. */
export const pendingFeedback = (store) => snapshots(store).map((f) => snapshotFeedback(store, f.id)).filter((s) => s.pending)

/** Notes that these snapshots' feedback, as it is now, went out (to an agent). */
export function markSent(store, frameIds) {
  store.transact(() => {
    for (const id of frameIds) {
      const fb = snapshotFeedback(store, id)
      if (fb) store.update(id, { snapshot: { ...store.get(id).snapshot, sent: fb.key } })
    }
  })
}
