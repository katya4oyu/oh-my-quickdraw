// Screen sharing on a board: one person shares a tab or window
// (getDisplayMedia), everyone sees it live in a small window over the board,
// and anyone can take a snapshot of it — the sharer's page puts the still, at
// full size, on the board (placeSnapshot).
//
// The host carries the messages (a relay, WebRTC data channel, anything):
//   host.send({ kind: 'start', name } | { kind: 'stop' } | { kind: 'snap', by })
//   host.sendFrame(jpeg: Uint8Array)   the live picture; the host may drop frames
//   host.canSend()                     false while the last frame is still on its way
//   host.onMessage(fn)                 { kind: 'sharing', sharer: { name } | null, mine }
//                                      | { kind: 'frame', data: Uint8Array } | { kind: 'snap', by }
//   host.me()                          { name }
import { placeSnapshot } from './snapshots.js'

const svg = (inner) => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${inner}</svg>`
export const SHARE_ICONS = {
  share: svg('<rect x="3" y="4" width="18" height="13" rx="2"/><path d="M8 21h8"/><path d="M12 17v4"/><path d="m9 10 3-3 3 3"/><path d="M12 7v6"/>'),
  snap: svg('<path d="M4 8a2 2 0 0 1 2-2h2l2-2h4l2 2h2a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2z"/><circle cx="12" cy="13" r="3.5"/>'),
  fold: svg('<path d="m6 15 6-6 6 6"/>'),
  unfold: svg('<path d="m6 9 6 6 6-6"/>'),
}

const STYLE = `
.qss{position:absolute;box-sizing:border-box;display:flex;flex-direction:column;pointer-events:auto;overflow:hidden;
  left:12px;top:12px;width:420px;min-width:220px;max-width:calc(100% - 24px);
  border-radius:14px;background:var(--qd-pop-bg);border:1px solid var(--qd-border);box-shadow:var(--qd-pop-shadow);
  color:var(--qd-ink-strong);font:13px/1.4 system-ui,-apple-system,sans-serif;z-index:1}
