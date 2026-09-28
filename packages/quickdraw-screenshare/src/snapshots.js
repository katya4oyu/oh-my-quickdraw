// Snapshots on the board: a frame holding a still of the shared screen, and
// whatever people draw or write in it — the feedback. A snapshot is marked on
// its frame record (`snapshot: { at, by, imageId, sent? }`), so it travels with
// the board: synced, saved, exported, like any shape.
import { newId } from '@quickdrawjs/core'
import { createFrame, frameTitle, isFrame } from 'quickdraw-frames'

const GAP = 80
const PAD = 24 // around the image, inside the frame
const NOTES = 240 // room on the right for notes

export const isSnapshot = (rec) => isFrame(rec) && typeof rec.snapshot?.at === 'number'

/** The snapshot frames on the board, oldest first. */
export const snapshots = (store) => store.shapes().filter(isSnapshot).sort((a, b) => a.snapshot.at - b.snapshot.at)

/**
 * Puts a still on the board in a frame of its own: right of the last snapshot,
 * or in the middle of the view. `image`: `{ src: 'data:image/…', w, h }` (its
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
  let x, y
  if (last) { x = last.x + last.props.w + GAP; y = last.y }
  else {
    const v = editor.viewportPageBounds()
    x = v.x + (v.w - fw) / 2; y = v.y + (v.h - fh) / 2
  }
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
