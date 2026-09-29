// What an agent can do on a board, over a core Store: read it (as data or a
// Markdown outline), and change it in operations. Every operation is one
// store transaction whose diff is returned, so it can be logged and undone.
// Shapes the agent adds carry `agent: { name, op }`; it may move and edit
// anything, but delete only what an agent added.
import { newId, pageBounds, scaleShape, COLOR_IDS, GEO_IDS } from '@quickdrawjs/core'
import { createFrame, frameTitle, freeSpot, isFrame, renameFrame } from 'quickdraw-frames'
export { freeSpot } // free space for something, by where it is wanted (quickdraw-frames)
import { createMarkdown, TYPE as MARKDOWN } from 'quickdraw-markdown'
import { createEmbed, validateEmbed, TYPE as EMBED } from 'quickdraw-embed'
import { createTicket, isColumn, registerTicket, kanbanColumn, placeInColumn, setTicketStatus, TYPE as TICKET } from 'quickdraw-tickets'
import { estimateWidth } from './measure.js'

const GAP = 40
const PAD = 24 // inside a frame's edges
const MIN_FIT = 0.3 // smaller than this and notes stop being readable
const round = (n) => Math.round(n)
const emptyDiff = () => ({ added: {}, removed: {}, updated: {} })
const isTitle = (s) => s.isFrameTitle === true || s.id === s.frameId + '-title'
const isLine = (s) => s.type === 'arrow' || s.type === 'line'

// ---- reading -------------------------------------------------------------------

export function textOf(store, s) {
  switch (s.type) {
    case 'text': case 'note': return s.props.text
    case 'geo': return isFrame(s) ? frameTitle(store, s.id) : s.props.label
    case MARKDOWN: return s.props.md
    case TICKET: return s.props.title + (s.props.body ? '\n' + s.props.body : '')
    case EMBED: return s.props.title || s.props.preview?.title || s.props.url || (s.props.kind === 'html' ? '(HTML)' : '')
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
function shapeAt(shapes, x, y, reach = 16) {
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
    ...(typeof f.snapshot?.at === 'number' ? { snapshot: { at: f.snapshot.at, by: f.snapshot.by ?? '' } } : {}),
    ...(isColumn(f) ? { kanban: { id: f.kanban.id, status: f.kanban.status } } : {}), // a kanban's column (quickdraw-tickets)
    members: shapes.filter((s) => s.frameId === f.id && !isTitle(s) && !isLine(s)).map((s) => s.id), // arrows: see `arrows`
  })).sort(byPosition)
  const items = shapes.filter((s) => !isFrame(s) && !isTitle(s) && !isLine(s)).map((s) => ({
    id: s.id, type: s.type === 'geo' ? s.props.geo : s.type, text: stills.has(s.id) ? '(screenshot)' : textOf(store, s), ...box(s),
    ...(s.props.color ? { color: s.props.color } : {}),
    ...(s.frameId ? { frame: s.frameId } : {}),
    // who made it (an agent, or a person whose page marked it), and who changed it last if not them
    ...((s.made?.by ?? s.agent?.name) ? { by: s.made?.by ?? s.agent.name } : {}),
    ...(s.edited?.by && s.edited.by !== (s.made?.by ?? s.agent?.name) ? { edited_by: s.edited.by } : {}),
    ...(s.type === TICKET ? { ticket: { status: s.props.status, to: s.props.to ?? null, by: s.props.by ?? null, ...(s.props.result ? { result: s.props.result } : {}) } } : {}),
  })).sort(byPosition)
  const arrows = shapes.filter(isLine).map((s) => {
    const from = shapeAt(solid, s.x, s.y), to = shapeAt(solid, s.x + s.props.dx, s.y + s.props.dy)
    return { id: s.id, type: s.type, ...(from ? { from: from.id } : {}), ...(to ? { to: to.id } : {}) }
  })
  return { frames, items, arrows }
}

