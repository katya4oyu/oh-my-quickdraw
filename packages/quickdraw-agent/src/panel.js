import { pageBounds } from '@quickdrawjs/core'
import { textOf, undoDiff } from './ops.js'

/** Build the common request shape from a panel, selection, or committed note. */
export function buildAgentRequest({ id, to, text, editor, shapeIds = [], frameIds = [], anchor = {}, options }) {
  return {
    id, to, text: String(text).trim(),
    context: { shapeIds: [...shapeIds], frameIds: [...frameIds], viewport: { ...editor.viewportPageBounds() } },
    anchor: { ...anchor },
    ...(options ? { options: { ...options } } : {}),
  }
}

/** The feedback a new request carries: what the host offers, less what the person set aside. */
export const feedbackToSend = (items, skipped = new Set()) => (items || []).filter((f) => !skipped.has(f.id)).map((f) => f.id)

/** The model and effort a request to `agent` runs on: the person's choice where the agent offers it, else its defaults. */
export function agentOptions(agent, choice = {}) {
  const models = agent?.models
  if (!models?.length) return undefined
  const model = models.find((m) => m.id === choice.model) ?? models.find((m) => m.id === agent.model) ?? models[0]
  const fallback = model.id === agent.model && model.efforts.includes(agent.effort) ? agent.effort : model.effort
  return { model: model.id, effort: model.efforts.includes(choice.effort) ? choice.effort : fallback }
}

/** "9% · resets in 6d": how much of a usage limit an agent has used, and when it starts again. */
export function limitText(limit, now = Date.now()) {
  const used = `${Math.round(limit.usedPercent)}%`
  if (!limit.resetsAt) return used
  const mins = Math.max(1, Math.round((limit.resetsAt - now) / 60000))
  const left = mins < 60 ? `${mins}m` : mins < 48 * 60 ? `${Math.round(mins / 60)}h` : `${Math.round(mins / 1440)}d`
  return `${used} · resets in ${left}`
}
/** How close to a limit: 'full' at 100%, 'high' from 80%. */
export const limitLevel = (limit) => (limit.usedPercent >= 100 ? 'full' : limit.usedPercent >= 80 ? 'high' : '')
// the agent's most-used limit
const topLimit = (agent) => (agent?.limits || []).reduce((a, b) => (!a || b.usedPercent > a.usedPercent ? b : a), null)

/** A committed note beginning with @AI or a known agent name is a request. */
export function detectAgentMention(text, agents) {
  const value = String(text || '').trim()
  for (const agent of agents) {
    const escaped = agent.name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    const match = value.match(new RegExp(`^@${escaped}(?:\\s+([\\s\\S]*))?$`, 'i'))
    if (match) return { to: agent.id, text: (match[1] || '').trim() }
  }
  const match = value.match(/^@AI(?:\s+([\s\S]*))?$/i)
  const agent = match && (agents.find((item) => /\bai\b/i.test(item.name)) || agents[0])
  return agent ? { to: agent.id, text: (match[1] || '').trim() } : null
}

/** Whether a board note is already the anchor of a restored or live thread. */
export function hasAgentThreadForAnchor(shapeId, threads) {
  for (const thread of threads) if (thread.request.anchor?.shapeId === shapeId) return true
  return false
}

/** Track one thread's visible event history and per-request operation diffs. */
export function updateAgentThread(thread, event) {
  const next = { ...thread, events: [...(thread.events || []), event], diffs: [...(thread.diffs || [])] }
  if (event.type === 'op' && event.diff) next.diffs.push(event.diff)
  if (event.type === 'undo') { // undone here or on another device: nothing left to undo
    next.undoResult = { reverted: event.reverted, skipped: event.skipped }
    next.diffs = []
  }
  // a request about nothing in particular is pinned to the first thing it made
  if (event.type === 'op' && event.ids?.length && !thread.request?.anchor?.shapeId) {
    next.request = { ...thread.request, anchor: { ...thread.request.anchor, shapeId: event.ids[0] } }
  }
  if (event.type === 'done' || event.type === 'error') next.status = event.type
  else if (event.type === 'approval' || event.type === 'question') next.status = 'waiting'
  else if (event.type === 'progress' || event.type === 'op') next.status = 'working'
  // a message or a person's reply leaves it as it was: a word after `done` does not reopen it
  return next
}

/** Undo a request newest-first, preserving partial-conflict details. */
export function undoAgentRequest(store, diffs) {
  let reverted = 0
  const skipped = []
  for (const diff of [...diffs].reverse()) {
    const result = undoDiff(store, diff)
    reverted += result.reverted
    skipped.push(...result.skipped)
  }
  return { reverted, skipped }
}


