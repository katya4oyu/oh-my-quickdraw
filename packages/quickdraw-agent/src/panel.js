import { undoDiff } from './ops.js'

const svg = (body) => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${body}</svg>`
const askIcon = svg('<path d="M4 5h16v11H8l-4 4z"/><path d="M8 9h8M8 12h5"/>')
const el = (tag, cls, text) => {
  const node = document.createElement(tag)
  if (cls) node.className = cls
  if (text != null) node.textContent = text
  return node
}

/** Build the common request shape from a panel, selection, or committed note. */
export function buildAgentRequest({ id, to, text, editor, shapeIds = [], frameId, anchor = {} }) {
  return {
    id, to, text: String(text).trim(),
    context: { shapeIds: [...shapeIds], ...(frameId ? { frameId } : {}), viewport: { ...editor.viewportPageBounds() } },
    anchor: { ...anchor },
  }
}

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

/** Track one thread's visible event history and per-request operation diffs. */
export function updateAgentThread(thread, event) {
  const next = { ...thread, events: [...(thread.events || []), event], diffs: [...(thread.diffs || [])] }
  if (event.type === 'op' && event.diff) next.diffs.push(event.diff)
  if (event.type === 'done' || event.type === 'error') next.status = event.type
  else if (event.type === 'approval') next.status = 'waiting'
  else if (['progress', 'message', 'question', 'op'].includes(event.type)) next.status = 'working'
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

/** A quickdraw-toolbar selection item. */
export function agentAskTool(panel) {
  return {
    id: 'agent-ask', title: 'Ask AI', icon: askIcon,
    when: () => true,
    run: ({ shape }) => panel.openForSelection([shape.id]),
  }
}

const STYLE = `
.qd-agent-panel,.qd-agent-toggle,.qd-agent-pin{font:13px system-ui}
.qd-agent-panel{position:absolute;z-index:80;right:12px;top:12px;width:min(340px,calc(100% - 24px));max-height:calc(100% - 24px);display:flex;flex-direction:column;background:var(--qd-paper,#fff);color:var(--qd-ink,#222);border:1px solid #8885;border-radius:12px;box-shadow:0 5px 24px #0002}
.qd-agent-head,.qd-agent-thread-head{display:flex;align-items:center;justify-content:space-between;gap:8px;padding:10px 12px;border-bottom:1px solid #8883}
.qd-agent-head strong{font-size:14px}.qd-agent-body{overflow:auto;padding:10px 12px}
.qd-agent-panel button,.qd-agent-panel select,.qd-agent-panel textarea{font:inherit}
.qd-agent-panel button,.qd-agent-toggle{border:1px solid #8885;border-radius:7px;background:var(--qd-paper,#fff);color:inherit;padding:5px 8px;cursor:pointer}
.qd-agent-panel button:hover{background:#8882}.qd-agent-participants,.qd-agent-threads{display:grid;gap:5px;margin:0 0 12px}
.qd-agent-participant,.qd-agent-thread{display:flex;justify-content:space-between;gap:8px;align-items:center}
.qd-agent-muted{opacity:.65;font-size:11px}.qd-agent-form{display:grid;gap:7px}
.qd-agent-form textarea{resize:vertical;min-height:55px;padding:7px;border:1px solid #8886;border-radius:7px;background:transparent;color:inherit}
.qd-agent-thread-view{border-top:1px solid #8883;margin-top:10px;padding-top:8px}.qd-agent-event{margin:5px 0;white-space:pre-wrap;overflow-wrap:anywhere}
.qd-agent-approval{display:flex;gap:6px}.qd-agent-pin{position:absolute;z-index:75;border:0;border-radius:999px;padding:5px 9px;background:#4b65d1;color:white;box-shadow:0 2px 8px #0004;cursor:pointer;white-space:nowrap}
.qd-agent-pin[data-status="waiting"]{background:#c77b00}.qd-agent-pin[data-status="error"]{background:#b33}.qd-agent-hidden{display:none!important}
.qd-agent-toggle{position:absolute;z-index:80;right:12px;top:12px}
`
function injectStyle() {
  if (document.getElementById('qd-agent-style')) return
  const style = el('style')
  style.id = 'qd-agent-style'
  style.textContent = STYLE
  document.head.append(style)
}
const statusText = (status) => ({ idle: '待機中', working: '作業中', waiting: '承認待ち', done: '完了', error: 'エラー' })[status] || status || '待機中'

/** Add the host-driven agent panel, thread list and canvas pins to an editor. */
export function createAgentPanel({ editor, store = editor.store, container = editor.container, host }) {
  if (!host || typeof host.agents !== 'function' || typeof host.ask !== 'function' || typeof host.reply !== 'function' || typeof host.threads !== 'function' || typeof host.onEvent !== 'function') {
    throw new TypeError('createAgentPanel requires host agents, ask, reply, threads and onEvent functions')
  }
  injectStyle()
  const threads = new Map((host.threads() || []).map((thread) => [thread.request.id, { ...thread, events: [...(thread.events || [])], diffs: [...(thread.diffs || [])] }]))
  const pins = new Map()
  const requestedNotes = new Set()
  let selectedThread = null
  let pendingShapeIds = null

  const panel = el('section', 'qd-agent-panel')
  panel.setAttribute('aria-label', 'AI agents')
  const header = el('header', 'qd-agent-head')
  const close = el('button', '', '×')
  close.setAttribute('aria-label', 'Close AI panel')
  header.append(el('strong', '', 'AI participants'), close)
  const body = el('div', 'qd-agent-body')
  const participants = el('div', 'qd-agent-participants')
  const threadList = el('div', 'qd-agent-threads')
  const composer = el('form', 'qd-agent-form')
  const selector = el('select')
  selector.setAttribute('aria-label', 'Agent')
  const prompt = el('textarea')
  prompt.placeholder = 'Ask about this board…'
  prompt.setAttribute('aria-label', 'Request')
  const submit = el('button', '', 'Ask')
  submit.type = 'submit'
  composer.append(selector, prompt, submit)
  const active = el('section', 'qd-agent-thread-view qd-agent-hidden')
  body.append(participants, el('strong', '', 'Threads'), threadList, composer, active)
  panel.append(header, body)
  const toggle = el('button', 'qd-agent-toggle', 'AI')
  toggle.type = 'button'
  toggle.setAttribute('aria-label', 'Open AI panel')
  container.append(toggle, panel)

  const getAgents = () => host.agents() || []
  function show() {
    panel.classList.remove('qd-agent-hidden')
    toggle.classList.add('qd-agent-hidden')
  }
  function renderParticipants() {
    participants.replaceChildren()
    selector.replaceChildren()
    for (const agent of getAgents()) {
      const row = el('div', 'qd-agent-participant')
      row.append(
        el('span', '', agent.name),
        el('span', 'qd-agent-muted', (agent.knows || []).join(', ')),
        el('span', 'qd-agent-muted', statusText(agent.status)),
      )
      participants.append(row)
      const option = el('option', '', agent.name)
      option.value = agent.id
      selector.append(option)
    }
  }
  function renderPins() {
    for (const [id, thread] of threads) {
      let pin = pins.get(id)
      if (!pin) {
        pin = el('button', 'qd-agent-pin')
        pin.type = 'button'
        pin.addEventListener('click', () => { selectedThread = id; show(); renderThread() })
        container.append(pin)
        pins.set(id, pin)
      }
      const anchor = thread.request.anchor || {}
      const shape = anchor.shapeId ? store.get(anchor.shapeId) : null
      const point = shape
        ? editor.pageToScreen(shape.x + (shape.props?.w || 0) / 2, shape.y + (shape.props?.h || 0) / 2)
        : editor.pageToScreen(anchor.x || 0, anchor.y || 0)
      pin.style.left = `${point.x}px`
      pin.style.top = `${point.y}px`
      pin.textContent = thread.request.text.slice(0, 32) || 'AI thread'
      pin.dataset.status = thread.status
      pin.title = `${thread.request.text} — ${statusText(thread.status)}`
    }
  }
  function renderThread() {
    const thread = threads.get(selectedThread)
    active.replaceChildren()
    active.classList.toggle('qd-agent-hidden', !thread)
    if (!thread) return
    const title = el('div', 'qd-agent-thread-head')
    const dismiss = el('button', '', '×')
    dismiss.addEventListener('click', () => { selectedThread = null; renderThread() })
    title.append(el('strong', '', thread.request.text), dismiss)
    active.append(title)
    for (const event of thread.events || []) {
      const line = el('div', 'qd-agent-event')
      line.textContent = `${event.type}: ${event.text || event.message || (event.type === 'op' ? `Board operation: ${event.op}` : '')}`
      active.append(line)
      if (event.type === 'approval' && event.id) {
        const actions = el('div', 'qd-agent-approval')
        for (const [allow, label] of [[true, 'Allow'], [false, 'Deny']]) {
          const button = el('button', '', label)
          button.addEventListener('click', () => host.reply(thread.request.id, { approval: event.id, allow }))
          actions.append(button)
        }
        active.append(actions)
      }
    }
    const undo = el('button', '', 'Undo this request')
    undo.disabled = !thread.diffs.length
    undo.addEventListener('click', () => {
      thread.undoResult = undoAgentRequest(store, thread.diffs)
      thread.diffs = []
      renderThreads()
    })
    active.append(undo)
    if (thread.undoResult) {
      const result = thread.undoResult
      active.append(el('div', 'qd-agent-event', `Undid ${result.reverted} change${result.reverted === 1 ? '' : 's'}${result.skipped.length ? `; these changed and were not undone: ${result.skipped.join(', ')}.` : '.'}`))
    }
    const followup = el('form', 'qd-agent-form')
    const message = el('textarea')
    message.placeholder = 'Follow up…'
    const send = el('button', '', 'Reply')
    send.type = 'submit'
    followup.append(message, send)
    followup.addEventListener('submit', (event) => {
      event.preventDefault()
      if (!message.value.trim()) return
      host.reply(thread.request.id, message.value.trim())
      message.value = ''
    })
    active.append(followup)
  }
  function renderThreads() {
    threadList.replaceChildren()
    for (const thread of [...threads.values()].reverse()) {
      const button = el('button', 'qd-agent-thread')
      button.type = 'button'
      button.append(el('span', '', thread.request.text), el('span', 'qd-agent-muted', statusText(thread.status)))
      button.addEventListener('click', () => { selectedThread = thread.request.id; renderThread() })
      threadList.append(button)
    }
    renderThread()
    renderPins()
  }
  function handleEvent(envelope, requestId) {
    if (envelope.type === 'agents') { renderParticipants(); return }
    const event = envelope.type === 'event' && envelope.event ? envelope.event : envelope
    const id = event.requestId || requestId
    const thread = threads.get(id)
    if (!thread) return
    threads.set(id, updateAgentThread(thread, event))
    renderParticipants()
    renderThreads()
  }
  function sendRequest(request) {
    threads.set(request.id, { request, events: [], diffs: [], status: 'working' })
    selectedThread = request.id
    renderThreads()
    Promise.resolve(host.ask(request)).catch((error) => handleEvent({ type: 'error', message: String(error) }, request.id))
    return request
  }
  function askSelection(shapeIds = [...editor.selection]) {
    const selected = shapeIds.map((id) => store.get(id)).filter(Boolean)
    const first = selected[0]
    const fallback = editor.viewportPageBounds()
    const anchor = first ? { shapeId: first.id, x: first.x, y: first.y } : { x: fallback.x + fallback.w / 2, y: fallback.y + fallback.h / 2 }
    return sendRequest(buildAgentRequest({
      id: crypto.randomUUID(), to: selector.value || getAgents()[0]?.id || '', text: prompt.value, editor,
      shapeIds, frameId: selected.find((shape) => shape.isFrame)?.id, anchor,
    }))
  }
  function openForSelection(shapeIds) {
    pendingShapeIds = [...shapeIds]
    show()
    prompt.focus()
  }
  function askText(text, anchor = {}) {
    return sendRequest(buildAgentRequest({ id: crypto.randomUUID(), to: selector.value || getAgents()[0]?.id || '', text, editor, anchor }))
  }
  const onEdit = () => {
    if (editor.editing) return
    const id = [...editor.selection][0]
    const shape = id && store.get(id)
    if (!shape || shape.type !== 'note' || requestedNotes.has(id)) return
    const mention = detectAgentMention(shape.props.text, getAgents())
    if (!mention) return
    requestedNotes.add(id)
    sendRequest(buildAgentRequest({
      id: crypto.randomUUID(), to: mention.to, text: mention.text, editor,
      shapeIds: [id], anchor: { shapeId: id, x: shape.x, y: shape.y },
    }))
  }
  const onHostEvent = (event) => handleEvent(event)
  const offHost = host.onEvent(onHostEvent)
  const offs = ['camera', 'change'].map((name) => editor.on(name, renderPins))
  offs.push(editor.on('edit', onEdit))
  composer.addEventListener('submit', (event) => {
    event.preventDefault()
    if (!prompt.value.trim()) return
    askSelection(pendingShapeIds ?? [...editor.selection])
    pendingShapeIds = null
    prompt.value = ''
  })
  close.addEventListener('click', () => { panel.classList.add('qd-agent-hidden'); toggle.classList.remove('qd-agent-hidden') })
  toggle.addEventListener('click', show)
  renderParticipants()
  renderThreads()
  return {
    askSelection,
    openForSelection,
    askText,
    show,
    get threads() { return [...threads.values()] },
    destroy() {
      if (typeof offHost === 'function') offHost()
      offs.forEach((off) => off())
      panel.remove()
      toggle.remove()
      for (const pin of pins.values()) pin.remove()
      pins.clear()
    },
  }
}
