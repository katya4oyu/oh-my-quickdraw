// A fill for a closed outline drawn with the pen: the board's pen strokes have
// none, so an SVG shape's fill comes as a shape of its own, under its outline.
// Three ways of filling, as on paper: `tint` (the colour's pale body, like a
// marker laid flat), `hatch` (diagonal hand strokes), `scribble` (a quick
// back-and-forth with a wide translucent pen). Drawn with the theme's colours.
import * as core from '@quickdrawjs/core'

export const FILL = 'svg-fill'
export const FILL_STYLES = ['tint', 'hatch', 'scribble']
let registered = false

const bounds = (s) => ({ x: 0, y: 0, w: Math.max(1, s.props.w), h: Math.max(1, s.props.h) })

function outline(ctx, pts) {
  ctx.beginPath()
  ctx.moveTo(pts[0], pts[1])
  for (let i = 2; i < pts.length; i += 2) ctx.lineTo(pts[i], pts[i + 1])
  ctx.closePath()
}

// strokes across the shape at an angle, `gap` apart, nudged a little so they read as drawn by hand
function across(ctx, w, h, gap, angle, wobble) {
  const c = Math.cos(angle), s = Math.sin(angle), r = Math.hypot(w, h)
  let seed = 7
  const rnd = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 2 ** 32 - 0.5 }
  ctx.beginPath()
  for (let d = -r; d <= r; d += gap) {
    const o = d + rnd() * wobble
    const x = w / 2 + o * -s, y = h / 2 + o * c
    ctx.moveTo(x - c * r, y - s * r)
    ctx.lineTo(x + c * r + rnd() * wobble, y + s * r + rnd() * wobble)
  }
  ctx.stroke()
}

function draw(ctx, shape, { theme }) {
  const p = shape.props, col = theme.colors[p.color] ?? theme.colors.black
  ctx.save()
  outline(ctx, p.pts)
  if (p.style === 'tint') {
    ctx.fillStyle = col.fill
    ctx.fill()
  } else {
    ctx.clip()
    ctx.lineCap = 'round'
    if (p.style === 'hatch') {
      ctx.strokeStyle = col.stroke
      ctx.globalAlpha = 0.55
      ctx.lineWidth = 1.6
      across(ctx, p.w, p.h, 9, -Math.PI / 4, 1.5)
    } else { // scribble
      ctx.strokeStyle = col.stroke
      ctx.globalAlpha = 0.22
      ctx.lineWidth = 14
      across(ctx, p.w, p.h, 11, -Math.PI / 3, 4)
    }
  }
  ctx.restore()
}

function scale(shape, sx, sy) {
  const p = shape.props
  return { ...shape, props: { ...p, w: p.w * sx, h: p.h * sy, pts: p.pts.map((v, i) => (i % 2 ? v * sy : v * sx)) } }
}

/** Registers the fill's shape type; false on a core without registerShapeType. */
export function registerSvgFill() {
  if (typeof core.registerShapeType !== 'function') return false
  if (!registered) core.registerShapeType(FILL, { bounds, draw, scale })
  return (registered = true)
}

// For quickdraw-import's `types`. An error message, or null.
export function validateSvgFill(shape) {
  const p = shape.props
  if (!Array.isArray(p.pts) || p.pts.length < 6 || p.pts.length > 20000 || !p.pts.every(Number.isFinite)) return 'bad props.pts'
  if (!FILL_STYLES.includes(p.style)) return 'bad props.style'
  for (const k of ['w', 'h']) if (!Number.isFinite(p[k]) || p[k] <= 0 || p[k] > 10000) return `bad props.${k}`
  return null
}
