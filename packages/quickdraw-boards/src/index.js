// A board in a board. A board card is a shape for another board: its title
// and a picture of it, and an Open button; or, made live, a window onto it
// that shows it as it is now, as people draw on it (read only; double-click
// to pan and zoom in it).
//
// Boards are the app's (where they are, what they are called, their
// pictures), so it is the host that knows them:
//   host.boards()      [{ id, title, thumbnailAt? }] — the ones a card may show (it is asked again now and then)
//   host.thumbnail(id, at)  the URL of a board's picture (null for none)
//   host.view(id)      the URL of a page that shows the board, read only (the live window)
//   host.open(id)      goes to the board
//   host.current?      the board this is (no card of itself)
// Record: { type: 'boardcard', props: { board, title, w, h, live } } (title:
// as it was when the card was made; the host's, when it knows the board).
import * as core from '@quickdrawjs/core'

export const TYPE = 'boardcard'
export const isBoardCard = (s) => s?.type === TYPE
const W = 360, H = 260, HEAD = 34, MIN_W = 180, MIN_H = 120
const { newId, FONTS } = core
const sans = FONTS?.sans ?? 'system-ui, sans-serif'
export const isBoardCardSupported = () => typeof core.registerShapeType === 'function'

// what the host knows, for drawing: id -> { title, thumbnail URL }; pictures by URL
const known = new Map()
const pictures = new Map()
let redraw = () => {}

function picture(url) {
  if (!url || typeof Image === 'undefined') return null
  let e = pictures.get(url)
  if (!e) {
    e = { img: new Image(), ready: false }
    e.img.onload = () => { e.ready = true; redraw() }
    e.img.src = url
    pictures.set(url, e)
  }
  return e.ready ? e.img : null
}

const bounds = (s) => ({ x: 0, y: 0, w: Math.max(MIN_W, s.props.w), h: Math.max(MIN_H, s.props.h) })

function fit(text, ctx, max) {
  let t = String(text)
  if (ctx.measureText(t).width <= max) return t
  while (t.length > 1 && ctx.measureText(t + '…').width > max) t = t.slice(0, -1)
  return t + '…'
}

function draw(ctx, shape, { theme }) {
  const p = shape.props
  const { w, h } = bounds(shape)
  const ink = theme.colors.black.stroke, soft = theme.colors.grey.stroke
  const k = known.get(p.board)
  ctx.save()
  ctx.beginPath()
  ctx.roundRect(0, 0, w, h, 10)
  ctx.fillStyle = theme.background
  ctx.fill()
  ctx.lineWidth = 1.5
  ctx.strokeStyle = soft
  ctx.stroke()
  ctx.clip()
  // its head: a board sign (four squares) and its title
  ctx.strokeStyle = soft
  ctx.lineWidth = 1.4
  for (const [x, y] of [[12, 10], [20, 10], [12, 18], [20, 18]]) { ctx.beginPath(); ctx.roundRect(x, y, 6, 6, 1.5); ctx.stroke() }
  ctx.font = `600 14px ${sans}`
  ctx.fillStyle = ink
  ctx.textBaseline = 'middle'
  ctx.fillText(fit(k?.title ?? p.title ?? 'Board', ctx, w - 48 - (p.live ? 44 : 0)), 36, HEAD / 2 + 1)
  if (p.live) { ctx.font = `600 10px ${sans}`; ctx.fillStyle = theme.colors.red.stroke; ctx.textAlign = 'right'; ctx.fillText('LIVE', w - 12, HEAD / 2 + 1); ctx.textAlign = 'left' }
  ctx.beginPath(); ctx.moveTo(0, HEAD); ctx.lineTo(w, HEAD); ctx.strokeStyle = soft; ctx.lineWidth = 1; ctx.stroke()
  // what it looks like: its picture, fitted; else a word
  const img = picture(k?.thumbnail)
  const area = { x: 0, y: HEAD, w, h: h - HEAD }
  if (img) {
    const s = Math.min(area.w / img.naturalWidth, area.h / img.naturalHeight)
    const iw = img.naturalWidth * s, ih = img.naturalHeight * s
    ctx.drawImage(img, area.x + (area.w - iw) / 2, area.y + (area.h - ih) / 2, iw, ih)
  } else {
    ctx.font = `13px ${sans}`
    ctx.fillStyle = soft
    ctx.textAlign = 'center'
    ctx.fillText(k ? 'No picture yet' : 'A board', w / 2, area.y + area.h / 2)
    ctx.textAlign = 'left'
  }
  ctx.restore()
}

const scale = (shape, sx, sy) => ({ ...shape, props: { ...shape.props, w: Math.max(MIN_W, shape.props.w * sx), h: Math.max(MIN_H, shape.props.h * (sy ?? sx)) } })

