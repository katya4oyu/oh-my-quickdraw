// What an agent can do on a board, over a core Store: read it (as data or a
// Markdown outline), and change it in operations. Every operation is one
// store transaction whose diff is returned, so it can be logged and undone.
// Shapes the agent adds carry `agent: { name, op }`; it may move and edit
// anything, but delete only what an agent added.
import { newId, pageBounds, scaleShape, COLOR_IDS, GEO_IDS, SIZE_IDS, DASH_IDS, FILL_IDS, FONT_SIZES } from '@quickdrawjs/core'
import { createFrame, frameTitle, freeSpot, inFrame, isFrame, renameFrame } from 'quickdraw-frames'
export { freeSpot } // free space for something, by where it is wanted (quickdraw-frames)
import { createMarkdown, TYPE as MARKDOWN } from 'quickdraw-markdown'
import { createEmbed, validateEmbed, TYPE as EMBED } from 'quickdraw-embed'
import { createBoardCard, validateBoardCard, TYPE as BOARDCARD } from 'quickdraw-boards'
import { createLayout, addCell, setSpan, setColumns, isLayout, isCell } from 'quickdraw-layouts'
import { createTicket, isColumn, registerTicket, kanbanColumn, placeInColumn, setTicketStatus, TYPE as TICKET } from 'quickdraw-tickets'
import { estimateWidth } from './measure.js'

const GAP = 40
const PAD = 24 // inside a frame's edges
const MIN_FIT = 0.3 // smaller than this and notes stop being readable
const round = (n) => Math.round(n)
const emptyDiff = () => ({ added: {}, removed: {}, updated: {} })
const isTitle = (s) => s.isFrameTitle === true || s.id === s.frameId + '-title'
const isLine = (s) => s.type === 'arrow' || s.type === 'line'
/** A text that is an arrow's label (`labelOf`: the arrow's id): it sits by the arrow's middle and follows it. */
export const isLabel = (s) => typeof s?.labelOf === 'string'

// ---- reading -------------------------------------------------------------------

export function textOf(store, s) {
  switch (s.type) {
    case 'text': case 'note': return s.props.text
    case 'geo': return isFrame(s) ? frameTitle(store, s.id) : s.props.label
    case MARKDOWN: return s.props.md
    case TICKET: return s.props.title + (s.props.body ? '\n' + s.props.body : '')
    case EMBED: return s.props.title || s.props.preview?.title || s.props.url || (s.props.kind === 'html' ? '(HTML)' : '')
    case 'member': return s.props.name + (s.props.role ? ` — ${s.props.role}` : '') // a profile card (quickdraw-members)
    case BOARDCARD: return `${s.props.title} (board ${s.props.board}${s.props.live ? ', live' : ''})` // a board in this board (quickdraw-boards)
    case 'image': return '(image)'
    case 'draw': case 'highlight': return '(drawing)'
    default: return ''
  }
}

function box(s) {
  const b = pageBounds(s)
  return { x: round(b.x), y: round(b.y), w: round(b.w), h: round(b.h) }
}

// the shape an arrow end touches: the smallest one within reach of the point
export function shapeAt(shapes, x, y, reach = 16) {
  let best = null, area = Infinity
  for (const s of shapes) {
    const b = pageBounds(s)
    if (x < b.x - reach || x > b.x + b.w + reach || y < b.y - reach || y > b.y + b.h + reach) continue
    if (b.w * b.h < area) { best = s; area = b.w * b.h }
  }
  return best
}

// reading order: rows of ~40px, left to right
const byPosition = (a, b) => Math.round(a.y / 40) - Math.round(b.y / 40) || a.x - b.x

// The board as data: frames with their members, other shapes, and which
// shapes the arrows connect (by where their ends land).
export function describeBoard(store) {
  const shapes = store.shapes().filter((s) => s.typeName === 'shape')
  const solid = shapes.filter((s) => !isLine(s) && !isFrame(s) && !isTitle(s))
  // a snapshot (quickdraw-screenshare): a frame holding a still of a shared screen
  const stills = new Set(shapes.filter((f) => isFrame(f) && f.snapshot?.imageId).map((f) => f.snapshot.imageId))
  const frames = shapes.filter(isFrame).map((f) => ({
    id: f.id, title: frameTitle(store, f.id), ...(f.aspect ? { aspect: f.aspect } : {}), ...box(f),
    ...(isCell(f) ? { cell: { layout: f.layoutId, c: f.span.c, r: f.span.r, ...(f.span.auto ? { auto: true } : {}) } } : {}), // a bento cell (quickdraw-layouts)
    ...(typeof f.snapshot?.at === 'number' ? { snapshot: { at: f.snapshot.at, by: f.snapshot.by ?? '' } } : {}),
    ...(isColumn(f) ? { kanban: { id: f.kanban.id, status: f.kanban.status } } : {}), // a kanban's column (quickdraw-tickets)
    ...(f.frameId && isFrame(store.get(f.frameId)) ? { frame: f.frameId } : {}), // in another frame
    ...(f.titleInside ? { title_inside: true } : {}),
    members: shapes.filter((s) => s.frameId === f.id && !isTitle(s) && !isLine(s)).map((s) => s.id), // arrows: see `arrows`
  })).sort(byPosition)
  // bento grids (quickdraw-layouts): their cells are frames, in order
  const layouts = shapes.filter(isLayout).map((a) => ({
    id: a.id, type: a.layout.type, cols: a.layout.cols, ...box(a), ...(a.frameId && isFrame(store.get(a.frameId)) ? { frame: a.frameId } : {}),
    cells: shapes.filter((f) => isCell(f) && f.layoutId === a.id).sort((p, q) => p.order - q.order).map((f) => f.id),
  })).sort(byPosition)
  const items = shapes.filter((s) => !isFrame(s) && !isTitle(s) && !isLine(s) && !isLayout(s) && !isLabel(s)).map((s) => ({
    id: s.id, type: s.type === 'geo' ? s.props.geo : s.type, text: stills.has(s.id) ? '(screenshot)' : textOf(store, s), ...box(s),
    ...(s.props.color ? { color: s.props.color } : {}),
    ...(s.frameId ? { frame: s.frameId } : {}),
    // who made it (an agent, or a person whose page marked it), and who changed it last if not them
    ...((s.made?.by ?? s.agent?.name) ? { by: s.made?.by ?? s.agent.name } : {}),
    ...(s.edited?.by && s.edited.by !== (s.made?.by ?? s.agent?.name) ? { edited_by: s.edited.by } : {}),
    ...(s.type === TICKET ? { ticket: { status: s.props.status, to: s.props.to ?? null, by: s.props.by ?? null, ...(s.props.result ? { result: s.props.result } : {}), ...(s.props.work?.area ? { area: s.props.work.area } : {}) } } : {}),
  })).sort(byPosition)
  const ends = solid.filter((s) => !isLabel(s))
  const labels = new Map(shapes.filter(isLabel).map((l) => [l.labelOf, l]))
  const arrows = shapes.filter(isLine).map((s) => {
    const from = shapeAt(ends, s.x, s.y), to = shapeAt(ends, s.x + s.props.dx, s.y + s.props.dy)
    const label = labels.get(s.id)
    return { id: s.id, type: s.type, ...(from ? { from: from.id } : {}), ...(to ? { to: to.id } : {}), ...(label ? { label: label.props.text, label_id: label.id } : {}) }
  })
  return { ...(layouts.length ? { layouts } : {}), frames, items, arrows }
}

