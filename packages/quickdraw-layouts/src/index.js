// Layouts that keep themselves: an area on the board whose frames stay laid
// out as they change, built from plain records with no core change. The first
// (and so far only) kind is a bento grid.
//
// An area is an unfilled, dashed geo rectangle marked `isLayout` (a frame
// takes it in only when it is wholly inside: quickdraw-frames), carrying
// `layout: { type: 'bento', cols, gap }`. Its width is fixed; its height
// follows its cells. Its cells are quickdraw-frames' own frames, marked
// `layoutId` (the area), `span: { c, r, auto? }` (in grid units) and `order`.
// A frame's members stay its members (`frameId`), so they move with its cell.
//
// bindLayouts keeps it consistent on local edits (each peer handles its own):
// - a cell resized snaps to whole units (never smaller than what is in it)
// - a cell dragged within its area moves there in the order; dragged out, it
//   is a plain frame again; a frame dropped into an area becomes a cell —
//   unless it lands wholly inside a cell: then it is a frame in that frame
//   (quickdraw-frames nests it), as is a cell dropped into another
// - whenever a cell comes, goes or changes span, the area packs its cells
//   again (as CSS Grid's dense flow does) and grows or shrinks to hold them
// - an `auto` cell grows and shrinks (in rows) with what is in it
// - moving an area moves its cells; resizing it changes the unit; deleting it
//   leaves its cells as plain frames
// Mid-gesture (a drag, a resize) nothing is packed: it happens on release.
import { pageBounds, composeDiff, newId } from '@quickdrawjs/core'
import { createFrame, isFrame } from 'quickdraw-frames'
import { packBento } from './bento.js'

export { packBento } from './bento.js'
export { layoutTools, LAYOUT_ICONS } from './tools.js'

export const isLayout = (rec) => !!rec && rec.isLayout === true
export const isCell = (rec) => isFrame(rec) && typeof rec.layoutId === 'string'

const PAD = 16 // the area's sides and bottom, around its cells
const TOP = 48 // above the first row: room for the cells' titles
const INSIDE = 16 // what is in a cell, from its edges
const isTitle = (rec) => rec.isFrameTitle === true || rec.id === rec.frameId + '-title'

// the grid of an area: where its cells go, and how big a unit is
function gridOf(area) {
  const { cols, gap } = area.layout
  const unit = Math.max(20, (area.props.w - PAD * 2 - gap * (cols - 1)) / cols)
  // rows have room for the next row's titles above them
  return { cols, gap, rowGap: Math.max(gap, TOP), unit, x: area.x + PAD, y: area.y + TOP }
}

const cellsOf = (store, layoutId) => store.shapes()
  .filter((s) => isCell(s) && s.layoutId === layoutId)
  .sort((a, b) => a.order - b.order || (a.id < b.id ? -1 : 1))

// what a cell holds (not its title)
const membersOf = (store, cellId) => store.shapes().filter((s) => s.frameId === cellId && !isTitle(s))

function extent(shapes) {
  if (!shapes.length) return null
  const bs = shapes.map(pageBounds)
  const x = Math.min(...bs.map((b) => b.x)), y = Math.min(...bs.map((b) => b.y))
  return { x, y, r: Math.max(...bs.map((b) => b.x + b.w)), b: Math.max(...bs.map((b) => b.y + b.h)) }
}

// units needed for a length, rounded (snap) or up (to hold something)
const unitsFor = (len, unit, gap, round = Math.round) => Math.max(1, round((len + gap) / (unit + gap) - 1e-6))

// the smallest span that holds what is in a cell, from where the cell's top-left is
function minSpan(g, shapes, origin) {
  const e = extent(shapes)
  if (!e) return { c: 1, r: 1 }
  return {
    c: Math.min(g.cols, unitsFor(e.r - origin.x + INSIDE, g.unit, g.gap, Math.ceil)),
    r: unitsFor(e.b - origin.y + INSIDE, g.unit, g.rowGap, Math.ceil),
  }
}

