// `quickdraw serve`: the boards' home. Serves the list of boards (/), each
// board's page (/b/<id>), the packages the page imports (from wherever Node
// resolves them, so it runs outside this repo), the boards API (/api/boards),
// a relay per board (/ws/<id>, see ../protocol.js), with the agents on it and
// the requests to them, and link previews (/preview).
// Updates are persisted in SQLite; a state vector is answered from what is
// stored, so a board comes back even when no other peer is online.
import { existsSync, realpathSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http'
import { createRequire } from 'node:module'
import type { Duplex } from 'node:stream'
import { dirname, extname, join, normalize, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import * as Y from 'yjs'
import { isLocal, lanAddress } from './local.ts'
import { tailnetSelf, type Person } from './tailscale.ts'
import { detectAgentMention, hasAgentThreadForAnchor, type AgentEvent, type AgentParticipant, type AgentRequest } from 'quickdraw-agent'
import { randomUUID } from 'node:crypto'
import { AGENT, LIVE, PRESENCE, SHARE, SV, UPDATE } from '../protocol.js'
import { handlePreview } from './preview.ts'
import { parseJSON } from 'quickdraw-import'
import { validateMarkdown, TYPE as MARKDOWN } from 'quickdraw-markdown'
import { validateEmbed, TYPE as EMBED } from 'quickdraw-embed'
import { validateTicket, TYPE as TICKET } from 'quickdraw-tickets'
import { BOARD_ID, openBoards, type BoardInfo } from './boards.ts'
import { openThreads } from './threads.ts'
import { accept, BINARY, CLOSE, frame, PING, PONG, reader } from './websocket.ts'

const types: Record<string, string> = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css' }

// what the page imports, served at /_/<name>/src/…
const PACKAGES = ['@quickdrawjs/core', 'quickdraw-agent', 'quickdraw-yjs', 'quickdraw-export', 'quickdraw-import', 'quickdraw-frames', 'quickdraw-layouts', 'quickdraw-tickets', 'quickdraw-members', 'quickdraw-gif', 'quickdraw-clipboard', 'quickdraw-boards', 'quickdraw-markdown', 'quickdraw-embed', 'quickdraw-toolbar', 'quickdraw-screenshare', 'quickdraw-presence', 'quickdraw-voice']

function packageRoot(name: string): string {
  let dir = dirname(createRequire(import.meta.url).resolve(name))
  while (!existsSync(join(dir, 'package.json'))) dir = dirname(dir)
  return realpathSync(dir)
}

// the file under root that path names, or null when it would leave root
function inside(root: string, path: string): string | null {
  const file = join(root, normalize(path))
  return file === root || file.startsWith(root + sep) ? file : null
}

export interface ServeOptions {
  dbPath?: string
  compactEvery?: number
  /** who the host is on its tailnet; by default read from `tailscale status` (null: no Tailscale) */
  self?: Person | null
  /**
   * A device on the local network that connects straight here (no proxy, no
   * tailscale serve) is a person, known by its address: its browser and the
   * agents started on it are one person's. Off by default: an address tells
   * devices apart, not people, and anyone on the network can use one.
   */
  trustLanIp?: boolean
}

const json = (res: ServerResponse, status: number, body: unknown) =>
  res.writeHead(status, { 'content-type': 'application/json', 'cache-control': 'no-store' }).end(JSON.stringify(body))

async function readJson(req: IncomingMessage, limit = 10_000): Promise<Record<string, unknown>> {
  let body = ''
  for await (const chunk of req) {
    body += chunk
    if (body.length > limit) throw new Error('too large')
  }
  const v = JSON.parse(body || '{}')
  if (!v || typeof v !== 'object' || Array.isArray(v)) throw new Error('not an object')
  return v
}

export function createQuickdrawServer({ dbPath = ':memory:', compactEvery = 500, self = tailnetSelf(), trustLanIp = false }: ServeOptions = {}) {
  const web = fileURLToPath(new URL('../../web/', import.meta.url)).replace(/\/$/, '')
  const protocol = fileURLToPath(new URL('../protocol.js', import.meta.url))
  const mounts = new Map(PACKAGES.map((name) => [name.replace('@quickdrawjs/', ''), join(packageRoot(name), 'src')]))
  const boards = openBoards(dbPath, compactEvery)
  const threads = openThreads(dbPath)

  function locate(pathname: string): string | null {
    if (pathname === '/') return join(web, 'index.html')
    if (pathname === '/protocol.js') return protocol
    if (pathname === '/versions.js') return join(web, 'versions.js')
    const b = pathname.match(/^\/b\/([^/]+)(\/view)?$/)
    if (b) return BOARD_ID.test(b[1]) && boards.get(b[1]) ? join(web, b[2] ? 'view.html' : 'board.html') : null // /view: read only (a board card's live window)
    const m = pathname.match(/^\/_\/([^/]+)\/src(\/.*)$/)
    if (m) {
      const root = mounts.get(m[1])
      return root ? inside(root, m[2]) : null
    }
    return null
  }

  // /api/boards: the boards (JSON in and out: a cross-site form cannot send it)
  //   GET    /api/boards[?archived=1]            the list, with how many agents are on each
  //   POST   /api/boards { title, from?, file? }  a new board: empty, a copy of `from`, or a JSON file's
  //   GET    /api/boards/ID                       one
  //   PATCH  /api/boards/ID { title?, archived? } rename, archive or bring back
  //   GET    /api/boards/ID/versions              its versions, newest first
  //   POST   /api/boards/ID/versions { name }     keep it as it is now
  //   POST   /api/boards/ID/versions/V/restore { as: 'board' | 'new' }   back to V, or V as a new board
  //   GET    /api/boards/ID/thumbnail             a small picture of it (PUT one: a JPEG, PNG or WebP)
  async function api(req: IncomingMessage, res: ServerResponse, pathname: string) {
    const body = async (limit?: number) => {
      if (!req.headers['content-type']?.startsWith('application/json')) throw Object.assign(new Error('send JSON'), { status: 415 })
      try { return await readJson(req, limit) } catch (e) { throw Object.assign(e as Error, { status: 400 }) }
    }
    const withAgents = (b: BoardInfo) => ({ ...b, agents: rooms.get(b.id) ? agentsIn(rooms.get(b.id)!).length : 0 })
    try {
      if (pathname === '/api/boards') {
        if (req.method === 'GET') return json(res, 200, boards.list({ archived: new URL(req.url ?? '/', 'http://x').searchParams.get('archived') === '1' }).map(withAgents))
        if (req.method !== 'POST') return json(res, 405, { error: 'GET or POST' })
        const b = await body(30_000_000) // a JSON file may carry images
        const t = typeof b.title === 'string' ? b.title : undefined
        if (typeof b.from === 'string') return json(res, 201, boards.duplicate(b.from, t))
        if (b.file !== undefined) {
          let parsed
          try { parsed = parseJSON(b.file, { types: { [MARKDOWN]: validateMarkdown, [EMBED]: validateEmbed, [TICKET]: validateTicket } }) } catch (e) { return json(res, 400, { error: (e as Error).message }) }
          return json(res, 201, boards.createFrom(t ?? 'Imported', [...parsed.shapes, ...Object.values(parsed.assets)] as never))
        }
        return json(res, 201, boards.create(t))
      }
      const t = pathname.match(/^\/api\/boards\/([^/]+)\/thumbnail$/)
      if (t) {
        const tid = BOARD_ID.test(t[1]) && boards.get(t[1]) ? t[1] : null
        if (!tid) return json(res, 404, { error: 'no such board' })
        if (req.method === 'GET') {
          const thumb = boards.thumbnail(tid)
          if (!thumb) return json(res, 404, { error: 'no thumbnail yet' })
          return res.writeHead(200, { 'content-type': thumb.type, 'cache-control': 'no-cache', etag: `"${thumb.at}"` }).end(thumb.data)
        }
        if (req.method !== 'PUT') return json(res, 405, { error: 'GET or PUT' })
        const type = req.headers['content-type'] ?? ''
        if (!['image/jpeg', 'image/png', 'image/webp'].includes(type)) return json(res, 415, { error: 'send a JPEG, PNG or WebP' })
        const chunks: Buffer[] = []
        let size = 0
        for await (const chunk of req) {
          size += chunk.length
          if (size > 500_000) return json(res, 413, { error: 'too large for a thumbnail' })
          chunks.push(chunk)
        }
        boards.setThumbnail(tid, Buffer.concat(chunks), type)
        return res.writeHead(204).end()
      }
      const m = pathname.match(/^\/api\/boards\/([^/]+)(\/versions(?:\/(\d+)\/restore)?)?$/)
      const info = m && BOARD_ID.test(m[1]) ? boards.get(m[1]) : undefined
      if (!m || !info) return json(res, 404, { error: 'no such board' })
      const id = info.id
      if (!m[2]) {
        if (req.method === 'GET') return json(res, 200, withAgents(info))
        if (req.method !== 'PATCH') return json(res, 405, { error: 'GET or PATCH' })
        const b = await body()
        if (typeof b.title === 'string') boards.rename(id, b.title)
        if (typeof b.archived === 'boolean') boards.archive(id, b.archived)
        return json(res, 200, boards.get(id))
      }
      if (!m[3]) {
        if (req.method === 'GET') return json(res, 200, boards.versions(id))
        if (req.method !== 'POST') return json(res, 405, { error: 'GET or POST' })
        const b = await body()
        return json(res, 201, boards.saveVersion(id, typeof b.name === 'string' ? b.name : ''))
      }
      if (req.method !== 'POST') return json(res, 405, { error: 'POST' })
      const b = await body()
      const vid = Number(m[3])
      if (b.as === 'new') return json(res, 201, boards.openVersion(id, vid, typeof b.title === 'string' ? b.title : undefined))
      // over the board: kept as a version first, then sent to everyone on it as an ordinary update
      boards.saveVersion(id, 'Before restoring', true)
      const update = boards.restore(id, vid)
      const room = rooms.get(id)
      if (room && update.length) { const out = frame(BINARY, Buffer.concat([Buffer.from([UPDATE]), update])); for (const p of room) if (p.writable) p.write(out) }
      return json(res, 200, { restored: vid })
    } catch (e) {
      const err = e as Error & { status?: number }
      return json(res, err.status ?? (/no such/.test(err.message) ? 404 : 500), { error: err.message })
    }
  }

  const rooms = new Map<string, Set<Duplex>>() // board id -> its sockets
  let nextId = 1
  const presence = (id: number, data: object) => frame(BINARY, Buffer.concat([Buffer.from([PRESENCE]), Buffer.from(JSON.stringify({ ...data, id }))]))
  const broadcast = (room: Set<Duplex>, from: Duplex, out: Buffer) => { for (const peer of room) if (peer !== from && peer.writable) peer.write(out) }
  const presences = new Map<Duplex, Buffer>() // each connection's latest, in memory only: for those who come later
  const refused = (board: string, what: string, payload: Buffer, e: unknown) =>
    console.warn(`board ${board}: ignored ${what} that cannot be read (${payload.length - 1} bytes): ${(e as Error).message}`)

  // agents: a connection that joined as one; the others are pages
  const agentOf = new Map<Duplex, AgentParticipant>()
  const local = new WeakSet<Duplex>() // connections from this computer (./local.ts)
  // Who is behind a connection, as far as the server can tell: a tailnet login
  // (the header \`tailscale serve\` adds, and strips from what comes in; trusted only
  // on a connection it made, from this computer), or the host (straight to this
  // computer: its own login when it has Tailscale); else nobody known.
  const personOf = new WeakMap<Duplex, { key: string, name: string }>()
  const hostPerson = self ? { key: 'tailnet:' + self.login, name: self.name ?? self.login } : { key: 'host', name: 'the host' }
  const names = new WeakMap<Duplex, string>() // what each says it is called (presence)
  // a device known by its address (--trust-lan-ip) is called what its person's page calls itself
  const deviceNames = new Map<string, string>()
  const nameOf = (p?: { key: string, name: string }) => (p ? deviceNames.get(p.key) ?? p.name : undefined)
  const peerIdOf = new WeakMap<Duplex, number>() // its id in presence
  // a person's name as the others see it: "Mac 2" when another person here is "Mac" already
  const uniqueName = (room: Set<Duplex>, socket: Duplex, name: string) => {
    const taken = new Set([...room].filter((s) => s !== socket && !agentOf.has(s)).map((s) => names.get(s)).filter(Boolean))
    if (!taken.has(name)) return name
    for (let n = 2; ; n++) if (!taken.has(`${name} ${n}`)) return `${name} ${n}`
  }
  // An agent is its owner's (who started it, on their own account): it takes
  // requests, replies and approvals from them, and from whom they open it to:
  // everyone (--allow-remote, or from the panel), or people they name.
  const access = new WeakMap<AgentParticipant, { owner?: { key: string, name: string }, with: 'owner' | 'all' | Map<string, string> }>()
  const mayAsk = (socket: Duplex, agent?: AgentParticipant) => {
    if (!agent) return true
    const a = access.get(agent)
    if (!a || a.with === 'all') return true
    const me = personOf.get(socket)?.key
    return !!me && (me === a.owner?.key || (a.with instanceof Map && a.with.has(me)))
  }
  const onlyHere = (agent: AgentParticipant) => {
    const owner = nameOf(access.get(agent)?.owner)
    return `${agent.name} runs on ${owner ? owner + '\'s' : 'someone else\'s'} account: only ${owner ?? 'they'} can ask it, unless they open it to you.`
  }
  // an agent as a page sees it: whose it is, and whether that page may ask it
  const agentView = (a: AgentParticipant, page: Duplex) => {
    const acc = access.get(a)
    const mine = !!acc?.owner && acc.owner.key === personOf.get(page)?.key
    return {
      ...a, ...(acc?.owner ? { owner: { name: nameOf(acc.owner)! } } : {}), mine, canAsk: mayAsk(page, a),
      ...(mine ? { sharedWith: acc!.with instanceof Map ? [...acc!.with.values()] : acc!.with } : {}),
    }
  }
  let closing = false
  const agentMsg = (value: object) => frame(BINARY, Buffer.concat([Buffer.from([AGENT]), Buffer.from(JSON.stringify(value))]))
  const send = (to: Duplex, value: object) => { if (to.writable) to.write(agentMsg(value)) }
  const pages = (room: Set<Duplex>) => [...room].filter((s) => !agentOf.has(s))
  const agentsIn = (room: Set<Duplex>) => [...room].flatMap((s) => agentOf.get(s) ?? [])
  const toPages = (room: Set<Duplex>, value: object) => { const out = agentMsg(value); for (const p of pages(room)) if (p.writable) p.write(out) }
  const announce = (room: Set<Duplex>) => { for (const p of pages(room)) send(p, { kind: 'agents', agents: agentsIn(room).map((a) => agentView(a, p)) }) }
  function record(room: Set<Duplex>, event: AgentEvent) {
    if (threads.append(event.requestId, event)) toPages(room, { kind: 'event', event })
  }
  const str = (v: unknown, max: number) => typeof v === 'string' && v.length > 0 && v.length <= max
  const AGENT_EVENTS = new Set(['progress', 'message', 'question', 'approval', 'op', 'area', 'done', 'error'])
  // a work area on the board: page coordinates, not absurd
  const rect = (a: any) => a && ['x', 'y', 'w', 'h'].every((k) => Number.isFinite(a[k]) && Math.abs(a[k]) < 1e7) && a.w >= 40 && a.h >= 40
    ? { x: a.x, y: a.y, w: a.w, h: a.h } : null
  // voice conversations (a request with a WebRTC offer): the page that asked, by request.
  // Their offer and answer go between it and the agent only, and are never stored.
  const talking = new Map<string, { page: Duplex, agent: Duplex }>()

  // screen sharing (quickdraw-screenshare): one sharer per board; its frames go to
  // the pages, dropped for one that is behind, and never stored
  const sharers = new Map<string, { socket: Duplex, name: string }>() // board -> who shares
  const shareMsg = (value: object) => frame(BINARY, Buffer.concat([Buffer.from([SHARE]), Buffer.from(JSON.stringify(value))]))
  const sharingFor = (board: string, s: Duplex) => {
    const sh = sharers.get(board)
    return shareMsg({ kind: 'sharing', sharer: sh ? { name: sh.name } : null, mine: sh?.socket === s })
  }
  const announceSharing = (board: string, room: Set<Duplex>) => { for (const s of pages(room)) if (s.writable) s.write(sharingFor(board, s)) }
  const BEHIND = 1_000_000 // bytes waiting for a peer: past this, it skips frames

  function onShareMessage(board: string, room: Set<Duplex>, socket: Duplex, m: Record<string, any>) {
    if (agentOf.has(socket)) return
    const sh = sharers.get(board)
    if (m.kind === 'start') {
      sharers.set(board, { socket, name: str(m.name, 100) ? m.name : '' }) // takes over from anyone sharing
      announceSharing(board, room)
    } else if (m.kind === 'stop' && sh?.socket === socket) {
      sharers.delete(board)
      announceSharing(board, room)
    } else if (m.kind === 'snap' && sh && sh.socket !== socket && sh.socket.writable) {
      sh.socket.write(shareMsg({ kind: 'snap', by: str(m.by, 100) ? m.by : '' }))
    }
  }
  function onLiveFrame(board: string, room: Set<Duplex>, socket: Duplex, payload: Buffer) {
    if (sharers.get(board)?.socket !== socket || payload.length > 4_000_000) return
    const out = frame(BINARY, payload)
    for (const p of pages(room)) if (p !== socket && p.writable && p.writableLength < BEHIND) p.write(out)
  }

  function onAgentMessage(board: string, room: Set<Duplex>, socket: Duplex, m: Record<string, any>) {
    const agent = agentOf.get(socket)
    if (m.kind === 'hello' && !agent) { // a page: who is here, and the threads so far
      socket.write(sharingFor(board, socket))
      // who you are, when the server can tell (a tailnet name): the page names you so until you choose a name
      send(socket, { kind: 'you', local: local.has(socket), ...(personOf.get(socket)?.key.startsWith('tailnet:') ? { person: personOf.get(socket)!.name } : {}) })
      send(socket, { kind: 'agents', agents: agentsIn(room).map((a) => agentView(a, socket)) })
      send(socket, { kind: 'threads', threads: threads.list(board) })
    } else if (m.kind === 'join' && !agent && str(m.agent?.name, 100)) {
      // its id, unique on the board: what requests are addressed to
      const taken = new Set(agentsIn(room).map((a) => a.id))
      const base = String(str(m.agent.id, 100) ? m.agent.id : m.agent.name)
      let id = base
      for (let i = 2; taken.has(id); i++) id = `${base}-${i}`
      const knows = Array.isArray(m.agent.knows) ? m.agent.knows.filter((k: unknown) => str(k, 100)).slice(0, 8) : []
      // the models a person may choose from, per request, and the defaults
      // (a model that takes no effort, as some of pi's, has none: efforts [] and effort '')
      const models = Array.isArray(m.agent.models) ? m.agent.models.slice(0, 100).flatMap((x: any) => {
        const efforts = Array.isArray(x?.efforts) ? x.efforts.filter((e: unknown) => str(e, 40)).slice(0, 12) : []
        const effort = efforts.length ? (str(x?.effort, 40) ? x.effort : '') : ''
        return str(x?.id, 100) && str(x?.name, 100) && (effort || !efforts.length) ? [{ id: x.id, name: x.name, efforts, effort }] : []
      }) : []
      const participant: AgentParticipant = {
        id, name: m.agent.name, knows, status: 'idle',
        ...(models.length ? { models } : {}),
        ...(str(m.agent.model, 100) ? { model: m.agent.model } : {}),
        ...(str(m.agent.effort, 40) ? { effort: m.agent.effort } : {}),
        ...(m.agent.remote === true ? { remote: true } : {}),
        ...(m.agent.voice === true ? { voice: true } : {}),
        // the voices it talks in: names, a few
        ...(m.agent.voice === true && Array.isArray(m.agent.voices) && m.agent.voices.length ? { voices: m.agent.voices.filter((v: unknown) => str(v, 40)).slice(0, 40) } : {}),
        ...(m.agent.voice === true && str(m.agent.defaultVoice, 40) ? { defaultVoice: m.agent.defaultVoice } : {}),
      }
      agentOf.set(socket, participant)
      access.set(participant, { owner: personOf.get(socket), with: m.agent.remote === true ? 'all' : 'owner' })
      send(socket, { kind: 'joined', id })
      announce(room)
    } else if (m.kind === 'status' && agent && ['idle', 'working', 'waiting'].includes(m.status)) {
      agent.status = m.status
      announce(room)
    } else if (m.kind === 'account' && agent) {
      // what it runs on, as it says: shown in the panel, never checked
      const limits = Array.isArray(m.limits) ? m.limits.slice(0, 8).flatMap((l: any) =>
        str(l?.name, 40) && Number.isFinite(l.usedPercent)
          ? [{ name: l.name, usedPercent: Math.min(100, Math.max(0, l.usedPercent)), ...(Number.isFinite(l.resetsAt) ? { resetsAt: l.resetsAt } : {}) }]
          : []) : []
      if (str(m.account, 100)) agent.account = m.account
      else delete agent.account
      if (limits.length) agent.limits = limits
      else delete agent.limits
      announce(room)
    } else if (m.kind === 'event' && agent && (AGENT_EVENTS.has(m.event?.type) || (m.event?.type === 'reply' && talking.has(m.event.requestId)))) {
      // only about a request to this agent, on this board; in a conversation, what the person said comes from it too
      const t = threads.get(m.event.requestId)
      if (t?.board === board && t.thread.request.to === agent.id) record(room, m.event)
    } else if (m.kind === 'voice' && str(m.requestId, 100)) {
      const call = talking.get(m.requestId)
      if (!call) return
      if (agent && call.agent === socket) { // the answer, or that it ended
        if (str(m.sdp, 20_000)) send(call.page, { kind: 'voice', requestId: m.requestId, sdp: m.sdp })
        else if ('end' in m) {
          talking.delete(m.requestId)
          send(call.page, { kind: 'voice', requestId: m.requestId, end: str(m.end, 500) ? m.end : null })
        }
      } else if (call.page === socket && m.stop === true) send(call.agent, { kind: 'voice', requestId: m.requestId, stop: true })
    } else if (m.kind === 'request' && !agent && str(m.request?.id, 100) && typeof m.request.text === 'string' && m.request.text.length <= 20_000) {
      const request = m.request as AgentRequest
      if (threads.get(request.id)) return
      delete request.from // a page asks as itself: only the server says an agent asked
      // feedback it carries (snapshot frames): ids only, a few
      const fb = request.context?.feedback
      if (fb !== undefined && !(Array.isArray(fb) && fb.length <= 12 && fb.every((id) => str(id, 100)))) delete request.context.feedback
      // where it should work, marked out on the board: a sound box, or nothing
      if (request.context?.area !== undefined) {
        const area = rect(request.context.area)
        if (area) request.context.area = area
        else delete request.context.area
      }
      const target = [...room].find((s) => agentOf.get(s)?.id === request.to)
      const agentTo = target && agentOf.get(target)
      if (!mayAsk(socket, agentTo)) return send(socket, { kind: 'event', event: { type: 'error', requestId: request.id, message: onlyHere(agentTo!) } })
      // to talk (see ./protocol.js): only with an agent that talks
      const sdp = str(m.sdp, 20_000) ? m.sdp as string : undefined
      if (sdp && !agentTo?.voice) return send(socket, { kind: 'voice', requestId: request.id, end: 'That agent does not talk.' })
      if (sdp) request.voice = true
      else delete request.voice
      boards.saveVersion(board, `Before AI: ${request.text.replace(/\s+/g, ' ').slice(0, 60)}`, true) // to go back past what it does
      const thread = threads.create(board, request)
      broadcast(new Set(pages(room)), socket, agentMsg({ kind: 'thread', thread })) // the sender has it
      if (target && sdp) talking.set(request.id, { page: socket, agent: target })
      if (target) send(target, { kind: 'request', request, local: true, ...(sdp ? { sdp } : {}) }) // `local`: the server checked who asks
      else record(room, { type: 'error', requestId: request.id, message: 'That agent is not on this board.' })
    } else if (m.kind === 'mention' && str(m.note?.id, 100) && typeof m.note.text === 'string' && m.note.text.length <= 20_000) {
      // a note an agent (or a command) wrote that starts with @AI or @<agent>: a
      // request to that agent, as when a person writes one, if the one who
      // started the writer started that agent too (or it takes requests from anyone)
      const others = [...room].filter((s) => s !== socket && agentOf.has(s))
      const found = detectAgentMention(m.note.text, others.map((s) => agentOf.get(s)!))
      if (!found) return
      const target = others.find((s) => agentOf.get(s)!.id === found.to)!
      const agentTo = agentOf.get(target)!
      if (!mayAsk(socket, agentTo)) return
      if (hasAgentThreadForAnchor(m.note.id, threads.list(board))) return // it is already a request
      const x = Number.isFinite(m.note.x) ? m.note.x : 0, y = Number.isFinite(m.note.y) ? m.note.y : 0
      const from = agent?.name ?? names.get(socket)
      const request: AgentRequest = {
        id: randomUUID(), to: agentTo.id, text: found.text,
        context: { shapeIds: [m.note.id], frameIds: [], viewport: { x: x - 400, y: y - 300, w: 1000, h: 800 } },
        anchor: { shapeId: m.note.id, x, y }, ...(from ? { from } : {}),
      }
      boards.saveVersion(board, `Before AI: ${request.text.replace(/\s+/g, ' ').slice(0, 60)}`, true)
      const thread = threads.create(board, request)
      toPages(room, { kind: 'thread', thread })
      send(target, { kind: 'request', request, local: true })
    } else if (m.kind === 'share' && !agent && str(m.agent, 100)) {
      // its owner opens an agent to everyone, to people on the board (presence ids), or closes it again
      const target = agentsIn(room).find((a) => a.id === m.agent)
      const acc = target && access.get(target)
      const me = personOf.get(socket)?.key
      if (!acc || !me || acc.owner?.key !== me) return
      if (m.with === 'all' || m.with === 'owner') acc.with = m.with
      else if (Array.isArray(m.with)) {
        const people = new Map<string, string>()
        for (const s of room) {
          const p = personOf.get(s)
          if (p && p.key !== me && !agentOf.has(s) && m.with.includes(peerIdOf.get(s))) people.set(p.key, names.get(s) ?? p.name)
        }
        acc.with = people.size ? people : 'owner'
      } else return
      if (acc.with === 'all') target.remote = true // what the panel says of it follows
      else delete target.remote
      announce(room)
    } else if (m.kind === 'reply' && !agent && str(m.requestId, 100)) {
      const t = threads.get(m.requestId)
      if (t?.board !== board) return
      const { message } = m
      const to = [...room].find((s) => agentOf.get(s)?.id === t.thread.request.to)
      // moving its work area directs the agent too
      const answering = str(message, 20_000) || (message && str(message.approval, 200)) || !!rect(message?.area) || message?.stop === true
      if (answering && !mayAsk(socket, to && agentOf.get(to))) {
        return send(socket, { kind: 'event', event: { type: 'error', requestId: m.requestId, message: onlyHere(agentOf.get(to!)!) } })
      }
      if (str(message, 20_000)) {
        record(room, { type: 'reply', requestId: m.requestId, text: message })
        if (to) send(to, { kind: 'reply', requestId: m.requestId, message, local: true })
      } else if (message && str(message.approval, 200) && typeof message.allow === 'boolean') {
        if (to) send(to, { kind: 'reply', requestId: m.requestId, message: { approval: message.approval, allow: message.allow }, local: true })
      } else if (message?.stop === true) {
        if (to) send(to, { kind: 'reply', requestId: m.requestId, message: { stop: true }, local: true })
      } else if (rect(message?.area)) {
        // everyone sees it moved at once; the agent builds there from its next step
        const area = rect(message.area)!
        record(room, { type: 'area', requestId: m.requestId, area, by: 'person' })
        if (to) send(to, { kind: 'reply', requestId: m.requestId, message: { area }, local: true })
      } else if (message?.undo && Number.isInteger(message.undo.reverted) && Array.isArray(message.undo.skipped)) {
        record(room, { type: 'undo', requestId: m.requestId, reverted: message.undo.reverted, skipped: message.undo.skipped.filter((s: unknown) => str(s, 200)) })
      }
    }
  }

  const server: Server = createServer(async (req, res) => {
    const { pathname } = new URL(req.url ?? '/', 'http://x')
    if (pathname === '/preview') return handlePreview(req, res)
    if (pathname.startsWith('/api/')) return api(req, res, pathname)
    let file: string | null = null
    try { file = locate(decodeURIComponent(pathname)) } catch {}
    if (!file) return res.writeHead(404).end()
    try {
      const body = await readFile(file)
      res.writeHead(200, { 'content-type': types[extname(file)] || 'application/octet-stream' }).end(body)
    } catch {
      res.writeHead(404).end()
    }
  })

  server.on('upgrade', (req, socket) => {
    const board = new URL(req.url ?? '/', 'http://x').pathname.match(/^\/ws\/([^/]+)$/)?.[1]
    // an unknown board is refused, never created: boards are made on purpose
    if (!board || !BOARD_ID.test(board) || !boards.get(board) || !accept(req, socket)) return socket.destroy()
    if (isLocal(req)) { local.add(socket); personOf.set(socket, hostPerson) }
    else {
      const login = req.headers['tailscale-user-login'], name = req.headers['tailscale-user-name']
      const lan = trustLanIp ? lanAddress(req) : null
      if (typeof login === 'string' && login && /^(127\.|::1$|::ffff:127\.)/.test(req.socket.remoteAddress ?? '')) {
        personOf.set(socket, { key: 'tailnet:' + login, name: typeof name === 'string' && name ? name : login })
      } else if (lan) personOf.set(socket, { key: 'ip:' + lan, name: lan }) // --trust-lan-ip: the device, called what its page calls itself
    }
    let room = rooms.get(board)
    if (!room) rooms.set(board, room = new Set())
    const peers = room
    peers.add(socket)
    const id = nextId++
    peerIdOf.set(socket, id)
    for (const peer of peers) { const p = presences.get(peer); if (p) socket.write(p) } // who is here already
    const read = reader()
    socket.on('data', (chunk: Buffer) => {
      for (const { opcode, payload } of read(chunk)) {
        if (opcode === CLOSE) { socket.end(frame(CLOSE, Buffer.alloc(0))); drop(); return }
        if (opcode === PING) { socket.write(frame(PONG, payload)); continue }
        if (opcode !== BINARY || payload.length === 0) continue
        if (payload[0] === SV) {
          let diff
          try { diff = Y.diffUpdate(boards.state(board), payload.subarray(1)) } catch (e) { refused(board, 'a state vector', payload, e); continue }
          socket.write(frame(BINARY, Buffer.concat([Buffer.from([UPDATE]), diff])))
        } else if (payload[0] === UPDATE) {
          // one that cannot be read is neither kept nor passed on: kept, it would break the board for everyone
          try { Y.decodeUpdate(payload.subarray(1)) } catch (e) { refused(board, 'an update', payload, e); continue }
          boards.append(board, payload.subarray(1))
          broadcast(peers, socket, frame(BINARY, payload))
        } else if (payload[0] === PRESENCE) {
          let data
          try { data = JSON.parse(payload.subarray(1).toString()) } catch { continue }
          if (!data || typeof data !== 'object') continue
          delete data.owner // said by the server only
          if (data.agent) {
            // an agent shows whose it is: who started it (it runs on their account)
            const a = agentOf.get(socket)
            const owner = nameOf((a && access.get(a)?.owner) || personOf.get(socket))
            if (owner) data.owner = owner
          } else if (str(data.name, 100)) data.name = uniqueName(peers, socket, data.name) // two people are two names
          const out = presence(id, data)
          presences.set(socket, out)
          if (str(data.name, 100)) names.set(socket, data.name)
          const who = personOf.get(socket)
          if (!data.agent && who?.key.startsWith('ip:') && str(data.name, 100)) deviceNames.set(who.key, data.name)
          broadcast(peers, socket, out)
        } else if (payload[0] === LIVE) {
          onLiveFrame(board, peers, socket, payload)
        } else if (payload[0] === SHARE) {
          let m
          try { m = JSON.parse(payload.subarray(1).toString()) } catch { continue }
          if (m && typeof m === 'object') onShareMessage(board, peers, socket, m)
        } else if (payload[0] === AGENT) {
          let m
          try { m = JSON.parse(payload.subarray(1).toString()) } catch { continue }
          if (m && typeof m === 'object') onAgentMessage(board, peers, socket, m)
        }
      }
    })
    function drop() {
      if (!peers.delete(socket)) return
      presences.delete(socket)
      broadcast(peers, socket, presence(id, { gone: true }))
      if (sharers.get(board!)?.socket === socket) { sharers.delete(board!); announceSharing(board!, peers) }
      // a conversation ends with the page that talks, or the agent it talks with
      for (const [requestId, call] of talking) {
        if (call.page === socket) send(call.agent, { kind: 'voice', requestId, stop: true })
        if (call.agent === socket) send(call.page, { kind: 'voice', requestId, end: 'The agent left the board.' })
        if (call.page === socket || call.agent === socket) talking.delete(requestId)
      }
      const agent = agentOf.get(socket)
      if (agent && !closing) { // not while the server shuts down: the threads are closed
        agentOf.delete(socket)
        announce(peers)
        // what it was still doing will not finish
        for (const t of threads.list(board!)) {
          if (t.request.to === agent.id && (t.status === 'working' || t.status === 'waiting')) {
            record(peers, { type: 'error', requestId: t.request.id, message: `${agent.name} left the board.` })
          }
        }
      }
      if (!peers.size) rooms.delete(board!)
    }
    socket.on('close', drop)
    socket.on('error', drop)
  })

  return {
    server,
    boards,
    threads,
    listen(port = 8795, host = '127.0.0.1') {
      return new Promise<{ port: number }>((ok) => server.listen(port, host, () => ok(server.address() as { port: number })))
    },
    close() {
      closing = true
      for (const room of rooms.values()) for (const s of room) s.destroy()
      return new Promise<void>((ok) => server.close(() => ok())).then(() => { boards.close(); threads.close() })
    },
  }
}
