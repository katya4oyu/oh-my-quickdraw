// `quickdraw serve`: the board's home. Serves the web page, the packages it
// imports (from wherever Node resolves them, so it runs outside this repo),
// the relay at /ws (see ../protocol.js) and link previews at /preview.
// Updates are persisted in SQLite; a state vector is answered from what is
// stored, so the board comes back even when no other peer is online.
import { existsSync, realpathSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { createServer, type Server } from 'node:http'
import { createRequire } from 'node:module'
import type { Duplex } from 'node:stream'
import { dirname, extname, join, normalize, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import * as Y from 'yjs'
import { PRESENCE, SV, UPDATE } from '../protocol.js'
import { handlePreview } from './preview.ts'
import { openUpdates } from './updates.ts'
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

export function createQuickdrawServer({ dbPath = ':memory:', compactEvery = 500 }: ServeOptions = {}) {
  const web = fileURLToPath(new URL('../../web/', import.meta.url))
  const protocol = fileURLToPath(new URL('../protocol.js', import.meta.url))
  const mounts = new Map(PACKAGES.map((name) => [name.replace('@quickdrawjs/', ''), join(packageRoot(name), 'src')]))

  function locate(pathname: string): string | null {
    if (pathname === '/protocol.js') return protocol
    const m = pathname.match(/^\/_\/([^/]+)\/src(\/.*)$/)
    if (m) {
      const root = mounts.get(m[1])
      return root ? inside(root, m[2]) : null
    }
    return inside(web.replace(/\/$/, ''), pathname.endsWith('/') ? pathname + 'index.html' : pathname)
  }

  const clients = new Set<Duplex>()
  const updates = openUpdates(dbPath, compactEvery)
  let nextId = 1
  const presence = (id: number, data: object) => frame(BINARY, Buffer.concat([Buffer.from([PRESENCE]), Buffer.from(JSON.stringify({ ...data, id }))]))
  const broadcast = (from: Duplex, out: Buffer) => { for (const peer of clients) if (peer !== from && peer.writable) peer.write(out) }

  const server: Server = createServer(async (req, res) => {
    const { pathname } = new URL(req.url ?? '/', 'http://x')
    if (pathname === '/preview') return handlePreview(req, res)
    let file: string | null = null
    try { file = locate(decodeURIComponent(pathname)) } catch {}
    if (!file) return res.writeHead(403).end()
    try {
      const body = await readFile(file)
      res.writeHead(200, { 'content-type': types[extname(file)] || 'application/octet-stream' }).end(body)
    } catch {
      res.writeHead(404).end()
    }
  })

  server.on('upgrade', (req, socket) => {
    if (new URL(req.url ?? '/', 'http://x').pathname !== '/ws' || !accept(req, socket)) return socket.destroy()
    clients.add(socket)
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
          const diff = Y.diffUpdate(updates.state(), payload.subarray(1))
          socket.write(frame(BINARY, Buffer.concat([Buffer.from([UPDATE]), diff])))
        } else if (payload[0] === UPDATE) {
          updates.append(payload.subarray(1))
          broadcast(socket, frame(BINARY, payload))
        } else if (payload[0] === PRESENCE) {
          try { broadcast(socket, presence(id, JSON.parse(payload.subarray(1).toString()))) } catch {}
        }
      }
    })
    function drop() {
      if (clients.delete(socket)) broadcast(socket, presence(id, { gone: true }))
    }
    socket.on('close', drop)
    socket.on('error', drop)
  })

  return {
    server,
    listen(port = 8795, host = '127.0.0.1') {
      return new Promise<{ port: number }>((ok) => server.listen(port, host, () => ok(server.address() as { port: number })))
    },
    close() {
      for (const s of clients) s.destroy()
      return new Promise<void>((ok) => server.close(() => ok())).then(() => updates.close())
    },
  }
}