@media (max-width:640px){.qss{left:8px!important;right:8px;top:auto!important;bottom:calc(8px + env(safe-area-inset-bottom));width:auto!important}}
.qss[hidden],.qss [hidden]{display:none!important}
.qss-head{display:flex;align-items:center;gap:6px;padding:6px 6px 6px 10px;cursor:grab;touch-action:none;user-select:none}
.qss-head:active{cursor:grabbing}
.qss-live{width:8px;height:8px;border-radius:50%;background:#e5484d;flex:none;animation:qss-pulse 1.6s ease-in-out infinite}
@keyframes qss-pulse{50%{opacity:.35}}
@media (prefers-reduced-motion:reduce){.qss-live{animation:none}}
.qss-name{flex:1;min-width:0;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;font-weight:600}
.qss-btn{all:unset;box-sizing:border-box;display:grid;place-items:center;height:28px;min-width:28px;padding:0 8px;border-radius:999px;cursor:pointer;font-size:12px;gap:4px;grid-auto-flow:column}
.qss-btn:hover{background:var(--qd-hover)}
.qss-btn svg{width:16px;height:16px}
.qss-btn.primary{background:var(--qd-on-bg);color:var(--qd-on-ink)}
.qss-view{position:relative;background:#000;aspect-ratio:16/10}
.qss-view canvas,.qss-view video{position:absolute;inset:0;width:100%;height:100%;object-fit:contain}
.qss.folded .qss-view,.qss.folded .qss-grip{display:none}
.qss-note{position:absolute;left:50%;bottom:10px;transform:translateX(-50%);padding:4px 10px;border-radius:999px;background:rgba(0,0,0,.7);color:#fff;font-size:12px;white-space:nowrap}
.qss-wait{position:absolute;inset:0;display:grid;place-items:center;color:#aaa;font-size:12px}
.qss-grip{position:absolute;right:0;bottom:0;width:16px;height:16px;cursor:nwse-resize;touch-action:none;
  background:linear-gradient(135deg,transparent 50%,rgba(255,255,255,.5) 50% 60%,transparent 60% 75%,rgba(255,255,255,.5) 75% 85%,transparent 85%)}
`
function injectStyle() {
  if (document.getElementById('qd-screenshare-style')) return
  const style = Object.assign(document.createElement('style'), { id: 'qd-screenshare-style', textContent: STYLE })
  document.head.append(style)
}
const el = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e }
const time = (at) => new Date(at).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })

// a frame of the video, its long side `max` at most, as a canvas
function still(video, max) {
  const k = Math.min(1, max / Math.max(video.videoWidth, video.videoHeight))
  const c = document.createElement('canvas')
  c.width = Math.max(1, Math.round(video.videoWidth * k))
  c.height = Math.max(1, Math.round(video.videoHeight * k))
  c.getContext('2d').drawImage(video, 0, 0, c.width, c.height)
  return c
}
const toBlob = (canvas, quality) => new Promise((ok) => canvas.toBlob(ok, 'image/jpeg', quality))
const dataUrl = (blob) => new Promise((ok, fail) => { const r = new FileReader(); r.onload = () => ok(r.result); r.onerror = fail; r.readAsDataURL(blob) })

/** Screen sharing and snapshots on a board; the host carries the messages (see above). */
export function createScreenShare({ editor, container = editor.container, host, live = { maxSide: 1280, quality: 0.7, every: 150 }, snapshot = { maxSide: 1920, quality: 0.85 } }) {
  if (!host || !['send', 'sendFrame', 'onMessage', 'me'].every((k) => typeof host[k] === 'function')) {
    throw new TypeError('createScreenShare requires host send, sendFrame, onMessage and me functions')
  }
  injectStyle()
  let sharer = null // { name } of whoever shares, as the host says
  let mine = false // it is this page
  let stream = null, video = null, timer = 0, encoding = false
  const listeners = new Set()
  const changed = () => { render(); for (const fn of listeners) fn() }

  // the live window
  const box = el('section', 'qss')
  box.hidden = true
  box.setAttribute('aria-label', 'Shared screen')
  const head = el('header', 'qss-head')
  const dot = el('span', 'qss-live')
  const name = el('span', 'qss-name')
  const snapBtn = el('button', 'qss-btn')
  snapBtn.type = 'button'
  snapBtn.title = 'Snapshot: put this moment on the board'
  snapBtn.innerHTML = SHARE_ICONS.snap
  snapBtn.append(el('span', '', 'Snapshot'))
  const stopBtn = el('button', 'qss-btn primary', 'Stop')
  stopBtn.type = 'button'
  const foldBtn = el('button', 'qss-btn')
  foldBtn.type = 'button'
  head.append(dot, name, snapBtn, stopBtn, foldBtn)
  const view = el('div', 'qss-view')
  const canvas = el('canvas')
  const wait = el('div', 'qss-wait', 'Waiting for the picture…')
  const note = el('div', 'qss-note')
  note.hidden = true
  const grip = el('div', 'qss-grip')
  view.append(canvas, wait, note)
  box.append(head, view, grip)
  ;(container.querySelector('.qd-ui') || container).append(box)
  // what is done in this window is not for the board (its shortcuts, its paste)
  for (const type of ['keydown', 'keyup', 'paste', 'wheel']) box.addEventListener(type, (e) => e.stopPropagation())

  let folded = false
  function render() {
    box.hidden = !sharer
    if (!sharer) return
    name.textContent = mine ? 'You are sharing' : `${sharer.name || 'Someone'}’s screen`
    stopBtn.hidden = !mine
    box.classList.toggle('folded', folded)
    foldBtn.innerHTML = folded ? SHARE_ICONS.unfold : SHARE_ICONS.fold
    foldBtn.title = folded ? 'Show' : 'Fold'
  }
  let noteTimer = 0
  function say(text) {
    note.textContent = text
    note.hidden = false
    clearTimeout(noteTimer)
    noteTimer = setTimeout(() => { note.hidden = true }, 2200)
  }

  // the picture: frames from the host (others), or our own video (the sharer)
  let drawing = null, next = null
  async function drawFrame(data) {
    if (drawing) { next = data; return } // keep only the latest
    drawing = data
    try {
      const bmp = await createImageBitmap(new Blob([data], { type: 'image/jpeg' }))
      if (canvas.width !== bmp.width || canvas.height !== bmp.height) Object.assign(canvas, { width: bmp.width, height: bmp.height })
      canvas.getContext('2d').drawImage(bmp, 0, 0)
      bmp.close()
      wait.hidden = true
    } catch {} finally {
      drawing = null
      if (next) { const d = next; next = null; drawFrame(d) }
    }
  }

  async function tick() {
    timer = setTimeout(tick, live.every)
    if (!video || encoding || video.readyState < 2 || (host.canSend && !host.canSend())) return
    encoding = true
    try {
      const c = still(video, live.maxSide)
      const blob = await toBlob(c, live.quality)
      if (blob && stream) host.sendFrame(new Uint8Array(await blob.arrayBuffer()))
      // our own window shows what we send
      if (canvas.width !== c.width || canvas.height !== c.height) Object.assign(canvas, { width: c.width, height: c.height })
      canvas.getContext('2d').drawImage(c, 0, 0)
      wait.hidden = true
    } finally { encoding = false }
  }

  function end(tell) {
    clearTimeout(timer)
    for (const t of stream?.getTracks() ?? []) t.stop()
    stream = null
    video = null
    if (tell) host.send({ kind: 'stop' })
    if (mine) { mine = false; sharer = null }
    changed()
  }

  async function takeSnapshot(by) {
    if (!video || video.readyState < 2) return null
    const blob = await toBlob(still(video, snapshot.maxSide), snapshot.quality)
    const src = await dataUrl(blob)
    const bmp = await createImageBitmap(blob)
    const at = Date.now()
    const placed = placeSnapshot(editor, { src, w: bmp.width, h: bmp.height }, { at, by, title: `${time(at)}${by ? ' · ' + by : ''}` })
    bmp.close()
    say('Snapshot is on the board')
    return placed
  }

  const offHost = host.onMessage((m) => {
    if (m?.kind === 'sharing') {
      if (stream && !m.mine) end(false) // someone else took over
      sharer = m.sharer || null
      mine = !!m.mine && !!sharer
      if (!sharer) { wait.hidden = false; canvas.getContext('2d')?.clearRect(0, 0, canvas.width, canvas.height) }
      changed()
    } else if (m?.kind === 'frame' && !mine && m.data) drawFrame(m.data)
    else if (m?.kind === 'snap' && stream) takeSnapshot(m.by || '')
  })

  // move the window by its header; resize it by the corner
  function drag(handle, move) {
    handle.addEventListener('pointerdown', (e) => {
      if (e.button !== 0 || e.target.closest('button')) return
      e.preventDefault()
      e.stopPropagation()
      handle.setPointerCapture(e.pointerId)
      const r = box.getBoundingClientRect(), p = box.offsetParent?.getBoundingClientRect() ?? { left: 0, top: 0 }
      const start = { x: e.clientX, y: e.clientY, left: r.left - p.left, top: r.top - p.top, w: r.width }
      const onMove = (ev) => move(ev.clientX - start.x, ev.clientY - start.y, start)
      const onUp = () => { handle.removeEventListener('pointermove', onMove); handle.removeEventListener('pointerup', onUp) }
      handle.addEventListener('pointermove', onMove)
      handle.addEventListener('pointerup', onUp)
    })
  }
  drag(head, (dx, dy, s) => Object.assign(box.style, { left: `${Math.max(0, s.left + dx)}px`, top: `${Math.max(0, s.top + dy)}px` }))
  drag(grip, (dx, _dy, s) => { box.style.width = `${Math.max(220, s.w + dx)}px` })
  box.addEventListener('pointerdown', (e) => e.stopPropagation()) // not a board gesture

  snapBtn.addEventListener('click', () => share.snap())
  stopBtn.addEventListener('click', () => share.stop())
  foldBtn.addEventListener('click', () => { folded = !folded; render() })

  const share = {
    /** someone is sharing: { name }, or null */
    get sharer() { return sharer },
    /** this page is sharing */
    get sharing() { return mine && !!stream },
    /** Shares a tab or window (the browser asks which), or `given` (a MediaStream: a canvas' captureStream in tests). */
    async start(given) {
      if (stream) end(true)
      const s = given ?? await navigator.mediaDevices.getDisplayMedia({ video: { displaySurface: 'browser' }, audio: false, selfBrowserSurface: 'exclude' })
      stream = s
      video = Object.assign(document.createElement('video'), { muted: true, playsInline: true, srcObject: s })
      await video.play().catch(() => {})
      s.getVideoTracks()[0]?.addEventListener('ended', () => end(true))
      host.send({ kind: 'start', name: host.me()?.name || '' })
      clearTimeout(timer)
      tick()
    },
    stop() { if (stream) end(true) },
    /** A snapshot of the shared screen: taken here when sharing, else asked of the sharer. */
    async snap() {
      if (!sharer) return null
      const by = host.me()?.name || ''
      if (stream) return takeSnapshot(by)
      host.send({ kind: 'snap', by })
      say('Snapshot asked for…')
      return null
    },
    /** called when who shares changes */
    onChange(fn) { listeners.add(fn); return () => listeners.delete(fn) },
    destroy() {
      end(false)
      offHost?.()
      box.remove()
    },
  }
  return share
}

/** Toolbar items (quickdraw-toolbar's shape): share or stop sharing, and a snapshot, for the "…" menu. */
export function screenShareTools(share) {
  const can = () => typeof navigator !== 'undefined' && !!navigator.mediaDevices?.getDisplayMedia
  return {
    menu: [
      {
        id: 'screen-share', title: 'Share screen', icon: SHARE_ICONS.share, available: can,
        checked: () => share.sharing,
        run: () => (share.sharing ? share.stop() : share.start().catch(() => {})), // a cancelled picker is no error
      },
      { id: 'screen-snapshot', title: 'Snapshot of shared screen', icon: SHARE_ICONS.snap, available: () => !!share.sharer, run: () => share.snap() },
    ],
  }
}
