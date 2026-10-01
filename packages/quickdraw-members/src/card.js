// A profile card on the board: an agent's name, role and what it does, as the
// members table has them. The table is what counts — the card is a view of
// it, put where people want one: changing its role (double-click, or Edit on
// the selection bar) changes the table, and every card of that agent follows;
// removing a card leaves the role as it is.
// Record: { type: 'member', props: { name, role, about, avatar, w } } (role,
// about and avatar — its pet's sheet, an asset id — the table's, kept on the
// card so it draws anywhere: an export, a headless render, a page without the
// table). A pet shows as its first idle frame: the canvas is not redrawn all
// the time, so cards keep still (the cursor and the Team panel move).
import * as core from '@quickdrawjs/core'
import { freeSpot } from 'quickdraw-frames'
import { PET_CELL, PET_COLUMNS, isPet } from './pet.js'

export const CARD = 'member'
const W = 260
const MIN_W = 180
const MAX_W = 600
const PAD = 14
const AV = 36 // the avatar circle
const PET_H = 52 // a pet, standing
const { newId, FONTS } = core
export const isMemberCard = (s) => s?.type === CARD
export const isCardSupported = () => typeof core.registerShapeType === 'function'

let measureCtx
function measure(font, text) {
  if (measureCtx === undefined) measureCtx = globalThis.document?.createElement('canvas').getContext('2d') ?? null
  if (!measureCtx) return [...text].length * parseFloat(font.match(/(\d+(?:\.\d+)?)px/)[1]) * 0.6
  measureCtx.font = font
  return measureCtx.measureText(text).width
}
// lines of at most maxW (breaks at spaces and between CJK characters), at most `max`, the last cut with "…"
function wrap(text, font, maxW, max) {
  const out = []
  let line = ''
  for (const t of String(text ?? '').match(/\s+|[⺀-鿿가-힯＀-￯]|[^\s⺀-鿿가-힯＀-￯]+/gu) ?? []) {
    if (line && measure(font, line + t) > maxW) { out.push(line.trimEnd()); line = t.trimStart() } else line += t
  }
  if (line.trim()) out.push(line.trimEnd())
  if (out.length > max) {
    out.length = max
    let last = out[max - 1]
    while (last && measure(font, last + '…') > maxW) last = last.slice(0, -1)
    out[max - 1] = last + '…'
  }
  return out
}
const FONT = { name: `600 15px ${FONTS?.sans ?? 'sans-serif'}`, role: `600 13px ${FONTS?.sans ?? 'sans-serif'}`, about: `13px ${FONTS?.sans ?? 'sans-serif'}`, av: `700 13px ${FONTS?.sans ?? 'sans-serif'}` }
const COLORS = ['blue', 'green', 'violet', 'orange', 'red', 'light-blue']
// its colour, from its name: the same on every card and every page
export function colorOf(name) {
  let h = 0
  for (const c of String(name)) h = (h * 31 + c.codePointAt(0)) >>> 0
  return COLORS[h % COLORS.length]
}
const initials = (name) => String(name).split(/[\s·]+/).filter(Boolean).slice(0, 2).map((w) => [...w][0].toUpperCase()).join('') || '?'

const layouts = new WeakMap()
function layout(shape) {
  const p = shape.props
  let l = layouts.get(p)
  if (l) return l
  const w = Math.max(MIN_W, p.w) - PAD * 3 - AV
  const name = wrap(p.name || 'Agent', FONT.name, w, 2)
  const role = p.role ? wrap(p.role, FONT.role, w, 2) : []
  const about = p.about ? wrap(p.about, FONT.about, Math.max(MIN_W, p.w) - PAD * 2, 4) : []
  const head = Math.max(p.avatar ? PET_H : AV, name.length * 20 + role.length * 18 + (role.length ? 2 : 0))
  l = { name, role, about, head, h: PAD + head + (about.length ? 8 + about.length * 18 : 0) + PAD }
  layouts.set(p, l)
  return l
}
const bounds = (shape) => ({ x: 0, y: 0, w: Math.max(MIN_W, shape.props.w), h: layout(shape).h })

function draw(ctx, shape, opts) {
  const { theme } = opts
  const p = shape.props
  const b = bounds(shape)
  const l = layout(shape)
  const accent = (theme.colors[colorOf(p.name)] ?? theme.colors.blue).stroke
  const ink = theme.colors.black.stroke
  const soft = theme.colors.grey.stroke
  ctx.beginPath()
  ctx.roundRect(0, 0, b.w, b.h, 12)
  ctx.fillStyle = theme.background
  ctx.fill()
  ctx.lineWidth = 1.5
  ctx.strokeStyle = accent
  ctx.stroke()
  // the avatar: its pet's first idle frame, else its initials in its colour
  const pet = p.avatar ? sheet(opts.store, p.avatar, opts.onAssetLoad) : null
  if (pet) {
    const w = (PET_H * PET_CELL.w) / PET_CELL.h
    const cw = pet.naturalWidth / PET_COLUMNS, ch = pet.naturalHeight / 9 // the sheet may be smaller than a Codex pet's own
    ctx.drawImage(pet, 0, 0, cw, ch, PAD + AV / 2 - w / 2, PAD - 4, w, PET_H)
  } else drawInitials(ctx, p, theme, accent)
  ctx.textAlign = 'left'
  ctx.textBaseline = 'alphabetic'
  const x = PAD * 2 + AV
  let y = PAD + Math.max(0, ((p.avatar ? PET_H - 8 : AV) - (l.name.length * 20 + l.role.length * 18)) / 2)
  drawText(ctx, l, x, y, ink, accent, soft)
}

