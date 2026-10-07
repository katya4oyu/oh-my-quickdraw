// The comments on the board: a marker on the top-right corner of each frame
// that has a thread (with how many comments), and the thread itself, opened
// from the marker or from a selected frame's Comment button, beside the
// marker on the board — a sheet along the bottom on a narrow screen.

export const COMMENT_ICON = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 5h16v11h-9l-5 4v-4H4z"/></svg>'
const CLOSE_ICON = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M6 6l12 12M18 6L6 18"/></svg>'

const W = 320 // the thread's width
const NARROW = 560 // narrower boards get the thread as a sheet along the bottom

/**
 * Where a thread goes: beside its marker (to the right, else the left), kept
 * on the screen; on a narrow board, a sheet along the bottom.
 */
export function threadSpot(marker, view, size = { w: W, h: 360 }, gap = 14) {
  if (view.w < NARROW) return { side: 'sheet' }
  const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v))
  const y = clamp(marker.y - 24, 12, Math.max(12, view.h - size.h - 12))
  if (marker.x + gap + size.w <= view.w - 12) return { side: 'right', x: marker.x + gap, y }
  if (marker.x - gap - size.w >= 12) return { side: 'left', x: marker.x - gap - size.w, y }
  return { side: 'right', x: clamp(marker.x + gap, 12, view.w - size.w - 12), y }
}

const STYLE = `
.qdc-layer{position:absolute;inset:0;pointer-events:none;overflow:hidden;z-index:34;font:13px/1.45 system-ui,-apple-system,sans-serif}
.qdc-layer [hidden]{display:none!important}
.qdc-marker{all:unset;position:absolute;left:0;top:0;pointer-events:auto;cursor:pointer;display:inline-flex;align-items:center;gap:4px;
  padding:3px 8px 3px 6px;border-radius:999px;background:var(--qd-pop-bg);border:1px solid var(--qd-border);box-shadow:var(--qd-pop-shadow);
  color:var(--qd-ink-strong);font-size:12px;font-variant-numeric:tabular-nums;transform:translate(-50%,-50%)}
.qdc-marker svg{width:15px;height:15px}
.qdc-marker[aria-expanded=true]{border-color:var(--qdc-accent)}
.qdc-marker:focus-visible,.qdc-thread button:focus-visible{outline:2px solid var(--qdc-accent);outline-offset:2px}
.qdc-thread{position:absolute;left:0;top:0;width:${W}px;max-height:min(440px,calc(100% - 24px));box-sizing:border-box;pointer-events:auto;
  display:grid;grid-template-rows:auto minmax(0,1fr) auto;border-radius:16px;background:var(--qd-pop-bg);border:1px solid var(--qd-border);
  box-shadow:var(--qd-pop-shadow);color:var(--qd-ink-strong);backdrop-filter:blur(20px) saturate(1.4);-webkit-backdrop-filter:blur(20px) saturate(1.4)}
.qdc-thread.qdc-sheet{left:8px;right:8px;top:auto;bottom:8px;width:auto;max-height:60%}
.qdc-head{display:flex;align-items:center;gap:8px;padding:10px 10px 8px 14px;border-bottom:1px solid var(--qd-border)}
.qdc-head span{color:var(--qd-ink-soft);font-size:12px}
.qdc-head b{font-weight:600;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;min-width:0;flex:1}
.qdc-x{all:unset;cursor:pointer;width:26px;height:26px;display:grid;place-items:center;border-radius:8px;color:var(--qd-ink-soft);flex:none}
.qdc-x:hover{background:var(--qd-hover)}.qdc-x svg{width:15px;height:15px}
.qdc-list{overflow-y:auto;padding:10px 14px;display:grid;gap:12px;align-content:start}
.qdc-empty{color:var(--qd-ink-soft);font-size:12px}
.qdc-c{display:grid;gap:2px}
.qdc-who{display:flex;gap:6px;align-items:baseline;font-size:12px}
.qdc-who b{font-weight:600}.qdc-who time{color:var(--qd-ink-soft);font-variant-numeric:tabular-nums}
.qdc-text{white-space:pre-wrap;overflow-wrap:anywhere;color:var(--qd-ink)}
.qdc-del{all:unset;cursor:pointer;margin-left:auto;color:var(--qd-ink-soft);font-size:11px;opacity:0}
.qdc-c:hover .qdc-del,.qdc-del:focus-visible{opacity:1}
.qdc-reply{display:grid;grid-template-columns:minmax(0,1fr) auto;gap:8px;align-items:end;padding:10px 12px;border-top:1px solid var(--qd-border)}
.qdc-reply textarea{font:16px/1.4 system-ui,-apple-system,sans-serif;resize:none;border:1px solid var(--qd-border);border-radius:12px;padding:7px 10px;
  background:transparent;color:var(--qd-ink-strong);outline:0;min-height:22px;max-height:120px}
.qdc-reply textarea:focus{border-color:var(--qd-ink-soft)}
.qdc-send{all:unset;cursor:pointer;font-size:12.5px;padding:7px 14px;border-radius:999px;background:var(--qdc-accent);color:#fff}
.qdc-send[disabled]{opacity:.4;cursor:default}
:root{--qdc-accent:#5b5bd6}
`

