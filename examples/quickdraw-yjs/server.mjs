// Example server: serves the workspace root (so the page can import the
// vendored core and the package source without a build step) and relays
// WebSocket messages at /ws to every other client — a minimal RFC 6455
// server for unfragmented messages.
// Messages are one type byte + payload: 0 = Yjs update, 1 = state vector,
// 2 = presence (JSON, e.g. a cursor). Presence is relayed tagged with the
// sender's connection id and never stored; a disconnect relays { gone: true }.
// Updates are persisted as-is in SQLite (built-in node:sqlite) and merged
// once they pile up; a state vector is answered from what is stored, so the
// board comes back even when no other peer is online.
import { createServer } from 'node:http'
import { createHash } from 'node:crypto'
import { readFile, readdir } from 'node:fs/promises'
import { extname, join, normalize, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { DatabaseSync } from 'node:sqlite'
import * as Y from 'yjs'

const root = resolve(import.meta.dirname, '../..')
const types = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css' }
const GUID = '258EAFA5-E914-47DA-95CA-C5AB0DC85B11'
const UPDATE = 0, SV = 1, PRESENCE = 2

function frame(opcode, payload) {
  const n = payload.length
  const head = n < 126 ? Buffer.from([0x80 | opcode, n])
    : n < 65536 ? Buffer.from([0x80 | opcode, 126, n >> 8, n & 255])
    : Buffer.concat([Buffer.from([0x80 | opcode, 127]), (() => { const b = Buffer.alloc(8); b.writeBigUInt64BE(BigInt(n)); return b })()])
  return Buffer.concat([head, payload])
}

// pulls complete frames off the front of buf; returns [frames, rest]
function parse(buf) {
  const frames = []
  for (;;) {
    if (buf.length < 2) break
    const opcode = buf[0] & 15
    let len = buf[1] & 127
    let off = 2
    if (len === 126) { if (buf.length < 4) break; len = buf.readUInt16BE(2); off = 4 }
    else if (len === 127) { if (buf.length < 10) break; len = Number(buf.readBigUInt64BE(2)); off = 10 }
    const masked = buf[1] & 128
    const mask = masked ? buf.subarray(off, off + 4) : null
    if (masked) off += 4
    if (buf.length < off + len) break
    const payload = Buffer.from(buf.subarray(off, off + len))
    if (mask) for (let i = 0; i < len; i++) payload[i] ^= mask[i & 3]
    frames.push({ opcode, payload })
    buf = buf.subarray(off + len)
  }
  return [frames, buf]
}

function openStore(dbPath, compactEvery) {
  const db = new DatabaseSync(dbPath)
  db.exec('CREATE TABLE IF NOT EXISTS updates (seq INTEGER PRIMARY KEY AUTOINCREMENT, data BLOB NOT NULL)')
  const insert = db.prepare('INSERT INTO updates (data) VALUES (?)')
  const all = db.prepare('SELECT data FROM updates ORDER BY seq')
  const count = db.prepare('SELECT count(*) AS n FROM updates')
  const state = () => Y.mergeUpdates(all.all().map((r) => r.data))
  return {
    state,
    append(update) {
      insert.run(update)
      if (count.get().n < compactEvery) return
      db.exec('BEGIN')
      try {
        const merged = state()
        db.exec('DELETE FROM updates')
        insert.run(merged)
        db.exec('COMMIT')
      } catch (e) { db.exec('ROLLBACK'); throw e }
    },
    close: () => db.close(),
  }
}

export function createExampleServer({ dbPath = ':memory:', compactEvery = 500 } = {}) {
  const clients = new Set()
  const store = openStore(dbPath, compactEvery)
  let nextId = 1
  const presence = (id, data) => frame(2, Buffer.concat([Buffer.from([PRESENCE]), Buffer.from(JSON.stringify({ ...data, id }))]))
  const broadcast = (from, out) => { for (const peer of clients) if (peer !== from && peer.writable) peer.write(out) }

  const server = createServer(async (req, res) => {
    const path = normalize(decodeURIComponent(new URL(req.url, 'http://x').pathname))
    const file = join(root, path.endsWith('/') ? path + 'index.html' : path)
    if (!file.startsWith(root)) return res.writeHead(403).end()
    try {
      const body = await readFile(file)
      res.writeHead(200, { 'content-type': types[extname(file)] || 'application/octet-stream' }).end(body)
    } catch {
      res.writeHead(404).end()
    }
  })

  server.on('upgrade', (req, socket) => {
    const key = req.headers['sec-websocket-key']
    if (new URL(req.url, 'http://x').pathname !== '/ws' || !key) return socket.destroy()
    const accept = createHash('sha1').update(key + GUID).digest('base64')
    socket.write(`HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: ${accept}\r\n\r\n`)
    clients.add(socket)
    const id = nextId++
    let buf = Buffer.alloc(0)
    socket.on('data', (chunk) => {
      let frames
      ;[frames, buf] = parse(Buffer.concat([buf, chunk]))
      for (const { opcode, payload } of frames) {
        if (opcode === 8) { socket.end(frame(8, Buffer.alloc(0))); drop(); return }
        if (opcode === 9) { socket.write(frame(10, payload)); continue }
        if (opcode !== 2 || payload.length === 0) continue
        if (payload[0] === SV) {
          const diff = Y.diffUpdate(store.state(), payload.subarray(1))
          socket.write(frame(2, Buffer.concat([Buffer.from([UPDATE]), diff])))
        } else if (payload[0] === UPDATE) {
          store.append(payload.subarray(1))
          broadcast(socket, frame(2, payload))
        } else if (payload[0] === PRESENCE) {
          try { broadcast(socket, presence(id, JSON.parse(payload.subarray(1)))) } catch {}
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
    listen(port = 8080, host = '127.0.0.1') {
      return new Promise((ok) => server.listen(port, host, () => ok(server.address())))
    },
    close() {
      for (const s of clients) s.destroy()
      return new Promise((ok) => server.close(ok)).then(() => store.close())
    },
  }
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  const dbPath = process.env.DB || join(import.meta.dirname, 'board.sqlite')
  const { port } = await createExampleServer({ dbPath }).listen(Number(process.env.PORT || 8080))
  // every example is served from here; the relay is used by quickdraw-yjs and demo
  const examples = (await readdir(join(root, 'examples'), { withFileTypes: true })).filter((d) => d.isDirectory())
  for (const { name } of examples) console.log(`http://localhost:${port}/examples/${name}/`)
}