// The board as a Markdown outline, for reading and summarizing.
export function boardToMarkdown(store) {
  const { layouts = [], frames, items, arrows } = describeBoard(store)
  const byId = new Map(items.map((it) => [it.id, it]))
  const line = (it) => {
    const text = String(it.text ?? '').trim()
    const tag = `[${it.type}${it.by ? `, by ${it.by}` : ''}${it.edited_by ? `, edited by ${it.edited_by}` : ''}] `
    if (it.ticket) {
      const t = it.ticket
      const who = t.status === 'todo' ? ` → ${t.to ?? 'any agent'}` : t.by ? `, ${t.by}` : ''
      // an agent at work on a request: where (others keep out)
      const where = t.status === 'doing' && t.area ? `, working in x ${Math.round(t.area.x)}, y ${Math.round(t.area.y)}, ${Math.round(t.area.w)} × ${Math.round(t.area.h)}` : ''
      return `- [ticket, ${t.status}${who}${where}] ${text.replace(/\s*\n\s*/g, ' / ') || '(empty)'}${t.result ? ` — ${t.result.replace(/\s*\n\s*/g, ' / ')}` : ''} (id ${it.id})`
    }
    if (it.type === MARKDOWN) return `- ${tag}(id ${it.id})\n` + text.split('\n').map((l) => '  > ' + l).join('\n')
    return `- ${tag}${text.replace(/\s*\n\s*/g, ' / ') || '(empty)'} (id ${it.id})`
  }
  const out = ['# Board', '']
  const titles = new Map(frames.map((f) => [f.id, f.title || 'Frame']))
  for (const l of layouts) {
    out.push(`## Bento grid (${l.cols} columns; id ${l.id})`, '', 'Its cells are frames that pack themselves: widen one (span) and the rest move along.', '',
      ...(l.cells.length ? l.cells.map((id) => `- ${titles.get(id)} (cell; id ${id})`) : ['- (no cells)']), '')
  }
  // frames in frames: under the frame they are in, a heading level down
  const framesById = new Map(frames.map((f) => [f.id, f]))
  const section = (f, depth) => {
    const kind = f.snapshot ? 'snapshot of a shared screen; its notes and marks are feedback'
      : f.kanban ? `kanban column: ${f.kanban.status} tickets`
      : f.cell ? `bento cell ${f.cell.c}×${f.cell.r}${f.cell.auto ? ', rows follow its contents' : ''} in ${f.cell.layout}`
      : `frame${f.aspect ? `, ${ratio(f.aspect)}` : ''}`
    const inside = f.frame ? `, in ${titles.get(f.frame)}` : ''
    out.push(`${'#'.repeat(Math.min(6, depth))} ${f.title || 'Frame'} (${kind}${inside}; id ${f.id})`, '')
    const members = f.members.map((id) => byId.get(id)).filter(Boolean)
    const children = f.members.map((id) => framesById.get(id)).filter(Boolean)
    out.push(...(members.length ? members.map(line) : children.length ? [] : ['- (empty)']), ...(members.length || !children.length ? [''] : []))
    for (const c of children) section(c, depth + 1)
  }
  for (const f of frames) if (!f.frame || !framesById.has(f.frame)) section(f, 2)
  const loose = items.filter((it) => !it.frame)
  if (loose.length) out.push(frames.length ? '## Outside frames' : '## Shapes', '', ...loose.map(line), '')
  const links = arrows.filter((a) => a.from && a.to)
  if (links.length) {
    const name = (id) => (String(byId.get(id)?.text ?? '').split('\n')[0].slice(0, 40) || id)
    out.push('## Connections', '', ...links.map((a) => `- ${name(a.from)} → ${name(a.to)}${a.label ? ` ("${a.label.replace(/\s*\n\s*/g, ' / ')}", arrow ${a.id})` : ''}`), '')
  }
  if (!frames.length && !items.length) out.push('(empty board)', '')
  return out.join('\n')
}

const RATIOS = { '16:9': 16 / 9, '16:10': 16 / 10, '4:3': 4 / 3, '1:1': 1 }
const ratio = (a) => Object.entries(RATIOS).find(([, v]) => Math.abs(v - a) < 1e-3)?.[0] ?? a.toFixed(2)
export function parseRatio(s) {
  if (s == null || s === '' || s === 'free') return null
  if (typeof s === 'number') return s
  const [w, h] = String(s).split(':').map(Number)
  if (!(w > 0 && h > 0)) throw new Error(`bad aspect ratio "${s}" (like 16:9)`)
  return w / h
}

// ---- writing -------------------------------------------------------------------

const intersects = (a, b, pad = 0) => a.x < b.x + b.w + pad && a.x + a.w + pad > b.x && a.y < b.y + b.h + pad && a.y + a.h + pad > b.y

function checkColor(color) {
  if (color != null && !COLOR_IDS.includes(color)) throw new Error(`unknown color "${color}" (one of ${COLOR_IDS.join(', ')})`)
  return color
}
const oneOf = (what, all) => (v) => {
  if (v != null && !all.includes(v)) throw new Error(`unknown ${what} "${v}" (one of ${all.join(', ')})`)
  return v
}
const checkSize = oneOf('text size', SIZE_IDS), checkDash = oneOf('line style', DASH_IDS), checkFill = oneOf('fill', FILL_IDS)
function checkBend(bend) {
  if (bend != null && !Number.isFinite(Number(bend))) throw new Error(`a bend is a number (how far the middle bows out), not "${bend}"`)
  return bend == null ? bend : Number(bend)
}
// a text's size on the page, estimated: its widest line, and a line's height per line
function textBox(text, size = 'm') {
  const fs = FONT_SIZES[size], lines = String(text).split('\n')
  return { w: Math.max(...lines.map((l) => estimateWidth(`${fs}px sans-serif`, l))), h: Math.round(fs * 1.4) * lines.length }
}

/** A point on an arrow at `t` (0 start, 1 end): on its curve when bent (the core's: a quadratic whose control point is the middle + the normal × 2 bend). */
export function pointOnArrow(arrow, t) {
  const { dx, dy } = arrow.props, bend = arrow.props.bend || 0
  const len = Math.hypot(dx, dy) || 1
  const cx = dx / 2 + (-dy / len) * bend * 2, cy = dy / 2 + (dx / len) * bend * 2
  const u = 1 - t
  return { x: arrow.x + 2 * u * t * cx + t * t * dx, y: arrow.y + 2 * u * t * cy + t * t * dy }
}
/** An arrow as a polyline (its curve, when bent), for what it runs across. */
export const arrowPath = (arrow, n = 16) => Array.from({ length: n + 1 }, (_, i) => pointOnArrow(arrow, i / n))