function injectStyle() {
  if (document.getElementById('qd-comments-style')) return
  document.head.append(Object.assign(document.createElement('style'), { id: 'qd-comments-style', textContent: STYLE }))
}
const el = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e }
const isFrame = (s) => !!s && s.isFrame === true
const clock = (at) => new Date(at).toLocaleString([], { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' })

/**
 * The board's comments, shown and written: markers on the frames that have a
 * thread, and the thread of one, opened beside its marker. `me()` gives the
 * name comments are written under. Returns { open(frameId), close(), refresh, destroy }.
 */
export function createComments({ editor, comments, me = () => null, container = editor.container }) {
  injectStyle()
  const layer = el('div', 'qdc-layer')
  container.append(layer)
  const markers = new Map() // frame id -> button
  let openId = null

  // the thread
  const thread = el('section', 'qdc-thread')
  thread.hidden = true
  thread.setAttribute('aria-label', 'Comments')
  const head = el('div', 'qdc-head')
  const where = el('span', '', 'Frame'), title = el('b')
  const x = el('button', 'qdc-x'); x.innerHTML = CLOSE_ICON; x.title = 'Close'; x.setAttribute('aria-label', 'Close')
  x.onclick = () => close()
  head.append(where, title, x)
  const list = el('div', 'qdc-list')
  const form = el('form', 'qdc-reply')
  const input = el('textarea'); input.rows = 1; input.setAttribute('aria-label', 'Comment')
  const send = el('button', 'qdc-send', 'Send'); send.type = 'submit'; send.disabled = true
  form.append(input, send)
  thread.append(head, list, form)
  layer.append(thread)
  for (const type of ['pointerdown', 'wheel', 'keydown']) thread.addEventListener(type, (e) => e.stopPropagation()) // the board keeps its hands off

  const grow = () => { input.style.height = 'auto'; input.style.height = Math.min(120, input.scrollHeight) + 'px'; send.disabled = !input.value.trim() }
  input.addEventListener('input', grow)
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); form.requestSubmit() }
    if (e.key === 'Escape') close()
  })
  form.addEventListener('submit', (e) => {
    e.preventDefault()
    if (!openId || !input.value.trim()) return
    comments.add(openId, input.value, me()?.name ?? '')
    input.value = ''
    grow()
  })

  function renderThread() {
    const f = editor.store.get(openId)
    if (!isFrame(f)) { close(); return }
    title.textContent = editor.store.get(openId + '-title')?.props?.text || 'Untitled'
    const items = comments.list(openId)
    list.replaceChildren(...(items.length ? items.map((c) => {
      const row = el('article', 'qdc-c')
      const who = el('div', 'qdc-who')
      const t = el('time', '', clock(c.at)); t.dateTime = new Date(c.at).toISOString()
      who.append(el('b', '', c.by || 'Someone'), t)
      if (c.by && c.by === me()?.name) { // your own: you may take it back
        const del = el('button', 'qdc-del', 'Delete'); del.type = 'button'
        del.onclick = () => comments.remove(openId, c.id)
        who.append(del)
      }
      row.append(who, el('div', 'qdc-text', c.text))
      return row
    }) : [el('p', 'qdc-empty', 'No comments yet. What should whoever works on this drawing know?')]))
    input.placeholder = items.length ? 'Reply' : 'Write a comment'
    list.scrollTop = list.scrollHeight
  }

  function place() {
    const v = editor.viewSize()
    const shown = new Set()
    for (const id of new Set([...comments.frames(), ...(openId ? [openId] : [])])) {
      const f = editor.store.get(id)
      if (!isFrame(f)) continue
      const n = comments.list(id).length
      const s = editor.pageToScreen(f.x + f.props.w, f.y)
      let m = markers.get(id)
      if (!m) {
        m = el('button', 'qdc-marker')
        m.type = 'button'
        m.onclick = () => (openId === id ? close() : open(id))
        layer.insertBefore(m, thread)
        markers.set(id, m)
      }
      m.innerHTML = COMMENT_ICON
      m.append(el('span', '', n ? String(n) : '+'))
      m.title = n ? `${n} comment${n === 1 ? '' : 's'}` : 'Comment'
      m.setAttribute('aria-expanded', String(openId === id))
      m.hidden = s.x < -20 || s.y < -20 || s.x > v.w + 20 || s.y > v.h + 20
      m.style.left = s.x + 'px'
      m.style.top = s.y + 'px'
      shown.add(id)
      if (openId === id) {
        const spot = threadSpot(s, v, { w: W, h: Math.min(440, thread.offsetHeight || 360) })
        thread.classList.toggle('qdc-sheet', spot.side === 'sheet')
        thread.style.transform = spot.side === 'sheet' ? '' : `translate(${spot.x}px, ${spot.y}px)`
      }
    }
    for (const [id, m] of [...markers]) if (!shown.has(id)) { m.remove(); markers.delete(id) }
  }

  let raf = 0
  const schedule = () => { if (!raf) raf = requestAnimationFrame(() => { raf = 0; if (openId) renderThread(); place() }) }

  function open(frameId) {
    if (!isFrame(editor.store.get(frameId))) return
    openId = frameId
    thread.hidden = false
    renderThread()
    place()
    input.focus({ preventScroll: true })
  }
  function close() {
    openId = null
    thread.hidden = true
    input.value = ''
    grow()
    place()
  }

  const offs = [comments.onChange(schedule), editor.store.listen(schedule), editor.on('camera', schedule)]
  addEventListener('resize', schedule)
  schedule()
  return {
    open, close, refresh: schedule,
    destroy() {
      cancelAnimationFrame(raf)
      offs.forEach((off) => off?.())
      removeEventListener('resize', schedule)
      layer.remove()
      markers.clear()
    },
  }
}

/** A selected frame's Comment button (for quickdraw-toolbar's selection bar). */
export function commentTools(view) {
  return {
    context: [{ id: 'comment', title: 'Comment', icon: COMMENT_ICON, when: isFrame, run: ({ shape }) => view.open(shape.id) }],
  }
}