// Packs an area's cells and fits the area around them. `base`: for cells
// whose members did not follow them in this change (a resize), where the cell
// was, so its members move by the right amount.
function pack(store, layoutId, base = {}) {
  const area = store.get(layoutId)
  if (!isLayout(area)) return
  const g = gridOf(area)
  const cells = cellsOf(store, layoutId)
  for (const s of cells) { // auto cells: as many rows as what is in them needs
    if (!s.span.auto) continue
    const r = minSpan(g, membersOf(store, s.id), base[s.id] ?? s).r
    if (r !== s.span.r) store.update(s.id, { span: { ...s.span, r } })
  }
  const { places, rows } = packBento(cellsOf(store, layoutId).map((s) => ({ id: s.id, c: s.span.c, r: s.span.r })), g.cols)
  for (const p of places) {
    const s = store.get(p.id)
    const x = g.x + p.col * (g.unit + g.gap), y = g.y + p.row * (g.unit + g.rowGap)
    const w = p.c * g.unit + (p.c - 1) * g.gap, h = p.r * g.unit + (p.r - 1) * g.rowGap
    const from = base[s.id] ?? s
    const dx = x - from.x, dy = y - from.y
    if (s.x === x && s.y === y && s.props.w === w && s.props.h === h && !dx && !dy) continue
    store.update(s.id, { x, y, props: { w, h } })
    // the cell's title and what is in it come along
    for (const m of store.shapes()) {
      if (m.frameId !== s.id) continue
      if (isTitle(m)) store.update(m.id, { x, y: y - 34 })
      else if (dx || dy) store.update(m.id, { x: m.x + dx, y: m.y + dy })
    }
  }
  const h = TOP + Math.max(1, rows) * (g.unit + g.rowGap) - g.rowGap + PAD
  if (area.props.h !== h) store.update(layoutId, { props: { h } })
}

// a cell (not s itself, nor one inside it) that holds all of s: s goes in it, not into the grid
function cellHolding(store, s) {
  const b = pageBounds(s)
  return store.shapes().find((c) => isCell(c) && c.id !== s.id && c.frameId !== s.id
    && b.x >= c.x && b.y >= c.y && b.x + b.w <= c.x + c.props.w && b.y + b.h <= c.y + c.props.h) ?? null
}

// the area whose inside holds a point, the topmost first
function areaAt(store, x, y) {
  let best = null
  for (const a of store.shapes()) {
    if (!isLayout(a)) continue
    if (x >= a.x && x <= a.x + a.props.w && y >= a.y && y <= a.y + a.props.h && (!best || a.z > best.z)) best = a
  }
  return best
}

// is a cell exactly the size its span makes (packing sized it, not a person)?
function fitsSpan(g, s) {
  const c = Math.min(g.cols, s.span.c)
  return Math.abs(s.props.w - (c * g.unit + (c - 1) * g.gap)) < 0.5 && Math.abs(s.props.h - (s.span.r * g.unit + (s.span.r - 1) * g.rowGap)) < 0.5
}

// is a cell where packing puts it (moved by packing, not dragged)?
function atSlot(store, area, s) {
  const g = gridOf(area)
  const { places } = packBento(cellsOf(store, area.id).map((c) => ({ id: c.id, c: c.span.c, r: c.span.r })), g.cols)
  const p = places.find((q) => q.id === s.id)
  return !!p && fitsSpan(g, s) && Math.abs(s.x - (g.x + p.col * (g.unit + g.gap))) < 0.5 && Math.abs(s.y - (g.y + p.row * (g.unit + g.rowGap))) < 0.5
}

// the grid slot under a point in an area
function slotAt(g, x, y) {
  return {
    col: Math.min(g.cols - 1, Math.max(0, Math.floor((x - g.x + g.gap / 2) / (g.unit + g.gap)))),
    row: Math.max(0, Math.floor((y - g.y + g.rowGap / 2) / (g.unit + g.rowGap))),
  }
}

// Puts a cell (already marked with the area) where a point is in its area's
// order: before the cell packed at that slot, or last.
function placeAt(store, cellId, x, y) {
  const cell = store.get(cellId)
  const area = store.get(cell.layoutId)
  const g = gridOf(area)
  const slot = slotAt(g, x, y)
  const others = cellsOf(store, area.id).filter((s) => s.id !== cellId)
  const { places } = packBento(others.map((s) => ({ id: s.id, c: s.span.c, r: s.span.r })), g.cols)
  const at = places.find((p) => slot.col >= p.col && slot.col < p.col + p.c && slot.row >= p.row && slot.row < p.row + p.r)
    ?? places.find((p) => p.row > slot.row || (p.row === slot.row && p.col > slot.col))
  const order = [...others]
  order.splice(at ? others.findIndex((s) => s.id === at.id) : others.length, 0, cell)
  order.forEach((s, i) => { if (s.order !== i) store.update(s.id, { order: i }) })
}

function leave(store, s) {
  const { layoutId: _, span: __, order: ___, ...rest } = s
  store.put(rest)
}

/**
 * A bento area with its top-left at x, y: `w` wide (its height follows its
 * cells), `cols` columns, `gap` between cells. Returns its id.
 */
