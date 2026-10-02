// The session process (see ./client.ts): it holds a board as an agent — in the
// AI panel, with a cursor — for an agent that has only a shell, and runs that
// agent's commands on it. A second runtime of BoardAgent (../agent/board-agent.ts),
// beside Codex, whose "model" is the agent on the other end of the
// commands: what reaches it (requests, people's replies, Stop, tickets) waits in
// an inbox until `quickdraw next` takes it.
import { createServer, type Server, type Socket } from 'node:net'
import { mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { basename, join } from 'node:path'
import { pageBounds, type BoardRecord, type Diff, type Store } from '@quickdrawjs/core'
import { describeBoard, textOf, type AgentRequest } from 'quickdraw-agent'
import { openBoard, type Board } from '../board/open.ts'
import { teamOf } from '../board/team.ts'
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
  /** its role on the board (quickdraw-members) */
  role?: string
  /** its pet: a Codex pet's folder or sprite sheet */
  avatar?: string
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

// one board the session is on: the agent there, and what it keeps of it
interface Joined {
  /** its relay URL; its id, as the server knows it; its title */
  url: string
  id: string
  title: string
  board: Board
  agent: BoardAgent
  store: Store
  requests: Map<string, AgentRequest>
  /** requests taken and not finished */
  open: Set<string>
  lastSpot: { x: number, y: number } | null
  drift: number
  holding(): boolean
  settle(justDone?: boolean): void
  changes(): object
  didText(diff: Diff): string
  saw(diff: Diff): void
  who(): object
  describeRequest(r: AgentRequest): Promise<object>
  crowd(): { x: number, y: number } | null
  stay(): boolean
  off(): void
}
type Queued = Item & { at: Joined }

const boardIdOf = (url: string) => url.match(/\/ws\/([^/?#]+)/)?.[1] ?? url

export async function startSession({ url, name, cwd, idle = 30, remote = false, role, avatar }: SessionOptions) {
  const id = 'cli-' + (name + '-' + basename(cwd)).toLowerCase().replace(/[^a-z0-9-]+/g, '-')
  // ---- the inbox, for all its boards: each thing says where it is from ----
  const inbox: Queued[] = []
  const wake = new Set<() => void>()
  let current: { at: Joined, request: string } | null = null // the request its commands work on
  let waiting = 0 // `next`s waiting now
  const push = (item: Queued) => { inbox.push(item); for (const fn of [...wake]) fn() }
  const boards = new Map<string, Joined>() // by relay URL
  const where = (j: Joined) => ({ id: j.id, title: j.title })

  // the other boards it is on, and which of them it works on now: for the people on each
  function tellElsewhere() {
    for (const j of boards.values()) {
      const others = [...boards.values()].filter((o) => o !== j).map((o) => ({ id: o.id, title: o.title, working: o.holding() }))
      j.board.relay?.send({ kind: 'elsewhere', boards: others })
    }
  }

  async function onto(boardUrl: string): Promise<Joined> {
    const board = await openBoard({ url: boardUrl, name })
    const agent = await joinBoard(board, { id, name, knows: [basename(cwd)], remote, role, avatar }, {
      imageRoots: [cwd], preview: (link) => linkPreview(serverOfBoard(boardUrl), link),
    })
    const store = board.store
    const boardId = boardIdOf(boardUrl)
    const title = await fetch(`${serverOfBoard(boardUrl)}/api/boards/${boardId}`).then((r) => (r.ok ? r.json() : null)).then((b) => b?.title ?? boardId).catch(() => boardId)
    const j = { url: boardUrl, id: boardId, title, board, agent, store, requests: new Map(), open: new Set(), lastSpot: null, drift: 0 } as unknown as Joined
    agent.status('idle')

    // working while it has a request it took and did not finish, or a ticket it took and did not close
    j.holding = () => j.open.size > 0 || listTickets(store, { status: 'doing' }).some((t: { props: { by?: string } }) => t.props.by === name)
    j.settle = (justDone = false) => {
      if (j.holding()) { agent.status('working'); agent.activity('thinking') } // between its commands, it is at work
      else { agent.status('idle'); agent.activity(justDone ? 'done' : null) }
      if (boards.size > 1) tellElsewhere()
    }
    agent.onRequest = (request) => {
      j.requests.set(request.id, request)
      push({ type: 'request', request, at: j })
      if (!waiting) agent.emit(request.id, { type: 'progress', text: `Waiting for ${name} to pick it up` })
    }
    agent.onReply = (requestId, text) => push({ type: 'reply', requestId, text, at: j })
    agent.onStop = (requestId) => push({ type: 'stop', requestId, at: j })
    // tickets for it (or any agent) still to do: each once for whom it is for, so one
    // given to it later is news again; not one it left for any agent itself
    const told = new Set<string>()
    const tickets = () => {
      for (const t of listTickets(store, { status: 'todo', for: name })) {
        const p = (t as unknown as { props: { to?: string | null, from?: string | null } }).props
        if (!p.to && p.from === name) continue
        const key = `${t.id}:${p.to ?? ''}`
        if (!told.has(key)) { told.add(key); push({ type: 'ticket', id: t.id, at: j }) }
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
    j.changes = () => {
      const added: object[] = [], changed: object[] = [], removed: string[] = []
      const now = new Map<string, string>()
      for (const s of store.shapes()) if (isShape(s as BoardRecord)) now.set(s.id, summary(s as BoardRecord))
      for (const [sid, v] of now) {
        const s = store.get(sid) as BoardRecord & { agent?: { name: string }, made?: { by: string }, edited?: { by: string } }
        if (!seen.has(sid)) added.push({ ...said(s), by: s.made?.by ?? s.agent?.name ?? 'people' })
        else if (seen.get(sid) !== v) changed.push({ ...said(s), ...(s.edited?.by ? { by: s.edited.by } : {}) })
      }
      for (const sid of seen.keys()) if (!now.has(sid)) removed.push(sid)
      look()
      const cut = <T>(list: T[]) => (list.length > 30 ? [...list.slice(0, 30), `…and ${list.length - 30} more`] : list)
      return { added: cut(added), changed: cut(changed), removed: cut(removed) }
    }
    // what a command did, in a line for the request's thread: people see it work, as with Codex's own words
    j.didText = (diff: Diff) => {
      const kind = (s: BoardRecord) => String(said(s).type ?? 'shape')
      const count = (list: BoardRecord[]) => {
        const n = new Map<string, number>()
        for (const s of list) n.set(kind(s), (n.get(kind(s)) ?? 0) + 1)
        return [...n].map(([k, c]) => `${c} ${k}${c === 1 ? '' : 's'}`).join(', ')
      }
      const added = (Object.values(diff.added) as BoardRecord[]).filter(isShape)
      const changed = Object.keys(diff.updated).map((sid) => store.get(sid) as BoardRecord | undefined).filter((s): s is BoardRecord => !!s && isShape(s))
      const removed = (Object.values(diff.removed) as BoardRecord[]).filter(isShape)
      const one = (s: BoardRecord) => { const t = said(s).text; return `${kind(s)}${t ? ` "${clip(t, 40)}"` : ''}` }
      const parts = [
        added.length ? `added ${added.length === 1 ? one(added[0]) : count(added)}` : '',
        changed.length ? `changed ${changed.length === 1 ? one(changed[0]) : count(changed)}` : '',
        removed.length ? `removed ${count(removed)}` : '',
      ].filter(Boolean)
      const text = parts.join('; ')
      return text && text[0].toUpperCase() + text.slice(1)
    }
    // its own work is not news
    j.saw = (diff: Diff) => {
      for (const sid of [...Object.keys(diff.added), ...Object.keys(diff.updated)]) { const s = store.get(sid) as BoardRecord | undefined; if (s && isShape(s)) seen.set(sid, summary(s)) }
      for (const sid of Object.keys(diff.removed)) seen.delete(sid)
    }

    // ---- who is here ----
    j.who = () => {
      const peers = [...board.relay!.peers().values()].map((p) => {
        const v = p.view
        const centre = v && { x: v.x + v.w / 2, y: v.y + v.h / 2 }
        const inView = v ? store.shapes().filter((f) => isFrame(f) && (() => { const b = pageBounds(f as never); return b.x < v.x + v.w && b.x + b.w > v.x && b.y < v.y + v.h && b.y + b.h > v.y })()) : []
        return {
          name: p.name ?? '?', agent: !!p.agent, ...(p.agent && p.name && board.members?.get(p.name)?.role ? { role: board.members.get(p.name)!.role } : {}),
          ...(p.agent ? { status: p.agentStatus ?? 'idle', ...(p.agentActivity ? { doing: p.agentActivity + (p.agentNote ? ': ' + p.agentNote : '') } : {}) } : p.status ? { status: p.status } : {}),
          ...(p.x != null && p.y != null ? { cursor: { x: Math.round(p.x), y: Math.round(p.y) } } : {}),
          ...(centre ? { looking_at: { x: Math.round(centre.x), y: Math.round(centre.y), frames: inView.slice(0, 5).map((f) => ({ id: f.id, title: frameTitle(store as never, f.id) })) } } : {}),
        }
      })
      const mine = board.members?.get(name)?.role
      return { you: name, board: where(j), ...(mine ? { your_role: mine } : {}), here: peers }
    }

    // ---- a request, as `next` gives it ----
    j.describeRequest = async (r: AgentRequest) => {
      const d = describeBoard(store as never)
      const byId = new Map<string, object>([...d.items.map((it) => [it.id, it] as const), ...d.frames.map((f) => [f.id, { ...f, type: 'frame' }] as const)])
      const fb = r.context.feedback?.length ? await agent.feedback(r.context.feedback) : null
      return {
        type: 'request', id: r.id, board: where(j), text: r.text, ...(r.from ? { from: r.from } : {}),
        ...(r.context.shapeIds.length ? { about: r.context.shapeIds.map((sid) => byId.get(sid) ?? { id: sid, gone: true }) } : {}),
        ...(r.context.area ? { area: r.context.area } : {}),
        viewport: r.context.viewport,
        ...(fb?.text ? { feedback: { text: fb.text, images: fb.images } } : {}),
        changes: j.changes(),
        team: teamOf(board, name), // who does what: roles, and what each works on
      }
    }

    // ---- while it waits: where it stays ----
    // People see an agent that waits, and where: by the people on the board (the
    // biggest group of their cursors and views), else where it last worked. It
    // drifts a little there, "ready for a request".
    j.crowd = () => {
      const at = [...board.relay!.peers().values()].filter((p) => !p.agent).flatMap((p) =>
        p.x != null && p.y != null ? [{ x: p.x, y: p.y }] : p.view ? [{ x: p.view.x + p.view.w / 2, y: p.view.y + p.view.h / 2 }] : [])
      if (!at.length) return null
      const near = (a: { x: number, y: number }) => at.filter((b) => Math.hypot(a.x - b.x, a.y - b.y) < 700)
      const group = at.map(near).reduce((a, b) => (b.length > a.length ? b : a))
      return { x: group.reduce((s, p) => s + p.x, 0) / group.length, y: group.reduce((s, p) => s + p.y, 0) / group.length }
    }
    j.stay = () => {
      const to = j.crowd() ?? j.lastSpot
      if (!to) return false
      j.drift++
      // beside them, not on top of anyone; a little further each time, then back
      const r = 30 + 15 * Math.sin(j.drift / 2)
      agent.point(Math.round(to.x + 90 + r * Math.cos(j.drift)), Math.round(to.y + 60 + r * Math.sin(j.drift)))
      return true
    }
    j.off = offTickets
    // its board gone (the server, the connection): off that board; the last one ends the session
    board.relay!.onClose(() => void leave(j))
    boards.set(boardUrl, j)
    tellElsewhere()
    return j
  }

  // off one board; the session ends with the last
  async function leave(j: Joined) {
    if (!boards.has(j.url)) return
    boards.delete(j.url)
    j.off()
    for (let i = inbox.length - 1; i >= 0; i--) if (inbox[i].at === j) inbox.splice(i, 1)
    if (current?.at === j) current = null
    await j.agent.close().catch(() => {})
    if (!boards.size) return close()
    tellElsewhere()
    writeInfo()
  }

  const first = await onto(url)

  async function next(timeout: number | undefined, closed: () => boolean): Promise<object> {
    const until = timeout != null ? Date.now() + timeout * 1000 : Infinity
    let stayed = 0
    while (!inbox.length) {
      if (closed()) return { type: null, stopped: true }
      const left = until - Date.now()
      if (left <= 0) return { type: null, timeout: true }
      waiting++
      for (const j of boards.values()) {
        if (j.holding()) continue
        j.agent.status('idle')
        j.agent.activity('available')
      }
      if (Date.now() - stayed > 2500 && [...boards.values()].filter((j) => !j.holding()).map((j) => j.stay()).some(Boolean)) stayed = Date.now() // until it has somewhere to be, it looks every second
      await new Promise<void>((resolve) => {
        const t = setTimeout(done, Math.min(left, 1000)) // looks at `closed` now and then
        function done() { clearTimeout(t); wake.delete(done); resolve() }
        wake.add(done)
      })
      waiting--
    }
    const item = inbox.shift()!
    const j = item.at
    if (item.type === 'request') {
      current = { at: j, request: item.request.id }
      j.open.add(item.request.id)
      j.agent.lookAt(item.request)
      j.lastSpot = item.request.anchor?.x != null ? { x: item.request.anchor.x, y: item.request.anchor.y! } : j.lastSpot
      j.agent.status('working')
      j.agent.activity('thinking')
      j.agent.emit(item.request.id, { type: 'progress', text: `${name} is on it` })
      if (boards.size > 1) tellElsewhere()
      return j.describeRequest(item.request)
    }
    if (item.type === 'reply') return { type: 'reply', request: item.requestId, board: where(j), text: item.text }
    if (item.type === 'stop') return { type: 'stop', request: item.requestId, board: where(j), text: 'A person pressed Stop: stop working on it, then quickdraw finish it.' }
    const t = j.store.get(item.id)
    if (!t || (t as { props?: { status?: string } }).props?.status !== 'todo') return next(timeout == null ? undefined : Math.max(0, (until - Date.now()) / 1000), closed) // taken or gone since
    // who wrote it and who changed it last (gave it to this agent, say): the person who started it decides whether to take it
    const marks = t as unknown as { made?: { by?: string }, edited?: { by?: string } }
    return { type: 'ticket', board: where(j), ticket: describeTicket(t), ...(marks.made?.by ? { made_by: marks.made.by } : {}), ...(marks.edited?.by ? { changed_by: marks.edited.by } : {}) }
  }

  function finish(j: Joined, requestId: string, text?: string) {
    j.agent.emit(requestId, { type: 'done', ...(text ? { text } : {}) })
    j.open.delete(requestId)
    if (current?.request === requestId) {
      const left = [...boards.values()].flatMap((b) => [...b.open].map((r) => ({ at: b, request: r })))
      current = left.at(-1) ?? null
    }
    j.settle(true)
  }

  // ---- commands ----
  const pending = () => {
    if (!inbox.length) return null
    const kinds: Record<string, number> = {}
    for (const i of inbox) kinds[i.type] = (kinds[i.type] ?? 0) + 1
    return { ...kinds, note: 'waiting for you: quickdraw next' }
  }
  // the board a request is on
  const ofRequest = (requestId: string) => [...boards.values()].find((j) => j.requests.has(requestId)) ?? null
  const which = (o: { request?: string }, arg?: string) => {
    const rid = o.request ?? (arg && ofRequest(arg) ? arg : null) ?? current?.request
    if (!rid) throw new Error('no request: quickdraw next takes one (or give --request ID)')
    const j = ofRequest(rid)
    if (!j) throw new Error(`no request ${rid} here`)
    return { id: rid, j }
  }
  // the board a command is for: --board (an id, a page URL or a relay URL), else the request it works on, else the only one
  function boardFor(o: { board?: string, request?: string }): Joined {
    if (o.board) {
      const want = o.board
      const j = [...boards.values()].find((b) => b.url === want || b.id === want || want.includes(`/b/${b.id}`) || want.endsWith(`/${b.id}`))
      if (!j) throw new Error(`not on board ${want} (on ${[...boards.values()].map((b) => `${b.title} (${b.id})`).join(', ')}): quickdraw join --board ${want} first`)
      return j
    }
    if (o.request) { const j = ofRequest(o.request); if (j) return j }
    if (current) return current.at
    if (boards.size === 1) return [...boards.values()][0]
    throw new Error(`which board? You are on ${[...boards.values()].map((b) => `${b.title} (${b.id})`).join(', ')}: add --board ID (or take a request: its board is the one)`)
  }

  async function run(argv: string[], stdin: string | undefined, out: (s: string) => void, signal: AbortSignal): Promise<void> {
    const { o, cmd, args } = parseCommand(argv)
    switch (cmd) {
      case 'next': case 'wait': { // wait: what is for it — requests (the panel, @mentions), replies, Stop, tickets — on any of its boards
        const item = await next(o.timeout ? Number(o.timeout) : undefined, () => signal.aborted) as { type: string | null, ticket?: { id: string }, board?: { id: string } }
        if (!(o.take && item.type === 'ticket')) return out(JSON.stringify(item))
        const took: string[] = [] // --take: a ticket is taken too
        await run(['take', item.ticket!.id, '--board', item.board!.id], undefined, (l) => took.push(l), signal)
        return out(took.at(-1)!)
      }
      case 'join-board': { // `quickdraw join` again, for another board: the session goes there too
        const target = args[0]
        if (!target) throw new Error('join-board needs a board')
        const had = boards.get(target)
        const j = had ?? await onto(target)
        writeInfo()
        return out(JSON.stringify({ joined: true, ...(had ? { already: true } : {}), board: j.url, name, boards: [...boards.values()].map(where) }))
      }
      case 'say': {
        const { id: rid, j } = which(o, args[0])
        const text = (args[0] === rid ? args.slice(1) : args).join(' ')
        if (!text) throw new Error('say needs a text')
        j.agent.emit(rid, { type: o.progress ? 'progress' : 'message', text })
        return out(JSON.stringify({ said: rid }))
      }
      case 'finish': {
        const { id: rid, j } = which(o, args[0])
        finish(j, rid, o.text ?? ((args[0] === rid ? args.slice(1) : args).join(' ') || undefined))
        return out(JSON.stringify({ finished: rid }))
      }
      case 'area': {
        const { id: rid, j } = which(o)
        const [w, h] = args.map(Number)
        const at = o.at?.split(',').map(Number)
        return out(await j.agent.runTool(rid, 'claim_area', { w, h, ...(o.title ? { title: o.title } : {}), ...(at ? { x: at[0], y: at[1] } : {}) }))
      }
      case 'who': {
        const j = boardFor(o)
        return out(JSON.stringify({ ...j.who(), ...(boards.size > 1 ? { your_boards: [...boards.values()].map(where) } : {}) }, null, 2))
      }
      case 'changes': return out(JSON.stringify(boardFor(o).changes(), null, 2))
      case 'leave': { // one board (--board), else all of them
        if (o.board && boards.size > 1) {
          const j = boardFor(o)
          void leave(j)
          return out(JSON.stringify({ left: where(j), still_on: [...boards.values()].filter((b) => b !== j).map(where) }))
        }
        void close()
        return out(JSON.stringify({ left: true })) // gone from here at once; off the board a moment later
      }
    }
    // a board command, as this agent, on the board it is for
    const j = boardFor(o)
    const request = o.request ?? (current?.at === j ? current.request : null)
    const writes = !READING.has(cmd) && !STREAMING.has(cmd)
    const people = writes && request ? j.agent.peopleSince(request).trim() : ''
    j.agent.activity(writes ? 'drawing' : 'reading')
    const rest = argv.filter((a, i) => a !== '--board' && argv[i - 1] !== '--board' && !a.startsWith('--board=')) // it is on that board already
    try {
      await runCommand({
        board: j.board, url: j.url, boardKey: j.url, session: true,
        // what has no place goes where people look: the request's view (BoardAgent's), else by the people, else where it last worked
        operate: async (make) => {
          const done = await j.agent.operate(request, make, { prefer: (request ? undefined : j.crowd() ?? j.lastSpot) ?? undefined })
          j.saw(done.diff)
          if (done.focus) j.lastSpot = done.focus
          const did = request && j.didText(done.diff)
          if (did) j.agent.emit(request, { type: 'progress', text: did })
          return done
        },
        stdin: async () => stdin ?? '',
      }, [...rest, '--name', name], out, { signal })
    } finally { j.settle(cmd === 'done' || cmd === 'fail') }
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
  function writeInfo() {
    info.boards = [...boards.keys()]
    writeFileSync(sessionFile(cwd), JSON.stringify(info, null, 2) + '\n')
  }
  mkdirSync(join(cwd, '.quickdraw'), { recursive: true })
  writeInfo()
  idleFrom()

  let ended: () => void
  const closed = new Promise<void>((r) => { ended = r })
  let closing = false
  async function close() {
    if (closing) return closed
    closing = true
    clearTimeout(idleTimer)
    for (const fn of [...wake]) fn()
    server.close()
    rmSync(socket, { force: true })
    rmSync(sessionFile(cwd), { force: true })
    const all = [...boards.values()]
    boards.clear()
    for (const j of all) { j.off(); await j.agent.close().catch(() => {}) }
    ended!()
    return closed
  }
  return { info, closed, close, agent: first.agent as BoardAgent, board: first.board as Board, store: first.store as Store }
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
