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
import type { AgentEvent, AgentParticipant, AgentRequest } from 'quickdraw-agent'
import { AGENT, PRESENCE, SV, UPDATE } from '../protocol.js'
import { handlePreview } from './preview.ts'
import { BOARD_ID, openBoards } from './boards.ts'
import { openThreads } from './threads.ts'
import { accept, BINARY, CLOSE, frame, parse, PING, PONG } from './websocket.ts'

const types: Record<string, string> = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css' }

// what the page imports, served at /_/<name>/src/…
const PACKAGES = ['@quickdrawjs/core', 'quickdraw-agent', 'quickdraw-yjs', 'quickdraw-export', 'quickdraw-import', 'quickdraw-frames', 'quickdraw-markdown', 'quickdraw-embed', 'quickdraw-toolbar']

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

export function createQuickdrawServer({ dbPath = ':memory:', compactEvery = 500 }: ServeOptions = {}) {
  const web = fileURLToPath(new URL('../../web/', import.meta.url)).replace(/\/$/, '')
  const protocol = fileURLToPath(new URL('../protocol.js', import.meta.url))
  const mounts = new Map(PACKAGES.map((name) => [name.replace('@quickdrawjs/', ''), join(packageRoot(name), 'src')]))
  const boards = openBoards(dbPath, compactEvery)
  const threads = openThreads(dbPath)

  function locate(pathname: string): string | null {
    if (pathname === '/') return join(web, 'index.html')
    if (pathname === '/protocol.js') return protocol
    const b = pathname.match(/^\/b\/([^/]+)$/)
    if (b) return BOARD_ID.test(b[1]) && boards.get(b[1]) ? join(web, 'board.html') : null
    const m = pathname.match(/^\/_\/([^/]+)\/src(\/.*)$/)
    if (m) {
      const root = mounts.get(m[1])
      return root ? inside(root, m[2]) : null
    }
    return null
  }

  // /api/boards: list (GET) and create (POST, JSON: a cross-site form cannot send it)
  async function api(req: IncomingMessage, res: ServerResponse, pathname: string) {
    if (pathname === '/api/boards') {
      if (req.method === 'GET') return json(res, 200, boards.list())
      if (req.method === 'POST') {
        if (!req.headers['content-type']?.startsWith('application/json')) return json(res, 415, { error: 'send JSON' })
        let body
        try { body = await readJson(req) } catch (e) { return json(res, 400, { error: (e as Error).message }) }
        return json(res, 201, boards.create(typeof body.title === 'string' ? body.title : undefined))
      }
      return json(res, 405, { error: 'GET or POST' })
    }
    const one = pathname.match(/^\/api\/boards\/([^/]+)$/)
    const info = one && BOARD_ID.test(one[1]) ? boards.get(one[1]) : undefined
    return info ? json(res, 200, info) : json(res, 404, { error: 'no such board' })
  }

  const rooms = new Map<string, Set<Duplex>>() // board id -> its sockets
  let nextId = 1
  const presence = (id: number, data: object) => frame(BINARY, Buffer.concat([Buffer.from([PRESENCE]), Buffer.from(JSON.stringify({ ...data, id }))]))
  const broadcast = (room: Set<Duplex>, from: Duplex, out: Buffer) => { for (const peer of room) if (peer !== from && peer.writable) peer.write(out) }

  // agents: a connection that joined as one; the others are pages
  const agentOf = new Map<Duplex, AgentParticipant>()
  const agentMsg = (value: object) => frame(BINARY, Buffer.concat([Buffer.from([AGENT]), Buffer.from(JSON.stringify(value))]))
  const send = (to: Duplex, value: object) => { if (to.writable) to.write(agentMsg(value)) }
  const pages = (room: Set<Duplex>) => [...room].filter((s) => !agentOf.has(s))
  const agentsIn = (room: Set<Duplex>) => [...room].flatMap((s) => agentOf.get(s) ?? [])
  const toPages = (room: Set<Duplex>, value: object) => { const out = agentMsg(value); for (const p of pages(room)) if (p.writable) p.write(out) }
  const announce = (room: Set<Duplex>) => toPages(room, { kind: 'agents', agents: agentsIn(room) })
  function record(room: Set<Duplex>, event: AgentEvent) {
    if (threads.append(event.requestId, event)) toPages(room, { kind: 'event', event })
  }
  const str = (v: unknown, max: number) => typeof v === 'string' && v.length > 0 && v.length <= max
  const AGENT_EVENTS = new Set(['progress', 'message', 'question', 'approval', 'op', 'done', 'error'])

  function onAgentMessage(board: string, room: Set<Duplex>, socket: Duplex, m: Record<string, any>) {
    const agent = agentOf.get(socket)
    if (m.kind === 'hello' && !agent) { // a page: who is here, and the threads so far
      send(socket, { kind: 'agents', agents: agentsIn(room) })
      send(socket, { kind: 'threads', threads: threads.list(board) })
    } else if (m.kind === 'join' && !agent && str(m.agent?.name, 100)) {
      // its id, unique on the board: what requests are addressed to
      const taken = new Set(agentsIn(room).map((a) => a.id))
      const base = String(str(m.agent.id, 100) ? m.agent.id : m.agent.name)
      let id = base
      for (let i = 2; taken.has(id); i++) id = `${base}-${i}`
      const knows = Array.isArray(m.agent.knows) ? m.agent.knows.filter((k: unknown) => str(k, 100)).slice(0, 8) : []
      agentOf.set(socket, { id, name: m.agent.name, knows, status: 'idle' })
      send(socket, { kind: 'joined', id })
      announce(room)
    } else if (m.kind === 'status' && agent && ['idle', 'working', 'waiting'].includes(m.status)) {
      agent.status = m.status
      announce(room)
    } else if (m.kind === 'event' && agent && AGENT_EVENTS.has(m.event?.type)) {
      // only about a request to this agent, on this board
      const t = threads.get(m.event.requestId)
      if (t?.board === board && t.thread.request.to === agent.id) record(room, m.event)
    } else if (m.kind === 'request' && !agent && str(m.request?.id, 100) && typeof m.request.text === 'string' && m.request.text.length <= 20_000) {
      const request = m.request as AgentRequest
      if (threads.get(request.id)) return
      const thread = threads.create(board, request)
      broadcast(new Set(pages(room)), socket, agentMsg({ kind: 'thread', thread })) // the sender has it
      const to = [...room].find((s) => agentOf.get(s)?.id === request.to)
      if (to) send(to, { kind: 'request', request })
      else record(room, { type: 'error', requestId: request.id, message: 'That agent is not on this board.' })
    } else if (m.kind === 'reply' && !agent && str(m.requestId, 100)) {
      const t = threads.get(m.requestId)
      if (t?.board !== board) return
      const { message } = m
      const to = [...room].find((s) => agentOf.get(s)?.id === t.thread.request.to)
      if (str(message, 20_000)) {
        record(room, { type: 'reply', requestId: m.requestId, text: message })
        if (to) send(to, { kind: 'reply', requestId: m.requestId, message })
      } else if (message && str(message.approval, 200) && typeof message.allow === 'boolean') {
        if (to) send(to, { kind: 'reply', requestId: m.requestId, message: { approval: message.approval, allow: message.allow } })
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
    let room = rooms.get(board)
    if (!room) rooms.set(board, room = new Set())
    const peers = room
    peers.add(socket)
    const id = nextId++
    let buf: Buffer = Buffer.alloc(0)
    socket.on('data', (chunk: Buffer) => {
      let frames
      ;[frames, buf] = parse(Buffer.concat([buf, chunk]))
      for (const { opcode, payload } of frames) {
        if (opcode === CLOSE) { socket.end(frame(CLOSE, Buffer.alloc(0))); drop(); return }
        if (opcode === PING) { socket.write(frame(PONG, payload)); continue }
        if (opcode !== BINARY || payload.length === 0) continue
        if (payload[0] === SV) {
          const diff = Y.diffUpdate(boards.state(board), payload.subarray(1))
          socket.write(frame(BINARY, Buffer.concat([Buffer.from([UPDATE]), diff])))
        } else if (payload[0] === UPDATE) {
          boards.append(board, payload.subarray(1))
          broadcast(peers, socket, frame(BINARY, payload))
        } else if (payload[0] === PRESENCE) {
          try { broadcast(peers, socket, presence(id, JSON.parse(payload.subarray(1).toString()))) } catch {}
        } else if (payload[0] === AGENT) {
          let m
          try { m = JSON.parse(payload.subarray(1).toString()) } catch { continue }
          if (m && typeof m === 'object') onAgentMessage(board, peers, socket, m)
        }
      }
    })
    function drop() {
      if (!peers.delete(socket)) return
      broadcast(peers, socket, presence(id, { gone: true }))
      const agent = agentOf.get(socket)
      if (agent) {
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
      for (const room of rooms.values()) for (const s of room) s.destroy()
      return new Promise<void>((ok) => server.close(() => ok())).then(() => { boards.close(); threads.close() })
    },
  }
}