/**
 * Where an arrow's label goes (its top-left corner), for a label `w` × `h`: by
 * the arrow's middle (the curve's, when bent), just clear of the line — on the
 * side it bows to, else above it (right of it, when it runs up or down).
 * When it lands on something, lint says so (bend the arrow, or move a shape).
 */
export function labelSpot(arrow, w, h) {
  const { dx, dy } = arrow.props, bend = arrow.props.bend || 0
  const len = Math.hypot(dx, dy) || 1
  const nx = -dy / len, ny = dx / len // the core's normal: a bend bows that way
  const side = bend ? Math.sign(bend) : Math.abs(ny) >= 0.5 ? -Math.sign(ny) : (nx >= 0 ? 1 : -1)
  const p = pointOnArrow(arrow, 0.5), ox = nx * side, oy = ny * side
  const reach = Math.abs(ox) * w / 2 + Math.abs(oy) * h / 2 + 8
  return { x: round(p.x + ox * reach - w / 2), y: round(p.y + oy * reach - h / 2) }
}

/** Puts arrows' labels by their arrows again (all of them, or those of `arrowIds`), wrapped to fit beside them; returns the records that changed. */
export function labelsFollow(store, arrowIds) {
  const out = []
  for (const l of store.shapes()) {
    if (!isLabel(l) || (arrowIds && !arrowIds.has(l.labelOf))) continue
    const a = store.get(l.labelOf)
    if (!a || !isLine(a)) continue
    // beside a line that runs across, it may be no wider than the line is long (else it lies on the shapes
    // at its ends): wrapped to that width, words as they are; beside one that runs up or down, one line
    const { dx, dy } = a.props
    const across = Math.abs(dx) >= Math.abs(dy), room = Math.max(60, Math.hypot(dx, dy) - 16)
    const natural = textBox(l.props.text, l.props.size).w + 2
    const wrap = across && natural > room
    const props = wrap ? { ...l.props, autosize: false, w: Math.round(room) } : { ...l.props, autosize: true }
    const fitted = wrap === (l.props.autosize === false) && (!wrap || l.props.w === props.w) ? l : { ...l, props }
    const b = pageBounds(fitted)
    const at = labelSpot(a, b.w, b.h)
    if (fitted !== l || Math.abs(at.x - b.x) + Math.abs(at.y - b.y) > 0.5) out.push({ ...fitted, x: fitted.x + at.x - b.x, y: fitted.y + at.y - b.y })
  }
  return out
}