// ---- the panel ----
// It lives in the core's .qd-ui, reuses its theme variables and hides with it:
// a card left of the toolbar's rail on wide screens, a sheet from the bottom
// on phones. Threads are pinned to the top-right corner of what they are about.

const svg = (body) => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${body}</svg>`
export const AGENT_ICON = svg('<path d="M12 3.5 13.9 9 19.5 11l-5.6 2L12 18.5 10.1 13 4.5 11l5.6-2z"/><path d="M19 3v4M17 5h4"/>')
const ICONS = {
  send: svg('<path d="M12 19V5"/><path d="m5 12 7-7 7 7"/>'),
  back: svg('<path d="m15 18-6-6 6-6"/>'),
  close: svg('<path d="M18 6 6 18M6 6l12 12"/>'),
}

const el = (tag, cls, text) => {
  const node = document.createElement(tag)
  if (cls) node.className = cls
  if (text != null) node.textContent = text
  return node
}
const iconButton = (icon, title, cls = '') => {
  const b = el('button', 'qd-tool ' + cls)
  b.type = 'button'
  b.innerHTML = icon
  b.title = title
  b.setAttribute('aria-label', title)
  return b
}

const STYLE = `
.qda{position:absolute;box-sizing:border-box;display:flex;flex-direction:column;pointer-events:auto;overflow:hidden;
  top:10px;right:var(--qda-right,58px);width:320px;max-height:calc(100% - 76px);
  border-radius:16px;background:var(--qd-pop-bg);border:1px solid var(--qd-border);box-shadow:var(--qd-pop-shadow);
  backdrop-filter:blur(20px) saturate(1.4);-webkit-backdrop-filter:blur(20px) saturate(1.4);color:var(--qd-ink-strong);
  font:13px/1.45 system-ui,-apple-system,sans-serif;z-index:1;animation:qda-in 160ms cubic-bezier(.2,.9,.3,1.1)}
