// Embeds for Quickdraw: web pages (allowed URLs) and inline HTML, shown as
// live iframes over the board.
//
// Two layers work together. On the canvas, a registered shape type ('embed')
// draws a placeholder, so embeds select, move, resize and export (as the
// placeholder) like any shape. Over it, bindEmbeds lays the iframes between
// the board canvas and the selection overlay, following the camera; iframes
// therefore sit above other shapes, as in other whiteboards.
//
// Security (see policy.js): every client checks what a record may show when
// it renders. URLs must be https and allowed by a rule; inline HTML runs
// sandboxed with no network, only after the viewer presses Run, and is
// stopped if it tries to navigate away. Iframes ignore the pointer until
// activated (double-click, or activate()), so the board stays usable.
//
// Link cards: a URL's placeholder is a card from its stored Open Graph
// preview, with an Open button. It is what a viewer sees when their rules do
// not allow the page, and all there is for kind 'link' (never an iframe).
//
// Record: { type: 'embed', props: { kind: 'url' | 'link' | 'html', url? | html?, w, h, title?, preview? } }
import * as core from '@quickdrawjs/core'
import { resolveEmbedUrl, htmlDocument, DEFAULT_RULES, URL_SANDBOX, URL_ALLOW, HTML_SANDBOX } from './policy.js'
import { cleanPreview, PREVIEW_LIMITS } from './preview.js'

export * from './policy.js'
export * from './preview.js'

export const TYPE = 'embed'
export const isEmbedSupported = () => typeof core.registerShapeType === 'function'
const UNSUPPORTED = 'This Quickdraw core cannot draw custom shapes (registerShapeType is missing)'

function hostOf(url) {
  try { return new URL(url).hostname } catch { return 'invalid URL' }
}

// decoded preview images, by data URL
const images = new Map()
function cardImage(src, onLoad) {
  let img = images.get(src)
  if (!img && typeof Image !== 'undefined') {
    img = new Image()
    img.onload = () => onLoad?.()
    img.src = src
    images.set(src, img)
    if (images.size > 100) images.delete(images.keys().next().value)
  }
  return img?.complete && img.naturalWidth ? img : null
}

// break opportunities: runs of spaces, single CJK characters, other words
const SEGMENT = /\s+|[\u3000-\u30ff\u3400-\u9fff\uf900-\ufaff\uff00-\uffef]|[^\s\u3000-\u30ff\u3400-\u9fff\uf900-\ufaff\uff00-\uffef]+/g

// up to n lines of text within maxW, wrapping at spaces or between CJK
// characters (words longer than a line break anywhere); ellipsized when cut
export function fitLines(ctx, text, maxW, n) {
  const fits = (t) => ctx.measureText(t).width <= maxW
  const segs = text.match(SEGMENT) || []
  const lines = []
  let line = ''
  let cut = false
  const push = () => { lines.push(line.trimEnd()); line = '' }
  for (let i = 0; i < segs.length && !cut; i++) {
    let seg = segs[i]
    if (fits(line + seg)) { line += seg; continue }
    if (/^\s+$/.test(seg)) { push(); cut = lines.length === n && i < segs.length - 1; continue }
    if (line.trim()) push()
    else line = ''
    while (lines.length < n && !fits(seg) && seg.length > 1) { // a word wider than the line
      let k = seg.length - 1
      while (k > 1 && !fits(seg.slice(0, k))) k--
      lines.push(seg.slice(0, k))
      seg = seg.slice(k)
    }
    if (lines.length === n) cut = true
    else line = seg
  }
  if (!cut && line.trim()) {
    if (lines.length < n) push()
    else cut = true
  }
  if (cut) {
    let last = lines[n - 1]
    while (last && !fits(last + '…')) last = last.slice(0, -1)
    lines[n - 1] = last.trimEnd() + '…'
  }
  return lines
}

