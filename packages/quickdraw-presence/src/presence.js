// Who is on a board, drawn over it: everyone's cursor with their name, colour
// and status; a row of people and agents at the top (yours to set your name,
// colour and status; theirs to follow); arrows at the edge of the screen for
// those out of sight; and following someone — their view, or where an agent
// works — until you move the view yourself.
//
// The host carries the presences (a relay, WebRTC, anything):
//   host.send(presence)   yours, whenever it changes:
//                         { name, color, status?, x, y, view: { x, y, w, h } } (page coordinates; x/y null off the board)
//   host.onMessage(fn)    fn({ id, ...presence }) for someone else, fn({ id, gone: true }) when they leave;
//                         an agent's presence says { agent: true, agentStatus: 'working' | 'waiting' | 'idle' },
//                         and what it is doing just now: agentActivity (one of ACTIVITIES) and agentNote
import { edgePoint, fitView, centreOn, wellInside, initials } from './geometry.js'

export const COLORS = ['#e03131', '#1971c2', '#2f9e44', '#f08c00', '#9c36b5', '#0c8599']
const AGENT_STATUS = { working: 'working', waiting: 'waiting for you', idle: 'idle' }
// what an agent is doing just now: what its label says (its cursor's motion shows it too)
export const ACTIVITIES = {
  thinking: 'thinking', reading: 'reading the board', searching: 'searching the web', running: 'running a command',
  editing: 'editing files', imaging: 'making an image', drawing: 'drawing', waiting: 'waiting for you', done: 'done',
  available: 'ready for a request', // here, with nothing to do: it stays where people are
}

