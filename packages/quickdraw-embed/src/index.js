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
// Record: { type: 'embed', props: { kind: 'url' | 'html', url? | html?, w, h, title? } }
import * as core from '@quickdrawjs/core'
import { resolveEmbedUrl, htmlDocument, DEFAULT_RULES, URL_SANDBOX, URL_ALLOW, HTML_SANDBOX } from './policy.js'

export * from './policy.js'

export const TYPE = 'embed'
export const isEmbedSupported = () => typeof core.registerShapeType === 'function'
const UNSUPPORTED = 'This Quickdraw core cannot draw custom shapes (registerShapeType is missing)'

function hostOf(url) {
  try { return new URL(url).hostname } catch { return 'invalid URL' }
}

function draw(ctx, shape, { theme }) {
  const { w, h, kind, url, title } = shape.props
  const grey = theme.colors.grey
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
  ctx.fillText(title || (kind === 'html' ? '</> HTML' : `▶ ${hostOf(url)}`), w / 2, h / 2, w - 24)
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

// kind 'url': { url }, or kind 'html': { html }. Returns the new id.
export function createEmbed(store, { x, y, w, h, kind = 'url', url, html, title }) {
  if (!registerEmbed()) throw new Error(UNSUPPORTED)
  const id = core.newId()
  const props = kind === 'html'
    ? { kind, html: html ?? '', w: w ?? 400, h: h ?? 300 }
    : { kind: 'url', url: url ?? '', w: w ?? 480, h: h ?? 270 }
  if (title) props.title = title
  store.put({ id, typeName: 'shape', type: TYPE, x, y, rot: 0, z: store.maxZ() + 1, props })
  return id
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

  // the iframe (or a notice) for a record, per this viewer's rules and choices
  function content(s) {
    const p = s.props
    if (p.kind === 'url') {
      const v = verdict(p.url)
      if (v.pending) return note('Checking…')
      const r = v.r
      // with allow-same-origin, a page from our own origin could reach into the board
      if (!r || new URL(r.src).origin === location.origin) return note(`Not allowed here: ${hostOf(p.url)}`)
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
    Object.assign(wrap.style, { position: 'absolute', left: '0', top: '0', transformOrigin: '0 0', borderRadius: '8px', overflow: 'hidden', background: '#fff' })
    const c = content(s)
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