export function createLayout(store, { x, y, w = 1200, cols = 4, gap = 24 }) {
  const id = newId()
  store.transact(() => {
    store.put({
      id, typeName: 'shape', type: 'geo', isLayout: true, frameless: true, layout: { type: 'bento', cols: Math.max(1, Math.floor(cols)), gap }, x, y, rot: 0, z: store.minZ() - 1,
      props: { geo: 'rectangle', w, h: 200, color: 'grey', size: 's', dash: 'dashed', fill: 'none', font: 'sans' },
    })
    pack(store, id)
  })
  return id
}

/**
 * A new cell (a frame) at the end of an area: c × r units, `auto` to follow
 * what is in it. Returns the frame's id.
 */
export function addCell(store, layoutId, { c = 1, r = 1, title = 'Frame', auto = false } = {}) {
  const area = store.get(layoutId)
  if (!isLayout(area)) throw new Error(`${layoutId} is not a layout`)
  const g = gridOf(area)
  const cells = cellsOf(store, layoutId)
  const span = { c: Math.min(g.cols, Math.max(1, Math.round(c))), r: Math.max(1, Math.round(r)), ...(auto ? { auto: true } : {}) }
  // made where it will go, so it takes in nothing on the way
  const { places } = packBento([...cells.map((s) => ({ id: s.id, c: s.span.c, r: s.span.r })), { id: '', ...span }], g.cols)
  const p = places.at(-1)
  let id
  store.transact(() => {
    id = createFrame(store, {
      x: g.x + p.col * (g.unit + g.gap), y: g.y + p.row * (g.unit + g.rowGap),
      w: span.c * g.unit + (span.c - 1) * g.gap, h: span.r * g.unit + (span.r - 1) * g.rowGap, title,
    })
    store.update(id, { layoutId, span, order: cells.length ? cells.at(-1).order + 1 : 0 })
    pack(store, layoutId)
  })
  return id
}

// Sets a cell's span (any of c, r, auto), and packs its area again.
export function setSpan(store, cellId, { c, r, auto } = {}) {
  const s = store.get(cellId)
  if (!isCell(s)) throw new Error(`${cellId} is not in a layout`)
  const span = { c: c ?? s.span.c, r: r ?? s.span.r }
  if (auto ?? s.span.auto) span.auto = true
  store.transact(() => {
    store.update(cellId, { span })
    pack(store, s.layoutId)
  })
}

// Sets an area's columns, and packs it again (spans wider than it are cut to it).
export function setColumns(store, layoutId, cols) {
  const a = store.get(layoutId)
  if (!isLayout(a)) throw new Error(`${layoutId} is not a layout`)
  store.transact(() => {
    store.update(layoutId, { layout: { ...a.layout, cols: Math.max(1, Math.floor(cols)) } })
    pack(store, layoutId)
  })
}

// Packs an area again, from its records.
export function reflow(store, layoutId) {
  store.transact(() => pack(store, layoutId))
}

// stores whose changes are already laid out (see settled)
const quiet = new WeakSet()

// Runs fn with bindLayouts paying no attention: for changes already laid out
// elsewhere, put on the board a piece at a time (an agent's operation, made on
// a copy), whose halfway states must not be read as drags.
export function settled(store, fn) {
  if (quiet.has(store)) return fn()
  quiet.add(store)
  try { return fn() } finally { quiet.delete(store) }
}

