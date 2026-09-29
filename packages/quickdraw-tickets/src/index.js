// Tickets for agents: a card people write ("do this") and an agent takes,
// works on and closes. A custom shape type ('ticket') drawn on the canvas, so
// it selects, moves, exports and follows the theme like any other shape.
// Record: { type: 'ticket', props: { title, body, to, from, status, by, result, created, w } }
// - to: the agent it is for (its name), or null for any agent
// - status: todo | doing | done | failed; by: who took it; result: a word on how it went
// The height follows the text; corner-resizing changes the width.
//
// A kanban (kanban.js) is three frames, Todo / Doing / Done, marked `kanban`:
// a ticket's column follows its status, and its status follows the column a
// person drags it into.
import * as core from '@quickdrawjs/core'

export { createKanban, bindKanban, setTicketStatus, placeInColumn, columnOf, kanbanColumn, kanbanNear, isColumn, COLUMNS } from './kanban.js'
export { ticketTools, TICKET_ICONS } from './tools.js'

export const TYPE = 'ticket'
export const STATUSES = ['todo', 'doing', 'done', 'failed']
export const STATUS_COLORS = { todo: 'grey', doing: 'blue', done: 'green', failed: 'red' }
export const MAX_TITLE = 500
export const MAX_BODY = 10_000
const W = 240
const MIN_W = 160
const MAX_W = 1200
const PAD = 14
const HEAD = 18 // the status row
const BODY_LINES = 8
const RESULT_LINES = 4

const { newId, FONTS } = core
export const isTicketSupported = () => typeof core.registerShapeType === 'function'
export const isTicket = (s) => s?.type === TYPE
const UNSUPPORTED = 'This Quickdraw core cannot draw custom shapes (registerShapeType is missing)'

// canvas text measurement; outside a browser (tests, servers) an estimate
let measureCtx
function measure(font, text) {
  if (measureCtx === undefined) measureCtx = globalThis.document?.createElement('canvas').getContext('2d') ?? null
  if (!measureCtx) return [...text].length * parseFloat(font.match(/(\d+(?:\.\d+)?)px/)[1]) * 0.6
  measureCtx.font = font
  return measureCtx.measureText(text).width
}

// Lines of at most maxW: breaks at spaces, between CJK characters, and inside
// a word wider than the line. At most `max` lines, the last one cut with "…".
const CJK = '⺀-鿿가-힯豈-﫿＀-￯'
const TOKENS = new RegExp(`\\s+|[${CJK}]|[^\\s${CJK}]+`, 'gu')
function wrap(text, font, maxW, max = Infinity) {
  const out = []
  for (const para of String(text ?? '').split('\n')) {
    let line = ''
    for (const t of para.match(TOKENS) ?? []) {
      for (const token of t.trim() && measure(font, t) > maxW ? Array.from(t) : [t]) {
        if (line && measure(font, line + token) > maxW) { out.push(line.trimEnd()); line = token.trimStart() }
        else line += token
      }
    }
    out.push(line.trimEnd())
  }
  if (out.length > max) {
    out.length = max
    let last = out[max - 1]
    while (last && measure(font, last + '…') > maxW) last = last.slice(0, -1)
    out[max - 1] = last + '…'
  }
  return out
}

const FONT = {
  head: `600 11px ${FONTS.sans}`,
  title: `600 15px ${FONTS.sans}`,
  body: `13px ${FONTS.sans}`,
  result: `italic 13px ${FONTS.sans}`,
}

// who the ticket is with, for its top-right corner
export function ticketWho(p) {
  if (p.status === 'todo') return p.to ? '→ ' + p.to : 'any agent'
  return p.by || p.to || ''
}

// layouts are pure in props (a new props object on every change): cache them
const layouts = new WeakMap()
function layout(shape) {
  const p = shape.props
  let l = layouts.get(p)
  if (l) return l
  const w = Math.max(MIN_W, p.w) - PAD * 2
  const lines = []
  let y = PAD + HEAD + 8
  const add = (text, font, lh, style) => { for (const t of text) { lines.push({ text: t, font, y: y + lh * 0.75, style }); y += lh } }
  add(wrap(p.title || 'Untitled', FONT.title, w, 4), FONT.title, 20, 'title')
  if (p.body) { y += 4; add(wrap(p.body, FONT.body, w, BODY_LINES), FONT.body, 18, 'body') }
  if (p.result) { y += 6; add(wrap(p.result, FONT.result, w, RESULT_LINES), FONT.result, 18, 'result') }
  l = { lines, h: y + PAD }
  layouts.set(p, l)
  return l
}

function bounds(shape) {
  return { x: 0, y: 0, w: Math.max(MIN_W, shape.props.w), h: layout(shape).h }
}