@media (max-width:640px){.qda{top:auto;left:8px;right:8px;width:auto;bottom:calc(8px + env(safe-area-inset-bottom));max-height:62%;animation-name:qda-up}}
@keyframes qda-in{from{opacity:0;transform:translateX(8px)}}
@keyframes qda-up{from{opacity:0;transform:translateY(12px)}}
@media (prefers-reduced-motion:reduce){.qda,.qda-pin[data-status=working]::after{animation:none}}
.qda[hidden],.qda [hidden]{display:none!important}
.qda .qd-tool svg{width:17px;height:17px;display:block}
.qda-head{display:flex;align-items:center;gap:4px;padding:8px 8px 6px 14px;flex:none}
.qda-back+.qda-title{margin-left:-4px}
.qda-title{flex:1;min-width:0;font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.qda-body{flex:1;min-height:0;overflow:auto;padding:0 14px 10px;display:flex;flex-direction:column;gap:6px}
.qda-muted{color:var(--qd-ink-soft);font-size:12px}
.qda-who{display:flex;flex-wrap:wrap;gap:6px;margin-bottom:6px}
.qda-agent{display:flex;align-items:center;gap:6px;padding:3px 9px 3px 7px;border-radius:999px;background:var(--qd-seg-bg)}
.qda-dot{width:7px;height:7px;border-radius:50%;flex:none;background:var(--qd-ink-faint)}
.qda-dot[data-status=working]{background:var(--qda-accent)}.qda-dot[data-status=waiting]{background:var(--qda-wait)}
.qda-dot[data-status=error]{background:var(--qda-error)}.qda-dot[data-status=done]{background:var(--qd-ink-soft)}
.qda-join{display:grid;gap:6px;padding:9px 11px;margin-bottom:6px;border-radius:12px;background:var(--qd-seg-bg)}
.qda-join>div{display:flex;align-items:center;justify-content:space-between;gap:6px}
.qda-join code{font:12px/1.4 ui-monospace,SFMono-Regular,Menlo,monospace;user-select:all}
.qda-join code span{display:inline-block;max-width:100%;overflow-wrap:anywhere}
.qda-usage{display:grid;grid-template-columns:auto 1fr auto;align-items:center;gap:4px 8px;padding:8px 11px;margin-bottom:6px;border-radius:12px;background:var(--qd-seg-bg);font-size:12px}
.qda-usage>.qda-muted{grid-column:1/-1}
.qda-bar{height:5px;border-radius:3px;background:var(--qd-hover);overflow:hidden}
.qda-bar i{display:block;height:100%;border-radius:3px;background:var(--qda-accent)}
[data-level=high] .qda-bar i{background:var(--qda-wait)}[data-level=full] .qda-bar i{background:var(--qda-error)}
.qda-limit{display:contents}.qda-limit span:last-child{color:var(--qd-ink-soft);font-variant-numeric:tabular-nums}
.qda-opts .qda-muted{align-self:center;padding:0 4px}.qda-opts [data-level=high]{color:var(--qda-wait)}.qda-opts [data-level=full]{color:var(--qda-error)}
.qda-empty{padding:18px 4px;text-align:center;color:var(--qd-ink-soft)}
.qda-row{all:unset;box-sizing:border-box;display:flex;align-items:center;gap:9px;padding:8px 9px;margin:0 -9px;border-radius:10px;cursor:pointer}
.qda-row:hover{background:var(--qd-hover)}
.qda-row span:nth-child(2){flex:1;min-width:0;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden}
.qda-me{align-self:flex-end;max-width:85%;padding:7px 11px;border-radius:14px 14px 4px 14px;background:var(--qd-on-bg);color:var(--qd-on-ink);white-space:pre-wrap;overflow-wrap:anywhere}
.qda-say{align-self:flex-start;max-width:90%;padding:7px 11px;border-radius:14px 14px 14px 4px;background:var(--qd-seg-bg);white-space:pre-wrap;overflow-wrap:anywhere}
.qda-note{display:flex;align-items:center;gap:7px;color:var(--qd-ink-soft);font-size:12px}
.qda-note.error{color:var(--qda-error)}
.qda-ask{border:1px solid var(--qda-wait);border-radius:12px;padding:9px 11px;display:grid;gap:8px}
.qda-actions{display:flex;gap:6px;flex-wrap:wrap}
.qda-btn{font:inherit;font-size:12px;border:1px solid var(--qd-border);border-radius:999px;padding:4px 12px;background:transparent;color:inherit;cursor:pointer}
.qda-btn:hover{background:var(--qd-hover)}.qda-btn.primary{background:var(--qd-on-bg);color:var(--qd-on-ink);border-color:transparent}
.qda-btn:disabled{opacity:.4;cursor:default}
.qda-foot{flex:none;padding:8px;border-top:1px solid var(--qd-menu-div);display:grid;gap:6px}
.qda-chip{display:flex;align-items:center;gap:6px;justify-self:start;max-width:100%;padding:2px 4px 2px 9px;border-radius:999px;background:var(--qd-seg-bg);font-size:12px}
.qda-chip span{white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.qda-fb{display:flex;flex-wrap:wrap;gap:4px}
.qda-fb .qda-chip{background:color-mix(in srgb,var(--qda-accent) 14%,transparent)}
.qda-chip .qd-tool{width:22px;height:22px}.qda-chip .qd-tool svg{width:13px;height:13px}
.qda-input{display:flex;align-items:flex-end;gap:6px;padding:4px 4px 4px 10px;border-radius:14px;background:var(--qd-seg-bg)}
.qda-input textarea{flex:1;border:0;outline:0;background:transparent;color:inherit;resize:none;font:16px/1.35 system-ui,-apple-system,sans-serif;padding:4px 0;max-height:120px}
.qda-opts{display:flex;flex-wrap:wrap;gap:4px}
.qda-opts select{font:inherit;font-size:12px;border:1px solid var(--qd-border);border-radius:999px;padding:3px 8px;background:transparent;color:var(--qd-ink);max-width:170px}
.qda-send{background:var(--qd-on-bg)!important;color:var(--qd-on-ink)!important;border-radius:50%!important;width:30px!important;height:30px!important}
.qda-send:disabled{opacity:.3}
.qda-pins{position:absolute;inset:0;pointer-events:none;overflow:hidden;z-index:30}
.qda-pin{position:absolute;width:24px;height:24px;padding:0;margin:-12px 0 0 -12px;border-radius:50%;border:2px solid var(--qd-pop-bg);
  display:grid;place-items:center;background:var(--qd-on-bg);color:var(--qd-on-ink);box-shadow:var(--qd-bar-shadow);pointer-events:auto;cursor:pointer}
.qda-pin svg{width:13px;height:13px}
.qda-pin[data-status=working]{background:var(--qda-accent);color:#fff}
.qda-pin[data-status=working]::after{content:'';position:absolute;inset:-5px;border-radius:50%;border:2px solid var(--qda-accent);animation:qda-pulse 1.4s ease-out infinite}
.qda-pin[data-status=waiting]{background:var(--qda-wait);color:#fff}
.qda-pin[data-status=error]{background:var(--qda-error);color:#fff}
.qda-pin[data-status=undone]{opacity:.45}
.qda-pin.open{outline:2px solid var(--qda-accent);outline-offset:2px}
@keyframes qda-pulse{from{opacity:.7;transform:scale(.8)}to{opacity:0;transform:scale(1.4)}}
:root{--qda-accent:#5b5bd6;--qda-wait:#d98a00;--qda-error:#c43d3d}
`
function injectStyle() {
  if (document.getElementById('qd-agent-style')) return
  const style = el('style')
  style.id = 'qd-agent-style'
  style.textContent = STYLE
  document.head.append(style)
}
const STATUS = { idle: 'Idle', working: 'Working', waiting: 'Needs you', done: 'Done', error: 'Error', undone: 'Undone' }
const threadStatus = (thread) => (thread.undoResult ? 'undone' : thread.status)
const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`
// "About: Ideas" for one shape or frame, "About 2 frames and 3 shapes" for more
function about(store, all) {
  const shapes = all.filter((s) => !s.isFrameTitle) // a frame's title goes with it
  const frames = shapes.filter((s) => s.isFrame)
  if (shapes.length === 1) {
    const text = textOf(store, shapes[0]) || (shapes[0].isFrame ? 'a frame' : shapes[0].type)
    return `About: ${String(text).split('\n')[0]}`
  }
  const rest = shapes.length - frames.length
  return 'About ' + [frames.length && plural(frames.length, 'frame'), rest && plural(rest, 'shape')].filter(Boolean).join(' and ')
}

/** Toolbar items (quickdraw-toolbar's shape): AI on the rail, "Ask AI" on the selection bar. */
export function agentTools(panel) {
  return {
    rail: [{ id: 'agent', title: 'AI', icon: AGENT_ICON, run: () => panel.toggle() }],
    context: [{ id: 'agent-ask', title: 'Ask AI', icon: AGENT_ICON, when: () => true, run: ({ shape }) => panel.openForSelection([shape.id]) }],
  }
}

/** Add the host-driven agent panel, thread list and canvas pins to an editor. */
export function createAgentPanel({ editor, store = editor.store, container = editor.container, host }) {
  if (!host || typeof host.agents !== 'function' || typeof host.ask !== 'function' || typeof host.reply !== 'function' || typeof host.threads !== 'function' || typeof host.onEvent !== 'function') {
    throw new TypeError('createAgentPanel requires host agents, ask, reply, threads and onEvent functions')
  }
  injectStyle()
  const threads = new Map((host.threads() || []).map((thread) => [thread.request.id, { ...thread, events: [...(thread.events || [])], diffs: [...(thread.diffs || [])] }]))
  const answered = new Set() // approvals answered here, until the agent moves on
  let view = null // null: the list; else the open thread's id
  let pendingShapeIds = null // the selection a request will be about
  let editingNoteId = null
  // the model and effort chosen per agent, remembered on this device
  const CHOICES = 'quickdraw-agent:choices'
  let choices = {}
  try { choices = JSON.parse(localStorage.getItem(CHOICES) || '{}') } catch {}
  const choose = (agentId, patch) => {
    choices = { ...choices, [agentId]: { ...choices[agentId], ...patch } }
    try { localStorage.setItem(CHOICES, JSON.stringify(choices)) } catch {}
    renderFoot()
  }
  const optionsFor = (agentId) => agentOptions(getAgents().find((a) => a.id === agentId), choices[agentId])

  const panel = el('section', 'qda')
  panel.hidden = true
  panel.setAttribute('aria-label', 'AI')
  const head = el('header', 'qda-head')
  const back = iconButton(ICONS.back, 'All threads', 'qda-back')
  const title = el('div', 'qda-title')
  const close = iconButton(ICONS.close, 'Close')
  head.append(back, title, close)
  const body = el('div', 'qda-body')
  const foot = el('form', 'qda-foot')
  const fbRow = el('div', 'qda-fb') // feedback that goes with the next request
  const skipped = new Set() // feedback set aside for the next request
  const chip = el('div', 'qda-chip')
  const chipText = el('span')
  const chipClear = iconButton(ICONS.close, 'Not about the selection')
  chip.append(chipText, chipClear)
  const input = el('div', 'qda-input')
  const prompt = el('textarea')
  prompt.rows = 1
  prompt.setAttribute('aria-label', 'Message')
  const opts = el('div', 'qda-opts')
  const picker = el('select')
  picker.setAttribute('aria-label', 'Ask')
  const modelPick = el('select')
  modelPick.setAttribute('aria-label', 'Model')
  const effortPick = el('select')
  effortPick.setAttribute('aria-label', 'Effort')
  const usage = el('span', 'qda-muted') // the chosen agent's most-used limit
  opts.append(picker, modelPick, effortPick, usage)
  const send = iconButton(ICONS.send, 'Send', 'qda-send')
  send.type = 'submit'
  input.append(prompt, send)
  const lock = el('div', 'qda-muted') // why this viewer may not ask
  foot.append(fbRow, chip, opts, lock, input)
  panel.append(head, body, foot)
  // typing here is not for the board: its shortcuts (keys on the container) and its paste
  for (const type of ['keydown', 'keyup', 'paste']) panel.addEventListener(type, (e) => e.stopPropagation())
  ;(container.querySelector('.qd-ui') || container).append(panel)
  const pinLayer = el('div', 'qda-pins')
  container.append(pinLayer)
  const pins = new Map()

  const getAgents = () => host.agents() || []
  const agentName = (id) => getAgents().find((a) => a.id === id)?.name || 'AI'
  // why this viewer may not ask an agent (or answer it), as the host says; nothing if they may
  const whyNot = (id) => { const a = getAgents().find((x) => x.id === id); return a ? host.cannotAsk?.(a) : undefined }

  function show() {
    if (panel.hidden && editor.selection.size) { pendingShapeIds = [...editor.selection]; view = null }
    panel.hidden = false
    render()
  }
  function hide() { panel.hidden = true; renderPins() }
  function open(id) { view = id; following = id; show() }

  function renderList() {
    title.textContent = 'AI'
    const who = el('div', 'qda-who')
    for (const agent of getAgents()) {
      const row = el('div', 'qda-agent')
      const dot = el('span', 'qda-dot')
      dot.dataset.status = agent.status
      row.title = `${STATUS[agent.status] || agent.status}${agent.knows?.length ? ' · knows ' + agent.knows.join(', ') : ''}`
      row.append(dot, el('span', '', agent.name))
      const knows = (agent.knows || []).filter((k) => !agent.name.includes(k)) // "Codex · repo" already says repo
      if (knows.length) row.append(el('span', 'qda-muted', knows.join(' · ')))
      who.append(row)
    }
    body.append(who)
    // what each runs on, and how much of its limits is used
    for (const agent of getAgents()) {
      if (!agent.account && !agent.limits?.length) continue
      const box = el('div', 'qda-usage')
      const label = [getAgents().length > 1 && agent.name, agent.account].filter(Boolean).join(' · ')
      if (label) box.append(el('span', 'qda-muted', label))
      for (const limit of agent.limits || []) {
        const row = el('div', 'qda-limit')
        row.dataset.level = limitLevel(limit)
        const bar = el('span', 'qda-bar')
        const fillBar = el('i')
        fillBar.style.width = `${Math.min(100, limit.usedPercent)}%`
        bar.append(fillBar)
        row.append(el('span', '', limit.name), bar, el('span', '', limitText(limit)))
        box.append(row)
      }
      body.append(box)
    }
    if (!getAgents().length) {
      who.append(el('span', 'qda-muted', 'No AI has joined this board.'))
      const join = host.join?.()
      if (join) body.append(joinBlock(join))
    }
    const list = [...threads.values()].reverse()
    if (!list.length) {
      body.append(el('div', 'qda-empty', 'Ask here, from ✦ on a selected shape, or write a note that starts with “@AI”.'))
    }
    for (const thread of list) {
      const row = el('button', 'qda-row')
      row.type = 'button'
      const dot = el('span', 'qda-dot')
      dot.dataset.status = threadStatus(thread)
      row.append(dot, el('span', '', thread.request.text || '(no text)'), el('span', 'qda-muted', STATUS[threadStatus(thread)] || ''))
      row.addEventListener('click', () => open(thread.request.id))
      body.append(row)
    }
  }

  // how to bring an agent here: the host's command, to copy into a terminal
  function joinBlock({ text, command }) {
    const box = el('div', 'qda-join')
    const code = el('code') // wrapped between words; a long one (a URL) within itself
    command.split(' ').forEach((word, i) => code.append(...(i ? [' '] : []), el('span', '', word)))
    const copy = el('button', 'qda-btn', 'Copy')
    copy.type = 'button'
    copy.addEventListener('click', async () => {
      try {
        await navigator.clipboard.writeText(command)
        copy.textContent = 'Copied'
        setTimeout(() => { copy.textContent = 'Copy' }, 1500)
      } catch { getSelection()?.selectAllChildren(code) } // no clipboard here: selected, to copy by hand
    })
    const row = el('div')
    row.append(el('span', 'qda-muted', text || ''), copy)
    box.append(row, code)
    return box
  }

  function renderThread(thread) {
    title.textContent = agentName(thread.request.to)
    body.append(el('div', 'qda-me', thread.request.text))
    let changes = 0
    const flushChanges = () => {
      if (changes) body.append(el('div', 'qda-note', `✓ ${plural(changes, 'change')} on the board`))
      changes = 0
    }
    thread.events.forEach((event, i) => {
      if (event.type === 'op') { changes++; return }
      flushChanges()
      const text = event.text || event.message || ''
      if (event.type === 'reply') body.append(el('div', 'qda-me', text))
      else if (event.type === 'message' || event.type === 'question') body.append(el('div', 'qda-say', text))
      else if (event.type === 'approval') {
        const card = el('div', 'qda-ask')
        card.append(el('div', '', text || 'The agent asks for approval.'))
        const settled = answered.has(event.id) || i < thread.events.length - 1
        const blocked = !settled && whyNot(thread.request.to)
        if (blocked) card.append(el('div', 'qda-muted', blocked))
        else if (!settled) {
          const actions = el('div', 'qda-actions')
          for (const [allow, label] of [[true, 'Allow'], [false, 'Deny']]) {
            const b = el('button', 'qda-btn' + (allow ? ' primary' : ''), label)
            b.type = 'button'
            b.addEventListener('click', () => {
              answered.add(event.id)
              host.reply(thread.request.id, { approval: event.id, allow })
              render()
            })
            actions.append(b)
          }
          card.append(actions)
        } else card.append(el('div', 'qda-muted', 'Answered'))
        body.append(card)
      } else if (event.type === 'error') body.append(el('div', 'qda-note error', text || 'Something went wrong.'))
      else if (text) body.append(el('div', 'qda-note', text))
    })
    flushChanges()
    if (thread.undoResult) {
      const { reverted, skipped } = thread.undoResult
      body.append(el('div', 'qda-note', `Undone: ${plural(reverted, 'change')} reverted${skipped.length ? `, ${skipped.length} kept (changed since)` : ''}.`))
    } else if (thread.diffs.length && thread.status !== 'working' && thread.status !== 'waiting') {
      const actions = el('div', 'qda-actions')
      const undo = el('button', 'qda-btn', 'Undo these changes')
      undo.type = 'button'
      undo.addEventListener('click', () => {
        thread.undoResult = undoAgentRequest(store, thread.diffs)
        thread.diffs = []
        Promise.resolve(host.reply(thread.request.id, { undo: thread.undoResult })).catch((error) => {
          thread.undoSyncError = String(error)
          render()
        })
        render()
      })
      actions.append(undo)
      body.append(actions)
    }
    if (thread.undoSyncError) body.append(el('div', 'qda-note error', `Could not save the undo: ${thread.undoSyncError}`))
  }

  function renderFoot() {
    const agents = getAgents()
    const inThread = view && threads.has(view)
    const selected = (pendingShapeIds || []).map((id) => store.get(id)).filter(Boolean)
    chip.hidden = inThread || !selected.length
    if (selected.length) chipText.textContent = about(store, selected)
    picker.hidden = inThread || agents.length < 2
    fill(picker, agents.map((a) => [a.id, a.name]))
    // the model and effort, for an agent that offers them
    const agent = agents.find((a) => a.id === picker.value) ?? agents[0]
    const chosen = agentOptions(agent, choices[agent?.id])
    modelPick.hidden = effortPick.hidden = inThread || !chosen
    if (chosen) {
      const model = agent.models.find((m) => m.id === chosen.model)
      fill(modelPick, agent.models.map((m) => [m.id, m.name]), chosen.model)
      fill(effortPick, model.efforts.map((e) => [e, e]), chosen.effort)
    }
    const top = topLimit(agent)
    usage.hidden = inThread || !top
    if (top) {
      usage.textContent = `${top.name} ${Math.round(top.usedPercent)}%`
      usage.dataset.level = limitLevel(top)
      usage.title = [agent.account, ...agent.limits.map((l) => `${l.name}: ${limitText(l)}`)].filter(Boolean).join('\n')
    }
    opts.hidden = picker.hidden && modelPick.hidden && usage.hidden
    // feedback (e.g. snapshots written on) that the next request carries, each set aside with its ×
    const feedback = inThread ? [] : (host.feedback?.() || [])
    for (const id of skipped) if (!feedback.some((f) => f.id === id)) skipped.delete(id)
    const fbKey = JSON.stringify(feedback.map((f) => [f.id, f.label, f.count, skipped.has(f.id)]))
    if (fbRow.dataset.key !== fbKey) {
      fbRow.dataset.key = fbKey
      fbRow.replaceChildren(...feedback.filter((f) => !skipped.has(f.id)).map((f) => {
        const c = el('div', 'qda-chip')
        c.title = 'Goes with your next request'
        const x = iconButton(ICONS.close, 'Not this time')
        x.addEventListener('click', () => { skipped.add(f.id); renderFoot() })
        c.append(el('span', '', `${f.label}${f.count ? ' · ' + f.count : ''}`), x)
        return c
      }))
    }
    fbRow.hidden = !fbRow.childElementCount
    const blocked = whyNot(inThread ? threads.get(view).request.to : agent?.id)
    lock.hidden = !blocked
    lock.textContent = blocked || ''
    prompt.disabled = !!blocked
    prompt.placeholder = blocked ? 'Not from here' : inThread ? 'Reply…' : `Ask ${agents.length === 1 ? agents[0].name : 'AI'}…`
    send.disabled = !!blocked || !prompt.value.trim() || (!inThread && !agents.length)
  }

  // a select's options, rebuilt only when they change (an open picker stays open)
  function fill(select, items, value) {
    const key = JSON.stringify(items)
    if (select.dataset.items !== key) {
      const keep = select.value
      select.replaceChildren(...items.map(([v, label]) => Object.assign(el('option', '', label), { value: v })))
      select.dataset.items = key
      if (items.some(([v]) => v === keep)) select.value = keep
    }
    if (value != null) select.value = value
  }

  function render() {
    body.replaceChildren()
    const thread = view && threads.get(view)
    if (!thread) view = null
    back.hidden = !thread
    if (thread) renderThread(thread)
    else renderList()
    renderFoot()
    renderPins()
    if (thread) body.scrollTop = body.scrollHeight
  }

  function renderPins() {
    for (const [id, thread] of threads) {
      let pin = pins.get(id)
      if (!pin) {
        pin = el('button', 'qda-pin')
        pin.type = 'button'
        pin.innerHTML = AGENT_ICON
        pin.addEventListener('pointerdown', (e) => e.stopPropagation()) // not a board gesture
        pin.addEventListener('click', (e) => { e.stopPropagation(); open(id) })
        pinLayer.append(pin)
        pins.set(id, pin)
      }
      const anchor = thread.request.anchor || {}
      const shape = anchor.shapeId ? store.get(anchor.shapeId) : null
      const bounds = shape ? pageBounds(shape) : null
      const point = bounds ? editor.pageToScreen(bounds.x + bounds.w, bounds.y) : editor.pageToScreen(anchor.x || 0, anchor.y || 0)
      pin.style.left = `${point.x}px`
      pin.style.top = `${point.y}px`
      pin.dataset.status = threadStatus(thread)
      pin.classList.toggle('open', !panel.hidden && view === id)
      pin.title = `${thread.request.text} — ${STATUS[threadStatus(thread)] || ''}`
    }
  }

  function handleEvent(envelope, requestId) {
    if (envelope.type === 'agents') { if (!panel.hidden) render(); return }
    if (envelope.type === 'threads' || envelope.type === 'thread') {
      // `threads`: the stored ones, as they are now (after reconnecting too);
      // `thread`: one started on another device
      for (const thread of envelope.threads || [envelope.thread]) {
        if (envelope.type === 'threads' || !threads.has(thread.request.id)) threads.set(thread.request.id, { ...thread, events: [...thread.events], diffs: [...thread.diffs] })
      }
      if (panel.hidden) renderPins()
      else render()
      return
    }
    const event = envelope.type === 'event' && envelope.event ? envelope.event : envelope
    const id = event.requestId || requestId
    const thread = threads.get(id)
    if (!thread) return
    threads.set(id, updateAgentThread(thread, event))
    if (event.type === 'op' && id === following) follow(event.diff)
    if (panel.hidden) renderPins()
    else render()
  }

  // Following: the view goes where the agent works on a request asked or
  // opened here, until the person moves the view themselves.
  let following = null
  let panning = 0 // until when camera changes are ours
  function follow(diff) {
    const shapes = [...Object.values(diff?.added || {}), ...Object.values(diff?.updated || {}).map(([, to]) => to)]
      .filter((r) => r.typeName === 'shape' && !r.isFrameTitle)
    if (!shapes.length) return
    const bs = shapes.map((s) => pageBounds(s))
    const x = Math.min(...bs.map((b) => b.x)), y = Math.min(...bs.map((b) => b.y))
    const w = Math.max(...bs.map((b) => b.x + b.w)) - x, h = Math.max(...bs.map((b) => b.y + b.h)) - y
    const v = editor.viewportPageBounds()
    if (x >= v.x && y >= v.y && x + w <= v.x + v.w && y + h <= v.y + v.h) return // in view
    const box = container.getBoundingClientRect()
    const z = Math.min(editor.camera.z, (box.width * 0.8) / w, (box.height * 0.8) / h)
    panning = Date.now() + 800
    editor.setCamera({ x: box.width / 2 / z - (x + w / 2), y: box.height / 2 / z - (y + h / 2), z }, { animate: 500 })
  }

  function sendRequest(request) {
    const feedback = feedbackToSend(host.feedback?.(), skipped)
    if (feedback.length) request = { ...request, context: { ...request.context, feedback } }
    skipped.clear()
    following = request.id
    threads.set(request.id, { request, events: [], diffs: [], status: 'working' })
    open(request.id)
    Promise.resolve(host.ask(request)).catch((error) => handleEvent({ type: 'error', message: String(error) }, request.id))
    return request
  }
  const currentAgent = () => picker.value || getAgents()[0]?.id || ''
  function askSelection(shapeIds = [...editor.selection], text = prompt.value) {
    const selected = shapeIds.map((id) => store.get(id)).filter(Boolean)
    const first = selected[0]
    const v = editor.viewportPageBounds()
    const anchor = first ? { shapeId: first.id, x: first.x, y: first.y } : { x: v.x + v.w / 2, y: v.y + v.h / 2 }
    return sendRequest(buildAgentRequest({
      id: crypto.randomUUID(), to: currentAgent(), text, editor, options: optionsFor(currentAgent()),
      shapeIds: selected.map((s) => s.id), frameIds: selected.filter((s) => s.isFrame).map((s) => s.id), anchor,
    }))
  }
  function askText(text, anchor = {}) {
    return sendRequest(buildAgentRequest({ id: crypto.randomUUID(), to: currentAgent(), text, editor, anchor, options: optionsFor(currentAgent()) }))
  }
  function openForSelection(shapeIds) {
    pendingShapeIds = [...shapeIds]
    view = null
    show()
    prompt.focus()
  }

  const onEdit = () => {
    if (editor.editing) { editingNoteId = editor.editing.id; return }
    const id = editingNoteId
    editingNoteId = null
    const shape = id && store.get(id)
    if (!shape || shape.type !== 'note' || hasAgentThreadForAnchor(id, threads.values())) return
    const mention = detectAgentMention(shape.props.text, getAgents().filter((a) => !host.cannotAsk?.(a)))
    if (!mention) return
    sendRequest(buildAgentRequest({
      id: crypto.randomUUID(), to: mention.to, text: mention.text, editor, options: optionsFor(mention.to),
      shapeIds: [id], anchor: { shapeId: id, x: shape.x, y: shape.y },
    }))
  }

  const offHost = host.onEvent((event) => handleEvent(event))
  const offs = ['camera', 'change'].map((name) => editor.on(name, renderPins))
  offs.push(editor.on('change', () => { if (!panel.hidden) renderFoot() })) // feedback comes and goes with the board
  offs.push(editor.on('camera', () => { if (Date.now() > panning) following = null })) // the person took the view
  offs.push(editor.on('edit', onEdit))
  offs.push(editor.on('selection', () => {
    if (panel.hidden) return
    pendingShapeIds = editor.selection.size ? [...editor.selection] : null
    renderFoot()
  }))
  back.addEventListener('click', () => { view = null; render() })
  close.addEventListener('click', hide)
  picker.addEventListener('change', renderFoot)
  modelPick.addEventListener('change', () => choose(currentAgent(), { model: modelPick.value }))
  effortPick.addEventListener('change', () => choose(currentAgent(), { effort: effortPick.value }))
  chipClear.addEventListener('click', () => { pendingShapeIds = null; renderFoot() })
  prompt.addEventListener('input', () => {
    prompt.style.height = 'auto'
    prompt.style.height = `${prompt.scrollHeight}px`
    renderFoot()
  })
  prompt.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) { e.preventDefault(); foot.requestSubmit() }
  })
  foot.addEventListener('submit', (event) => {
    event.preventDefault()
    const text = prompt.value.trim()
    if (!text || send.disabled) return
    prompt.value = ''
    prompt.style.height = 'auto'
    if (view && threads.has(view)) host.reply(view, text)
    else {
      askSelection(pendingShapeIds ?? [], text)
      pendingShapeIds = null
    }
    renderFoot()
  })
  renderPins()

  return {
    askSelection,
    openForSelection,
    askText,
    show,
    hide,
    toggle() { if (panel.hidden) show(); else hide() },
    open,
    get threads() { return [...threads.values()] },
    destroy() {
      if (typeof offHost === 'function') offHost()
      offs.forEach((off) => off())
      panel.remove()
      pinLayer.remove()
    },
  }
}
