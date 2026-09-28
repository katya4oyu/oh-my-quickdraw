// The arithmetic of presence, kept apart from the page so it can be tested.

const ZOOM_MIN = 0.05, ZOOM_MAX = 8 // the core's

/**
 * Where to show someone out of sight: on the edge of the screen box
 * (`{ w, h }`, inset by `margin`), on the line from its centre to the screen
 * point `p`. Null while `p` is in view.
 */
export function edgePoint(box, p, margin = 24) {
  if (p.x >= 0 && p.y >= 0 && p.x <= box.w && p.y <= box.h) return null
  const cx = box.w / 2, cy = box.h / 2
  const dx = p.x - cx, dy = p.y - cy
  const hw = Math.max(0, cx - margin), hh = Math.max(0, cy - margin)
  // the smaller of the steps that reach a vertical or a horizontal side
  const k = Math.min(dx ? hw / Math.abs(dx) : Infinity, dy ? hh / Math.abs(dy) : Infinity)
  return { x: cx + dx * k, y: cy + dy * k, angle: Math.atan2(dy, dx) }
}

/** The camera that shows the page rectangle `view` whole and centred in the screen box `{ w, h }`. */
export function fitView(box, view) {
  const z = Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, Math.min(box.w / view.w, box.h / view.h)))
  return { x: box.w / 2 / z - (view.x + view.w / 2), y: box.h / 2 / z - (view.y + view.h / 2), z }
}

/** The camera that puts the page point `p` in the middle of the screen box, at zoom `z`. */
export const centreOn = (box, p, z) => ({ x: box.w / 2 / z - p.x, y: box.h / 2 / z - p.y, z })

/**
 * Whether the page point `p` is well inside the page rectangle `v`: not
 * within `edge` (a fraction of its size) of a side. Following an agent pans
 * once its cursor gets that close to the edge.
 */
export function wellInside(v, p, edge = 0.15) {
  const mx = v.w * edge, my = v.h * edge
  return p.x >= v.x + mx && p.x <= v.x + v.w - mx && p.y >= v.y + my && p.y <= v.y + v.h - my
}

/** One or two letters for someone's avatar. */
export function initials(name = '') {
  const words = String(name).trim().split(/\s+/).filter(Boolean)
  if (!words.length) return '?'
  if (words.length === 1) return [...words[0]].slice(0, 2).join('').toUpperCase()
  return ([...words[0]][0] + [...words[1]][0]).toUpperCase()
}