// The operations, bound to one op: what it adds is marked with it. `area`: a
// work area ({ x, y, w, h }) where what is added without a place goes; it
// grows downwards (unlike a frame) when full, see area().
function operations(store, name, op, { area: startArea, prefer } = {}) {
  const agent = { name, op }
  let column = null // where this op's unplaced shapes stack: { x, y, w, count }
  let nearLast = null // the last one placed near `prefer`
  let focus = null
  const area = startArea ? { ...startArea } : null

  // the Todo column of the kanban highest up and furthest left, if any
  const firstKanbanTodo = () => {
    const first = store.shapes().filter(isColumn).sort(byPosition)[0]
    return first ? kanbanColumn(store, first.kanban.id, 'todo') : null
  }

  const need = (id) => {
    const s = store.get(id)
    if (!s || s.typeName !== 'shape') throw new Error(`no shape ${id}`)
    return s
  }

  // A free spot for a w×h shape: inside a frame's grid, or in a column to the
  // right of everything, stacking down (and over) within one operation.
  function place(w, h, { inFrame } = {}) {
    if (inFrame) {
      const f = need(inFrame)
      if (!isFrame(f)) throw new Error(`${inFrame} is not a frame`)
      const fb = pageBounds(f)
      // its members, and what lies on it but is not one yet: what this operation
      // put there (membership follows only once the operation is done)
      // (not the frames it is in: they hold it all)
      const around = (s) => (isFrame(s) || isLayout(s)) && (() => { const b = pageBounds(s); return b.x <= fb.x && b.y <= fb.y && b.x + b.w >= fb.x + fb.w && b.y + b.h >= fb.y + fb.h })()
      const taken = store.shapes()
        .filter((s) => s.id !== f.id && (!isTitle(s) || (f.titleInside && s.id === f.id + '-title')) && !isLayout(s) && !around(s) && (s.frameId === f.id || intersects(pageBounds(s), fb))) // its title, when inside it, is in the way too
        .map(pageBounds)
      for (let y = fb.y + 24; y + h <= fb.y + fb.h - 16; y += 24) {
        for (let x = fb.x + 24; x + w <= fb.x + fb.w - 16; x += 24) {
          const r = { x, y, w, h }
          if (!taken.some((t) => intersects(r, t, 16))) return { x, y }
        }
      }
      // full: never grown (its size may be the point, like a 16:9 slide) nor piled up
      // a bento cell makes room: a row more (the cells after it move along)
      if (isCell(f)) {
        if (f.span.r >= 20) throw new Error(`cell ${inFrame} is full at 20 rows: put the rest in another cell`)
        setSpan(store, f.id, { r: f.span.r + 1 })
        return place(w, h, { inFrame })
      }
      throw new Error(`frame ${inFrame} is full: add without --in (it goes in free space), then fit ${inFrame} ID… shrinks everything to fit`)
    }
    if (area) return inArea(w, h)
    // near where people look (a request's view, where people are): the free spot nearest to
    // it; what the same operation adds next goes below the last, and around what is there
    if (prefer) {
      const want = nearLast ? { x: nearLast.x, y: nearLast.y + nearLast.h + GAP } : { x: prefer.x - w / 2, y: prefer.y - h / 2 }
      const at = freeSpot(store, w, h, want, { gap: GAP, above: 0 })
      nearLast = { ...at, h }
      return at
    }
    if (!column) {
      const all = store.shapes().filter((s) => s.typeName === 'shape').map(pageBounds)
      const right = all.length ? Math.max(...all.map((b) => b.x + b.w)) + GAP * 2 : 0
      const top = all.length ? Math.min(...all.map((b) => b.y)) : 0
      column = { x: right, y: top, top, w: 0, count: 0 }
    }
    if (column.count === 6) Object.assign(column, { x: column.x + column.w + GAP, y: column.top, w: 0, count: 0 })
    const at = { x: column.x, y: column.y }
    column.y += h + GAP
    column.w = Math.max(column.w, w)
    column.count++
    return at
  }

  // a free spot in the work area, row by row; when there is none, the area grows
  // down (and wide enough) and it goes in the new room
  function inArea(w, h) {
    const PAD = 24, TOP = 44 // room for a frame's title
    const taken = store.shapes().filter((s) => !isTitle(s)).map((s) => withTitle(store, s)).filter((b) => intersects(b, area))
    for (let y = area.y + TOP; y + h <= area.y + area.h - PAD; y += 24) {
      for (let x = area.x + PAD; x + w <= area.x + area.w - PAD; x += 24) {
        if (!taken.some((t) => intersects({ x, y: y - TOP + PAD, w, h: h + TOP - PAD }, t, 16))) return { x, y }
      }
    }
    const bottom = Math.max(area.y + area.h - PAD, ...taken.map((t) => t.y + t.h + 16))
    const at = { x: area.x + PAD, y: bottom + TOP - PAD + 16 }
    area.w = Math.max(area.w, w + PAD * 2)
    area.h = at.y + h + PAD - area.y
    return at
  }

  function put(rec) {
    store.put({ ...rec, id: rec.id ?? newId(), typeName: 'shape', rot: 0, z: store.maxZ() + 1, agent })
    focus = { x: rec.x, y: rec.y }
    return store.get(rec.id) ?? store.shapes().at(-1)
  }
  function add(type, props, w, h, opts) {
    const at = opts.at ?? place(w, h, opts)
    const id = newId()
    put({ id, type, x: at.x, y: at.y, props, ...member(opts) })
    return id
  }
  // put in a frame: a member at once, so a cell that grows later in the same
  // operation (and moves the cells after it) takes it along
  const member = (opts) => (opts.inFrame && !opts.at ? { frameId: opts.inFrame } : {})

  // Frames and grids made in this operation. What lies in one joins it only
  // once the operation is done (quickdraw-frames), so moving it in the same
  // operation takes along by hand what is in it: its members (its title, what
  // was put `in` or `around`) and what lies in it — as joining would.
  const made = new Set()
  const encloses = (fb, m) => { const b = pageBounds(m); if (isFrame(m) || isLayout(m)) return b.x >= fb.x && b.y >= fb.y && b.x + b.w <= fb.x + fb.w && b.y + b.h <= fb.y + fb.h; const cx = b.x + b.w / 2, cy = b.y + b.h / 2; return cx >= fb.x && cx <= fb.x + fb.w && cy >= fb.y && cy <= fb.y + fb.h }
  function along(id) {
    const out = new Set(), todo = [id]
    while (todo.length) {
      const f = store.get(todo.pop()), fb = pageBounds(f)
      for (const m of store.shapes()) {
        if (m.id === id || out.has(m.id) || m.typeName !== 'shape' || isLine(m)) continue // arrows: rerouted
        const joined = m.frameId === f.id || (isLayout(f) && m.layoutId === f.id)
        const lies = made.has(f.id) && (!m.frameId || m.frameId === f.frameId) && encloses(fb, m)
        if (joined || lies) { out.add(m.id); if (isFrame(m) || isLayout(m)) todo.push(m.id) }
      }
    }
    return out
  }
  // moves a shape by dx, dy; a frame made in this operation brings what is in
  // it (one made before: quickdraw-frames brings it); not what `moving` moves itself
  function shift(id, dx, dy, moving = new Set()) {
    if (!dx && !dy) return
    const go = made.has(id) ? [...along(id)].filter((m) => !moving.has(m)) : []
    for (const m of [id, ...go]) { const s = store.get(m); store.update(m, { x: s.x + dx, y: s.y + dy }) }
  }

  const ops = {
    note(text, opts = {}) {
      return add('note', { text: String(text), color: checkColor(opts.color) ?? 'yellow', size: checkSize(opts.textSize) ?? 'm', font: 'draw', scale: 1 }, 200, 200, opts)
    },
    text(text, opts = {}) {
      const size = checkSize(opts.textSize) ?? 'm', { w, h } = textBox(text, size)
      return add('text', { text: String(text), color: checkColor(opts.color) ?? 'black', size, font: 'draw', autosize: true, scale: 1 }, w, h, opts)
    },
    shape(geo, label = '', opts = {}) {
      if (!GEO_IDS.includes(geo)) throw new Error(`unknown shape "${geo}" (one of ${GEO_IDS.join(', ')})`)
      const w = opts.w ?? 180, h = opts.h ?? 100
      const labelSize = checkSize(opts.textSize)
      return add('geo', { geo, w, h, color: checkColor(opts.color) ?? 'blue', size: 'm', dash: checkDash(opts.dash) ?? 'draw', fill: checkFill(opts.fill) ?? 'none', font: 'draw', ...(labelSize ? { labelSize } : {}), ...(label ? { label: String(label) } : {}) }, w, h, opts)
    },
    // an image from a data URL of `natural` size; shown `w` wide (400 at most by default)
    image(src, natural, opts = {}) {
      if (typeof src !== 'string' || !src.startsWith('data:image/')) throw new Error('an image needs a data:image/… URL')
      if (!(natural?.w > 0 && natural?.h > 0)) throw new Error('an image needs its size')
      const w = opts.w ?? Math.min(natural.w, 400), h = (w * natural.h) / natural.w
      const assetId = newId('asset')
      store.put({ id: assetId, typeName: 'asset', src, w: natural.w, h: natural.h })
      return add('image', { w, h, assetId }, w, h, opts)
    },
    markdown(md, opts = {}) {
      const w = opts.w ?? 360
      const at = opts.at ?? place(w, 240, opts)
      const id = createMarkdown(store, { x: at.x, y: at.y, w, md: String(md) })
      store.update(id, { agent, ...member(opts) })
      focus = at
      return id
    },
    // a web page (live where the viewer's rules allow it, else its link card),
    // a link card (`link`), or inline HTML (runs when a viewer presses Run)
    embed({ url, html, link = false, title, preview } = {}, opts = {}) {
      const kind = html != null ? 'html' : link || /^http:\/\//i.test(String(url)) ? 'link' : 'url' // a page only over https
      const [w0, h0] = kind === 'html' ? [400, 300] : kind === 'link' ? [320, 260] : [480, 270]
      const w = opts.w ?? w0, h = opts.h ?? h0
      const at = opts.at ?? place(w, h, opts)
      const id = createEmbed(store, { x: at.x, y: at.y, w, h, kind, url: url == null ? undefined : String(url), html: html == null ? undefined : String(html), title, preview })
      const err = validateEmbed(store.get(id))
      if (err) throw new Error(`embed: ${err === 'bad props.url' ? 'needs an http(s) URL, or html' : err}`)
      store.update(id, { agent, ...member(opts) })
      focus = at
      return id
    },
    // a card for another board (its id): its picture, or (live) a window onto it
    board({ board, title = 'Board', live = false } = {}, opts = {}) {
      const w = opts.w ?? 360, h = opts.h ?? 260
      const at = opts.at ?? place(w, h, opts)
      const id = createBoardCard(store, { x: at.x, y: at.y, w, h, board: String(board ?? ''), title: String(title), live: !!live })
      const err = validateBoardCard(store.get(id))
      if (err) throw new Error(`board card: ${err === 'bad props.board' ? 'needs a board id (omq boards lists them)' : err}`)
      store.update(id, { agent, ...member(opts) })
      focus = at
      return id
    },
    // a ticket for an agent (`to`, or any): in the frame or at the point given,
    // else in the Todo column of the board's first kanban, else in free space
    ticket(title, { body = '', to = null } = {}, opts = {}) {
      const w = opts.w ?? 240
      const what = { w, title: String(title), body: String(body ?? ''), to: to || null, from: name }
      registerTicket()
      const h = pageBounds({ type: TICKET, x: 0, y: 0, rot: 0, props: { ...what, status: 'todo' } }).h
      const target = opts.inFrame ? need(opts.inFrame) : !opts.at && firstKanbanTodo()
      const at = opts.at ?? (target && isColumn(target) ? placeInColumn(store, target.id, h) : place(w, h, opts))
      const id = createTicket(store, { ...what, x: at.x, y: at.y })
      store.update(id, { agent })
      focus = at
      return id
    },
    // todo | doing | done | failed; `by` who has it (doing: this agent unless
    // said), `result` how it went. In a kanban the ticket moves column.
    status(id, status, { by, result } = {}) {
      const s = need(id)
      if (s.type !== TICKET) throw new Error(`${id} (${s.type}) is not a ticket`)
      const who = by !== undefined ? by : status === 'todo' ? undefined : s.props.by || name
      setTicketStatus(store, id, status, { by: who, result: result ?? undefined })
      focus = { x: store.get(id).x, y: store.get(id).y }
      return id
    },
    // title; aspect ('16:9'…); around: ids to enclose, or at/w/h
    frame(title = 'Frame', opts = {}) {
      // in a bento grid: a cell at the end of it, `span` units ({ c, r }), `auto` rows
      if (opts.inFrame && isLayout(store.get(opts.inFrame))) {
        const id = addCell(store, opts.inFrame, { title: String(title), c: opts.span?.c, r: opts.span?.r, auto: !!opts.auto })
        store.update(id, { agent })
        made.add(id)
        store.update(id + '-title', { agent })
        focus = { x: store.get(id).x, y: store.get(id).y }
        return id
      }
      if (opts.span || opts.auto) throw new Error('span and auto are for a cell: put the frame in a bento grid (in: its id)')
      const aspect = parseRatio(opts.aspect)
      let { x, y } = opts.at ?? {}
      let w = opts.w ?? 480, h = opts.h ?? (aspect ? w / aspect : 320)
      if (opts.around?.length) {
        const bs = opts.around.map((id) => pageBounds(need(id)))
        const pad = 32
        x = Math.min(...bs.map((b) => b.x)) - pad
        y = Math.min(...bs.map((b) => b.y)) - pad
        w = Math.max(...bs.map((b) => b.x + b.w)) - x + pad
        h = Math.max(...bs.map((b) => b.y + b.h)) - y + pad
        if (aspect) { if (w / h < aspect) w = h * aspect; else h = w / aspect }
      } else if (x == null) ({ x, y } = place(w, h + 40, { inFrame: opts.inFrame })) // in a frame: a frame in it
      const id = createFrame(store, { x, y: opts.around?.length || opts.at ? y : y + 40, w, h, aspect, title: String(title), titleInside: !!opts.titleInside })
      store.update(id, { agent })
      store.update(id + '-title', { agent })
      made.add(id)
      for (const m of opts.around ?? []) if (!isLine(store.get(m))) store.update(m, { frameId: id }) // what it was put around is in it now
      focus = { x, y }
      return id
    },
    // a bento grid: frames (cells) that pack themselves, `cols` columns `w` wide;
    // its height follows its cells. Cells: frame(title, { inFrame: id, span })
    layout({ cols = 4, w = 1200, gap = 24 } = {}, opts = {}) {
      const at = opts.at ?? place(w, 400)
      const id = createLayout(store, { x: at.x, y: at.y, w, cols, gap })
      store.update(id, { agent })
      made.add(id)
      focus = at
      return id
    },
    // a cell's size in grid units ({ c, r }), or whether its rows follow its contents (auto)
    span(id, { c, r, auto } = {}) {
      const s = need(id)
      if (!isCell(s)) throw new Error(`${id} is not a cell of a bento grid`)
      setSpan(store, id, { c, r, auto })
      focus = { x: s.x, y: s.y }
      return id
    },
    columns(id, cols) {
      const a = need(id)
      if (!isLayout(a)) throw new Error(`${id} is not a bento grid`)
      if (!(Number(cols) >= 1)) throw new Error('columns needs a number, 1 or more')
      setColumns(store, id, Number(cols))
      focus = { x: a.x, y: a.y }
      return id
    },
    // an arrow between two shapes' edges (or from/to points { x, y }); between
    // shapes it keeps `link` and is re-routed when they move in an operation.
    // `bend`: how far its middle bows out (+ to the right as it goes, - to the
    // left); `dash`; `label`: a word or two by its middle, which follows it
    arrow(from, to, opts = {}) {
      const g = route(store, [from, to].map((e) => (typeof e === 'string' ? pageBounds(need(e)) : { x: e.x, y: e.y, w: 0, h: 0 })))
      const id = newId()
      const link = typeof from === 'string' && typeof to === 'string' ? { link: { from, to } } : {}
      put({ id, type: opts.line ? 'line' : 'arrow', x: g.x, y: g.y, ...link, props: { dx: g.dx, dy: g.dy, bend: checkBend(opts.bend) ?? 0, color: checkColor(opts.color) ?? 'black', size: 'm', dash: checkDash(opts.dash) ?? 'solid' } })
      if (opts.label) setLabel(id, opts.label, opts)
      return id
    },
    // text / label / markdown / frame title, and color; a text's size (textSize),
    // a shape's line style and fill, an arrow's line style, bend and label
    // (label: '' takes it off)
    update(id, { text, color, w, h, textSize, dash, fill, bend, label } = {}) {
      const s = need(id)
      if (textSize != null) {
        checkSize(textSize)
        if (s.type === 'geo' && !isFrame(s) && !isLayout(s)) store.update(id, { props: { labelSize: textSize } })
        else if (s.type === 'text' || s.type === 'note') store.update(id, { props: { size: textSize } })
        else if (isLine(s)) { for (const l of store.shapes()) if (l.labelOf === id) store.update(l.id, { props: { size: textSize } }) }
        else throw new Error(`${id} (${s.type}) has no text size: only texts, notes, shapes' labels and arrows' labels do`)
      }
      if (dash != null) {
        if (!(isLine(s) || (s.type === 'geo' && !isFrame(s) && !isLayout(s)))) throw new Error(`${id} (${s.type}) has no line style: only shapes and arrows do`)
        store.update(id, { props: { dash: checkDash(dash) } })
      }
      if (fill != null) {
        if (s.type !== 'geo' || isFrame(s) || isLayout(s)) throw new Error(`${id} (${s.type}) has no fill: only shapes (rectangle, ellipse, …) do`)
        store.update(id, { props: { fill: checkFill(fill) } })
      }
      if (bend != null || label != null) {
        if (!isLine(s)) throw new Error(`${id} (${s.type}) is not an arrow: only arrows bend and have labels`)
        if (bend != null) store.update(id, { props: { bend: checkBend(bend) } })
        if (label != null) setLabel(id, label, { textSize })
      }
      // a shape's size: boxes only (a frame keeps its size; fit_frame shrinks what is in it)
      if (w != null || h != null) {
        if (isCell(s)) throw new Error(`${id} is a bento cell: change its size with span (units), and the others move along`)
        if (s.type !== 'geo' || isFrame(s) || isLayout(s)) throw new Error(`${id} (${isFrame(s) ? 'a frame' : isLayout(s) ? 'a bento grid' : s.type}) cannot be resized; only shapes (rectangle, diamond, …) can`)
        const size = (v, was) => (v == null ? was : Math.max(24, Math.min(4000, Number(v) || was)))
        store.update(id, { props: { w: size(w, s.props.w), h: size(h, s.props.h) } })
      }
      if (text != null) {
        if (isFrame(s)) renameFrame(store, id, String(text))
        else if (s.type === 'geo') store.update(id, { props: { label: String(text) } })
        else if (s.type === MARKDOWN) store.update(id, { props: { md: String(text) } })
        else if (s.type === TICKET) { const [title, ...rest] = String(text).split('\n'); store.update(id, { props: { title, body: rest.join('\n').trim() } }) }
        else if (s.type === 'text' || s.type === 'note') store.update(id, { props: { text: String(text) } })
        else throw new Error(`${id} (${s.type}) has no text`)
      }
      if (color != null) store.update(id, { props: { color: checkColor(color) } })
      focus = { x: s.x, y: s.y }
      return id
    },
    // to { x, y }, or by { dx, dy }; a frame brings its members
    move(id, { x, y, dx = 0, dy = 0 } = {}) {
      const s = need(id)
      shift(id, (x ?? s.x + dx) - s.x, (y ?? s.y + dy) - s.y)
      focus = { x: x ?? s.x + dx, y: y ?? s.y + dy }
      return id
    },
    // lays shapes out in a grid, row or column, from `at` or where they start;
    // a frame counts with its title, so frames in a column do not overlap titles
    arrange(ids, { layout = 'grid', gap = 24, at, cols: across } = {}) {
      const shapes = ids.map(need)
      const bs = shapes.map((s) => withTitle(store, s))
      let x0 = at?.x ?? Math.min(...bs.map((b) => b.x)), y0 = at?.y ?? Math.min(...bs.map((b) => b.y))
      const cols = layout === 'row' ? shapes.length : layout === 'column' ? 1 : across > 0 ? Math.floor(across) : Math.ceil(Math.sqrt(shapes.length))
      let x = x0, y = y0, rowH = 0
      shapes.forEach((s, i) => {
        if (i && i % cols === 0) { x = x0; y += rowH + gap; rowH = 0 }
        const b = bs[i]
        shift(s.id, x - b.x, y - b.y, new Set(ids))
        x += b.w + gap
        rowH = Math.max(rowH, b.h)
      })
      focus = { x: x0, y: y0 }
      return ids
    },
    // Puts what is in a frame, and the shapes named, inside it: shrunk together
    // (never enlarged) to fit within its edges, keeping how they sit relative to
    // each other, as a person would. The frame keeps its size.
    fit(frameId, { ids = [] } = {}) {
      const f = need(frameId)
      if (!isFrame(f)) throw new Error(`${frameId} is not a frame`)
      const named = ids.map(need)
      // what is in it (a frame in it counts as itself; what is in that comes along)
      const shapes = [...new Map([...store.shapes().filter((s) => s.frameId === f.id && !isTitle(s)), ...named].map((s) => [s.id, s])).values()]
      if (!shapes.length) return []
      const bs = shapes.map(pageBounds)
      const listed = new Set(shapes.map((s) => s.id))
      const along = shapes.filter(isFrame).flatMap((g) => store.shapes().filter((s) => !listed.has(s.id) && inFrame(store, s, g.id))) // frames' titles and members
      const g = { x: Math.min(...bs.map((b) => b.x)), y: Math.min(...bs.map((b) => b.y)) }
      g.w = Math.max(...bs.map((b) => b.x + b.w)) - g.x
      g.h = Math.max(...bs.map((b) => b.y + b.h)) - g.y
      const room = { w: f.props.w - PAD * 2, h: f.props.h - PAD * 2 }
      const k = Math.min(1, room.w / g.w, room.h / g.h)
      if (k < MIN_FIT) throw new Error(`too much to fit in ${frameId}: it would take shrinking to ${Math.round(k * 100)}% (at least ${MIN_FIT * 100}%); use a bigger frame, or several`)
      const x0 = f.x + PAD + (room.w - g.w * k) / 2, y0 = f.y + PAD + (room.h - g.h * k) / 2 // centred
      const abs = along.map(pageBounds)
      ;[...shapes, ...along].forEach((s, i) => {
        const b = i < shapes.length ? bs[i] : abs[i - shapes.length]
        const scaled = k < 1 ? scaleShape(s, k, k) : s
        const nb = pageBounds(scaled)
        const x = x0 + (b.x - g.x) * k, y = y0 + (b.y - g.y) * k
        store.put({ ...scaled, x: scaled.x + x - nb.x, y: scaled.y + y - nb.y })
      })
      focus = { x: f.x, y: f.y }
      return shapes.map((s) => s.id)
    },
    // Draws with the pen, as a person marks something: around a shape (circle),
    // under it (underline), or through page points. A hand-drawn stroke (a
    // 'draw' shape), red unless said: it stays until someone deletes it.
    pen({ kind = 'circle', id, points, color, size = 'm' } = {}) {
      let path
      if (kind === 'points') {
        if (!Array.isArray(points) || points.length < 2) throw new Error('the pen needs two points or more: [[x, y], …]')
        path = points.map((p) => (Array.isArray(p) ? p : [p.x, p.y]).map(Number))
        if (path.some((p) => !p.every(Number.isFinite))) throw new Error('bad pen points')
      } else {
        const b = pageBounds(need(id))
        if (kind === 'circle') {
          const cx = b.x + b.w / 2, cy = b.y + b.h / 2, rx = b.w / 2 + 20, ry = b.h / 2 + 16
          path = Array.from({ length: 48 }, (_, i) => {
            const a = -Math.PI * 0.6 + (i / 46) * Math.PI * 2.08 // round, a little past where it began
            const wob = 1 + 0.025 * Math.sin(i * 1.7) // not a perfect ellipse: drawn by hand
            return [cx + rx * wob * Math.cos(a), cy + ry * wob * Math.sin(a)]
          })
        } else if (kind === 'underline') {
          const y = b.y + b.h + 10
          path = Array.from({ length: 16 }, (_, i) => [b.x - 6 + ((b.w + 12) * i) / 15, y + 2.5 * Math.sin(i * 0.9)])
        } else throw new Error(`unknown pen "${kind}" (circle, underline or points)`)
      }
      const x0 = Math.min(...path.map((p) => p[0])), y0 = Math.min(...path.map((p) => p[1]))
      const id2 = newId()
      put({ id: id2, type: 'draw', x: round(x0), y: round(y0), props: {
        pts: path.flatMap(([x, y]) => [Math.round((x - x0) * 10) / 10, Math.round((y - y0) * 10) / 10, 0.5]),
        color: checkColor(color) ?? 'red', size, dash: 'draw', done: true,
      } })
      return id2
    },
    // Lays frames out close together, in reading order, in rows from `at` (by
    // default where the first of them is) no wider than `width`: a board that
    // grew outwards, gathered. A frame brings what is in it and its title; a
    // kanban's columns go together. What is in no frame stays where it is.
    tidy({ ids, at, gap = GAP * 2, width = 2400 } = {}) {
      const frames = ids?.length ? ids.map(need) : store.shapes().filter((s) => (isFrame(s) || isLayout(s)) && !isFrame(store.get(s.frameId))) // frames in frames come with theirs
      for (const f of frames) if (!isFrame(f) && !isLayout(f)) throw new Error(`${f.id} is not a frame`)
      // what moves together: a frame, all the columns of its kanban, or a bento
      // grid (moved alone: its cells follow it)
      const units = new Map()
      for (const f of frames) {
        const grid = isCell(f) ? store.get(f.layoutId) : isLayout(f) ? f : null
        const key = grid?.id ?? f.kanban?.id ?? f.id
        const all = grid ? [grid] : f.kanban?.id ? store.shapes().filter((c) => isFrame(c) && c.kanban?.id === f.kanban.id) : [f]
        if (!units.has(key)) units.set(key, all)
      }
      const moving = new Set([...units.values()].flat().map((f) => f.id))
      const boxes = [...units.values()].map((fs) => {
        const bs = fs.map((f) => withTitle(store, f))
        const x = Math.min(...bs.map((b) => b.x)), y = Math.min(...bs.map((b) => b.y))
        return { fs, x, y, w: Math.max(...bs.map((b) => b.x + b.w)) - x, h: Math.max(...bs.map((b) => b.y + b.h)) - y }
      }).sort(byPosition)
      if (!boxes.length) return []
      const x0 = at?.x ?? boxes[0].x, y0 = at?.y ?? boxes[0].y
      const rowW = Math.max(width, ...boxes.map((b) => b.w))
      let x = x0, y = y0, rowH = 0
      for (const b of boxes) {
        if (x > x0 && x + b.w > x0 + rowW) { x = x0; y += rowH + gap; rowH = 0 }
        const dx = x - b.x, dy = y - b.y
        for (const f of b.fs) shift(f.id, dx, dy, moving)
        x += b.w + gap
        rowH = Math.max(rowH, b.h)
      }
      focus = { x: x0, y: y0 }
      return boxes.flatMap((b) => b.fs.map((f) => f.id))
    },
    // only what an agent added; a frame goes with its title, its members stay
    delete(ids) {
      for (const id of ids) {
        const s = need(id)
        if (!s.agent) throw new Error(`refused: ${id} was not added by an agent`)
      }
      const labels = store.shapes().filter((l) => isLabel(l) && ids.includes(l.labelOf) && !ids.includes(l.id)).map((l) => l.id) // an arrow's label goes with it
      store.remove([...ids, ...labels])
      return ids
    },
  }
  // an arrow's label: put, changed, or taken off ('')
  function setLabel(arrowId, text, { color, textSize } = {}) {
    const was = store.shapes().find((l) => l.labelOf === arrowId)
    if (!String(text).trim()) { if (was) store.remove([was.id]); return null }
    if (was) { store.update(was.id, { props: { text: String(text), ...(textSize ? { size: checkSize(textSize) } : {}) } }); return was.id }
    const a = store.get(arrowId), size = checkSize(textSize) ?? 's', { w, h } = textBox(text, size)
    const id = add('text', { text: String(text), color: checkColor(color) ?? a.props.color ?? 'black', size, font: 'draw', autosize: true, scale: 1 }, w, h, { at: labelSpot(a, w, h) })
    store.update(id, { labelOf: arrowId })
    return id
  }
  // after the steps: linked arrows follow their shapes
  function reroute() {
    for (const s of store.shapes()) {
      if (!s.link || !isLine(s)) continue
      const a = store.get(s.link.from), b = store.get(s.link.to)
      if (!a || !b) continue
      const g = route(store, [pageBounds(a), pageBounds(b)])
      if (Math.abs(g.x - s.x) + Math.abs(g.y - s.y) + Math.abs(g.dx - s.props.dx) + Math.abs(g.dy - s.props.dy) > 0.5) {
        store.update(s.id, { x: g.x, y: g.y, props: { dx: g.dx, dy: g.dy } })
      }
    }
    for (const l of labelsFollow(store)) store.put(l) // and labels their arrows
  }
  return { ops, focus: () => focus, reroute, area: () => area }
}

