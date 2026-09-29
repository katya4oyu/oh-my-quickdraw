// A linter for a board's layout: what reads badly once drawn — shapes on top of
// each other, an arrow running across a shape it does not connect, something
// sticking out of its frame, frames on top of each other. It only reads, so an
// agent can draw first, then check and fix; `frame`, `ids` or `area` narrow it
// to what was just made (what else is there still counts, as what it runs into).
import { pageBounds, FONT_SIZES } from '@quickdrawjs/core'
import { isFrame } from 'quickdraw-frames'
import { textOf } from './ops.js'
import { estimateWidth } from './measure.js'

const MIN = 6 // overlaps thinner than this are touching, not covering
const isTitle = (s) => s.isFrameTitle === true || s.id === s.frameId + '-title'
const isLine = (s) => s.type === 'arrow' || s.type === 'line'
// what may sit on anything without it being a problem: pen marks, pictures (people draw on them)
const isFree = (s) => s.type === 'draw' || s.type === 'highlight' || s.type === 'image'
const meet = (a, b) => ({ w: Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x), h: Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y) })
const within = (a, b, tol = 2) => a.x >= b.x - tol && a.y >= b.y - tol && a.x + a.w <= b.x + b.w + tol && a.y + a.h <= b.y + b.h + tol
const hits = (a, b) => { const m = meet(a, b); return m.w > 0 && m.h > 0 }

// a frame's bounds with its title above it
function withTitle(store, f) {
  const b = pageBounds(f)
  const t = store.get(f.id + '-title')
  if (!t) return b
  const tb = pageBounds(t)
  const x = Math.min(b.x, tb.x), y = Math.min(b.y, tb.y)
  return { x, y, w: Math.max(b.x + b.w, tb.x + tb.w) - x, h: Math.max(b.y + b.h, tb.y + tb.h) - y }
}

// does the segment p→q pass through rect r (Liang–Barsky)?
function crosses(p, q, r) {
  let t0 = 0, t1 = 1
  const dx = q.x - p.x, dy = q.y - p.y
  for (const [a, b] of [[-dx, p.x - r.x], [dx, r.x + r.w - p.x], [-dy, p.y - r.y], [dy, r.y + r.h - p.y]]) {
    if (a === 0) { if (b < 0) return false; continue }
    const t = b / a
    if (a < 0) { if (t > t1) return false; if (t > t0) t0 = t } else { if (t < t0) return false; if (t < t1) t1 = t }
  }
  return t1 - t0 > 0.02
}
// the height a shape's label takes, wrapped as the core wraps it (at spaces;
// a word wider than the line anywhere). Widths are estimated, a little under
// Node's layout estimate, which runs wide of the hand-drawn font as drawn:
// what is reported is what clearly spills out as people see it, the box's
// padding aside (widths vary some ten per cent with the letters).
const LABEL_PAD = 12
const width = (font, t) => estimateWidth(font, t) * 0.9
function labelHeight(s) {
  const fs = FONT_SIZES[s.props.labelSize || 's'] ?? 20
  const font = `500 ${fs}px sans-serif`
  const maxW = Math.max(24, s.props.w - LABEL_PAD * 2)
  const estimateWidth = width
  let lines = 0
  for (const para of String(s.props.label).split('\n')) {
    let line = ''
    lines++
    for (const word of para.split(/(\s+)/)) {
      const test = line + word
      if (line.trim() && estimateWidth(font, test) > maxW) { lines++; line = word.trimStart() } else line = test
      while (estimateWidth(font, line) > maxW && line.length > 1) { // too wide alone: broken anywhere
        let cut = line.length - 1
        while (cut > 1 && estimateWidth(font, line.slice(0, cut)) > maxW) cut--
        lines++; line = line.slice(cut)
      }
    }
  }
  return lines * fs * 1.3
}
// what of a shape's box its label may use: all of a rectangle's, less of the others'
const roomFor = (s) => (['rectangle', 'cloud', 'rhombus'].includes(s.props.geo) || !s.props.geo ? 1 : 0.8)

const shrink = (r, d) => ({ x: r.x + d, y: r.y + d, w: Math.max(0, r.w - d * 2), h: Math.max(0, r.h - d * 2) })

/**
 * Problems in how the board is laid out: [{ kind, ids, text }]. Narrowed by
 * `frame` (a frame id: its title, what is in it or on it), `ids`, or `area`
 * ({ x, y, w, h }); a problem is reported when one of those shapes is in it.
 */