function drawCard(ctx, shape, { theme, onAssetLoad }) {
  const { w, h, url, title, preview = {} } = shape.props
  const grey = theme.colors.grey
  ctx.beginPath()
  ctx.roundRect(0, 0, w, h, 8)
  ctx.fillStyle = theme.background
  ctx.fill()
  ctx.lineWidth = 1
  ctx.strokeStyle = grey.stroke
  ctx.stroke()
  ctx.save()
  ctx.clip()
  let y = 0
  if (preview.image) {
    const ih = Math.min(h * 0.55, w * 0.52)
    const img = cardImage(preview.image, onAssetLoad)
    if (img) { // cover: crop to the box
      const k = Math.max(w / img.naturalWidth, ih / img.naturalHeight)
      const sw = w / k, sh = ih / k
      ctx.drawImage(img, (img.naturalWidth - sw) / 2, (img.naturalHeight - sh) / 2, sw, sh, 0, 0, w, ih)
    } else {
      ctx.fillStyle = grey.fill
      ctx.fillRect(0, 0, w, ih)
    }
    y = ih
  }
  const pad = 12, maxW = w - pad * 2, foot = h - pad - 14
  ctx.textAlign = 'left'
  ctx.textBaseline = 'top'
  y += pad
  const text = (font, color, str, n, lh) => {
    ctx.font = font
    ctx.fillStyle = color
    for (const line of fitLines(ctx, str, maxW, n)) {
      if (y + lh > foot) return
      ctx.fillText(line, pad, y)
      y += lh
    }
  }
  text(`bold 15px ${core.FONTS.sans}`, theme.colors.black.stroke, title || preview.title || hostOf(url), 2, 20)
  if (preview.description) { y += 4; text(`13px ${core.FONTS.sans}`, grey.stroke, preview.description, 3, 18) }
  ctx.font = `12px ${core.FONTS.sans}`
  ctx.fillStyle = grey.stroke
  ctx.fillText(fitLines(ctx, '↗ ' + (preview.siteName || hostOf(url)), maxW, 1)[0] ?? '', pad, foot)
  ctx.restore()
}

function draw(ctx, shape, opts) {
  const { w, h, kind, title } = shape.props
  if (kind !== 'html') return drawCard(ctx, shape, opts)
  const grey = opts.theme.colors.grey
  ctx.beginPath()
  ctx.roundRect(0, 0, w, h, 8)
  ctx.fillStyle = grey.fill
  ctx.fill()
  ctx.lineWidth = 1
  ctx.strokeStyle = grey.stroke
  ctx.stroke()
  ctx.fillStyle = grey.stroke
  ctx.font = `14px ${core.FONTS.sans}`
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  ctx.fillText(title || '</> HTML', w / 2, h / 2, w - 24)
}

let registered = false
export function registerEmbed() {
  if (!isEmbedSupported()) return false
  if (!registered) {
    core.registerShapeType(TYPE, {
      bounds: (s) => ({ x: 0, y: 0, w: s.props.w, h: s.props.h }),
      draw,
      scale: (s, sx, sy) => ({ ...s, props: { ...s.props, w: Math.max(40, s.props.w * sx), h: Math.max(40, s.props.h * sy) } }),
    })
  }
  return (registered = true)
}

// kind 'url' (an iframe where allowed, a card elsewhere) or 'link' (always a
// card): { url, preview?, fetchPreview? }; kind 'html': { html }.
// fetchPreview(url) -> { title?, description?, siteName?, image?: Blob | data URL }
// is the app's way past CORS (a proxy, a desktop shell…); its answer is
// cleaned, the image shrunk inline, and stored once. Returns the new id.
export function createEmbed(store, { x, y, w, h, kind = 'url', url, html, title, preview, fetchPreview }) {
  if (!registerEmbed()) throw new Error(UNSUPPORTED)
  const id = core.newId()
  const link = kind === 'link'
  const props = kind === 'html'
    ? { kind, html: html ?? '', w: w ?? 400, h: h ?? 300 }
    : { kind: link ? 'link' : 'url', url: url ?? '', w: w ?? (link ? 320 : 480), h: h ?? (link ? 260 : 270) }
  if (title) props.title = title
  const clean = kind !== 'html' && cleanPreview(preview)
  if (clean) props.preview = clean
  store.put({ id, typeName: 'shape', type: TYPE, x, y, rot: 0, z: store.maxZ() + 1, props })
  if (fetchPreview && kind !== 'html') addPreview(store, id, fetchPreview)
  return id
}

