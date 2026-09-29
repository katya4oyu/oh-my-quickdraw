// The session process (see ./client.ts): it holds a board as an agent — in the
// AI panel, with a cursor — for an agent that has only a shell, and runs that
// agent's commands on it. A third runtime of BoardAgent (../agent/board-agent.ts),
// beside Codex and pi, whose "model" is the agent on the other end of the
// commands: what reaches it (requests, people's replies, Stop, tickets) waits in
// an inbox until `quickdraw next` takes it.
import { createServer, type Server, type Socket } from 'node:net'
import { mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { basename, join } from 'node:path'
import { pageBounds, type BoardRecord, type Diff, type Store } from '@quickdrawjs/core'
import { describeBoard, textOf, type AgentRequest } from 'quickdraw-agent'
import { openBoard, type Board } from '../board/open.ts'
import { joinBoard, type BoardAgent } from '../agent/board-agent.ts'
import { linkPreview, serverOfBoard } from '../board/link-preview.ts'
import { parseCommand, runCommand } from '../commands/index.ts'
import { sessionFile, socketPath, type SessionInfo } from './client.ts'

const { describeTicket, listTickets } = await import('quickdraw-tickets')
const { isFrame, frameTitle } = await import('quickdraw-frames')

export interface SessionOptions {
  /** the board's relay URL */
  url: string
  name: string
  /** the agent's working directory: its files, and where the session is found */
  cwd: string
  /** minutes without a command before it leaves the board (default 30) */
  idle?: number
  /** takes requests from anyone on the board, not only this computer */
  remote?: boolean
}

type Item =
  | { type: 'request', request: AgentRequest }
  | { type: 'reply', requestId: string, text: string }
  | { type: 'stop', requestId: string }
  | { type: 'ticket', id: string }

const READING = new Set(['read', 'lint', 'export', 'log', 'tickets'])
const STREAMING = new Set(['next', 'wait', 'watch'])
const clip = (s: string, n = 80) => (s.length > n ? s.slice(0, n - 1) + '…' : s)
const isShape = (r: BoardRecord) => r.typeName === 'shape' && !(r as { isFrameTitle?: boolean }).isFrameTitle

export async function startSession({ url, name, cwd, idle = 30, remote = false }: SessionOptions) {
  const board = await openBoard({ url, name })
  const id = 'cli-' + (name + '-' + basename(cwd)).toLowerCase().replace(/[^a-z0-9-]+/g, '-')
  const agent = await joinBoard(board, { id, name, knows: [basename(cwd)], remote }, {
    imageRoots: [cwd], preview: (link) => linkPreview(serverOfBoard(url), link),
  })
  const store = board.store
  agent.status('idle')

  // ---- the inbox ----
  const inbox: Item[] = []
  const wake = new Set<() => void>()
  const requests = new Map<string, AgentRequest>()
  const open = new Set<string>() // requests taken and not finished
  let current: string | null = null // the one its commands work on
  let waiting = 0 // `next`s waiting now
  // working while it has a request it took and did not finish, or a ticket it took and did not close
  const holding = () => open.size > 0 || listTickets(store, { status: 'doing' }).some((t: { props: { by?: string } }) => t.props.by === name)
  const settle = (justDone = false) => {
    if (holding()) { agent.status('working'); agent.activity('thinking') } // between its commands, it is at work
    else { agent.status('idle'); agent.activity(justDone ? 'done' : null) }
  }
  const push = (item: Item) => { inbox.push(item); for (const fn of [...wake]) fn() }
  agent.onRequest = (request) => {
    requests.set(request.id, request)
    push({ type: 'request', request })
    if (!waiting) agent.emit(request.id, { type: 'progress', text: `Waiting for ${name} to pick it up` })
  }
  agent.onReply = (requestId, text) => push({ type: 'reply', requestId, text })
  agent.onStop = (requestId) => push({ type: 'stop', requestId })
  // tickets for it (or any agent) still to do: each once for whom it is for, so one
  // given to it later is news again; not one it left for any agent itself
  const told = new Set<string>()
  const tickets = () => {
    for (const t of listTickets(store, { status: 'todo', for: name })) {
      const p = (t as unknown as { props: { to?: string | null, from?: string | null } }).props
      if (!p.to && p.from === name) continue
      const key = `${t.id}:${p.to ?? ''}`
      if (!told.has(key)) { told.add(key); push({ type: 'ticket', id: t.id }) }
    }
  }
  tickets()
  const offTickets = store.listen(tickets)

  // ---- what changed since it last looked ----
  const summary = (s: BoardRecord) => JSON.stringify([(s as { type?: string }).type, Math.round((s as { x: number }).x), Math.round((s as { y: number }).y), textOf(store as never, s as never), (s as { frameId?: string }).frameId ?? null])
  const seen = new Map<string, string>()
  const look = () => { seen.clear(); for (const s of store.shapes()) if (isShape(s as BoardRecord)) seen.set(s.id, summary(s as BoardRecord)) }
  look()
  const said = (s: BoardRecord) => ({ id: s.id, type: isFrame(s) ? 'frame' : (s as { type?: string }).type, text: clip(String(textOf(store as never, s as never) ?? '').replace(/\s+/g, ' ')) })
  function changes() {
    const added: object[] = [], changed: object[] = [], removed: string[] = []
    const now = new Map<string, string>()
    for (const s of store.shapes()) if (isShape(s as BoardRecord)) now.set(s.id, summary(s as BoardRecord))
    for (const [id, v] of now) {
      const s = store.get(id) as BoardRecord & { agent?: { name: string } }
      if (!seen.has(id)) added.push({ ...said(s), by: s.agent?.name ?? 'people' })
      else if (seen.get(id) !== v) changed.push(said(s))
    }
    for (const id of seen.keys()) if (!now.has(id)) removed.push(id)
    look()
    const cut = <T>(list: T[]) => (list.length > 30 ? [...list.slice(0, 30), `…and ${list.length - 30} more`] : list)
    return { added: cut(added), changed: cut(changed), removed: cut(removed) }
  }
  // its own work is not news
  const saw = (diff: Diff) => {
    for (const id of [...Object.keys(diff.added), ...Object.keys(diff.updated)]) { const s = store.get(id) as BoardRecord | undefined; if (s && isShape(s)) seen.set(id, summary(s)) }
    for (const id of Object.keys(diff.removed)) seen.delete(id)
  }

  // ---- who is here ----
  function who() {
    const peers = [...board.relay!.peers().values()].map((p) => {
      const v = p.view
      const centre = v && { x: v.x + v.w / 2, y: v.y + v.h / 2 }
      const inView = v ? store.shapes().filter((f) => isFrame(f) && (() => { const b = pageBounds(f as never); return b.x < v.x + v.w && b.x + b.w > v.x && b.y < v.y + v.h && b.y + b.h > v.y })()) : []
      return {
        name: p.name ?? '?', agent: !!p.agent,
        ...(p.agent ? { status: p.agentStatus ?? 'idle', ...(p.agentActivity ? { doing: p.agentActivity + (p.agentNote ? ': ' + p.agentNote : '') } : {}) } : p.status ? { status: p.status } : {}),
        ...(p.x != null && p.y != null ? { cursor: { x: Math.round(p.x), y: Math.round(p.y) } } : {}),
        ...(centre ? { looking_at: { x: Math.round(centre.x), y: Math.round(centre.y), frames: inView.slice(0, 5).map((f) => ({ id: f.id, title: frameTitle(store as never, f.id) })) } } : {}),
      }
    })
    return { you: name, here: peers }
  }

  // ---- a request, as `next` gives it ----
  async function describeRequest(r: AgentRequest) {
    const d = describeBoard(store as never)
    const byId = new Map<string, object>([...d.items.map((it) => [it.id, it] as const), ...d.frames.map((f) => [f.id, { ...f, type: 'frame' }] as const)])
    const fb = r.context.feedback?.length ? await agent.feedback(r.context.feedback) : null
    return {
      type: 'request', id: r.id, text: r.text, ...(r.from ? { from: r.from } : {}),
      ...(r.context.shapeIds.length ? { about: r.context.shapeIds.map((sid) => byId.get(sid) ?? { id: sid, gone: true }) } : {}),
      ...(r.context.area ? { area: r.context.area } : {}),
      viewport: r.context.viewport,
      ...(fb?.text ? { feedback: { text: fb.text, images: fb.images } } : {}),
      changes: changes(),
    }
  }

  // ---- while it waits: where it stays ----
  // People see an agent that waits, and where: by the people on the board (the
  // biggest group of their cursors and views), else where it last worked. It
  // drifts a little there, "ready for a request".
  let lastSpot: { x: number, y: number } | null = null
  function crowd(): { x: number, y: number } | null {
    const at = [...board.relay!.peers().values()].filter((p) => !p.agent).flatMap((p) =>
      p.x != null && p.y != null ? [{ x: p.x, y: p.y }] : p.view ? [{ x: p.view.x + p.view.w / 2, y: p.view.y + p.view.h / 2 }] : [])
    if (!at.length) return null
    const near = (a: { x: number, y: number }) => at.filter((b) => Math.hypot(a.x - b.x, a.y - b.y) < 700)
    const group = at.map(near).reduce((a, b) => (b.length > a.length ? b : a))
    return { x: group.reduce((s, p) => s + p.x, 0) / group.length, y: group.reduce((s, p) => s + p.y, 0) / group.length }
  }
  let drift = 0
  function stay(): boolean {
    const to = crowd() ?? lastSpot
    if (!to) return false
    drift++
    // beside them, not on top of anyone; a little further each time, then back
    const r = 30 + 15 * Math.sin(drift / 2)
    agent.point(Math.round(to.x + 90 + r * Math.cos(drift)), Math.round(to.y + 60 + r * Math.sin(drift)))
    return true
  }

  async function next(timeout: number | undefined, closed: () => boolean) {
    const until = timeout != null ? Date.now() + timeout * 1000 : Infinity
    let stayed = 0
    while (!inbox.length) {
      if (closed()) return { type: null, stopped: true }
      const left = until - Date.now()
      if (left <= 0) return { type: null, timeout: true }
      waiting++
      if (!holding()) {
        agent.status('idle')
        agent.activity('available')
        if (Date.now() - stayed > 2500 && stay()) stayed = Date.now() // until it has somewhere to be, it looks every second
      }
      await new Promise<void>((resolve) => {
        const t = setTimeout(done, Math.min(left, 1000)) // looks at `closed` now and then
        function done() { clearTimeout(t); wake.delete(done); resolve() }
        wake.add(done)
      })
      waiting--
    }
    const item = inbox.shift()!
    if (item.type === 'request') {
      current = item.request.id
      open.add(current)
      agent.lookAt(item.request)
      lastSpot = item.request.anchor?.x != null ? { x: item.request.anchor.x, y: item.request.anchor.y! } : lastSpot
      agent.status('working')
      agent.activity('thinking')
      agent.emit(current, { type: 'progress', text: `${name} is on it` })
      return describeRequest(item.request)
    }
    if (item.type === 'reply') return { type: 'reply', request: item.requestId, text: item.text }
    if (item.type === 'stop') return { type: 'stop', request: item.requestId, text: 'A person pressed Stop: stop working on it, then quickdraw finish it.' }
    const t = store.get(item.id)
    if (!t || (t as { props?: { status?: string } }).props?.status !== 'todo') return next(timeout == null ? undefined : Math.max(0, (until - Date.now()) / 1000), closed) // taken or gone since
    return { type: 'ticket', ticket: describeTicket(t) }
  }

  function finish(requestId: string, text?: string) {
    agent.emit(requestId, { type: 'done', ...(text ? { text } : {}) })
    open.delete(requestId)
    if (current === requestId) current = [...open].at(-1) ?? null
    settle(true)
  }

  // ---- commands ----
  const pending = () => {
    if (!inbox.length) return null
    const kinds: Record<string, number> = {}
    for (const i of inbox) kinds[i.type] = (kinds[i.type] ?? 0) + 1
    return { ...kinds, note: 'waiting for you: quickdraw next' }
  }
  const which = (o: { request?: string }, arg?: string) => {
    const id = o.request ?? (arg && requests.has(arg) ? arg : null) ?? current
    if (!id) throw new Error('no request: quickdraw next takes one (or give --request ID)')
    if (!requests.has(id)) throw new Error(`no request ${id} here`)
    return id
  }

  async function run(argv: string[], stdin: string | undefined, out: (s: string) => void, signal: AbortSignal) {
    const { o, cmd, args } = parseCommand(argv)
    switch (cmd) {
      case 'next': case 'wait': { // wait: what is for it — requests (the panel, @mentions), replies, Stop, tickets
        const item = await next(o.timeout ? Number(o.timeout) : undefined, () => signal.aborted) as { type: string | null, ticket?: { id: string } }
        if (!(o.take && item.type === 'ticket')) return out(JSON.stringify(item))
        const took: string[] = [] // --take: a ticket is taken too
        await run(['take', item.ticket!.id], undefined, (l) => took.push(l), signal)
        return out(took.at(-1)!)
      }
      case 'say': {
        const id = which(o, args[0])
        const text = (args[0] === id ? args.slice(1) : args).join(' ')
        if (!text) throw new Error('say needs a text')
        agent.emit(id, { type: o.progress ? 'progress' : 'message', text })
        return out(JSON.stringify({ said: id }))
      }
      case 'finish': {
        const id = which(o, args[0])
        finish(id, o.text ?? ((args[0] === id ? args.slice(1) : args).join(' ') || undefined))
        return out(JSON.stringify({ finished: id }))
      }
      case 'area': {
        const id = which(o)
        const [w, h] = args.map(Number)
        const at = o.at?.split(',').map(Number)
        return out(await agent.runTool(id, 'claim_area', { w, h, ...(o.title ? { title: o.title } : {}), ...(at ? { x: at[0], y: at[1] } : {}) }))
      }
      case 'who': return out(JSON.stringify(who(), null, 2))
      case 'changes': return out(JSON.stringify(changes(), null, 2))
      case 'leave': void close(); return out(JSON.stringify({ left: true })) // gone from here at once; off the board a moment later
    }
    // a board command, as this agent, on its board
    const request = o.request ?? current
    const writes = !READING.has(cmd) && !STREAMING.has(cmd)
    const people = writes && request ? agent.peopleSince(request).trim() : ''
    agent.activity(writes ? 'drawing' : 'reading')
    try {
      await runCommand({
        board, url, boardKey: url, session: true,
        operate: async (make) => { const done = await agent.operate(request, make); saw(done.diff); if (done.focus) lastSpot = done.focus; return done },
        stdin: async () => stdin ?? '',
      }, [...argv, '--name', name], out, { signal })
    } finally { settle(cmd === 'done' || cmd === 'fail') }
    if (people) out(JSON.stringify({ people }))
  }

  // ---- the socket ----
  const socket = socketPath(cwd)
  rmSync(socket, { force: true }) // left by a session that did not end well
  let busy = 0
  let idleTimer: ReturnType<typeof setTimeout> | undefined
  const idleFrom = () => { clearTimeout(idleTimer); if (!busy) idleTimer = setTimeout(() => void close(), idle * 60_000) }
  const server: Server = createServer((sock: Socket) => {
    let buf = ''
    const stop = new AbortController()
    sock.on('close', () => stop.abort())
    sock.on('error', () => stop.abort())
    sock.on('data', async (d) => {
      buf += d
      const i = buf.indexOf('\n')
      if (i < 0) return
      const line = buf.slice(0, i)
      buf = ''
      busy++
      clearTimeout(idleTimer)
      const send = (m: object) => { if (!sock.destroyed) sock.write(JSON.stringify(m) + '\n') }
      try {
        const { argv, stdin } = JSON.parse(line) as { argv: string[], stdin?: string }
        const { cmd } = parseCommand(argv)
        if (STREAMING.has(cmd)) await run(argv, stdin, (s) => send({ out: s }), stop.signal)
        else {
          // the last line (the result) says what waits in the inbox
          const lines: string[] = []
          await run(argv, stdin, (s) => lines.push(s), stop.signal)
          const box = pending()
          const merged = mergeTail(lines)
          if (box && merged.length) {
            try { const last = JSON.parse(merged.at(-1)!); if (last && typeof last === 'object' && !Array.isArray(last)) merged[merged.length - 1] = JSON.stringify({ ...last, inbox: box }) } catch { merged.push(JSON.stringify({ inbox: box })) }
          }
          for (const s of merged) send({ out: s })
        }
        send({ end: true })
      } catch (e) {
        send({ error: (e as Error).message })
      } finally {
        busy--
        idleFrom()
        sock.end()
      }
    })
  })
  await new Promise<void>((resolve, reject) => { server.once('error', reject); server.listen(socket, () => resolve()) })

  const info: SessionInfo = { url, name, socket, pid: process.pid, cwd }
  mkdirSync(join(cwd, '.quickdraw'), { recursive: true })
  writeFileSync(sessionFile(cwd), JSON.stringify(info, null, 2) + '\n')
  idleFrom()

  let ended: () => void
  const closed = new Promise<void>((r) => { ended = r })
  let closing = false
  async function close() {
    if (closing) return closed
    closing = true
    clearTimeout(idleTimer)
    offTickets()
    for (const fn of [...wake]) fn()
    server.close()
    rmSync(socket, { force: true })
    rmSync(sessionFile(cwd), { force: true })
    await agent.close().catch(() => {})
    ended!()
    return closed
  }
  board.relay!.onClose(() => void close())
  return { info, closed, close, agent: agent as BoardAgent, board: board as Board, store: store as Store }
}

// a result and the `people` line after it become one object
function mergeTail(lines: string[]): string[] {
  if (lines.length < 2) return lines
  try {
    const tail = JSON.parse(lines.at(-1)!)
    const prev = JSON.parse(lines.at(-2)!)
    if (tail && typeof tail.people === 'string' && Object.keys(tail).length === 1 && prev && typeof prev === 'object' && !Array.isArray(prev)) {
      return [...lines.slice(0, -2), JSON.stringify({ ...prev, people: tail.people })]
    }
  } catch {}
  return lines
}