export function lintBoard(store, { frame, ids, area } = {}) {
  const shapes = store.shapes().filter((s) => s.typeName === 'shape')
  const byId = new Map(shapes.map((s) => [s.id, s]))
  const bounds = new Map(shapes.map((s) => [s.id, isFrame(s) ? withTitle(store, s) : pageBounds(s)]))
  const b = (s) => bounds.get(s.id)

  // what to check
  let focus
  if (frame) {
    const f = byId.get(frame)
    if (!f || !isFrame(f)) throw new Error(`${frame} is not a frame`)
    focus = shapes.filter((s) => s.id === f.id || s.frameId === f.id || hits(b(s), b(f)))
  } else if (ids?.length) {
    for (const id of ids) if (!byId.has(id)) throw new Error(`no shape ${id}`)
    focus = ids.map((id) => byId.get(id))
  } else if (area) focus = shapes.filter((s) => hits(b(s), area))
  else focus = shapes
  const inFocus = new Set(focus.map((s) => s.id))
  const concerns = (...xs) => xs.some((s) => inFocus.has(s.id))

  const name = (s) => {
    const t = isFrame(s) ? `frame "${textOf(store, s)}"` : `${s.type === 'geo' ? s.props.geo ?? 'shape' : s.type}${(() => { const x = String(textOf(store, s) ?? '').split('\n')[0].trim(); return x ? ` "${x.slice(0, 40)}${x.length > 40 ? '…' : ''}"` : '' })()}`
    return `${t} (${s.id}${s.agent ? '' : ', by a person'})`
  }
  const issues = []
  const add = (kind, list, text) => issues.push({ kind, ids: list.map((s) => s.id), text })

  // shapes on top of each other (a frame's title counts: a heading over it hides it)
  const solid = shapes.filter((s) => !isLine(s) && !isFrame(s) && !isFree(s))
  for (let i = 0; i < solid.length; i++) for (let j = i + 1; j < solid.length; j++) {
    const s = solid[i], t = solid[j]
    if (!concerns(s, t) || (isTitle(s) && isTitle(t))) continue
    const m = meet(b(s), b(t))
    if (m.w < MIN || m.h < MIN) continue
    // text inside a box reads as its label
    if ((s.type === 'text' && t.type === 'geo' && within(b(s), b(t), 0)) || (t.type === 'text' && s.type === 'geo' && within(b(t), b(s), 0))) continue
    add('overlap', [s, t], `${name(s)} and ${name(t)} overlap (${Math.round(m.w)} × ${Math.round(m.h)}): move one clear, or arrange_shapes them`)
  }

  // frames on top of each other
  const frames = shapes.filter(isFrame)
  for (let i = 0; i < frames.length; i++) for (let j = i + 1; j < frames.length; j++) {
    const f = frames[i], g = frames[j]
    if (!concerns(f, g) || within(b(f), b(g), 0) || within(b(g), b(f), 0)) continue // one inside the other: nested
    const m = meet(b(f), b(g))
    if (m.w >= MIN && m.h >= MIN) add('frames-overlap', [f, g], `${name(f)} and ${name(g)} overlap, titles included: move one (its members come with it)`)
  }

  // what is in a frame stays inside it; what is not in one does not straddle its edge
  for (const s of solid) { // (an arrow may well run from a frame to what is outside it)
    if (isTitle(s)) continue
    const f = s.frameId && byId.get(s.frameId)
    const own = f && pageBounds(f)
    if (own && !within(pageBounds(s), own)) {
      if (concerns(s, f)) add('outside-frame', [s, f], `${name(s)} sticks out of ${name(f)}: move it inside; if there is no room, fit_frame ${f.id} ${s.id} shrinks what is in it to fit`)
      continue
    }
    for (const g of frames) {
      if (g.id === s.frameId || !concerns(s, g)) continue
      const gb = pageBounds(g), sb = pageBounds(s)
      const m = meet(sb, gb)
      if (m.w >= MIN && m.h >= MIN && !within(sb, gb) && !within(gb, sb)) add('straddles-frame', [s, g], `${name(s)} lies across the edge of ${name(g)}: if it belongs there, fit_frame ${g.id} ${s.id} brings it in (shrinking what is in it to fit); else move it clear`)
    }
  }

  // a label that does not fit its shape
  for (const s of solid) {
    if (s.type !== 'geo' || !s.props.label || !concerns(s)) continue
    const need = labelHeight(s), has = s.props.h * roomFor(s)
    if (need > has + 4) add('text-overflow', [s], `${name(s)}: its label needs about ${Math.ceil(need / roomFor(s))} of height, it is ${Math.round(s.props.h)}: make it taller or wider (update_shape w, h), or shorten the label`)
  }

  // right against a frame's edge, neither in it nor clear of it
  for (const s of solid) { // (an arrow may well run from a frame to what is outside it)
    if (isTitle(s)) continue
    const sb = pageBounds(s)
    for (const g of frames) {
      if (g.id === s.frameId || !concerns(s, g)) continue
      const gb = pageBounds(g)
      if (within(sb, gb) || within(gb, sb)) continue
      const m = meet(sb, gb), near = meet(sb, { x: gb.x - 8, y: gb.y - 8, w: gb.w + 16, h: gb.h + 16 })
      const across = m.w >= MIN && m.h >= MIN // reported above, as lying across the edge
      if (!across && ((near.w > MIN && near.h > 0) || (near.h > MIN && near.w > 0))) add('touches-frame', [s, g], `${name(s)} is right against the edge of ${name(g)}: if it belongs there, fit_frame ${g.id} ${s.id} brings it in (shrinking what is in it to fit); else leave a gap`)
    }
  }

  // an arrow across a shape it does not connect
  for (const a of shapes.filter(isLine)) {
    const p = { x: a.x, y: a.y }, q = { x: a.x + (a.props.dx ?? 0), y: a.y + (a.props.dy ?? 0) }
    const ends = new Set([a.link?.from, a.link?.to].filter(Boolean))
    for (const s of solid) {
      if (ends.has(s.id) || isTitle(s) || !concerns(a, s)) continue
      const r = shrink(pageBounds(s), 6)
      // an end on it: it points at it, connected or not
      const on = (pt) => pt.x >= r.x && pt.x <= r.x + r.w && pt.y >= r.y && pt.y <= r.y + r.h
      if (on(p) || on(q) || !crosses(p, q, r)) continue
      add('arrow-crosses', [a, s], `${name(a)} runs across ${name(s)}, which it does not connect: move that shape out of its way, or the shapes it connects`)
    }
  }
  return issues
}

/** issues as the model or a person reads them */
export function lintText(issues) {
  if (!issues.length) return 'No layout problems found.'
  return `${issues.length} layout problem${issues.length === 1 ? '' : 's'}:\n` + issues.map((i) => `- ${i.text}`).join('\n')
    + '\nFix yours (move_shape, arrange_shapes, fit_frame), then check again. Leave what people made where it is: move yours around it.'
}
