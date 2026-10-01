// The team and its tickets, as a page beside the board rather than on it:
// the agents (name, role, what each is doing, its tickets in progress) above
// a kanban of every ticket on the board — Todo, Doing, Done — whether or not
// the board has a kanban of frames. Drag a card to another column (or pick its
// status) to change it; press one to go to the ticket on the board. A role is
// edited in place, when the host lets it (setRole).
//
// The team comes from the host as a function (agents and their roles live
// elsewhere: quickdraw-members, presence); the tickets from the board itself.
import { pageBounds } from '@quickdrawjs/core'
import { isTicket, listTickets, STATUSES, STATUS_COLORS, ticketWho } from './index.js'
import { setTicketStatus } from './kanban.js'

const COLUMNS = [['todo', 'Todo'], ['doing', 'Doing'], ['done', 'Done']]
const columnOf = (status) => (status === 'failed' ? 'done' : status)
const STATUS_TITLES = { todo: 'Todo', doing: 'Doing', done: 'Done', failed: 'Failed' }
// the board's ink colours by name, as the panel cannot read the canvas theme
const INK = { grey: '#868e96', blue: '#1971c2', green: '#2f9e44', red: '#e03131' }

const STYLE = `
.qdt-team{position:absolute;box-sizing:border-box;display:flex;flex-direction:column;pointer-events:auto;overflow:hidden;
  top:calc(54px + env(safe-area-inset-top));right:var(--qda-right,58px);width:min(640px,calc(100% - 76px));max-height:calc(100% - 120px); /* under the row of people */
  border-radius:16px;background:var(--qd-pop-bg);border:1px solid var(--qd-border);box-shadow:var(--qd-pop-shadow);
  backdrop-filter:blur(20px) saturate(1.4);-webkit-backdrop-filter:blur(20px) saturate(1.4);color:var(--qd-ink-strong);
  font:13px/1.45 system-ui,-apple-system,sans-serif;z-index:1;touch-action:pan-x pan-y}
@media (max-width:640px){.qdt-team{top:auto;left:8px;right:8px;width:auto;bottom:calc(8px + env(safe-area-inset-bottom));max-height:62%}}
.qdt-team[hidden],.qdt-team [hidden]{display:none!important}
.qdt-head{display:flex;align-items:center;gap:6px;padding:10px 8px 6px 14px;flex:none}
.qdt-head h2{all:unset;flex:1;font-weight:600}
.qdt-x{all:unset;cursor:pointer;width:28px;height:28px;display:grid;place-items:center;border-radius:8px;color:var(--qd-ink-soft)}
.qdt-x:hover{background:var(--qd-hover,rgba(0,0,0,.06))}
.qdt-body{flex:1;min-height:0;overflow:auto;padding:0 12px 12px;display:flex;flex-direction:column;gap:10px}
.qdt-label{font-size:11px;font-weight:600;color:var(--qd-ink-soft);text-transform:uppercase;letter-spacing:.04em;margin:4px 2px 0}
.qdt-mates{display:flex;gap:8px;overflow-x:auto;padding-bottom:2px}
.qdt-mate{flex:none;width:180px;box-sizing:border-box;padding:8px 10px;border-radius:12px;border:1px solid var(--qd-border);display:grid;gap:3px}
.qdt-mate.away{opacity:.6}
.qdt-name{display:flex;align-items:center;gap:6px;font-weight:600;min-width:0}
.qdt-name span{white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.qdt-dot{flex:none;width:8px;height:8px;border-radius:50%;background:#adb5bd}
.qdt-dot[data-status=working]{background:#2f9e44}
.qdt-dot[data-status=waiting]{background:#f08c00}
.qdt-role{all:unset;box-sizing:border-box;width:100%;font-size:12px;padding:2px 6px;margin:0 -6px;border-radius:6px;color:var(--qd-ink-strong);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
button.qdt-role{cursor:text}
button.qdt-role:hover{background:var(--qd-hover,rgba(0,0,0,.06))}
.qdt-role.none{color:var(--qd-ink-soft);font-style:italic}
input.qdt-role{background:transparent;border:1px solid var(--qd-ink-soft)}
.qdt-pic{display:flex;align-items:flex-end;gap:6px;min-width:0}
.qdt-pic .qdt-name{flex:1;min-width:0;padding-bottom:4px}
.qdt-link{all:unset;cursor:pointer;font-size:11px;color:var(--qd-ink-soft);text-decoration:underline;text-underline-offset:2px;justify-self:start}
.qdt-link.err{color:#e03131;text-decoration:none}
.qdt-small{font-size:11px;color:var(--qd-ink-soft);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.qdt-cols{display:grid;grid-template-columns:repeat(3,minmax(150px,1fr));gap:8px;overflow-x:auto}
.qdt-col{border-radius:12px;background:var(--qd-hover,rgba(0,0,0,.04));padding:6px;display:flex;flex-direction:column;gap:6px;min-height:80px}
.qdt-col.over{outline:2px dashed var(--qd-ink-soft);outline-offset:-2px}
.qdt-col h3{all:unset;display:flex;justify-content:space-between;font-size:12px;font-weight:600;padding:2px 4px;color:var(--qd-ink-soft)}
.qdt-card{position:relative;box-sizing:border-box;padding:7px 8px 7px 11px;border-radius:9px;background:var(--qd-pop-bg);border:1px solid var(--qd-border);cursor:pointer;display:grid;gap:2px;overflow:hidden}
.qdt-card::before{content:'';position:absolute;left:0;top:0;bottom:0;width:3px;background:var(--qdt-accent,#868e96)}
.qdt-card:hover{border-color:var(--qd-ink-soft)}
.qdt-card.dragging{opacity:.4}
.qdt-title{font-weight:600;overflow-wrap:anywhere}
.qdt-result{font-size:12px;font-style:italic;color:var(--qdt-accent)}
.qdt-foot{display:flex;align-items:center;justify-content:space-between;gap:6px;min-width:0}
.qdt-foot .qdt-small{flex:1;min-width:0}
.qdt-foot select{flex:none;font:11px system-ui,-apple-system,sans-serif;color:var(--qd-ink-soft);background:transparent;border:0;padding:0;cursor:pointer;max-width:80px}
.qdt-empty{font-size:12px;color:var(--qd-ink-soft);padding:4px}
`
function injectStyle() {
  if (document.getElementById('qdt-team-style')) return
  document.head.append(Object.assign(document.createElement('style'), { id: 'qdt-team-style', textContent: STYLE }))
}
const el = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e }
const X_ICON = '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M6 6l12 12M18 6 6 18"/></svg>'