let registered = false
/** Registers the card's shape type; false on a core without registerShapeType. */
export function registerBoardCard() {
  if (!isBoardCardSupported()) return false
  if (!registered) core.registerShapeType(TYPE, { bounds, draw, scale })
  return (registered = true)
}

/** A card for a board, its top-left at x, y. Returns its id. */
export function createBoardCard(store, { x, y, board, title = 'Board', w = W, h = H, live = false }) {
  if (!registerBoardCard()) throw new Error('This Quickdraw core cannot draw custom shapes (registerShapeType is missing)')
  const id = newId()
  store.put({ id, typeName: 'shape', type: TYPE, x, y, rot: 0, z: store.maxZ() + 1, props: { board: String(board), title: String(title), w, h, live: !!live } })
  return id
}

// For quickdraw-import's `types`. An error message, or null.
export function validateBoardCard(shape) {
  const p = shape.props
  if (typeof p.board !== 'string' || !/^[\w-]{1,64}$/.test(p.board)) return 'bad props.board'
  if (typeof p.title !== 'string' || p.title.length > 300) return 'bad props.title'
  for (const k of ['w', 'h']) if (!Number.isFinite(p[k]) || p[k] <= 0 || p[k] > 4000) return `bad props.${k}`
  if (typeof p.live !== 'boolean') return 'bad props.live'
  return null
}

/** Sets what the host knows of boards (titles, pictures), for drawing cards. */
export function knowBoards(list, thumbnail = () => null) {
  known.clear()
  for (const b of list) known.set(b.id, { title: b.title, thumbnail: thumbnail(b.id, b.thumbnailAt) })
  redraw()
}

/**
 * Board cards on a page: what the host knows of boards (asked again every
 * `every` ms), an Open button on each card, and a live window on live ones
 * (at most `maxLive`; double-click one to pan and zoom in it). Returns
 * { refresh, destroy }.
 */
export function bindBoardCards(editor, host, { every = 60_000, maxLive = 4 } = {}) {
  if (!registerBoardCard()) return { refresh() {}, destroy() {} }
  redraw = () => editor.requestRender()
  const layer = document.createElement('div')
  Object.assign(layer.style, { position: 'absolute', inset: '0', overflow: 'hidden', pointerEvents: 'none' })
  editor.canvas.after(layer) // over the shapes, below the selection handles
  const mounted = new Map() // id -> { box, frame?, key }
  let active = null // the live window being used
  let raf = 0
  const schedule = () => { if (!raf) raf = requestAnimationFrame(() => { raf = 0; reconcile() }) }

  async function learn() {
    try { knowBoards(await host.boards(), host.thumbnail) } catch {}
  }

  function mount(s) {
    const box = document.createElement('div')
    Object.assign(box.style, { position: 'absolute', left: '0', top: '0', transformOrigin: '0 0', pointerEvents: 'none' })
    const open = document.createElement('button')
    open.type = 'button'
    open.textContent = 'Open ↗'
    open.title = 'Go to this board'
    Object.assign(open.style, { position: 'absolute', right: '8px', bottom: '8px', zIndex: 2, pointerEvents: 'auto', font: `600 12px ${sans}`, padding: '4px 10px', borderRadius: '999px', border: '1px solid #bbb', background: '#fff', color: '#222', cursor: 'pointer' })
    open.onpointerdown = (e) => e.stopPropagation()
    open.onclick = () => host.open(editor.store.get(s.id)?.props.board ?? s.props.board)
    box.append(open)
    let frame = null
    if (s.props.live && s.props.board !== host.current) {
      frame = document.createElement('iframe')
      frame.src = host.view(s.props.board)
      frame.title = 'Board: ' + (known.get(s.props.board)?.title ?? s.props.title)
      // our own page, read only: it needs its scripts and its origin (its connection); no forms, popups or top navigation
      frame.setAttribute('sandbox', 'allow-scripts allow-same-origin')
      Object.assign(frame.style, { position: 'absolute', left: '0', top: HEAD + 'px', width: '100%', height: `calc(100% - ${HEAD}px)`, border: '0', borderRadius: '0 0 10px 10px', background: 'transparent', pointerEvents: 'none' })
      box.append(frame)
    }
    layer.append(box)
    return { box, frame, key: `${s.props.board}|${s.props.live}` }
  }

  function reconcile() {
    const v = editor.viewportPageBounds()
    const cards = editor.shapesSorted().filter((s) => {
      if (!isBoardCard(s)) return false
      const b = core.pageBounds(s)
      return b.x < v.x + v.w && b.x + b.w > v.x && b.y < v.y + v.h && b.y + b.h > v.y
    })
    let live = 0
    const want = new Map()
    for (const s of [...cards].reverse()) { // the topmost first get their live windows
      const isLive = s.props.live && live < maxLive
      if (isLive) live++
      want.set(s.id, isLive ? s : { ...s, props: { ...s.props, live: false } })
    }
    for (const [id, m] of [...mounted]) if (!want.has(id)) { m.box.remove(); mounted.delete(id) }
    cards.forEach((card, order) => {
      const s = want.get(card.id)
      let m = mounted.get(s.id)
      if (m && m.key !== `${s.props.board}|${s.props.live}`) { m.box.remove(); mounted.delete(s.id); m = null }
      if (!m) mounted.set(s.id, m = mount(s))
      const { w, h } = bounds(s)
      const p = editor.pageToScreen(s.x, s.y)
      Object.assign(m.box.style, {
        width: w + 'px', height: h + 'px', zIndex: String(order),
        transform: `translate(${p.x}px, ${p.y}px) scale(${editor.camera.z})` + (s.rot ? ` translate(${w / 2}px, ${h / 2}px) rotate(${s.rot}rad) translate(${-w / 2}px, ${-h / 2}px)` : ''),
        outline: s.id === active ? '2px solid #4263eb' : 'none', borderRadius: '10px',
      })
      if (m.frame) m.frame.style.pointerEvents = s.id === active ? 'auto' : 'none'
    })
  }

  // double-click a live card to use its window (pan, zoom); a click elsewhere or Esc gives it back
  const onDblClick = (e) => {
    const r = editor.container.getBoundingClientRect()
    const pt = editor.screenToPage(e.clientX - r.left, e.clientY - r.top)
    const hit = editor.hitTest(pt.x, pt.y)
    if (isBoardCard(hit) && hit.props.live) { active = hit.id; schedule() }
  }
  const release = () => { if (active) { active = null; schedule() } }
  const onKey = (e) => { if (e.key === 'Escape') release() }
  editor.container.addEventListener('dblclick', onDblClick)
  editor.container.addEventListener('pointerdown', release, true)
  addEventListener('keydown', onKey)
  const offs = [editor.store.listen(schedule), editor.on('camera', schedule)]
  addEventListener('resize', schedule)
  learn()
  const timer = setInterval(learn, every)
  schedule()
  return {
    refresh: () => { learn(); schedule() },
    destroy() {
      clearInterval(timer)
      cancelAnimationFrame(raf)
      offs.forEach((off) => off?.())
      removeEventListener('resize', schedule)
      removeEventListener('keydown', onKey)
      editor.container.removeEventListener('dblclick', onDblClick)
      editor.container.removeEventListener('pointerdown', release, true)
      layer.remove()
    },
  }
}