// Fetches a card's preview with the app's fetchPreview and stores it.
// Resolves to the stored preview, or null (no answer, or the card changed).
export async function addPreview(store, id, fetchPreview) {
  const url = store.get(id)?.props.url
  if (!url) return null
  let p
  try { p = await fetchPreview(url) } catch { return null }
  if (!p) return null
  const image = typeof Blob !== 'undefined' && p.image instanceof Blob ? await shrinkImage(p.image).catch(() => undefined) : p.image
  const preview = cleanPreview({ ...p, image })
  if (!preview || store.get(id)?.props.url !== url) return null
  store.update(id, { props: { preview } })
  return preview
}

// an image blob as a small inline JPEG, within the preview size limit
async function shrinkImage(blob, max = 480) {
  const bmp = await createImageBitmap(blob)
  const k = Math.min(1, max / Math.max(bmp.width, bmp.height))
  const c = document.createElement('canvas')
  c.width = Math.max(1, Math.round(bmp.width * k))
  c.height = Math.max(1, Math.round(bmp.height * k))
  c.getContext('2d').drawImage(bmp, 0, 0, c.width, c.height)
  for (const q of [0.8, 0.6, 0.4]) {
    const d = c.toDataURL('image/jpeg', q)
    if (d.length <= PREVIEW_LIMITS.image) return d
  }
  return undefined
}

// opens a card's link in a new tab, http(s) only, telling it nothing about the board
function openLink(url) {
  try {
    const u = new URL(url)
    if (u.protocol === 'https:' || u.protocol === 'http:') window.open(u.href, '_blank', 'noopener,noreferrer')
  } catch {}
}

