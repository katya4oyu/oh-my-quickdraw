// Animated GIFs on a board. The core draws images on its canvas, and a canvas
// shows a GIF's first frame only; so over each GIF in view (that nothing is
// drawn over) this lays the GIF itself, as an <img>, which the browser plays.
// While it plays, the screen does not draw the GIF beneath it (the core's
// setDrawnElsewhere: else its first frame shows through a see-through GIF);
// exports, thumbnails and pages without this still show the first frame. On a
// core without setDrawnElsewhere, GIFs keep still. With reduced motion too.
//
// A GIF stays a GIF when it is pasted or dropped as a file (the core keeps
// images up to 2048 px as they are); an image copied from a web page reaches
// the clipboard as a PNG, a still, in most browsers.
import * as core from '@quickdrawjs/core'

/** Whether an image source is a GIF (a data URL or a .gif URL). */
export const isGifSrc = (src) => typeof src === 'string' && (/^data:image\/gif[;,]/i.test(src) || /\.gif(?:[?#]|$)/i.test(src))

/** The GIF image shapes of a board: [shape, its source]. */
export function gifsOf(store) {
  const out = []
  for (const s of store.shapes()) {
    if (s.type !== 'image' || !s.props?.assetId) continue
    const src = store.asset(s.props.assetId)?.src
    if (isGifSrc(src)) out.push([s, src])
  }
  return out
}

const overlaps = (a, b) => a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y

/**
 * Whether something is drawn over a shape (above it, and on it): then the GIF
 * keeps still, so what is on top of it stays on top. `sorted`: the shapes
 * bottom to top (editor.shapesSorted()).
 */
export function coveredIn(sorted, shape) {
  const i = sorted.findIndex((s) => s.id === shape.id)
  if (i < 0) return false
  const b = core.pageBounds(shape)
  for (let j = i + 1; j < sorted.length; j++) {
    const s = sorted[j]
    if (s.isFrameTitle) continue
    if (overlaps(core.pageBounds(s), b)) return true
  }
  return false
}

/** Plays the GIFs in view. Returns { refresh, destroy }. */
export function bindGifs(editor, { max = 12 } = {}) {
  const layer = document.createElement('div')
  layer.className = 'qd-gifs'
  Object.assign(layer.style, { position: 'absolute', inset: '0', overflow: 'hidden', pointerEvents: 'none' })
  editor.canvas.after(layer) // over the shapes, below the selection handles
  const live = new Map() // id -> { img, src }
  const canHide = typeof editor.setDrawnElsewhere === 'function'
  const still = () => !canHide || !!globalThis.matchMedia?.('(prefers-reduced-motion: reduce)').matches
  let raf = 0
  const schedule = () => { if (!raf) raf = requestAnimationFrame(() => { raf = 0; reconcile() }) }

  function reconcile() {
    const v = editor.viewportPageBounds()
    const sorted = editor.shapesSorted()
    const wanted = still() ? [] : gifsOf(editor.store)
      .filter(([s]) => overlaps(core.pageBounds(s), v) && !coveredIn(sorted, s))
      .slice(-max)
    const keep = new Set(wanted.map(([s]) => s.id))
    for (const [id, cur] of [...live]) if (!keep.has(id)) { cur.img.remove(); live.delete(id) }
    // the screen leaves to each <img> the GIF it plays, once it shows (until then the canvas does)
    const shown = () => editor.setDrawnElsewhere?.([...live].filter(([, c]) => c.ready).map(([id]) => id))
    for (const [s, src] of wanted) {
      let cur = live.get(s.id)
      if (cur && cur.src !== src) { cur.img.remove(); live.delete(s.id); cur = undefined }
      if (!cur) {
        const img = document.createElement('img')
        img.alt = ''
        img.draggable = false
        img.decoding = 'async'
        const entry = { img, src, ready: false }
        img.onload = () => { entry.ready = true; shown() }
        img.src = src
        Object.assign(img.style, { position: 'absolute', left: '0', top: '0', transformOrigin: '0 0', borderRadius: '4px', pointerEvents: 'none' })
        layer.append(img)
        live.set(s.id, cur = entry)
      }
      const { w, h } = s.props
      const p = editor.pageToScreen(s.x, s.y)
      Object.assign(cur.img.style, {
        width: w + 'px', height: h + 'px', opacity: String(s.opacity ?? 1),
        transform: `translate(${p.x}px, ${p.y}px) scale(${editor.camera.z})` + (s.rot ? ` translate(${w / 2}px, ${h / 2}px) rotate(${s.rot}rad) translate(${-w / 2}px, ${-h / 2}px)` : ''),
      })
    }
    shown()
  }

  const offs = [editor.store.listen(schedule), editor.on('camera', schedule)]
  addEventListener('resize', schedule)
  const motion = globalThis.matchMedia?.('(prefers-reduced-motion: reduce)')
  motion?.addEventListener?.('change', schedule)
  schedule()
  return {
    refresh: schedule,
    destroy() {
      cancelAnimationFrame(raf)
      offs.forEach((off) => off?.())
      removeEventListener('resize', schedule)
      motion?.removeEventListener?.('change', schedule)
      layer.remove()
      live.clear()
      editor.setDrawnElsewhere?.([])
    },
  }
}