const svg = (inner) => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${inner}</svg>`
export const BOARD_ICONS = {
  board: svg('<rect x="3" y="3" width="8" height="8" rx="1.5"/><rect x="13" y="3" width="8" height="8" rx="1.5"/><rect x="3" y="13" width="8" height="8" rx="1.5"/><path d="M13 17h8M17 13v8"/>'),
  live: svg('<circle cx="12" cy="12" r="2"/><path d="M7.8 7.8a6 6 0 0 0 0 8.4M16.2 7.8a6 6 0 0 1 0 8.4M5 5a10 10 0 0 0 0 14M19 5a10 10 0 0 1 0 14"/>'),
  open: svg('<path d="M14 4h6v6"/><path d="M20 4 11 13"/><path d="M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5"/>'),
}

/**
 * Toolbar items (quickdraw-toolbar's shape): a card for another board from
 * the rail (a menu of the boards the host knows), and Live view / Open on a
 * selected card.
 */
export function boardCardTools(host) {
  const available = isBoardCardSupported
  return {
    rail: [{
      id: 'board-card', title: 'A board in this board', icon: BOARD_ICONS.board, available,
      menu: () => {
        const others = [...known].filter(([id]) => id !== host.current)
        return others.length ? others.map(([id, b]) => ({ id: 'board-card-' + id, title: b.title || 'Untitled', run: ({ editor }) => {
          const v = editor.viewportPageBounds()
          const card = createBoardCard(editor.store, { x: Math.round(v.x + v.w / 2 - W / 2), y: Math.round(v.y + v.h / 2 - H / 2), board: id, title: b.title })
          editor.setTool('select')
          editor.setSelection([card])
        } })) : [{ id: 'board-card-none', title: 'No other boards yet', run: () => {} }]
      },
    }],
    context: [
      { id: 'board-live', title: 'Live view', icon: BOARD_ICONS.live, when: isBoardCard,
        menu: [[true, 'Live: show it as it is now'], [false, 'Picture']].map(([live, label]) => ({
          id: 'board-live-' + live, title: label, checked: ({ shape }) => !!shape.props.live === live,
          run: ({ editor, shape }) => editor.store.update(shape.id, { props: { live } }),
        })) },
      { id: 'board-open', title: 'Open board', icon: BOARD_ICONS.open, when: isBoardCard, run: ({ shape }) => host.open(shape.props.board) },
    ],
  }
}