// the status sign, a line icon in a 14px box at (x, y)
function drawStatus(ctx, status, x, y, color) {
  const cx = x + 7, cy = y + 7
  ctx.save()
  ctx.strokeStyle = color
  ctx.fillStyle = color
  ctx.lineWidth = 1.6
  ctx.lineCap = 'round'
  ctx.lineJoin = 'round'
  ctx.beginPath()
  ctx.arc(cx, cy, 6, 0, Math.PI * 2)
  ctx.stroke()
  ctx.beginPath()
  if (status === 'doing') { // half full
    ctx.moveTo(cx, cy - 3.5)
    ctx.arc(cx, cy, 3.5, -Math.PI / 2, Math.PI / 2)
    ctx.closePath()
    ctx.fill()
  } else if (status === 'done') {
    ctx.moveTo(cx - 3, cy)
    ctx.lineTo(cx - 0.8, cy + 2.4)
    ctx.lineTo(cx + 3.2, cy - 2.4)
    ctx.stroke()
  } else if (status === 'failed') {
    ctx.moveTo(cx - 2.5, cy - 2.5); ctx.lineTo(cx + 2.5, cy + 2.5)
    ctx.moveTo(cx + 2.5, cy - 2.5); ctx.lineTo(cx - 2.5, cy + 2.5)
    ctx.stroke()
  }
  ctx.restore()
}

function draw(ctx, shape, { theme }) {
  const p = shape.props
  const b = bounds(shape)
  const accent = theme.colors[STATUS_COLORS[p.status] || 'grey'].stroke
  const ink = theme.colors.black.stroke
  const soft = theme.colors.grey.stroke
  ctx.beginPath()
  ctx.roundRect(0, 0, b.w, b.h, 8)
  ctx.fillStyle = theme.background
  ctx.fill()
  ctx.lineWidth = 1.5
  ctx.strokeStyle = p.status === 'todo' ? soft : accent
  ctx.stroke()
  ctx.save()
  ctx.clip()
  ctx.fillStyle = accent
  ctx.fillRect(0, 0, 4, b.h) // the status stripe
  drawStatus(ctx, p.status, PAD, PAD + 2, accent)
  ctx.textBaseline = 'alphabetic'
  ctx.font = FONT.head
  ctx.fillStyle = accent
  ctx.fillText(String(p.status || 'todo').toUpperCase(), PAD + 20, PAD + 13)
  const who = ticketWho(p)
  if (who) {
    const room = b.w - PAD * 2 - 20 - measure(FONT.head, 'FAILED') - 12
    let text = who
    while (text.length > 1 && measure(FONT.head, text) > room) text = text.slice(0, -2) + '…'
    ctx.fillStyle = soft
    ctx.textAlign = 'right'
    ctx.fillText(text, b.w - PAD, PAD + 13)
    ctx.textAlign = 'left'
  }
  for (const line of layout(shape).lines) {
    ctx.font = line.font
    ctx.fillStyle = line.style === 'result' ? accent : ink
    ctx.globalAlpha = line.style === 'body' ? 0.78 : 1
    ctx.fillText(line.text, PAD, line.y)
  }
  ctx.restore()
}

// corner or side handles: only the width changes; the height follows the text
const scale = (shape, sx) => ({ ...shape, props: { ...shape.props, w: Math.min(MAX_W, Math.max(MIN_W, shape.props.w * sx)) } })

// Registers the shape type; returns false on a core without registerShapeType.
let registered = false
export function registerTicket() {
  if (!isTicketSupported()) return false
  if (!registered) core.registerShapeType(TYPE, { bounds, draw, scale })
  return (registered = true)
}

// A new ticket, `todo` unless said otherwise. Returns its id.
export function createTicket(store, { x, y, w = W, title = '', body = '', to = null, from = null, status = 'todo' }) {
  if (!registerTicket()) throw new Error(UNSUPPORTED)
  if (!STATUSES.includes(status)) throw new Error(`unknown status "${status}" (one of ${STATUSES.join(', ')})`)
  const id = newId()
  store.put({
    id, typeName: 'shape', type: TYPE, x, y, rot: 0, z: store.maxZ() + 1,
    props: { title: String(title), body: String(body), to: to || null, from: from || null, status, by: null, result: null, created: Date.now(), w },
  })
  return id
}

const optionalString = (v, max) => v == null || (typeof v === 'string' && v.length <= max)

// For quickdraw-import's `types` option: { types: { ticket: validateTicket } }.
// Returns an error message, or null when the record is a sound ticket.
export function validateTicket(shape) {
  const p = shape.props
  if (typeof p.title !== 'string' || p.title.length > MAX_TITLE) return 'bad props.title'
  if (!optionalString(p.body, MAX_BODY)) return 'bad props.body'
  if (!STATUSES.includes(p.status)) return 'bad props.status'
  for (const k of ['to', 'from', 'by']) if (!optionalString(p[k], 200)) return `bad props.${k}`
  if (!optionalString(p.result, MAX_BODY)) return 'bad props.result'
  if (p.created != null && !Number.isFinite(p.created)) return 'bad props.created'
  if (!Number.isFinite(p.w) || p.w <= 0 || p.w > MAX_W) return 'bad props.w'
  return null
}