// a shape's bounds; a frame's include its title above it
function withTitle(store, s) {
  const b = pageBounds(s)
  const t = isFrame(s) && store.get(s.id + '-title')
  if (!t) return b
  const tb = pageBounds(t)
  const x = Math.min(b.x, tb.x), y = Math.min(b.y, tb.y)
  return { x, y, w: Math.max(b.x + b.w, tb.x + tb.w) - x, h: Math.max(b.y + b.h, tb.y + tb.h) - y }
}

// the segment between two rects' centres, cut at their edges (plus a gap)
export function route(store, [ra, rb]) {
  const [a, b] = [ra, rb].map((r) => ({ x: r.x + r.w / 2, y: r.y + r.h / 2 }))
  const clip = (r, p, q) => {
    if (!r.w || !r.h) return p
    const dx = q.x - p.x, dy = q.y - p.y
    const t = Math.min(dx ? (r.w / 2) / Math.abs(dx) : Infinity, dy ? (r.h / 2) / Math.abs(dy) : Infinity)
    const len = Math.hypot(dx, dy) || 1
    return { x: p.x + dx * t + (dx / len) * 8, y: p.y + dy * t + (dy / len) * 8 }
  }
  const p = clip(ra, a, b), q = clip(rb, b, a)
  return { x: p.x, y: p.y, dx: q.x - p.x, dy: q.y - p.y }
}

