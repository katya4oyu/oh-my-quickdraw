// Arrows that follow what they connect. An arrow between two shapes keeps
// them as `link: { from, to }` (agents' arrows always have; ops.js), and is
// drawn again from edge to edge when either moves or changes size. On a page,
// bindArrows makes it so for what people do too:
// - a shape moved or resized: its linked arrows follow at once (while dragged);
// - an arrow drawn, or its end dragged, so that both ends land on shapes: it is
//   linked to them once let go (and drawn from edge to edge); dragged off one,
//   it is linked no more;
// - a shape removed: its arrows stay, linked no more;
// - an arrow moved, bent or re-routed: its label follows; removed: its label goes.
// Each page handles its own people's edits (as frames and kanbans do); an
// agent's operations reroute their own (ops.js), so nothing is done twice.
import { pageBounds } from '@quickdrawjs/core'
import { isFrame } from 'quickdraw-frames'
import { route, shapeAt, isLabel, labelsFollow } from './ops.js'

const isLine = (s) => s?.typeName === 'shape' && (s.type === 'arrow' || s.type === 'line')
const isTitle = (s) => !!s?.isFrameTitle
const same = (a, b) => a.x === b.x && a.y === b.y && a.w === b.w && a.h === b.h

/** The two shapes an arrow's ends land on (not frames, not other arrows), or null. */
export function arrowEnds(store, arrow) {
  const solid = store.shapes().filter((s) => s.typeName === 'shape' && !isLine(s) && !isFrame(s) && !isTitle(s) && !isLabel(s))
  const a = shapeAt(solid, arrow.x, arrow.y)
  const b = shapeAt(solid, arrow.x + arrow.props.dx, arrow.y + arrow.props.dy)
  return a && b && a.id !== b.id ? { from: a.id, to: b.id } : null
}

/** Where a linked arrow goes now, from edge to edge: { x, y, dx, dy }, or null when an end is gone. */
export function arrowRoute(store, arrow) {
  const a = arrow.link && store.get(arrow.link.from), b = arrow.link && store.get(arrow.link.to)
  return a && b ? route(store, [pageBounds(a), pageBounds(b)]) : null
}

const unlinked = (s) => { const { link, ...rest } = s; return rest }
const placed = (s, g) => ({ ...s, x: g.x, y: g.y, props: { ...s.props, dx: g.dx, dy: g.dy } })
const moves = (s, g) => Math.abs(g.x - s.x) + Math.abs(g.y - s.y) + Math.abs(g.dx - s.props.dx) + Math.abs(g.dy - s.props.dy) > 0.5

/** Arrows follow what they connect, for this page's edits. Returns an unbind. */
export function bindArrows(editor) {
  const { store } = editor
  let busy = false
  const drawn = new Set() // arrows this person drew or dragged: linked (or not) once let go
  const put = (recs, remove = []) => {
    if (!recs.length && !remove.length) return
    busy = true
    try { store.transact(() => { for (const r of recs) store.put(r); if (remove.length) store.remove(remove) }) } finally { busy = false }
  }
  // the labels of these arrows by them again (after they were put), and those of removed ones gone
  const labels = (lines, gone) => {
    const orphans = gone.size ? store.shapes().filter((l) => isLabel(l) && gone.has(l.labelOf)).map((l) => l.id) : []
    put(lines.size ? labelsFollow(store, lines) : [], orphans)
  }

  const off = store.listen((diff) => {
    if (busy) return
    const moved = new Set(), gone = new Set(Object.keys(diff.removed)), lines = new Set()
    for (const [id, r] of Object.entries(diff.added)) if (isLine(r)) drawn.add(id)
    for (const [id, [was, now]] of Object.entries(diff.updated)) {
      if (!now) continue
      if (isLine(now)) {
        if (was.x !== now.x || was.y !== now.y || was.props?.dx !== now.props?.dx || was.props?.dy !== now.props?.dy) drawn.add(id)
        if (was.x !== now.x || was.y !== now.y || was.props?.dx !== now.props?.dx || was.props?.dy !== now.props?.dy || was.props?.bend !== now.props?.bend) lines.add(id)
      } else if (!same(pageBounds(was), pageBounds(now))) moved.add(id)
    }
    if (!moved.size && !gone.size) return labels(lines, gone)
    const out = []
    for (const s of store.shapes()) {
      if (!isLine(s) || !s.link || drawn.has(s.id)) continue // one being dragged with them settles when let go
      if (gone.has(s.link.from) || gone.has(s.link.to)) { out.push(unlinked(s)); continue }
      if (!moved.has(s.link.from) && !moved.has(s.link.to)) continue
      const g = arrowRoute(store, s)
      if (g && moves(s, g)) { out.push(placed(s, g)); lines.add(s.id) }
    }
    put(out)
    labels(lines, gone)
  }, { source: 'user' })

  // let go: what was drawn or dragged is linked where both its ends land, else not
  function settle() {
    if (!drawn.size) return
    const ids = [...drawn]
    drawn.clear()
    const out = []
    for (const id of ids) {
      const s = store.get(id)
      if (!isLine(s)) continue
      const ends = arrowEnds(store, s)
      if (ends) {
        const linked = { ...s, link: ends }
        const g = arrowRoute(store, linked)
        out.push(g ? placed(linked, g) : linked)
      } else if (s.link) out.push(unlinked(s))
    }
    put(out)
    labels(new Set(ids), new Set())
  }
  const onUp = () => setTimeout(settle, 0) // after the core's own pointerup
  const c = editor.container
  c.addEventListener('pointerup', onUp)
  c.addEventListener('pointercancel', onUp)
  return () => {
    off()
    c.removeEventListener('pointerup', onUp)
    c.removeEventListener('pointercancel', onUp)
  }
}
