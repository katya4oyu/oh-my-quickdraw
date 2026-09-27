// Markdown cards for Quickdraw: a custom shape type ('markdown') drawn on the
// board's canvas through the core's registerShapeType, so it stacks, selects,
// rotates, exports and follows the theme like any other shape.
// Record: { type: 'markdown', props: { md, w, color? } } — the height follows
// the content. Corner-resizing changes the width; the text reflows.
import { registerShapeType, newId, FONTS } from '@quickdrawjs/core'
import { parseMarkdown } from './parse.js'
import { layoutMarkdown } from './layout.js'

export { parseMarkdown, parseInline } from './parse.js'
export { layoutMarkdown } from './layout.js'

export const TYPE = 'markdown'
const PAD = 14
const MIN_W = 120

// canvas text measurement; outside a browser (tests, servers) an estimate
let measureCtx
function measure(font, text) {
  if (measureCtx === undefined) measureCtx = globalThis.document?.createElement('canvas').getContext('2d') ?? null
  if (!measureCtx) return [...text].length * parseFloat(font.match(/(\d+(?:\.\d+)?)px/)[1]) * 0.6
  measureCtx.font = font
  return measureCtx.measureText(text).width
}

// layouts are pure in (md, width): cache the recent ones
const cache = new Map()
function layout(shape) {
  const w = Math.max(MIN_W, shape.props.w) - PAD * 2
  const key = w + '\n' + shape.props.md
  let l = cache.get(key)
  if (!l) {
    l = layoutMarkdown(parseMarkdown(shape.props.md), w, measure, FONTS)
    cache.set(key, l)
    if (cache.size > 200) cache.delete(cache.keys().next().value)
  }
  return l
}

function bounds(shape) {
  return { x: 0, y: 0, w: Math.max(MIN_W, shape.props.w), h: layout(shape).height + PAD * 2 }
}

function draw(ctx, shape, { theme }) {
  const b = bounds(shape)
  const ink = theme.colors[shape.props.color || 'black'].stroke
  const grey = theme.colors.grey
  ctx.beginPath()
  ctx.roundRect(0, 0, b.w, b.h, 8)
  ctx.fillStyle = theme.background
  ctx.fill()
  ctx.lineWidth = 1
  ctx.strokeStyle = grey.stroke
  ctx.stroke()
  ctx.save()
  ctx.clip() // long code lines stay inside the card
  ctx.translate(PAD, PAD)
  ctx.textBaseline = 'alphabetic'
  for (const o of layout(shape).ops) {
    if (o.op === 'rect') {
      ctx.fillStyle = o.style === 'code' ? grey.fill : grey.stroke
      ctx.fillRect(o.x, o.y, o.w, o.h)
    } else {
      ctx.font = o.font
      ctx.fillStyle = o.style === 'link' ? theme.colors.blue.stroke : o.style === 'muted' ? grey.stroke : ink
      ctx.fillText(o.text, o.x, o.y)
      if (o.style === 'link') ctx.fillRect(o.x, o.y + 2, measure(o.font, o.text), 1)
    }
  }
  ctx.restore()
}

// corner or side handles: only the width changes; the height follows the text
const scale = (shape, sx) => ({ ...shape, props: { ...shape.props, w: Math.max(MIN_W, shape.props.w * sx) } })

let registered = false
export function registerMarkdown() {
  if (!registered) registerShapeType(TYPE, { bounds, draw, scale })
  registered = true
}

export function createMarkdown(store, { x, y, w = 360, md = '# Title\n\nWrite **Markdown** here.' }) {
  registerMarkdown()
  const id = newId()
  store.put({ id, typeName: 'shape', type: TYPE, x, y, rot: 0, z: store.maxZ() + 1, props: { md, w, color: 'black' } })
  return id
}

// Edits a card's source in a textarea laid over it (outside the board, so the
// core's shortcuts stay out of the way). Commits on blur, Escape or ⌘/Ctrl+Enter.
// Resolves to the new source, or null if the shape is gone.
export function editMarkdown(editor, id) {
  const shape = editor.store.get(id)
  if (shape?.type !== TYPE) return Promise.resolve(null)
  const ta = document.createElement('textarea')
  ta.value = shape.props.md
  Object.assign(ta.style, {
    position: 'fixed', zIndex: 60, boxSizing: 'border-box', resize: 'none', margin: 0,
    padding: '10px', font: `14px ${FONTS.mono}`, lineHeight: 1.5, borderRadius: '8px',
    border: `2px solid ${editor.theme.colors.blue.stroke}`, background: editor.theme.background,
    color: editor.theme.colors.black.stroke, outline: 'none',
  })
  const place = () => {
    const s = editor.store.get(id)
    if (!s) return
    const r = editor.container.getBoundingClientRect()
    const p = editor.pageToScreen(s.x, s.y)
    const b = bounds(s)
    Object.assign(ta.style, {
      left: r.left + p.x + 'px', top: r.top + p.y + 'px',
      width: Math.max(260, b.w * editor.camera.z) + 'px', height: Math.max(160, b.h * editor.camera.z) + 'px',
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
      if (!editor.store.has(id)) return resolve(null)
      if (ta.value !== editor.store.get(id).props.md) editor.store.update(id, { props: { md: ta.value } })
      resolve(ta.value)
    }
    ta.addEventListener('blur', finish)
    ta.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' || (e.key === 'Enter' && (e.metaKey || e.ctrlKey))) { e.preventDefault(); finish() }
    })
  })
}

// Double-click a card to edit it (desktop; iOS sends no dblclick on the
// board, so offer another way to call editMarkdown there). Returns an unbind.
export function bindMarkdownEditing(editor) {
  registerMarkdown()
  const onDblClick = (e) => {
    const r = editor.container.getBoundingClientRect()
    const p = editor.screenToPage(e.clientX - r.left, e.clientY - r.top)
    const hit = editor.hitTest(p.x, p.y)
    if (hit?.type === TYPE) editMarkdown(editor, hit.id)
  }
  editor.container.addEventListener('dblclick', onDblClick)
  return () => editor.container.removeEventListener('dblclick', onDblClick)
}