// Runs fn(ops) as one operation, all or nothing. Returns { op, diff, result, focus }.
// The diff compares each touched record before and after, rather than composing
// the diffs as they are emitted: a listener that edits in response (frame
// membership) emits its diff before the one that caused it, out of order.
export function runOp(store, name, fn, { area, prefer } = {}) {
  const op = 'op:' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6)
  const { ops, focus, reroute, area: grown } = operations(store, name, op, { area, prefer })
  const before = new Map(store.all().map((r) => [r.id, r]))
  const touched = new Set()
  const off = store.listen((d) => {
    for (const part of [d.added, d.removed, d.updated]) for (const id of Object.keys(part)) touched.add(id)
  }, { source: 'user' })
  const since = () => {
    const diff = emptyDiff()
    for (const id of touched) {
      const a = before.get(id), b = store.get(id)
      if (a === b) continue
      if (!a) diff.added[id] = b
      else if (!b) diff.removed[id] = a
      else diff.updated[id] = [a, b]
    }
    return diff
  }
  let result
  try {
    try {
      store.transact(() => { result = fn(ops); reroute() })
      // who made it, and who changed it last (quickdraw-presence's bindAuthorship does it for people)
      const at = Date.now(), made = since()
      store.transact(() => {
        for (const id of Object.keys(made.added)) { const s = store.get(id); if (s?.typeName === 'shape' && !s.made) store.update(id, { made: { by: name, at } }) }
        for (const id of Object.keys(made.updated)) if (store.get(id)?.typeName === 'shape') store.update(id, { edited: { by: name, at } })
      })
    } catch (e) {
      revert(store, since()) // the transaction still applied what came before the error
      throw e
    }
  } finally { off() }
  return { op, diff: since(), result, focus: focus(), ...(area ? { area: grown() } : {}) }
}