// a pet's sheet, loaded once per asset; null until it is (then the board draws again)
const sheets = new Map()
function sheet(store, assetId, onLoad) {
  const had = sheets.get(assetId)
  if (had) return had.ready ? had.img : null
  const src = store?.asset?.(assetId)?.src
  if (!src || typeof Image === 'undefined') return null
  const img = new Image()
  const e = { img, ready: false }
  sheets.set(assetId, e)
  img.onload = () => { e.ready = true; onLoad?.() }
  img.src = src
  return null
}

function drawInitials(ctx, p, theme, accent) {
  ctx.beginPath()
  ctx.arc(PAD + AV / 2, PAD + AV / 2, AV / 2, 0, Math.PI * 2)
  ctx.fillStyle = accent
  ctx.fill()
  ctx.fillStyle = theme.background
  ctx.font = FONT.av
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  ctx.fillText(initials(p.name), PAD + AV / 2, PAD + AV / 2 + 1)
}

function drawText(ctx, l, x, y, ink, accent, soft) {
  ctx.font = FONT.name
  ctx.fillStyle = ink
  for (const t of l.name) { y += 20; ctx.fillText(t, x, y - 5) }
  ctx.font = FONT.role
  ctx.fillStyle = accent
  if (!l.role.length) { ctx.font = `italic ${FONT.about}`; ctx.fillStyle = soft; ctx.fillText('no role yet', x, y + 13) }
  for (const t of l.role) { y += 18; ctx.fillText(t, x, y - 3) }
  ctx.font = FONT.about
  ctx.fillStyle = ink
  ctx.globalAlpha = 0.78
  let ay = PAD + l.head + 8
  for (const t of l.about) { ay += 18; ctx.fillText(t, PAD, ay - 5) }
  ctx.globalAlpha = 1
}

// only the width changes; the height follows the text
const scale = (shape, sx) => ({ ...shape, props: { ...shape.props, w: Math.min(MAX_W, Math.max(MIN_W, shape.props.w * sx)) } })

let registered = false
/** Registers the card's shape type; false on a core without registerShapeType. */
export function registerMemberCard() {
  if (!isCardSupported()) return false
  if (!registered) core.registerShapeType(CARD, { bounds, draw, scale })
  return (registered = true)
}

/** Puts an agent's card on the board, with what the table says of it. Returns its id. */
export function createMemberCard(store, { x, y, name, members, w = W }) {
  if (!registerMemberCard()) throw new Error('This Quickdraw core cannot draw custom shapes (registerShapeType is missing)')
  const m = members?.get(name)
  const id = newId()
  store.put({ id, typeName: 'shape', type: CARD, x, y, rot: 0, z: store.maxZ() + 1, props: { name: m?.name ?? String(name), role: m?.role ?? '', about: m?.about ?? '', avatar: isPet(m?.avatar) ? m.avatar.asset : null, w } })
  return id
}

// For quickdraw-import's `types` option. An error message, or null.
export function validateMemberCard(shape) {
  const p = shape.props
  if (typeof p.name !== 'string' || !p.name || p.name.length > 200) return 'bad props.name'
  for (const k of ['role', 'about']) if (p[k] != null && (typeof p[k] !== 'string' || p[k].length > 300)) return `bad props.${k}`
  if (p.avatar != null && (typeof p.avatar !== 'string' || p.avatar.length > 200)) return 'bad props.avatar'
  if (!Number.isFinite(p.w) || p.w <= 0 || p.w > MAX_W) return 'bad props.w'
  return null
}

/**
 * Keeps the cards on a board with the table: a card shows its agent's role and
 * line as the table has them, whenever either changes. Returns an unbind.
 */
export function bindMemberCards(store, members) {
  const same = (a, b) => String(a).toLowerCase() === String(b).toLowerCase()
  let busy = false
  const sync = () => {
    if (busy) return
    const list = members.list()
    const changes = []
    for (const s of store.shapes()) {
      if (!isMemberCard(s)) continue
      const m = list.find((x) => same(x.name, s.props.name))
      const role = m?.role ?? '', about = m?.about ?? '', avatar = isPet(m?.avatar) ? m.avatar.asset : null
      if (s.props.role !== role || s.props.about !== about || (s.props.avatar ?? null) !== avatar) changes.push([s.id, { props: { role, about, avatar } }])
    }
    if (!changes.length) return
    busy = true
    try { store.transact(() => { for (const [id, patch] of changes) store.update(id, patch) }) } finally { busy = false }
  }
  sync()
  const offStore = store.listen((diff) => { if (Object.values(diff.added).some(isMemberCard)) sync() })
  const offMembers = members.onChange(sync)
  return () => { offStore(); offMembers() }
}