export function bindLayouts(store) {
  let busy = false
  let pending = null // changes held back until the gesture ends

  function handle(diff) {
    const before = store.undos.length
    busy = true
    try {
      store.transact(() => apply(diff))
    } finally { busy = false }
    // outside a gesture batch our follow-up is its own history entry: fold it
    // into the change it follows, so one undo takes both back
    if (store.undos.length === before + 1 && before > 0) {
      const ours = store.undos.pop()
      store.undos.push(composeDiff(store.undos.pop(), ours))
    }
  }

  function apply(diff) {
    const dirty = new Set() // areas to pack
    const base = {} // cells whose members stayed behind: where they were
    // deleted areas leave their cells as plain frames; deleted cells leave a gap
    for (const [id, rec] of Object.entries(diff.removed)) {
      if (isLayout(rec)) for (const s of store.shapes()) if (s.layoutId === id) leave(store, s)
      if (isCell(rec)) dirty.add(rec.layoutId)
      if (rec.frameId && isCell(store.get(rec.frameId))) dirty.add(store.get(rec.frameId).layoutId)
    }
    for (const id of [...Object.keys(diff.added), ...Object.keys(diff.updated)]) {
      const s = store.get(id)
      if (!s) continue
      const [from] = diff.updated[id] || []
      if (isLayout(s)) {
        // moved, resized, or new columns: packing puts its cells (and what is in them) in place
        if (!from || from.x !== s.x || from.y !== s.y || from.props.w !== s.props.w || from.props.h !== s.props.h || from.layout !== s.layout) dirty.add(id)
        continue
      }
      if (isFrame(s) && !isTitle(s)) {
        const moved = !from || from.x !== s.x || from.y !== s.y
        const resized = from && (from.props.w !== s.props.w || from.props.h !== s.props.h)
        if (isCell(s)) {
          const area = store.get(s.layoutId)
          if (!isLayout(area)) { leave(store, s); continue }
          if (!from) {
            // a copy (paste, duplicate, import) keeps its area: it goes where it landed in the order
            const b = pageBounds(s)
            placeAt(store, id, b.x + b.w / 2, b.y + b.h / 2)
            dirty.add(area.id)
          } else if (resized && !fitsSpan(gridOf(area), s)) {
            // a person resized it: members stay where they were; snap to units, never below what it holds
            const g = gridOf(area)
            base[id] = { x: from.x, y: from.y }
            const held = [...membersOf(store, id), ...Object.values(diff.updated).filter(([f, t]) => f.frameId === id && !t.frameId && !isTitle(f)).map(([, t]) => t)]
            const min = minSpan(g, held, from)
            const c = Math.min(g.cols, Math.max(min.c, unitsFor(s.props.w, g.unit, g.gap)))
            const r = Math.max(min.r, unitsFor(s.props.h, g.unit, g.rowGap))
            store.update(id, { span: { ...s.span, c, r } })
            dirty.add(area.id)
          } else if (moved && !atSlot(store, area, s) && cellHolding(store, s)) {
            leave(store, s) // dropped into another cell: a frame in it now
            dirty.add(area.id)
          } else if (moved && !atSlot(store, area, s)) {
            const b = pageBounds(s)
            const cx = b.x + b.w / 2, cy = b.y + b.h / 2
            const to = areaAt(store, cx, cy)
            if (to?.id === area.id) placeAt(store, id, cx, cy)
            else if (to) { store.update(id, { layoutId: to.id }); placeAt(store, id, cx, cy); dirty.add(to.id) }
            else leave(store, s)
            dirty.add(area.id)
          } else if (from && (from.span !== s.span || from.order !== s.order)) dirty.add(area.id)
          continue
        }
        // a frame dropped into an area joins it, at its size in units (wholly inside a cell: it is in that cell)
        if (moved && !cellHolding(store, s)) {
          const b = pageBounds(s)
          const cx = b.x + b.w / 2, cy = b.y + b.h / 2
          const to = areaAt(store, cx, cy)
          if (!to) continue
          const g = gridOf(to)
          const min = minSpan(g, membersOf(store, id), s)
          const c = Math.min(g.cols, Math.max(min.c, unitsFor(s.props.w, g.unit, g.gap)))
          const r = Math.max(min.r, unitsFor(s.props.h, g.unit, g.rowGap))
          // a cell's size is the grid's: an aspect ratio would fight it
          const { aspect: _, ...plain } = s
          store.put({ ...plain, layoutId: to.id, span: { c, r }, order: Infinity })
          placeAt(store, id, cx, cy)
          dirty.add(to.id)
        }
        continue
      }
      // what is in an auto cell changed: it may need more or fewer rows
      const cell = store.get(s.frameId) ?? (from?.frameId && store.get(from.frameId))
      if (isCell(cell) && cell.span.auto) dirty.add(cell.layoutId)
      if (from?.frameId && from.frameId !== s.frameId) {
        const was = store.get(from.frameId)
        if (isCell(was) && was.span.auto) dirty.add(was.layoutId)
      }
    }
    for (const id of dirty) pack(store, id, base)
  }

  const offDoc = store.listen((diff) => {
    // undo and redo bring back a state already laid out (our follow-ups are
    // in the same history entry): reading their moves as drags would reorder
    if (busy || quiet.has(store) || store._applyingHistory) return
    pending = pending ? composeDiff(pending, diff) : diff
    // mid-gesture (the core's open history batch): wait for the release, so a
    // dragged cell is not pulled back under the pointer
    if (store._batch) return
    const d = pending
    pending = null
    handle(d)
  }, { source: 'user' })
  // the end of a gesture emits no document change of its own
  const offHistory = store.listenHistory(() => {
    if (!pending || busy || store._batch) return
    const d = pending
    pending = null
    handle(d)
  })
  return () => { offDoc(); offHistory() }
}