// Runs a list of steps as one operation. Steps may name what they add
// (`ref: 'a'`) and point at it later as '@a'.
// [{ do: 'note', text, color?, in?, ref? }, { do: 'arrow', from: '@a', to: '@b' }, …]
export function applySteps(store, name, steps, { area, prefer } = {}) {
  if (!Array.isArray(steps)) throw new Error('steps must be an array')
  return runOp(store, name, (ops) => {
    const refs = {}
    const r = (v) => (typeof v === 'string' && v.startsWith('@') ? refs[v.slice(1)] ?? (() => { throw new Error(`unknown ref ${v}`) })() : v)
    const opts = (s) => ({ color: s.color, at: s.at, w: s.w, h: s.h, fill: s.fill, dash: s.dash, textSize: s.text_size ?? s.textSize, inFrame: r(s.in) })
    return steps.map((s, i) => {
      let out
      switch (s.do) {
        case 'note': out = ops.note(s.text ?? '', opts(s)); break
        case 'text': out = ops.text(s.text ?? '', opts(s)); break
        case 'shape': out = ops.shape(s.shape ?? 'rectangle', s.text ?? s.label ?? '', opts(s)); break
        case 'markdown': out = ops.markdown(s.text ?? s.md ?? '', opts(s)); break
        case 'image': out = ops.image(s.src, s.natural, opts(s)); break
        case 'embed': out = ops.embed({ url: s.url, html: s.html, link: s.link, title: s.title, preview: s.preview }, opts(s)); break
        case 'board': out = ops.board({ board: s.board, title: s.title, live: s.live }, opts(s)); break
        case 'ticket': out = ops.ticket(s.title ?? s.text ?? '', { body: s.body, to: s.to }, opts(s)); break
        case 'status': out = ops.status(r(s.id), s.status, { by: s.by, result: s.result }); break
        case 'frame': out = ops.frame(s.title ?? s.text, { ...opts(s), aspect: s.aspect, around: s.around?.map(r), span: spanOf(s.span), auto: s.auto, titleInside: s.title_inside ?? s.titleInside }); break
        case 'layout': out = ops.layout({ cols: s.cols, w: s.w, gap: s.gap }, { at: s.at }); break
        case 'span': out = ops.span(r(s.id), { ...spanOf(s.span), auto: s.auto }); break
        case 'columns': out = ops.columns(r(s.id), s.cols); break
        case 'arrow': out = ops.arrow(r(s.from), r(s.to), { color: s.color, line: s.line, dash: s.dash, bend: s.bend, label: s.label, textSize: s.text_size ?? s.textSize }); break
        case 'update': out = ops.update(r(s.id), { text: s.text, color: s.color, w: s.w, h: s.h, textSize: s.text_size ?? s.textSize, dash: s.dash, fill: s.fill, bend: s.bend, label: s.label }); break
        case 'move': out = ops.move(r(s.id), s); break
        case 'arrange': out = ops.arrange(s.ids.map(r), s); break
        case 'fit': out = ops.fit(r(s.frame ?? s.id), { ids: (s.ids ?? []).map(r) }); break
        case 'pen': out = ops.pen({ kind: s.kind ?? (s.points ? 'points' : 'circle'), id: r(s.id), points: s.points, color: s.color, size: s.size }); break
        case 'tidy': out = ops.tidy({ ids: s.ids?.map(r), at: s.at, gap: s.gap, width: s.width }); break
        case 'delete': out = ops.delete((s.ids ?? [s.id]).map(r)); break
        default: throw new Error(`step ${i + 1}: unknown "do": ${JSON.stringify(s.do)}`)
      }
      if (s.ref) refs[s.ref] = out
      return out
    })
  }, { area, prefer })
}