// The board as a Markdown outline, for reading and summarizing.
export function boardToMarkdown(store) {
  const { frames, items, arrows } = describeBoard(store)
  const byId = new Map(items.map((it) => [it.id, it]))
  const line = (it) => {
    const text = String(it.text ?? '').trim()
    const tag = `[${it.type}${it.by ? `, by ${it.by}` : ''}${it.edited_by ? `, edited by ${it.edited_by}` : ''}] `
    if (it.ticket) {
      const t = it.ticket
      const who = t.status === 'todo' ? ` → ${t.to ?? 'any agent'}` : t.by ? `, ${t.by}` : ''
      return `- [ticket, ${t.status}${who}] ${text.replace(/\s*\n\s*/g, ' / ') || '(empty)'}${t.result ? ` — ${t.result.replace(/\s*\n\s*/g, ' / ')}` : ''} (id ${it.id})`
    }
    if (it.type === MARKDOWN) return `- ${tag}(id ${it.id})\n` + text.split('\n').map((l) => '  > ' + l).join('\n')
    return `- ${tag}${text.replace(/\s*\n\s*/g, ' / ') || '(empty)'} (id ${it.id})`
  }
  const out = ['# Board', '']
  for (const f of frames) {
    const kind = f.snapshot ? 'snapshot of a shared screen; its notes and marks are feedback'
      : f.kanban ? `kanban column: ${f.kanban.status} tickets` : `frame${f.aspect ? `, ${ratio(f.aspect)}` : ''}`
    out.push(`## ${f.title || 'Frame'} (${kind}; id ${f.id})`, '')
    const members = f.members.map((id) => byId.get(id)).filter(Boolean)
    out.push(...(members.length ? members.map(line) : ['- (empty)']), '')
  }
  const loose = items.filter((it) => !it.frame)
  if (loose.length) out.push(frames.length ? '## Outside frames' : '## Shapes', '', ...loose.map(line), '')
  const links = arrows.filter((a) => a.from && a.to)
  if (links.length) {
    const name = (id) => (String(byId.get(id)?.text ?? '').split('\n')[0].slice(0, 40) || id)
    out.push('## Connections', '', ...links.map((a) => `- ${name(a.from)} → ${name(a.to)}`), '')
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

// The operations, bound to one op: what it adds is marked with it. `area`: a
// work area ({ x, y, w, h }) where what is added without a place goes; it
// grows downwards (unlike a frame) when full, see area().
function operations(store, name, op, { area: startArea } = {}) {
  const agent = { name, op }
  let column = null // where this op's unplaced shapes stack: { x, y, w, count }
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
      const taken = store.shapes()
        .filter((s) => s.id !== f.id && !isTitle(s) && (s.frameId === f.id || intersects(pageBounds(s), fb)))
        .map(pageBounds)
      for (let y = fb.y + 24; y + h <= fb.y + fb.h - 16; y += 24) {
        for (let x = fb.x + 24; x + w <= fb.x + fb.w - 16; x += 24) {
          const r = { x, y, w, h }
          if (!taken.some((t) => intersects(r, t, 16))) return { x, y }
        }
      }
      // full: never grown (its size may be the point, like a 16:9 slide) nor piled up
      throw new Error(`frame ${inFrame} is full: add without --in (it goes in free space), then fit ${inFrame} ID… shrinks everything to fit`)
    }
    if (area) return inArea(w, h)
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
    put({ id, type, x: at.x, y: at.y, props })
    return id
  }

  const ops = {
    note(text, opts = {}) {
      return add('note', { text: String(text), color: checkColor(opts.color) ?? 'yellow', size: 'm', font: 'draw', scale: 1 }, 200, 200, opts)
    },
    text(text, opts = {}) {
      const w = Math.max(...String(text).split('\n').map((l) => estimateWidth('26px sans-serif', l))), h = 36 * String(text).split('\n').length
      return add('text', { text: String(text), color: checkColor(opts.color) ?? 'black', size: 'm', font: 'draw', autosize: true, scale: 1 }, w, h, opts)
    },
    shape(geo, label = '', opts = {}) {
      if (!GEO_IDS.includes(geo)) throw new Error(`unknown shape "${geo}" (one of ${GEO_IDS.join(', ')})`)
      const w = opts.w ?? 180, h = opts.h ?? 100
      return add('geo', { geo, w, h, color: checkColor(opts.color) ?? 'blue', size: 'm', dash: 'draw', fill: opts.fill ?? 'none', font: 'draw', ...(label ? { label: String(label) } : {}) }, w, h, opts)
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
      store.update(id, { agent })
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
      store.update(id, { agent })
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
      } else if (x == null) ({ x, y } = place(w, h + 40))
      const id = createFrame(store, { x, y: opts.around?.length || opts.at ? y : y + 40, w, h, aspect, title: String(title) })
      store.update(id, { agent })
      store.update(id + '-title', { agent })
      focus = { x, y }
      return id
    },
    // an arrow between two shapes' edges (or from/to points { x, y }); between
    // shapes it keeps `link` and is re-routed when they move in an operation
    arrow(from, to, opts = {}) {
      const g = route(store, [from, to].map((e) => (typeof e === 'string' ? pageBounds(need(e)) : { x: e.x, y: e.y, w: 0, h: 0 })))
      const id = newId()
      const link = typeof from === 'string' && typeof to === 'string' ? { link: { from, to } } : {}
      put({ id, type: opts.line ? 'line' : 'arrow', x: g.x, y: g.y, ...link, props: { dx: g.dx, dy: g.dy, bend: 0, color: checkColor(opts.color) ?? 'black', size: 'm', dash: 'solid' } })
      return id
    },
    // text / label / markdown / frame title, and color
    update(id, { text, color, w, h } = {}) {
      const s = need(id)
      // a shape's size: boxes only (a frame keeps its size; fit_frame shrinks what is in it)
      if (w != null || h != null) {
        if (s.type !== 'geo' || isFrame(s)) throw new Error(`${id} (${isFrame(s) ? 'a frame' : s.type}) cannot be resized; only shapes (rectangle, diamond, …) can`)
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
      store.update(id, { x: x ?? s.x + dx, y: y ?? s.y + dy })
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
        store.update(s.id, { x: s.x + (x - b.x), y: s.y + (y - b.y) })
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
      for (const s of named) if (isFrame(s)) throw new Error(`${s.id} is a frame: frames do not nest`)
      const shapes = [...new Map([...store.shapes().filter((s) => s.frameId === f.id && !isTitle(s)), ...named].map((s) => [s.id, s])).values()]
      if (!shapes.length) return []
      const bs = shapes.map(pageBounds)
      const g = { x: Math.min(...bs.map((b) => b.x)), y: Math.min(...bs.map((b) => b.y)) }
      g.w = Math.max(...bs.map((b) => b.x + b.w)) - g.x
      g.h = Math.max(...bs.map((b) => b.y + b.h)) - g.y
      const room = { w: f.props.w - PAD * 2, h: f.props.h - PAD * 2 }
      const k = Math.min(1, room.w / g.w, room.h / g.h)
      if (k < MIN_FIT) throw new Error(`too much to fit in ${frameId}: it would take shrinking to ${Math.round(k * 100)}% (at least ${MIN_FIT * 100}%); use a bigger frame, or several`)
      const x0 = f.x + PAD + (room.w - g.w * k) / 2, y0 = f.y + PAD + (room.h - g.h * k) / 2 // centred
      shapes.forEach((s, i) => {
        const scaled = k < 1 ? scaleShape(s, k, k) : s
        const nb = pageBounds(scaled)
        const x = x0 + (bs[i].x - g.x) * k, y = y0 + (bs[i].y - g.y) * k
        store.put({ ...scaled, x: scaled.x + x - nb.x, y: scaled.y + y - nb.y })
      })
      focus = { x: f.x, y: f.y }
      return shapes.map((s) => s.id)
    },
    // only what an agent added; a frame goes with its title, its members stay
    delete(ids) {
      for (const id of ids) {
        const s = need(id)
        if (!s.agent) throw new Error(`refused: ${id} was not added by an agent`)
      }
      store.remove(ids)
      return ids
    },
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
function route(store, [ra, rb]) {
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
export function runOp(store, name, fn, { area } = {}) {
  const op = 'op:' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6)
  const { ops, focus, reroute, area: grown } = operations(store, name, op, { area })
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
export function applySteps(store, name, steps, { area } = {}) {
  if (!Array.isArray(steps)) throw new Error('steps must be an array')
  return runOp(store, name, (ops) => {
    const refs = {}
    const r = (v) => (typeof v === 'string' && v.startsWith('@') ? refs[v.slice(1)] ?? (() => { throw new Error(`unknown ref ${v}`) })() : v)
    const opts = (s) => ({ color: s.color, at: s.at, w: s.w, h: s.h, fill: s.fill, inFrame: r(s.in) })
    return steps.map((s, i) => {
      let out
      switch (s.do) {
        case 'note': out = ops.note(s.text ?? '', opts(s)); break
        case 'text': out = ops.text(s.text ?? '', opts(s)); break
        case 'shape': out = ops.shape(s.shape ?? 'rectangle', s.text ?? s.label ?? '', opts(s)); break
        case 'markdown': out = ops.markdown(s.text ?? s.md ?? '', opts(s)); break
        case 'image': out = ops.image(s.src, s.natural, opts(s)); break
        case 'embed': out = ops.embed({ url: s.url, html: s.html, link: s.link, title: s.title, preview: s.preview }, opts(s)); break
        case 'ticket': out = ops.ticket(s.title ?? s.text ?? '', { body: s.body, to: s.to }, opts(s)); break
        case 'status': out = ops.status(r(s.id), s.status, { by: s.by, result: s.result }); break
        case 'frame': out = ops.frame(s.title ?? s.text, { ...opts(s), aspect: s.aspect, around: s.around?.map(r) }); break
        case 'arrow': out = ops.arrow(r(s.from), r(s.to), { color: s.color, line: s.line }); break
        case 'update': out = ops.update(r(s.id), { text: s.text, color: s.color, w: s.w, h: s.h }); break
        case 'move': out = ops.move(r(s.id), s); break
        case 'arrange': out = ops.arrange(s.ids.map(r), s); break
        case 'fit': out = ops.fit(r(s.frame ?? s.id), { ids: (s.ids ?? []).map(r) }); break
        case 'delete': out = ops.delete((s.ids ?? [s.id]).map(r)); break
        default: throw new Error(`step ${i + 1}: unknown "do": ${JSON.stringify(s.do)}`)
      }
      if (s.ref) refs[s.ref] = out
      return out
    })
  }, { area })
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