const STYLE = `
.qdp-layer{position:absolute;inset:0;pointer-events:none;overflow:hidden;z-index:35}
.qdp-layer [hidden]{display:none!important}
.qdp-cursor{position:absolute;left:0;top:0;font:600 11px system-ui,-apple-system,sans-serif;transition:transform 80ms linear}
.qdp-cursor svg{display:block}
.qdp-cursor span,.qdp-edge span{position:absolute;padding:1px 6px;border-radius:6px;color:#fff;white-space:nowrap;max-width:220px;overflow:hidden;text-overflow:ellipsis}
.qdp-cursor span{left:14px;top:16px}
/* how an agent's cursor moves for what it is doing: it mulls in a small circle, sweeps
   as it reads, glances about as it searches, nods while busy, bobs while it waits
   for you, and gives a little hop when done; drawing is its own movement */
.qdp-cursor[data-act=thinking] svg{animation:qdp-mull 2.4s linear infinite}
.qdp-cursor[data-act=reading] svg{animation:qdp-scan 1.8s ease-in-out infinite}
.qdp-cursor[data-act=searching] svg{animation:qdp-glance 1.1s ease-in-out infinite}
.qdp-cursor[data-act=running] svg,.qdp-cursor[data-act=editing] svg,.qdp-cursor[data-act=imaging] svg{animation:qdp-nod .9s ease-in-out infinite}
.qdp-cursor[data-act=waiting] svg{animation:qdp-bob 1.4s ease-in-out infinite}
.qdp-cursor[data-act=done] svg{animation:qdp-hop 500ms cubic-bezier(.2,.9,.3,1.4)}
.qdp-cursor[data-act=available] svg{animation:qdp-sway 3.2s ease-in-out infinite}
@keyframes qdp-mull{from{transform:rotate(0) translateX(3px) rotate(0)}to{transform:rotate(360deg) translateX(3px) rotate(-360deg)}}
@keyframes qdp-scan{0%,100%{transform:translate(0,0)}25%{transform:translate(22px,2px)}50%{transform:translate(0,8px)}75%{transform:translate(22px,10px)}}
@keyframes qdp-glance{0%,100%{transform:translateX(0)}30%{transform:translateX(-7px)}70%{transform:translateX(7px)}}
@keyframes qdp-nod{50%{transform:translateY(3px)}}
@keyframes qdp-bob{0%,100%{transform:translateY(0)}50%{transform:translateY(-8px)}}
@keyframes qdp-sway{0%,100%{transform:translate(0,0) rotate(0)}30%{transform:translate(3px,-2px) rotate(4deg)}70%{transform:translate(-3px,1px) rotate(-3deg)}}
@keyframes qdp-hop{40%{transform:translateY(-10px) scale(1.15)}}
.qdp-edge{all:unset;position:absolute;left:0;top:0;pointer-events:auto;cursor:pointer;font:600 11px system-ui,-apple-system,sans-serif}
.qdp-edge i{position:absolute;left:-7px;top:-7px;width:14px;height:14px;border-radius:50%;border:2px solid #fff;box-sizing:border-box}
.qdp-edge b{position:absolute;left:-4px;top:-4px;width:8px;height:8px;clip-path:polygon(0 0,100% 50%,0 100%)}
.qdp-edge span{top:-9px;left:12px}
.qdp-edge.flip span{left:auto;right:12px}
.qdp-frame{position:absolute;inset:0;border:3px solid;border-radius:2px;pointer-events:none}
.qdp-row{position:absolute;top:calc(10px + env(safe-area-inset-top));left:50%;transform:translateX(-50%);display:flex;flex-direction:column;align-items:center;gap:6px;pointer-events:none;z-index:2}
.qdp-row[hidden],.qdp-row [hidden]{display:none!important}
.qdp-people{display:flex;gap:2px;padding:3px;border-radius:999px;background:var(--qd-pop-bg);border:1px solid var(--qd-border);box-shadow:var(--qd-bar-shadow);pointer-events:auto}
.qdp-av{all:unset;box-sizing:border-box;position:relative;width:28px;height:28px;border-radius:50%;display:grid;place-items:center;cursor:pointer;
  color:#fff;font:700 11px system-ui,-apple-system,sans-serif;border:2px solid var(--qd-pop-bg)}
.qdp-av.me::after{content:'';position:absolute;inset:-2px;border-radius:50%;border:2px dashed var(--qd-border)}
.qdp-av .dot{position:absolute;right:-3px;bottom:-3px;width:10px;height:10px;border-radius:50%;border:2px solid var(--qd-pop-bg);background:#adb5bd}
.qdp-av .dot[data-status=working]{background:#2f9e44;animation:qdp-pulse 1.2s ease-in-out infinite}
.qdp-av .dot[data-status=waiting]{background:#f08c00}
@keyframes qdp-pulse{50%{opacity:.35}}
@media (prefers-reduced-motion:reduce){.qdp-av .dot,.qdp-cursor svg{animation:none!important}.qdp-cursor{transition:none}}
.qdp-follow{display:flex;align-items:center;gap:8px;padding:4px 4px 4px 12px;border-radius:999px;color:#fff;font:600 12px system-ui,-apple-system,sans-serif;pointer-events:auto;box-shadow:var(--qd-bar-shadow)}
.qdp-follow button{all:unset;cursor:pointer;padding:2px 10px;border-radius:999px;background:rgba(255,255,255,.25)}
.qdp-follow button:hover{background:rgba(255,255,255,.4)}
.qdp-pop{width:240px;box-sizing:border-box;padding:12px;border-radius:14px;background:var(--qd-pop-bg);border:1px solid var(--qd-border);box-shadow:var(--qd-pop-shadow);
  color:var(--qd-ink-strong);font:13px/1.4 system-ui,-apple-system,sans-serif;display:grid;gap:8px;pointer-events:auto}
.qdp-pop label{display:grid;gap:3px;color:var(--qd-ink-soft);font-size:12px}
.qdp-pop input[type=text]{font:16px system-ui,-apple-system,sans-serif;border:1px solid var(--qd-border);border-radius:8px;padding:5px 8px;background:transparent;color:var(--qd-ink-strong);outline:0;min-width:0}
.qdp-pop input[type=text]:focus{border-color:var(--qd-ink-soft)}
.qdp-swatches{display:flex;gap:6px;flex-wrap:wrap;align-items:center}
.qdp-sw{all:unset;width:22px;height:22px;border-radius:50%;cursor:pointer;box-sizing:border-box;border:2px solid var(--qd-pop-bg)}
.qdp-sw.on{box-shadow:0 0 0 2px var(--qd-ink-strong)}
.qdp-swatches input[type=color]{width:26px;height:26px;padding:0;border:0;background:none;cursor:pointer}
.qdp-muted{color:var(--qd-ink-soft);font-size:12px}
`
function injectStyle() {
  if (document.getElementById('qd-presence-style')) return
  document.head.append(Object.assign(document.createElement('style'), { id: 'qd-presence-style', textContent: STYLE }))
}
const el = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e }
const ARROW = '<svg width="16" height="20" viewBox="0 0 16 20"><path d="M1 1l13 10.5-6 .7L4.7 19z" stroke="#fff" stroke-width="1.5"/></svg>'

// localStorage may be missing or refuse (private windows, blocked site data)
const localStore = {
  get(key) { try { return JSON.parse(localStorage.getItem(key)) } catch { return null } },
  set(key, value) { try { localStorage.setItem(key, JSON.stringify(value)) } catch {} },
}