/**
 * Edits an agent's role and line in a textarea over its card: the first line
 * is the role, the rest what it does. They go to the table (`by`: who edits).
 */
export function editMemberCard(editor, id, members, by = '') {
  const shape = editor.store.get(id)
  if (!isMemberCard(shape)) return Promise.resolve(null)
  const ta = document.createElement('textarea')
  ta.value = (shape.props.role || '') + (shape.props.about ? '\n' + shape.props.about : '')
  ta.placeholder = 'Role: transcriber, researcher, reviewer…\nWhat it does, on the next line'
  Object.assign(ta.style, {
    position: 'fixed', zIndex: 60, boxSizing: 'border-box', resize: 'none', margin: 0, padding: '10px 12px',
    font: `14px ${FONTS?.sans ?? 'sans-serif'}`, lineHeight: 1.45, borderRadius: '10px', outline: 'none',
    border: `2px solid ${editor.theme.colors[colorOf(shape.props.name)]?.stroke ?? '#1971c2'}`, background: editor.theme.background, color: editor.theme.colors.black.stroke,
  })
  const r = editor.container.getBoundingClientRect()
  const p = editor.pageToScreen(shape.x, shape.y)
  const b = bounds(shape)
  const w = Math.min(Math.max(260, b.w * editor.camera.z), r.width - 16)
  Object.assign(ta.style, {
    left: Math.max(r.left + 8, Math.min(r.left + p.x, r.right - w - 8)) + 'px', top: Math.max(r.top + 8, r.top + p.y) + 'px',
    width: w + 'px', height: Math.max(110, b.h * editor.camera.z) + 'px',
  })
  document.body.append(ta)
  ta.focus()
  return new Promise((resolve) => {
    let done = false
    const finish = (save) => {
      if (done) return
      done = true
      ta.remove()
      if (!save) return resolve(null)
      const [role = '', ...rest] = ta.value.split('\n')
      resolve(members.set(shape.props.name, { role: role.trim(), about: rest.join(' ').trim() }, by))
    }
    ta.addEventListener('blur', () => finish(true))
    ta.addEventListener('keydown', (e) => {
      e.stopPropagation()
      if (e.key === 'Escape') { e.preventDefault(); finish(false) }
      else if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); finish(true) }
    })
  })
}

const svg = (inner) => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${inner}</svg>`
export const CARD_ICONS = {
  card: svg('<rect x="3" y="5" width="18" height="14" rx="2"/><circle cx="8.5" cy="11" r="2"/><path d="M5.5 16a3 3 0 0 1 6 0"/><path d="M14 10h4"/><path d="M14 14h3"/>'),
  edit: svg('<path d="M4 20h4L19 9a2.8 2.8 0 0 0-4-4L4 16z"/><path d="m13.5 6.5 4 4"/>'),
}

/**
 * Toolbar items (quickdraw-toolbar's shape): a profile card from the rail (a
 * menu of the agents), and editing a selected one. agents(): [{ name }] on the
 * board; me(): who edits ({ name }).
 */
export function memberTools({ members, agents = () => [], me = () => null }) {
  const available = isCardSupported
  // the agents on the board, and those in the table
  const names = () => {
    const out = []
    for (const n of [...agents().map((a) => a.name), ...members.list().map((m) => m.name)]) if (n && !out.some((x) => x.toLowerCase() === n.toLowerCase())) out.push(n)
    return out
  }
  return {
    rail: [{
      id: 'member-card', title: 'Profile card', icon: CARD_ICONS.card, available,
      menu: () => {
        const list = names()
        return list.length ? list.map((name) => ({ id: 'member-card-' + name, title: name, run: ({ editor }) => {
          const v = editor.viewportPageBounds()
          const at = freeSpot(editor.store, W, 120, { x: v.x + v.w / 2 - W / 2, y: v.y + v.h * 0.3 }, { gap: 24 }) // clear of what is there
          const id = createMemberCard(editor.store, { ...at, name, members })
          editor.setTool('select')
          editor.setSelection([id])
        } })) : [{ id: 'member-card-none', title: 'No agents yet', run: () => {} }]
      },
    }],
    context: [
      { id: 'member-edit', title: 'Edit role', icon: CARD_ICONS.edit, when: isMemberCard, run: ({ editor, shape }) => editMemberCard(editor, shape.id, members, me()?.name) },
    ],
  }
}

/** Double-click a card to edit its role (desktop; the selection bar's Edit on a phone). Returns an unbind. */
export function bindMemberCardEditing(editor, members, { me = () => null } = {}) {
  if (!registerMemberCard()) return () => {}
  const onDblClick = (e) => {
    const r = editor.container.getBoundingClientRect()
    const p = editor.screenToPage(e.clientX - r.left, e.clientY - r.top)
    const hit = editor.hitTest(p.x, p.y)
    if (isMemberCard(hit)) editMemberCard(editor, hit.id, members, me()?.name)
  }
  editor.container.addEventListener('dblclick', onDblClick)
  return () => editor.container.removeEventListener('dblclick', onDblClick)
}
