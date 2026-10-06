// A linter for a board's layout: what reads badly once drawn — shapes on top of
// each other, an arrow running across a shape it does not connect, something
// sticking out of its frame, frames on top of each other. It only reads, so an
// agent can draw first, then check and fix; `frame`, `ids` or `area` narrow it
// to what was just made (what else is there still counts, as what it runs into).
import { pageBounds, FONT_SIZES } from '@quickdrawjs/core'
import { isFrame } from 'quickdraw-frames'
import { runOp, textOf, isLabel } from './ops.js'
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
// the label's lines as the core wraps them at the box's width: their widths, and a line's height
function labelLines(s, w = s.props.w) {
  const fs = FONT_SIZES[s.props.labelSize || 's'] ?? 20
  const font = `500 ${fs}px sans-serif`
  const maxW = Math.max(24, w - LABEL_PAD * 2)
  const estimateWidth = width
  const lines = []
  for (const para of String(s.props.label).split('\n')) {
    let line = ''
    for (const word of para.split(/(\s+)/)) {
      const test = line + word
      if (line.trim() && estimateWidth(font, test) > maxW) { lines.push(line); line = word.trimStart() } else line = test
      while (estimateWidth(font, line) > maxW && line.length > 1) { // too wide alone: broken anywhere
        let cut = line.length - 1
        while (cut > 1 && estimateWidth(font, line.slice(0, cut)) > maxW) cut--
        lines.push(line.slice(0, cut)); line = line.slice(cut)
      }
    }
    lines.push(line)
  }
  return { widths: lines.map((l) => estimateWidth(font, l.trim())), lh: fs * 1.3 }
}
const labelHeight = (s) => { const { widths, lh } = labelLines(s); return widths.length * lh }
// A diamond or an ellipse narrows away from its middle: a line of its label
// that is wider than the shape where it sits spills out at the sides, however
// tall the shape is. Does the label fit a w × h shape of s's kind?
const NARROWS = { diamond: (k) => 1 - k, ellipse: (k) => Math.sqrt(Math.max(0, 1 - k * k)) } // width at k (0 middle, 1 top or bottom)
function sidesFit(s, w = s.props.w, h = s.props.h) {
  const at = NARROWS[s.props.geo]
  if (!at) return true
  const { widths, lh } = labelLines(s, w)
  const top = -(widths.length * lh) / 2
  return widths.every((lw, i) => {
    const edge = Math.max(Math.abs(top + i * lh), Math.abs(top + (i + 1) * lh)) // the line's edge farther from the middle
    return lw + 8 <= w * at(Math.min(1, (2 * edge) / h))
  })
}
// how much bigger (both ways) the shape must be for its label to fit at the sides
function sidesGrow(s) {
  for (let k = 1.1; k <= 3; k += 0.1) if (sidesFit(s, s.props.w * k, s.props.h * k)) return k
  return 3
}
// what of a shape's box its label may use: all of a rectangle's, less of the others'
const roomFor = (s) => (['rectangle', 'cloud', 'rhombus'].includes(s.props.geo) || !s.props.geo ? 1 : 0.8)

const shrink = (r, d) => ({ x: r.x + d, y: r.y + d, w: Math.max(0, r.w - d * 2), h: Math.max(0, r.h - d * 2) })

/**
 * Problems in how the board is laid out: [{ kind, ids, text }]. Narrowed by
 * `frame` (a frame id: its title, what is in it or on it), `ids`, or `area`
 * ({ x, y, w, h }); a problem is reported when one of those shapes is in it.
 */
// how a fix is named: as the board tools call it (agents on the board), or as
// the omq command does (agents with a shell)
const WORDS = {
  tools: { arrange: () => 'arrange_shapes them', fit: (f, s) => `fit_frame ${f} ${s}`, resize: () => 'update_shape w, h', bend: () => 'bend' },
  cli: { arrange: (ids) => `omq arrange ${ids}`, fit: (f, s) => `omq fit ${f} ${s}`, resize: (id) => `omq update ${id} --size WxH`, bend: (id) => `omq update ${id} --bend N` },
}