// Shows embeds over the board. opts.rules: the URL rules (DEFAULT_RULES);
// opts.maxLive: at most this many iframes at once, the rest stay placeholders.
// Returns { activate(id), deactivate(), run(id), destroy() }.
export function bindEmbeds(editor, { rules = DEFAULT_RULES, maxLive = 8 } = {}) {
  const noop = () => {}
  if (!registerEmbed()) return { activate: noop, deactivate: noop, run: noop, refresh: noop, destroy: noop }

  const layer = document.createElement('div')
  Object.assign(layer.style, { position: 'absolute', inset: '0', overflow: 'hidden', pointerEvents: 'none' })
  editor.canvas.after(layer) // above the shapes, below the selection handles

  const live = new Map() // id -> { wrap, key, loads }
  const ran = new Set() // html embeds this viewer chose to run
  const stopped = new Set() // html embeds stopped for navigating
  const verdicts = new Map() // url -> { r } once the rules have answered; { pending } before
  let activeId = null
  let raf = 0

  const schedule = () => { if (!raf) raf = requestAnimationFrame(() => { raf = 0; reconcile() }) }

  function note(text, button) {
    const box = document.createElement('div')
    Object.assign(box.style, {
      position: 'absolute', inset: '0', display: 'flex', flexDirection: 'column', gap: '8px',
      alignItems: 'center', justifyContent: 'center', font: `13px ${core.FONTS.sans}`, color: '#666', textAlign: 'center', padding: '12px',
    })
    box.textContent = text
    if (button) {
      const b = document.createElement('button')
      b.textContent = button.label
      Object.assign(b.style, { pointerEvents: 'auto', font: `600 13px ${core.FONTS.sans}`, padding: '6px 14px', borderRadius: '999px', border: '1px solid #bbb', background: '#fff', cursor: 'pointer' })
      b.onclick = button.onClick
      box.append(b)
    }
    return box
  }

  // over a card drawn on the canvas: an Open button, and an optional badge
  function cardControls(url, badge) {
    const box = document.createElement('div')
    Object.assign(box.style, { position: 'absolute', inset: '0', font: `12px ${core.FONTS.sans}` })
    const b = document.createElement('button')
    b.textContent = 'Open ↗'
    Object.assign(b.style, { position: 'absolute', right: '8px', bottom: '8px', pointerEvents: 'auto', font: `600 12px ${core.FONTS.sans}`, padding: '4px 10px', borderRadius: '999px', border: '1px solid #bbb', background: '#fff', cursor: 'pointer' })
    b.onclick = () => openLink(url)
    box.append(b)
    if (badge) {
      const t = document.createElement('span')
      t.textContent = badge
      Object.assign(t.style, { position: 'absolute', left: '8px', top: '8px', padding: '2px 8px', borderRadius: '999px', background: 'rgba(0,0,0,0.55)', color: '#fff' })
      box.append(t)
    }
    return box
  }

  // the iframe (or controls, or a notice) for a record, per this viewer's rules and choices
  function content(s) {
    const p = s.props
    if (p.kind === 'link') return cardControls(p.url)
    if (p.kind === 'url') {
      const v = verdict(p.url)
      if (v.pending) return cardControls(p.url, 'Checking…')
      const r = v.r
      // with allow-same-origin, a page from our own origin could reach into the board;
      // not allowed: the card stays, with nothing loaded from the site
      if (!r || new URL(r.src).origin === location.origin) return cardControls(p.url, 'Link only')
      const f = document.createElement('iframe')
      Object.assign(f, { src: r.src, allow: URL_ALLOW, referrerPolicy: 'strict-origin-when-cross-origin', allowFullscreen: true, title: p.title || r.name })
      f.setAttribute('sandbox', URL_SANDBOX)
      f.loading = 'lazy'
      return f
    }
    if (stopped.has(s.id)) return note('Stopped: this HTML tried to leave its page.', { label: 'Run again', onClick: () => { stopped.delete(s.id); run(s.id) } })
    if (!ran.has(s.id)) return note('Inline HTML, sandboxed with no network access.', { label: '▶ Run', onClick: () => run(s.id) })
    const f = document.createElement('iframe')
    f.setAttribute('sandbox', HTML_SANDBOX)
    Object.assign(f, { srcdoc: htmlDocument(p.html), referrerPolicy: 'no-referrer', title: p.title || 'HTML' })
    // the first load is the document; any later one is the page navigating itself
    let loads = 0
    f.addEventListener('load', () => {
      if (++loads > 1) { stopped.add(s.id); ran.delete(s.id); unmount(s.id); schedule() }
    })
    return f
  }

  function mount(s) {
    const wrap = document.createElement('div')
    Object.assign(wrap.style, { position: 'absolute', left: '0', top: '0', transformOrigin: '0 0', borderRadius: '8px', overflow: 'hidden' })
    const c = content(s)
    // iframes and HTML notices sit on white; card controls let the card show through
    if (c.tagName === 'IFRAME' || s.props.kind === 'html') wrap.style.background = '#fff'
    if (c.tagName === 'IFRAME') Object.assign(c.style, { width: '100%', height: '100%', border: '0', display: 'block' })
    wrap.append(c)
    layer.append(wrap)
    live.set(s.id, { wrap, key: keyOf(s) })
  }

  function unmount(id) {
    live.get(id)?.wrap.remove()
    live.delete(id)
    if (activeId === id) activeId = null
  }

  const keyOf = (s) => [s.props.kind, s.props.url, s.props.html, ran.has(s.id), stopped.has(s.id), s.props.kind === 'url' && !!verdicts.get(s.props.url)?.pending].join('\u0000')

  // asks the rules once per URL; the embed shows "Checking…" until they answer
  function verdict(url) {
    let v = verdicts.get(url)
    if (!v) {
      verdicts.set(url, v = { pending: true })
      resolveEmbedUrl(url, rules).then((r) => {
        if (verdicts.get(url) !== v) return // refreshed meanwhile
        verdicts.set(url, { r })
        schedule()
      })
    }
    return v
  }

  // asks the rules again, e.g. after the app's allow list changed
  function refresh() {
    verdicts.clear()
    for (const [id, cur] of [...live]) {
      if (editor.store.get(id)?.props.kind === 'url') { cur.wrap.remove(); live.delete(id) }
    }
    schedule()
  }

  function place(s, { wrap }, order) {
    const { w, h } = s.props
    const p = editor.pageToScreen(s.x, s.y)
    const z = editor.camera.z
    Object.assign(wrap.style, {
      width: w + 'px', height: h + 'px', zIndex: order,
      transform: `translate(${p.x}px, ${p.y}px) scale(${z})` + (s.rot ? ` translate(${w / 2}px, ${h / 2}px) rotate(${s.rot}rad) translate(${-w / 2}px, ${-h / 2}px)` : ''),
      pointerEvents: s.id === activeId ? 'auto' : 'none',
      outline: s.id === activeId ? '2px solid #4263eb' : 'none',
    })
  }

  function reconcile() {
    const v = editor.viewportPageBounds()
    const m = Math.max(v.w, v.h) * 0.5 // keep nearby embeds mounted while panning
    const view = { x: v.x - m, y: v.y - m, w: v.w + m * 2, h: v.h + m * 2 }
    const wanted = editor.shapesSorted().filter((s) => {
      if (s.type !== TYPE) return false
      const b = core.pageBounds(s)
      return b.x < view.x + view.w && b.x + b.w > view.x && b.y < view.y + view.h && b.y + b.h > view.y
    }).slice(-maxLive) // the topmost when there are too many
    const keep = new Set(wanted.map((s) => s.id))
    for (const id of [...live.keys()]) if (!keep.has(id)) unmount(id)
    wanted.forEach((s, order) => {
      const cur = live.get(s.id)
      if (cur && cur.key !== keyOf(s)) unmount(s.id)
      if (!live.has(s.id)) mount(s)
      place(s, live.get(s.id), order)
    })
  }

  function run(id) {
    ran.add(id)
    schedule()
  }
  function activate(id) {
    if (editor.store.get(id)?.type !== TYPE) return
    activeId = id
    schedule()
  }
  function deactivate() {
    if (activeId == null) return
    activeId = null
    schedule()
  }

  // desktop: double-click an embed to use it; touch devices call activate()
  const onDblClick = (e) => {
    const r = editor.container.getBoundingClientRect()
    const p = editor.screenToPage(e.clientX - r.left, e.clientY - r.top)
    const hit = editor.hitTest(p.x, p.y)
    if (hit?.type === TYPE) activate(hit.id)
  }
  // clicks on the board (never inside an iframe) and Escape hand control back
  const onPointerDown = () => deactivate()
  const onKey = (e) => { if (e.key === 'Escape') deactivate() }
  editor.container.addEventListener('dblclick', onDblClick)
  editor.container.addEventListener('pointerdown', onPointerDown, true)
  addEventListener('keydown', onKey)
  const offs = [editor.store.listen(schedule), editor.on('camera', schedule), editor.on('selection', () => {
    if (activeId && !editor.selection.has(activeId)) deactivate()
  })]
  addEventListener('resize', schedule)
  schedule()

  return {
    activate, deactivate, run, refresh,
    destroy() {
      cancelAnimationFrame(raf)
      for (const off of offs) off()
      editor.container.removeEventListener('dblclick', onDblClick)
      editor.container.removeEventListener('pointerdown', onPointerDown, true)
      removeEventListener('keydown', onKey)
      removeEventListener('resize', schedule)
      layer.remove()
    },
  }
}