/** What someone's label says: their name, and their status or what the agent is doing (and on what). */
export function presenceLabel(p) {
  const act = p.agent && ACTIVITIES[p.agentActivity]
  const status = act ? act + (p.agentNote ? `: ${p.agentNote}` : '') : p.agent ? AGENT_STATUS[p.agentStatus] : p.status
  const name = p.agent && p.owner ? `${p.name} (${p.owner})` : p.name // an agent: and whose it is, as the host says
  return status ? `${name} · ${status}` : name
}

/** Live presence over a board; the host carries it (see above). */
export function createPresence({ editor, container = editor.container, host, defaults = {}, storage = localStore, key = 'quickdraw-presence' }) {
  if (!host || !['send', 'onMessage'].every((k) => typeof host[k] === 'function')) {
    throw new TypeError('createPresence requires host send and onMessage functions')
  }
  injectStyle()

  // you: kept in this browser, so you are the same person next time
  const saved = storage.get(key) || {}
  let named = !!saved.name // you chose a name (here, or before): no suggestion replaces it
  const me = {
    name: String(saved.name || defaults.name || 'Guest').slice(0, 40),
    color: saved.color || defaults.color || COLORS[Math.floor(Math.random() * COLORS.length)],
    status: String(saved.status ?? '').slice(0, 60),
  }
  const at = { x: null, y: null } // your cursor on the page

  const layer = el('div', 'qdp-layer')
  const frame = el('div', 'qdp-frame')
  frame.hidden = true
  layer.append(frame)
  container.append(layer)
  const row = el('div', 'qdp-row')
  const people = el('div', 'qdp-people')
  const banner = el('div', 'qdp-follow')
  const bannerText = el('span')
  const stop = el('button', '', 'Stop')
  stop.onclick = () => follow(null)
  banner.append(bannerText, stop)
  const pop = el('div', 'qdp-pop')
  pop.hidden = banner.hidden = true
  row.append(people, banner, pop)
  ;(container.querySelector('.qd-ui') || container).append(row)

  // ---- sending yours ------------------------------------------------------
  let queued = false
  const presence = () => ({ ...me, x: at.x, y: at.y, view: editor.viewportPageBounds(), laser })
  // your laser pointer, for the others: its strokes as they are (page points, a few times a second)
  let laser = [], laserKey = '[]', laserTimer = 0
  const onScribbles = () => {
    if (laserTimer) return
    laserTimer = setTimeout(() => {
      laserTimer = 0
      const now = (editor.getScribbles?.() ?? []).map((s) => ({ points: s.points.slice(-80).map((p) => [Math.round(p.x), Math.round(p.y)]), opacity: Math.round(s.opacity * 100) / 100 }))
      const key = JSON.stringify(now)
      if (key === laserKey) return
      laser = now; laserKey = key
      send()
    }, 50)
  }
  function send() {
    if (queued) return
    queued = true
    requestAnimationFrame(() => { queued = false; host.send(presence()) })
  }
  const onMove = (e) => {
    const r = container.getBoundingClientRect()
    Object.assign(at, editor.screenToPage(e.clientX - r.left, e.clientY - r.top))
    send()
  }
  const onLeave = () => { Object.assign(at, { x: null, y: null }); send() }
  container.addEventListener('pointermove', onMove, { capture: true })
  container.addEventListener('pointerleave', onLeave)

  // ---- theirs ---------------------------------------------------------------
  const peers = new Map() // id -> { id, name, color, …, cursor, edge }
  function receive(m) {
    if (!m || m.id == null) return
    let p = peers.get(m.id)
    if (m.gone) {
      if (!p) return
      p.cursor.remove(); p.edge.remove()
      peers.delete(m.id)
      showLasers()
      if (following === m.id) follow(null)
      renderRow()
      return
    }
    if (!p) {
      const cursor = el('div', 'qdp-cursor')
      cursor.innerHTML = ARROW + '<span></span>'
      const edge = el('button', 'qdp-edge')
      edge.append(el('i'), el('b'), el('span'))
      edge.onclick = () => jumpTo(m.id)
      layer.append(cursor, edge)
      peers.set(m.id, p = { id: m.id, cursor, edge })
    }
    Object.assign(p, {
      name: String(m.name || (m.agent ? 'Agent' : 'Guest')), color: m.color || '#868e96', status: m.status || '',
      x: m.x ?? null, y: m.y ?? null, view: m.view || null, agent: !!m.agent, agentStatus: m.agentStatus || null,
      agentActivity: ACTIVITIES[m.agentActivity] ? m.agentActivity : null, agentNote: String(m.agentNote ?? '').slice(0, 80),
      laser: lasersOf(m.laser),
      owner: m.agent && m.owner ? String(m.owner).slice(0, 60) : undefined, // an agent's: who started it, as the host says
    })
    showLasers()
    // its motion; set only when it changes, so an animation is not restarted
    const act = p.agentActivity || ''
    if (p.cursor.dataset.act !== act) p.cursor.dataset.act = act
    p.cursor.querySelector('path').setAttribute('fill', p.color)
    const label = presenceLabel(p)
    for (const span of [p.cursor.querySelector('span'), p.edge.querySelector('span')]) {
      span.textContent = label
      span.style.background = p.color
    }
    p.edge.querySelector('i').style.background = p.color
    p.edge.querySelector('b').style.background = p.color
    p.edge.title = `Go to ${p.name}`
    place(p)
    renderRow()
    if (following === p.id) keepUp(p)
  }

  function place(p) {
    const { w, h } = editor.viewSize()
    const hidden = p.x == null
    const s = hidden ? null : editor.pageToScreen(p.x, p.y)
    const edge = s && edgePoint({ w, h }, s)
    p.cursor.hidden = hidden || !!edge
    p.edge.hidden = !edge
    if (s && !edge) p.cursor.style.transform = `translate(${s.x}px, ${s.y}px)`
    if (edge) {
      p.edge.style.transform = `translate(${edge.x}px, ${edge.y}px)`
      p.edge.querySelector('b').style.transform = `rotate(${edge.angle}rad) translateX(10px)`
      p.edge.classList.toggle('flip', edge.x > w / 2) // the label towards the middle
    }
  }
  const placeAll = () => peers.forEach(place)

  function jumpTo(id) {
    const p = peers.get(id)
    if (!p || p.x == null) return
    moveCamera(centreOn(editor.viewSize(), p, editor.camera.z), 400)
  }

  // ---- following ------------------------------------------------------------
  // a person: their view; an agent (or anyone not saying their view): their
  // cursor, once it nears the edge. Moving the view yourself stops it.
  let following = null
  let ours = 0 // until when camera changes are ours
  function moveCamera(cam, animate) {
    ours = performance.now() + animate + 100
    editor.setCamera(cam, { animate })
  }
  function keepUp(p) {
    const box = editor.viewSize()
    if (p.view && !p.agent) {
      const cam = fitView(box, p.view), c = editor.camera
      if (Math.abs(cam.x - c.x) * c.z < 1 && Math.abs(cam.y - c.y) * c.z < 1 && Math.abs(cam.z - c.z) < 1e-3) return
      moveCamera(cam, 200)
    } else if (p.x != null && !wellInside(editor.viewportPageBounds(), p)) {
      moveCamera(centreOn(box, p, editor.camera.z), 400)
    }
  }
  function follow(id) {
    following = id != null && peers.has(id) ? id : null
    const p = following != null ? peers.get(following) : null
    frame.hidden = banner.hidden = !p
    if (p) {
      frame.style.borderColor = banner.style.background = p.color
      bannerText.textContent = `Following ${p.name}`
      keepUp(p)
    }
    renderRow()
  }
  const onCamera = () => {
    placeAll()
    if (following != null && performance.now() > ours) follow(null) // you took the view
    send()
  }
  const offs = [editor.on('camera', onCamera), editor.on('scribbles', onScribbles)]

  // theirs, drawn as the core draws a laser; kept fresh while they last (the core lets one go after 2.5 s)
  function lasersOf(list) {
    if (!Array.isArray(list)) return []
    return list.slice(0, 8).flatMap((s) => Array.isArray(s?.points)
      ? [{ points: s.points.slice(-120).filter((p) => Array.isArray(p) && p.every(Number.isFinite)).map(([x, y]) => ({ x, y })), opacity: Math.max(0, Math.min(1, Number(s.opacity) || 0)) }]
      : [])
  }
  let fresh = 0
  function showLasers() {
    const all = [...peers.values()].flatMap((p) => p.laser || [])
    editor.setRemoteScribbles?.(all)
    clearInterval(fresh)
    fresh = all.length ? setInterval(() => editor.setRemoteScribbles?.([...peers.values()].flatMap((p) => p.laser || [])), 1000) : 0
  }
  addEventListener('resize', placeAll)

  // ---- the row: you, then everyone else ---------------------------------------
  function avatar(p, { isMe = false } = {}) {
    const b = el('button', 'qdp-av' + (isMe ? ' me' : ''), p.agent ? '✦' : initials(p.name))
    b.style.background = p.color
    if (following === p.id) b.style.boxShadow = `0 0 0 2px ${p.color}`
    b.title = isMe ? `${presenceLabel(p)} (you) — change your name, colour and status` : `${presenceLabel(p)} — ${following === p.id ? 'stop following' : 'follow'}`
    if (p.agent) {
      const dot = el('span', 'dot')
      dot.dataset.status = p.agentStatus || 'idle'
      b.append(dot)
    }
    b.onclick = isMe ? togglePop : () => follow(following === p.id ? null : p.id)
    return b
  }
  function renderRow() {
    people.replaceChildren(avatar(me, { isMe: true }), ...[...peers.values()].map((p) => avatar(p)))
  }

  // ---- you: name, colour, status ------------------------------------------------
  function setMe(patch) {
    if (patch.name != null) { me.name = String(patch.name).trim().slice(0, 40) || 'Guest'; named = true }
    if (patch.color != null) me.color = String(patch.color)
    if (patch.status != null) me.status = String(patch.status).trim().slice(0, 60)
    storage.set(key, { ...me })
    renderRow()
    send()
  }
  function togglePop() {
    if (!pop.hidden) { pop.hidden = true; return }
    const name = Object.assign(el('input'), { type: 'text', value: me.name, maxLength: 40, placeholder: 'Your name' })
    const status = Object.assign(el('input'), { type: 'text', value: me.status, maxLength: 60, placeholder: 'e.g. reviewing, away' })
    name.oninput = () => setMe({ name: name.value })
    status.oninput = () => setMe({ status: status.value })
    const swatches = el('div', 'qdp-swatches')
    const custom = Object.assign(el('input'), { type: 'color', title: 'Another colour', value: /^#[0-9a-f]{6}$/i.test(me.color) ? me.color : '#000000' })
    const paint = () => swatches.querySelectorAll('.qdp-sw').forEach((s) => s.classList.toggle('on', s.dataset.color === me.color))
    for (const c of COLORS) {
      const sw = el('button', 'qdp-sw')
      sw.dataset.color = c
      sw.style.background = c
      sw.title = c
      sw.onclick = () => { setMe({ color: c }); paint() }
      swatches.append(sw)
    }
    custom.oninput = () => { setMe({ color: custom.value }); paint() }
    swatches.append(custom)
    paint()
    const field = (text, input) => { const l = el('label', '', text); l.append(input); return l }
    pop.replaceChildren(field('Name', name), field('Colour', swatches), field('Status', status), el('div', 'qdp-muted', 'Kept in this browser; everyone on the board sees it.'))
    pop.hidden = false
    name.focus()
    name.select()
  }
  // typing here is not for the board's shortcuts; a click elsewhere closes it
  for (const type of ['keydown', 'keyup', 'paste']) pop.addEventListener(type, (e) => { e.stopPropagation(); if (e.key === 'Escape' || (e.key === 'Enter' && type === 'keydown')) pop.hidden = true })
  const onDown = (e) => { if (!pop.hidden && !row.contains(e.target)) pop.hidden = true }
  document.addEventListener('pointerdown', onDown, { capture: true })

  const offHost = host.onMessage(receive)
  renderRow()
  send()

  return {
    /** you, as others see you */
    me: () => ({ ...me }),
    /** a name for you until you choose one (the host knows who you are): not kept */
    suggestName(name) {
      if (named || !name || me.name === name) return
      me.name = String(name).trim().slice(0, 40) || me.name
      renderRow()
      send()
    },
    setMe,
    /** follow someone by id (null stops) */
    follow,
    following: () => following,
    /** everyone else here now */
    peers: () => [...peers.values()].map(({ cursor, edge, ...p }) => p),
    /** say who you are again (after a reconnect) */
    resend: () => host.send(presence()),
    /** everyone else has gone (a disconnect) */
    clear: () => { for (const id of [...peers.keys()]) receive({ id, gone: true }) },
    destroy() {
      offs.forEach((off) => off?.())
      if (typeof offHost === 'function') offHost()
      container.removeEventListener('pointermove', onMove, { capture: true })
      container.removeEventListener('pointerleave', onLeave)
      removeEventListener('resize', placeAll)
      clearInterval(fresh); clearTimeout(laserTimer)
      document.removeEventListener('pointerdown', onDown, { capture: true })
      layer.remove()
      row.remove()
    },
  }
}