// a span as { c, r }, from that or "2x1"
export function spanOf(v) {
  if (v == null) return undefined
  if (typeof v === 'object') return { c: v.c, r: v.r }
  const m = /^(\d+)\s*[x×]\s*(\d+)$/.exec(String(v).trim())
  if (!m) throw new Error(`a span is COLSxROWS, like 2x1 (not "${v}")`)
  return { c: Number(m[1]), r: Number(m[2]) }
}

// ---- undo ------------------------------------------------------------------------

const stable = (v) => JSON.stringify(v, (k, x) => (x && typeof x === 'object' && !Array.isArray(x) ? Object.fromEntries(Object.entries(x).sort(([a], [b]) => (a < b ? -1 : 1))) : x))
const same = (a, b) => stable(a) === stable(b)

function revert(store, diff) {
  const inv = { added: { ...diff.removed }, removed: { ...diff.added }, updated: Object.fromEntries(Object.entries(diff.updated).map(([id, [from, to]]) => [id, [to, from]])) }
  store.applyDiff(inv, 'user')
}

// Undoes an operation's diff where nobody has changed things since; the rest
// is left alone and reported. Returns { reverted, skipped }.
export function undoDiff(store, diff) {
  const inv = emptyDiff()
  const skipped = []
  for (const [id, rec] of Object.entries(diff.added)) {
    const cur = store.get(id)
    if (!cur) continue
    if (same(cur, rec)) inv.removed[id] = cur
    else skipped.push(id)
  }
  for (const [id, [from, to]] of Object.entries(diff.updated)) {
    const cur = store.get(id)
    if (cur && same(cur, to)) inv.updated[id] = [cur, from]
    else skipped.push(id)
  }
  for (const [id, rec] of Object.entries(diff.removed)) {
    if (!store.has(id)) inv.added[id] = rec
    else skipped.push(id)
  }
  const reverted = Object.keys(inv.added).length + Object.keys(inv.removed).length + Object.keys(inv.updated).length
  if (reverted) store.applyDiff(inv, 'user')
  return { reverted, skipped }
}