export function lintBoard(store, { frame, ids, area, words = 'tools' } = {}) {
  const say = WORDS[words] ?? WORDS.tools
  // a bento grid's area is the ground its cells (frames) stand on, not a shape among them
  const shapes = store.shapes().filter((s) => s.typeName === 'shape' && !s.isLayout)
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
    const label = isLabel(s) ? s : isLabel(t) ? t : null // it sits by its arrow: bend that, or move the shapes
    add('overlap', [s, t], label
      ? `${name(s)} and ${name(t)} overlap (${Math.round(m.w)} × ${Math.round(m.h)}): ${name(label)} is the label of arrow ${label.labelOf} and stays by it — bend that arrow (${say.bend(label.labelOf)}), or move the other shape`
      : `${name(s)} and ${name(t)} overlap (${Math.round(m.w)} × ${Math.round(m.h)}): move one clear, or ${say.arrange(`${s.id},${t.id}`)}`)
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
      if (concerns(s, f)) add('outside-frame', [s, f], `${name(s)} sticks out of ${name(f)}: move it inside; if there is no room, ${say.fit(f.id, s.id)} shrinks what is in it to fit`)
      continue
    }
    for (const g of frames) {
      if (g.id === s.frameId || !concerns(s, g)) continue
      const gb = pageBounds(g), sb = pageBounds(s)
      const m = meet(sb, gb)
      if (m.w >= MIN && m.h >= MIN && !within(sb, gb) && !within(gb, sb)) add('straddles-frame', [s, g], `${name(s)} lies across the edge of ${name(g)}: if it belongs there, ${say.fit(g.id, s.id)} brings it in (shrinking what is in it to fit); else move it clear`)
    }
  }

  // a label that does not fit its shape
  for (const s of solid) {
    if (s.type !== 'geo' || !s.props.label || !concerns(s)) continue
    const need = labelHeight(s), has = s.props.h * roomFor(s)
    if (need > has + 4) add('text-overflow', [s], `${name(s)}: its label needs about ${Math.ceil(need / roomFor(s))} of height, it is ${Math.round(s.props.h)}: make it taller or wider (${say.resize(s.id)}), or shorten the label`)
    else if (!sidesFit(s)) { const k = sidesGrow(s); add('text-overflow', [s], `${name(s)}: its label spills out at the sides (a ${s.props.geo} narrows away from its middle): make it about ${Math.ceil(s.props.w * k)} × ${Math.ceil(s.props.h * k)} (${say.resize(s.id)}), or shorten the label`) }
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
      if (!across && ((near.w > MIN && near.h > 0) || (near.h > MIN && near.w > 0))) add('touches-frame', [s, g], `${name(s)} is right against the edge of ${name(g)}: if it belongs there, ${say.fit(g.id, s.id)} brings it in (shrinking what is in it to fit); else leave a gap`)
    }
  }

  // an arrow across a shape it does not connect
  for (const a of shapes.filter(isLine)) {
    const p = { x: a.x, y: a.y }, q = { x: a.x + (a.props.dx ?? 0), y: a.y + (a.props.dy ?? 0) }
    const ends = new Set([a.link?.from, a.link?.to].filter(Boolean))
    for (const s of solid) {
      if (ends.has(s.id) || isTitle(s) || s.labelOf === a.id || !concerns(a, s)) continue
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

// ---- fixing ----------------------------------------------------------------------

const GAP = 16
const FIXABLE = new Set(['text-overflow', 'frames-overlap', 'overlap', 'outside-frame', 'straddles-frame', 'touches-frame'])
const centre = (r) => ({ x: r.x + r.w / 2, y: r.y + r.h / 2 })
// mostly in r: three quarters of it or more
const mostlyIn = (b, r) => { const m = meet(b, r); return m.w > 0 && m.h > 0 && m.w * m.h >= 0.75 * b.w * b.h }
// the way out of b for a: along the axis it is least into b, away from b's centre, clear by GAP
function apart(a, b) {
  const m = meet(a, b), ca = centre(a), cb = centre(b)
  return m.w <= m.h
    ? { dx: (ca.x < cb.x ? -1 : 1) * (m.w + GAP), dy: 0 }
    : { dx: 0, dy: (ca.y < cb.y ? -1 : 1) * (m.h + GAP) }
}

// the way to push a shape off another: of the four, the one that lands on the
// fewest other shapes, then sticks out of its frame least (fit_frame brings it
// back in, shrinking less when it sticks out less: a tall frame fills downwards),
// then moves it least
function bestWay(store, s, sb, ob) {
  const f = s.frameId && store.get(s.frameId)
  const fb = f && pageBounds(f)
  const others = store.shapes().filter((t) => t.id !== s.id && !isLine(t) && !isFrame(t) && !isFree(t) && !t.isLayout).map(pageBounds)
  const frames = store.shapes().filter((g) => isFrame(g) && g.id !== s.frameId).map(pageBounds) // not into another frame
  const ways = [
    { dx: ob.x - (sb.x + sb.w) - GAP, dy: 0 }, { dx: ob.x + ob.w + GAP - sb.x, dy: 0 },
    { dx: 0, dy: ob.y - (sb.y + sb.h) - GAP }, { dx: 0, dy: ob.y + ob.h + GAP - sb.y },
  ]
  const score = ({ dx, dy }) => {
    const r = { x: sb.x + dx, y: sb.y + dy, w: sb.w, h: sb.h }
    const lands = others.concat(frames).filter((o) => { const m = meet(r, o); return m.w > 0 && m.h > 0 }).length
    const out = fb ? Math.max(0, fb.x - r.x) + Math.max(0, r.x + r.w - fb.x - fb.w) + Math.max(0, fb.y - r.y) + Math.max(0, r.y + r.h - fb.y - fb.h) : 0
    return lands * 1e6 + out * 10 + Math.abs(dx) + Math.abs(dy)
  }
  return ways.reduce((a, b) => (score(b) < score(a) ? b : a))
}

/**
 * Fixes what can be fixed without a judgement, as one operation by `name`, on
 * what agents made only (never people's): labels too big for their shapes
 * (the shape grows), shapes and frames on top of each other (pushed apart),
 * what hangs over a frame's edge (brought in with fit_frame when it belongs
 * there — in it by its centre, or lined up with what is — else moved clear).
 * What is left, such as an arrow across a shape, is for the agent to fix.
 * Returns null when there is nothing it can fix, else the operation with
 * `fixed` (what it did, as text) and `left` (the issues still there).
 */
export function fixLayout(store, name, scope = {}) {
  const mine = (id) => { const s = store.get(id); return s?.agent && !isTitle(s) && !isLabel(s) ? s : null } // a label stays by its arrow
  const can = (i) => FIXABLE.has(i.kind) && i.ids.some((id) => mine(id) && (i.kind === 'frames-overlap' || !isFrame(store.get(id))))
  if (!lintBoard(store, scope).some(can)) return null
  const fixed = []
  const short = (s) => { const t = String(textOf(store, s) ?? '').split('\n')[0].trim(); return `${isFrame(s) ? 'frame' : s.type === 'geo' ? s.props.geo : s.type}${t ? ` "${t.slice(0, 30)}"` : ''} (${s.id})` }
  const op = runOp(store, name, (ops) => {
    const issues = () => lintBoard(store, scope)
    // labels: the shape grows to hold its label
    for (const i of issues().filter((i) => i.kind === 'text-overflow')) {
      const s = mine(i.ids[0])
      if (!s) continue
      if (labelHeight(s) > s.props.h * roomFor(s) + 4) {
        ops.update(s.id, { h: Math.ceil(labelHeight(s) / roomFor(s)) + 8 })
        fixed.push(`made ${short(s)} taller for its label`)
      }
      const now = store.get(s.id)
      if (!sidesFit(now)) { const k = sidesGrow(now); ops.update(s.id, { w: Math.ceil(now.props.w * k), h: Math.ceil(now.props.h * k) }); fixed.push(`made ${short(s)} bigger for its label`) }
    }
    // frames on top of each other: the later one moves, with what is in it
    for (const i of issues().filter((i) => i.kind === 'frames-overlap')) {
      const [f, g] = i.ids.map((id) => store.get(id))
      const move = mine(g.id) ?? mine(f.id)
      if (!move) continue
      const other = move === g ? f : g
      ops.move(move.id, apart(withTitle(store, move), withTitle(store, other)))
      fixed.push(`moved ${short(move)} off ${short(other)}`)
    }
    // a frame whose contents are on top of each other, all an agent's: laid out
    // afresh, in reading order, as the grid that suits the frame's shape best
    // (a tall frame: a column); fit_frame, below, shrinks it in if need be
    const crowded = new Set(issues().filter((i) => i.kind === 'overlap').map((i) => i.ids.map((id) => store.get(id)))
      .filter(([a, b]) => mine(a.id) && mine(b.id) && a.frameId && a.frameId === b.frameId).map(([a]) => a.frameId))
    for (const fid of crowded) {
      const f = store.get(fid), fb = pageBounds(f)
      const inside = (m) => mostlyIn(pageBounds(m), fb)
      const members = store.shapes().filter((m) => m.frameId === fid && !isTitle(m) && !isLine(m) && !isFree(m) && inside(m)) // not a heading that strayed onto it
      if (members.some((m) => !mine(m.id))) continue // people's work in it: pushed apart one by one instead
      const bs = members.map(pageBounds)
      const w = Math.max(...bs.map((b) => b.w)), h = Math.max(...bs.map((b) => b.h)), n = members.length, gap = 24
      let cols = 1, best = 0
      for (let c = 1; c <= n; c++) {
        const rows = Math.ceil(n / c)
        const k = Math.min((fb.w - 48 + gap) / (c * (w + gap)), (fb.h - 48 + gap) / (rows * (h + gap)))
        if (k > best + 1e-6) { best = k; cols = c }
      }
      ops.arrange(members.map((m) => m.id), { cols, gap, at: { x: fb.x + 24, y: fb.y + 24 } })
      fixed.push(`laid out what is in ${short(f)} afresh, ${Math.ceil(n / cols)} × ${cols}`)
    }

    // shapes on top of each other: pushed apart, a few rounds (one push may land on another)
    for (let round = 0; round < 30; round++) {
      const pair = issues().find((i) => i.kind === 'overlap' && i.ids.some(mine))
      if (!pair) break
      const [a, b] = pair.ids.map((id) => store.get(id))
      // the one to move: an agent's, the later of two in reading order
      const later = (pageBounds(a).y - pageBounds(b).y || pageBounds(a).x - pageBounds(b).x) > 0 ? a : b
      const move = mine(later.id) ? later : mine(a.id) ? a : b
      const other = move === a ? b : a
      const mb = pageBounds(move), ob = pageBounds(other)
      // off a frame's title, from outside the frame: up, above the title (not into the frame)
      const frameOf = isTitle(other) && store.get(other.frameId)
      const upward = frameOf && mb.y + mb.h / 2 < pageBounds(frameOf).y + GAP
      ops.move(move.id, upward ? { dx: 0, dy: ob.y - (mb.y + mb.h) - GAP } : bestWay(store, move, mb, ob))
      if (!fixed.includes(`moved ${short(move)} off ${short(other)}`)) fixed.push(`moved ${short(move)} off ${short(other)}`)
    }
    // over a frame's edge: brought in when it belongs there, else moved clear
    const bring = new Map() // frame id -> ids to fit in
    for (const i of issues().filter((i) => ['outside-frame', 'straddles-frame', 'touches-frame'].includes(i.kind))) {
      const [s, f] = i.ids.map((id) => store.get(id))
      if (!mine(s.id)) continue
      const sb = pageBounds(s), fb = pageBounds(f), c = centre(sb)
      const members = store.shapes().filter((m) => m.frameId === f.id && m.id !== s.id && !isTitle(m)).map(pageBounds)
      const lined = members.some((m) => meet(m, sb).w > sb.w / 2 || meet(m, sb).h > sb.h / 2)
      // in it by its centre, or lined up with what is in it (a member by position alone may be a heading that strayed)
      const belongs = (c.x > fb.x && c.x < fb.x + fb.w && c.y > fb.y && c.y < fb.y + fb.h) || lined
      if (belongs) bring.set(f.id, [...(bring.get(f.id) ?? []), s.id])
      else { ops.move(s.id, apart(sb, fb)); fixed.push(`moved ${short(s)} clear of ${short(f)}`) }
    }
    for (const [f, ids] of bring) {
      try {
        ops.fit(f, { ids })
        fixed.push(`fitted ${ids.map((id) => short(store.get(id))).join(', ')} into ${short(store.get(f))}`)
      } catch { /* it would take shrinking too far: left for the agent (a bigger frame, or several) */ }
    }
  })
  return { ...op, fixed, left: lintBoard(store, scope) }
}

/** what fixLayout did and what is left, as the model or a person reads it */
export function fixText(result) {
  const done = result.fixed.length ? `Fixed ${result.fixed.length} by itself:\n` + result.fixed.map((f) => `- ${f}`).join('\n') : 'Nothing could be fixed without you.'
  if (!result.left.length) return done + '\n\nNo layout problems left.'
  // what is left needs the agent: said first and plainly, so it is not taken for done
  return `NOT DONE: ${result.left.length} problem${result.left.length === 1 ? '' : 's'} left for you to fix, then call check_board again:\n`
    + result.left.map((i) => `- ${i.text}`).join('\n') + '\n\n' + done
}