// A ticket as data, for agents: what it asks, for whom, and where it stands.
export function describeTicket(s) {
  const p = s.props
  return {
    id: s.id, title: p.title, ...(p.body ? { body: p.body } : {}), to: p.to ?? null, ...(p.from ? { from: p.from } : {}),
    status: p.status, by: p.by ?? null, ...(p.result ? { result: p.result } : {}), ...(p.created ? { created: p.created } : {}),
    ...(s.frameId ? { frame: s.frameId } : {}),
  }
}

const sameName = (a, b) => String(a).toLowerCase() === String(b).toLowerCase()
/** Whether a ticket is for this agent: addressed to it, or to any agent. */
export const ticketIsFor = (s, name) => !s.props.to || sameName(s.props.to, name)

// The board's tickets, oldest first. status: one status (or a list);
// for: an agent's name, keeping tickets addressed to it or to anyone.
export function listTickets(store, { status, for: name } = {}) {
  const want = status == null ? null : [status].flat()
  return store.shapes()
    .filter((s) => isTicket(s) && (!want || want.includes(s.props.status)) && (name == null || ticketIsFor(s, name)))
    .sort((a, b) => (a.props.created ?? 0) - (b.props.created ?? 0) || a.y - b.y || a.x - b.x)
}

// Edits a ticket in a textarea laid over it: the first line is its title, the
// rest its details. Commits on blur, Escape or ⌘/Ctrl+Enter. Resolves to the
// new { title, body }, or null if the ticket is gone.
export function editTicket(editor, id) {
  const shape = editor.store.get(id)
  if (!isTicket(shape)) return Promise.resolve(null)
  const ta = document.createElement('textarea')
  ta.value = shape.props.title + (shape.props.body ? '\n' + shape.props.body : '')
  ta.placeholder = 'What should the agent do?\nDetails on the next lines'
  Object.assign(ta.style, {
    position: 'fixed', zIndex: 60, boxSizing: 'border-box', resize: 'none', margin: 0,
    padding: '10px 12px', font: `14px ${FONTS.sans}`, lineHeight: 1.45, borderRadius: '8px',
    border: `2px solid ${editor.theme.colors.blue.stroke}`, background: editor.theme.background,
    color: editor.theme.colors.black.stroke, outline: 'none',
  })
  const place = () => {
    const s = editor.store.get(id)
    if (!s) return
    const r = editor.container.getBoundingClientRect()
    const p = editor.pageToScreen(s.x, s.y)
    const b = bounds(s)
    const w = Math.min(Math.max(260, b.w * editor.camera.z), r.width - 16)
    Object.assign(ta.style, {
      left: Math.max(r.left + 8, Math.min(r.left + p.x, r.right - w - 8)) + 'px', top: Math.max(r.top + 8, r.top + p.y) + 'px',
      width: w + 'px', height: Math.max(140, b.h * editor.camera.z) + 'px',
    })
  }
  place()
  const offCamera = editor.on('camera', place)
  document.body.append(ta)
  ta.focus()
  return new Promise((resolve) => {
    let done = false
    const finish = () => {
      if (done) return
      done = true
      offCamera?.()
      ta.remove()
      const s = editor.store.get(id)
      if (!s) return resolve(null)
      const [title = '', ...rest] = ta.value.split('\n')
      const next = { title: title.trim().slice(0, MAX_TITLE), body: rest.join('\n').trim().slice(0, MAX_BODY) }
      if (next.title !== s.props.title || next.body !== s.props.body) editor.store.update(id, { props: next })
      resolve(next)
    }
    ta.addEventListener('blur', finish)
    ta.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' || (e.key === 'Enter' && (e.metaKey || e.ctrlKey))) { e.preventDefault(); finish() }
    })
  })
}

// Double-click a ticket to edit it (desktop; the selection bar's Edit is the
// way on a phone). Returns an unbind.
export function bindTicketEditing(editor) {
  if (!registerTicket()) return () => {}
  const onDblClick = (e) => {
    const r = editor.container.getBoundingClientRect()
    const p = editor.screenToPage(e.clientX - r.left, e.clientY - r.top)
    const hit = editor.hitTest(p.x, p.y)
    if (isTicket(hit)) editTicket(editor, hit.id)
  }
  editor.container.addEventListener('dblclick', onDblClick)
  return () => editor.container.removeEventListener('dblclick', onDblClick)
}
