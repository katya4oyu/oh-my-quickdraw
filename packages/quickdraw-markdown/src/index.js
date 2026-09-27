// Markdown cards for Quickdraw: a custom shape type ('markdown') drawn on the
// board's canvas through the core's registerShapeType, so it stacks, selects,
// rotates, exports and follows the theme like any other shape.
// Record: { type: 'markdown', props: { md, w, color? } } — the height follows
// the content. Corner-resizing changes the width; the text reflows.
//
// registerShapeType comes from the katya4oyu/quickdraw fork. On a core without
// it this module still loads: isMarkdownSupported() is false, cards cannot be
// created, and parsing, layout and validateMarkdown keep working.
import * as core from '@quickdrawjs/core'
import { parseMarkdown } from './parse.js'
import { layoutMarkdown } from './layout.js'

export { parseMarkdown, parseInline } from './parse.js'
export { layoutMarkdown } from './layout.js'
export { markdownTools, MARKDOWN_ICONS } from './tools.js'

export const TYPE = 'markdown'
const PAD = 14
const MIN_W = 120
const MAX_W = 4000
export const MAX_MD_LENGTH = 100_000

const { newId, FONTS, COLOR_IDS } = core
export const isMarkdownSupported = () => typeof core.registerShapeType === 'function'
const UNSUPPORTED = 'This Quickdraw core cannot draw custom shapes (registerShapeType is missing)'

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

// Registers the shape type; returns false on a core without registerShapeType.
let registered = false
export function registerMarkdown() {
  if (!isMarkdownSupported()) return false
  if (!registered) core.registerShapeType(TYPE, { bounds, draw, scale })
  return (registered = true)
}

export function createMarkdown(store, { x, y, w = 360, md = '# Title\n\nWrite **Markdown** here.' }) {
  if (!registerMarkdown()) throw new Error(UNSUPPORTED)
  const id = newId()
  store.put({ id, typeName: 'shape', type: TYPE, x, y, rot: 0, z: store.maxZ() + 1, props: { md, w, color: 'black' } })
  return id
}

// For quickdraw-import's `types` option: { types: { markdown: validateMarkdown } }.
// Returns an error message, or null when the record is a sound card.
export function validateMarkdown(shape) {
  const p = shape.props
  if (typeof p.md !== 'string') return 'bad props.md'
  if (p.md.length > MAX_MD_LENGTH) return `props.md is too long (max ${MAX_MD_LENGTH} characters)`
  if (!Number.isFinite(p.w) || p.w <= 0 || p.w > MAX_W) return 'bad props.w'
  if (p.color != null && !COLOR_IDS.includes(p.color)) return 'bad props.color'
  return null
}

// Asks for a .md (or plain text) file and adds it as a card in the middle of
// the view, selected. Resolves to the new id, or null when cancelled.
export function openMarkdownFile(editor) {
  if (!isMarkdownSupported()) return Promise.reject(new Error(UNSUPPORTED))
  return new Promise((resolve, reject) => {
    const input = document.createElement('input')
    input.type = 'file'
    input.accept = '.md,.markdown,.txt,text/markdown,text/plain'
    input.onchange = async () => {
      const file = input.files[0]
      if (!file) return resolve(null)
      try {
        const md = await file.text()
        if (md.length > MAX_MD_LENGTH) throw new Error(`File is too long (max ${MAX_MD_LENGTH} characters)`)
        const v = editor.viewportPageBounds()
        const w = Math.min(420, v.w * 0.85)
        const id = createMarkdown(editor.store, { x: v.x + (v.w - w) / 2, y: v.y + v.h * 0.15, w, md })
        if (editor.tool !== 'select') editor.setTool('select')
        editor.setSelection([id])
        resolve(id)
      } catch (e) { reject(e) }
    }
    input.oncancel = () => resolve(null)
    input.click()
  })
}

// Saves a card's source as a .md file, named after its first heading.
export function downloadMarkdown(store, id) {
  const shape = store.get(id)
  if (shape?.type !== TYPE) return
  const heading = shape.props.md.match(/^#{1,6}\s+(.+)$/m)?.[1].replace(/[\\/:*?"<>|]/g, '').trim()
  const a = document.createElement('a')
  a.href = URL.createObjectURL(new Blob([shape.props.md], { type: 'text/markdown' }))
  a.download = (heading || 'card').slice(0, 80) + '.md'
  a.click()
  setTimeout(() => URL.revokeObjectURL(a.href), 5000)
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
  if (!registerMarkdown()) return () => {}
  const onDblClick = (e) => {
    const r = editor.container.getBoundingClientRect()
    const p = editor.screenToPage(e.clientX - r.left, e.clientY - r.top)
    const hit = editor.hitTest(p.x, p.y)
    if (hit?.type === TYPE) editMarkdown(editor, hit.id)
  }
  editor.container.addEventListener('dblclick', onDblClick)
  return () => editor.container.removeEventListener('dblclick', onDblClick)
}