/**
 * The team-and-tickets panel. team(): the agents, each
 * { name, role?, about?, here?, status?, doing?, elsewhere?: [{ title, working? }] }; setRole(name, role): changes
 * one (absent: roles are shown, not edited); avatar(mate): an element for its
 * picture (its pet, playing), kept by the host; setAvatar(name, file): sets one
 * from an image file a person picks (a promise; a rejection says why).
 * Returns { show, hide, toggle, refresh, destroy }; call refresh() when the
 * team changes (tickets are watched).
 */
export function createTicketBoard({ editor, container = editor.container, team = () => [], setRole, avatar, setAvatar } = {}) {
  injectStyle()
  const store = editor.store
  const panel = el('section', 'qdt-team')
  panel.hidden = true
  panel.setAttribute('aria-label', 'Team and tickets')
  const head = el('header', 'qdt-head')
  const title = el('h2', '', 'Team & tickets')
  const close = el('button', 'qdt-x')
  close.type = 'button'
  close.title = 'Close'
  close.innerHTML = X_ICON
  close.onclick = () => hide()
  head.append(title, close)
  const body = el('div', 'qdt-body')
  panel.append(head, body)
  ;(container.querySelector('.qd-ui') || container).append(panel) // with the core's chrome: its theme, and hidden with it
  // what happens in the panel stays in it: no board shortcuts, pans or zooms
  for (const type of ['keydown', 'keyup', 'paste', 'wheel', 'pointerdown', 'dblclick']) panel.addEventListener(type, (e) => e.stopPropagation())

  let editing = null // the name whose role is being edited

  function mateCard(m, tickets) {
    const card = el('div', 'qdt-mate' + (m.here === false ? ' away' : ''))
    const name = el('div', 'qdt-name')
    const dot = el('i', 'qdt-dot')
    dot.dataset.status = m.here === false ? '' : m.status || 'idle'
    name.append(dot, el('span', '', m.name))
    name.title = m.name
    const pic = avatar?.(m)
    if (pic) { const top = el('div', 'qdt-pic'); top.append(pic, name); card.append(top) } else card.append(name)
    if (editing === m.name && setRole) {
      const input = el('input', 'qdt-role')
      input.value = m.role || ''
      input.placeholder = 'Role: reviewer, researcher…'
      input.maxLength = 60
      const done = (save) => {
        if (editing !== m.name) return
        editing = null
        if (save && input.value.trim() !== (m.role || '')) setRole(m.name, input.value.trim())
        render()
      }
      input.onkeydown = (e) => { if (e.key === 'Enter') done(true); else if (e.key === 'Escape') done(false) }
      input.onblur = () => done(true)
      card.append(input)
      queueMicrotask(() => { input.focus(); input.select() })
    } else {
      const role = el(setRole ? 'button' : 'div', 'qdt-role' + (m.role ? '' : ' none'), m.role || (setRole ? 'Give it a role' : 'No role'))
      if (setRole) { role.type = 'button'; role.title = 'Change its role'; role.onclick = () => { editing = m.name; render() } }
      card.append(role)
    }
    if (m.about) card.append(el('div', 'qdt-small', m.about))
    const mine = tickets.filter((t) => t.props.status === 'doing' && t.props.by && t.props.by.toLowerCase() === m.name.toLowerCase())
    const line = m.here === false ? 'not on the board' : mine.length ? `on: ${mine.map((t) => t.props.title).join(', ')}` : m.doing || (m.status === 'working' ? 'working' : 'free')
    const small = el('div', 'qdt-small', line)
    small.title = line
    card.append(small)
    // the same agent on other boards: where, and whether it works there now
    if (m.elsewhere?.length) {
      const also = 'also on ' + m.elsewhere.map((b) => b.title + (b.working ? ' (working there)' : '')).join(', ')
      const e = el('div', 'qdt-small', also)
      e.title = also
      card.append(e)
    }
    if (setAvatar) {
      // its picture: a Codex pet's sprite sheet (spritesheet.webp or .png)
      const pick = el('input')
      pick.type = 'file'
      pick.accept = 'image/webp,image/png'
      pick.hidden = true
      const b = el('button', 'qdt-link', pic ? 'Change its pet' : 'Give it a pet')
      b.type = 'button'
      b.title = "A Codex pet's sprite sheet: ~/.codex/pets/NAME/spritesheet.webp"
      b.onclick = () => pick.click()
      pick.onchange = async () => {
        const file = pick.files?.[0]
        if (!file) return
        try { await setAvatar(m.name, file); b.textContent = 'Change its pet' } catch (e) { b.textContent = e.message; b.classList.add('err') }
      }
      card.append(pick, b)
    }
    return card
  }

  function ticketCard(t) {
    const p = t.props
    const card = el('div', 'qdt-card')
    card.style.setProperty('--qdt-accent', INK[STATUS_COLORS[p.status]] || INK.grey)
    card.draggable = true
    card.dataset.id = t.id
    card.append(el('div', 'qdt-title', p.title || 'Untitled'))
    if (p.result) card.append(el('div', 'qdt-result', p.result))
    const foot = el('div', 'qdt-foot')
    foot.append(el('span', 'qdt-small', ticketWho(p) || (p.status === 'todo' ? 'any agent' : '')))
    // its status, also where dragging is awkward (a phone)
    const pick = el('select')
    pick.title = 'Status'
    for (const s of STATUSES) pick.append(Object.assign(el('option', '', STATUS_TITLES[s]), { value: s, selected: s === p.status }))
    pick.onclick = (e) => e.stopPropagation()
    pick.onchange = () => setTicketStatus(store, t.id, pick.value)
    foot.append(pick)
    card.append(foot)
    card.onclick = () => goTo(t.id)
    card.ondragstart = (e) => { e.dataTransfer.setData('text/plain', t.id); e.dataTransfer.effectAllowed = 'move'; card.classList.add('dragging') }
    card.ondragend = () => card.classList.remove('dragging')
    return card
  }

  function column(status, label, tickets) {
    const col = el('div', 'qdt-col')
    const h = el('h3')
    h.append(el('span', '', label), el('span', '', String(tickets.length)))
    col.append(h)
    for (const t of tickets) col.append(ticketCard(t))
    if (!tickets.length) col.append(el('div', 'qdt-empty', status === 'todo' ? 'Nothing waiting' : status === 'doing' ? 'Nobody on one' : 'None yet'))
    col.ondragover = (e) => { e.preventDefault(); col.classList.add('over') }
    col.ondragleave = () => col.classList.remove('over')
    col.ondrop = (e) => {
      e.preventDefault()
      col.classList.remove('over')
      const id = e.dataTransfer.getData('text/plain')
      const t = store.get(id)
      if (isTicket(t) && columnOf(t.props.status) !== status) setTicketStatus(store, id, status)
    }
    return col
  }

  // the ticket on the board: in view, and selected
  function goTo(id) {
    const s = store.get(id)
    if (!s) return
    const b = pageBounds(s)
    const { w, h } = editor.viewSize()
    const z = Math.max(editor.camera.z, 0.6)
    editor.setCamera({ z, x: w / 2 / z - (b.x + b.w / 2), y: h / 2 / z - (b.y + b.h / 2) }, { animate: 300 })
    editor.setSelection([id])
  }

  function render() {
    if (panel.hidden) return
    const tickets = listTickets(store)
    const mates = team()
    body.replaceChildren()
    body.append(el('div', 'qdt-label', 'Team'))
    const row = el('div', 'qdt-mates')
    for (const m of mates) row.append(mateCard(m, tickets))
    if (!mates.length) row.append(el('div', 'qdt-empty', 'No agents on this board yet.'))
    body.append(row)
    body.append(el('div', 'qdt-label', 'Tickets'))
    const cols = el('div', 'qdt-cols')
    for (const [status, label] of COLUMNS) cols.append(column(status, label, tickets.filter((t) => columnOf(t.props.status) === status)))
    body.append(cols)
  }

  // tickets change on the board: again, a moment later (several changes at once are one)
  let queued = false
  const later = () => { if (!queued && !panel.hidden && !editing) { queued = true; requestAnimationFrame(() => { queued = false; render() }) } }
  const offChange = editor.on('change', later)

  function show() { panel.hidden = false; render() }
  function hide() { panel.hidden = true; editing = null }
  return {
    show, hide,
    toggle() { if (panel.hidden) show(); else hide() },
    get open() { return !panel.hidden },
    refresh: later,
    destroy() { offChange?.(); panel.remove() },
  }
}

export const TEAM_ICON = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="9" cy="8" r="3"/><path d="M3.5 19a5.5 5.5 0 0 1 11 0"/><path d="M16 5.5a2.5 2.5 0 0 1 0 5"/><path d="M17.5 14.5a4.5 4.5 0 0 1 3 4.5"/></svg>'
