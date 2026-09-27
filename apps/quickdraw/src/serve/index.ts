// `quickdraw serve`: the boards' home. Serves the list of boards (/), each
// board's page (/b/<id>), the packages the page imports (from wherever Node
// resolves them, so it runs outside this repo), the boards API (/api/boards),
// a relay per board (/ws/<id>, see ../protocol.js) and link previews (/preview).
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
import { PRESENCE, SV, UPDATE } from '../protocol.js'
import { handlePreview } from './preview.ts'
import { BOARD_ID, openBoards } from './boards.ts'
import { accept, BINARY, CLOSE, frame, parse, PING, PONG } from './websocket.ts'

const types: Record<string, string> = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css' }

// what the page imports, served at /_/<name>/src/…
const PACKAGES = ['@quickdrawjs/core', 'quickdraw-yjs', 'quickdraw-export', 'quickdraw-import', 'quickdraw-frames', 'quickdraw-markdown', 'quickdraw-embed', 'quickdraw-toolbar']

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
        }
      }
    })
    function drop() {
      if (!peers.delete(socket)) return
      broadcast(peers, socket, presence(id, { gone: true }))
      if (!peers.size) rooms.delete(board!)
    }
    socket.on('close', drop)
    socket.on('error', drop)
  })

  return {
    server,
    boards,
    listen(port = 8795, host = '127.0.0.1') {
      return new Promise<{ port: number }>((ok) => server.listen(port, host, () => ok(server.address() as { port: number })))
    },
    close() {
      for (const room of rooms.values()) for (const s of room) s.destroy()
      return new Promise<void>((ok) => server.close(() => ok())).then(() => boards.close())
    },
  }
}
