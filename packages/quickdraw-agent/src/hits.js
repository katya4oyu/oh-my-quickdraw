// What a shape runs into on the board, measured as drawn — for `placed`, so an
// agent drawing as written learns at once what to put right, without a lint or
// a picture: an arrow crossing another, an arrow running over a shape or a
// text it does not join, a text lying on a line, shapes or texts on top of
// each other. It only reads.
import { pageBounds } from '@quickdrawjs/core'
import { isFrame } from 'quickdraw-frames'

const isLine = (s) => s.type === 'arrow' || s.type === 'line'
const isTitle = (s) => s.isFrameTitle === true || s.id === s.frameId + '-title'
const isText = (s) => s.type === 'text'
const MIN = 4 // less than this is touching, not covering

// the line as the core draws it (shapes.js sampleLinePts), in page coordinates
export function linePoints(s) {
  const { dx, dy } = s.props, bend = s.props.bend || 0
  if (!bend) return [[s.x, s.y], [s.x + dx, s.y + dy]]
  const len = Math.hypot(dx, dy) || 1
  const cx = dx / 2 + (-dy / len) * bend * 2, cy = dy / 2 + (dx / len) * bend * 2
  return Array.from({ length: 17 }, (_, i) => { const t = i / 16, m = 1 - t; return [s.x + 2 * m * t * cx + t * t * dx, s.y + 2 * m * t * cy + t * t * dy] })
}

const cross = (o, a, b) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0])
function segsMeet(p, q, r, s) {
  const d1 = cross(r, s, p), d2 = cross(r, s, q), d3 = cross(p, q, r), d4 = cross(p, q, s)
  return ((d1 > 0) !== (d2 > 0)) && ((d3 > 0) !== (d4 > 0)) && d1 && d2 && d3 && d4
}
// does segment p→q pass through rect r (Liang–Barsky), by more than a touch?
function segInRect(p, q, r) {
  let t0 = 0, t1 = 1
  const dx = q[0] - p[0], dy = q[1] - p[1]
  for (const [a, b] of [[-dx, p[0] - r.x], [dx, r.x + r.w - p[0]], [-dy, p[1] - r.y], [dy, r.y + r.h - p[1]]]) {
    if (!a) { if (b < 0) return false; continue }
    const t = b / a
    if (a < 0) { if (t > t1) return false; if (t > t0) t0 = t } else { if (t < t0) return false; if (t < t1) t1 = t }
  }
  return (t1 - t0) * Math.hypot(dx, dy) > MIN
}
const near = (a, b, d = 12) => Math.hypot(a[0] - b[0], a[1] - b[1]) < d
const shrink = (r, d) => ({ x: r.x + d, y: r.y + d, w: Math.max(0, r.w - 2 * d), h: Math.max(0, r.h - 2 * d) })
const meet = (a, b) => ({ w: Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x), h: Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y) })
const within = (a, b) => a.x >= b.x - 1 && a.y >= b.y - 1 && a.x + a.w <= b.x + b.w + 1 && a.y + a.h <= b.y + b.h + 1

function linesCross(a, b) {
  const pa = linePoints(a), pb = linePoints(b)
  // arrows that start or end at the same spot meet there; that is not crossing
  const ends = (pts) => [pts[0], pts.at(-1)]
  for (const e of ends(pa)) for (const f of ends(pb)) if (near(e, f)) return false
  for (let i = 1; i < pa.length; i++) for (let j = 1; j < pb.length; j++) if (segsMeet(pa[i - 1], pa[i], pb[j - 1], pb[j])) return true
  return false
}
function lineOver(line, r) {
  const pts = linePoints(line)
  for (let i = 1; i < pts.length; i++) if (segInRect(pts[i - 1], pts[i], r)) return true
  return false
}

/**
 * What shape `id` runs into: ["crosses arrow @ref", "over text \"…\" (id)", …].
 * An arrow: other arrows it crosses, and shapes or texts it runs over (not the
 * two it joins); a text: lines it lies on, texts it overlaps, a shape whose edge
 * it lies across; a shape: shapes it overlaps (not one it lies wholly in), and
 * arrows that run over it.
 */
export function hitsOf(store, id) {
  const s = store.get(id)
  if (!s || s.typeName !== 'shape' || isFrame(s) || isTitle(s)) return []
  const others = store.shapes().filter((o) => o.typeName === 'shape' && o.id !== id && !isFrame(o) && !isTitle(o) && o.type !== 'draw' && o.type !== 'highlight' && !o.isLayout)
  const name = (o) => {
    const what = isLine(o) ? 'arrow' : isText(o) ? 'text' : o.type === 'geo' ? o.props.geo : o.type
    const words = isText(o) ? ` "${String(o.props.text).split('\n')[0].slice(0, 24)}"` : ''
    return `${what}${words} ${o.agent?.ref ? '@' + o.agent.ref : o.id}`
  }
  const out = []
  if (isLine(s)) {
    const joins = new Set([s.link?.from, s.link?.to].filter(Boolean))
    for (const o of others) {
      if (isLine(o)) { if (linesCross(s, o)) out.push(`crosses ${name(o)}`) }
      else if (!joins.has(o.id) && o.labelOf !== s.id && lineOver(s, shrink(pageBounds(o), isText(o) ? 0 : 6))) out.push(`over ${name(o)}`)
    }
    return out
  }
  const b = pageBounds(s)
  for (const o of others) {
    if (isLine(o)) {
      if (o.link?.from === id || o.link?.to === id || s.labelOf === o.id) continue
      if (lineOver(o, isText(s) ? b : shrink(b, 6))) out.push(`${isText(s) ? 'on' : 'under'} ${name(o)}`)
      continue
    }
    const ob = pageBounds(o), m = meet(b, ob)
    if (m.w < MIN || m.h < MIN) continue
    if (isText(s) && !isText(o) && within(b, ob)) continue // a text in a box: its words
    if (!isText(s) && isText(o) && within(ob, b)) continue // words in this box
    if (!isText(s) && !isText(o) && (within(b, ob) || within(ob, b))) continue // a box in a box
    out.push(`overlaps ${name(o)}`)
  }
  return out
}
