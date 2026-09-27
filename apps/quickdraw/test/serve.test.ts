import { afterEach, describe, expect, it } from 'vitest'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import * as Y from 'yjs'
import { createQuickdrawServer, type ServeOptions } from '../src/serve/index.ts'
import { PRESENCE, SV, UPDATE, pack } from '../src/protocol.js'

let apps: ReturnType<typeof createQuickdrawServer>[] = []
afterEach(async () => { for (const app of apps) await app.close(); apps = [] })

async function start(opts?: ServeOptions) {
  const app = createQuickdrawServer(opts)
  apps.push(app)
  const { port } = await app.listen(0)
  return `ws://127.0.0.1:${port}/ws`
}

const open = (u: string) => new Promise<WebSocket>((ok, fail) => {
  const ws = new WebSocket(u)
  ws.binaryType = 'arraybuffer'
  ws.onopen = () => ok(ws)
  ws.onerror = fail
})
const next = (ws: WebSocket) => new Promise<Uint8Array>((ok) => { ws.onmessage = ({ data }) => ok(new Uint8Array(data)) })

// an update carrying `count` records of `size` bytes each
function edit(count = 1, size = 10, doc = new Y.Doc()) {
  const map = doc.getMap('quickdraw')
  for (let i = 0; i < count; i++) map.set(`shape:${map.size}`, { id: `shape:${map.size}`, pad: 'x'.repeat(size) })
  return Y.encodeStateAsUpdate(doc)
}

// ask the server for everything and decode it
async function fetchState(url: string) {
  const ws = await open(url)
  const got = next(ws)
  ws.send(pack(SV, Y.encodeStateVector(new Y.Doc())))
  const m = await got
  ws.close()
  expect(m[0]).toBe(UPDATE)
  const doc = new Y.Doc()
  Y.applyUpdate(doc, m.subarray(1))
  return doc.getMap('quickdraw').toJSON()
}

describe('relay', () => {
  it('forwards updates to other clients only, including large ones', async () => {
    const url = await start()
    const [a, b, c] = await Promise.all([open(url), open(url), open(url)])
    let echoed = false
    a.onmessage = () => { echoed = true }
    for (const size of [5, 300, 70000]) {
      const msg = pack(UPDATE, edit(1, size))
      const got = Promise.all([next(b), next(c)])
      a.send(msg)
      for (const m of await got) expect(m).toEqual(msg)
    }
    expect(echoed).toBe(false)
    for (const ws of [a, b, c]) ws.close()
  })

  it('answers a state vector from storage with no other peer online', async () => {
    const url = await start()
    const a = await open(url)
    a.send(pack(UPDATE, edit(2)))
    a.close()
    expect(Object.keys(await fetchState(url))).toEqual(['shape:0', 'shape:1'])
  })

  it('persists across restarts and compacts', async () => {
    const dbPath = join(mkdtempSync(join(tmpdir(), 'qd-yjs-')), 'board.sqlite')
    let url = await start({ dbPath, compactEvery: 3 })
    const a = await open(url)
    const doc = new Y.Doc()
    for (let i = 0; i < 5; i++) a.send(pack(UPDATE, edit(1, 10, doc)))
    await fetchState(url) // round trip: every update above has been stored
    a.close()
    await apps.pop()!.close()

    url = await start({ dbPath, compactEvery: 3 })
    expect(Object.keys(await fetchState(url))).toHaveLength(5)
  })

  it('relays presence tagged with the sender id, and announces disconnects', async () => {
    const url = await start()
    const [a, b] = await Promise.all([open(url), open(url)])
    const decode = (m: Uint8Array) => { expect(m[0]).toBe(PRESENCE); return JSON.parse(new TextDecoder().decode(m.subarray(1))) }
    let got = next(b)
    a.send(pack(PRESENCE, new TextEncoder().encode(JSON.stringify({ name: 'Mac', x: 1, y: 2 }))))
    const cursor = decode(await got)
    expect(cursor).toMatchObject({ name: 'Mac', x: 1, y: 2 })
    got = next(b)
    a.close()
    expect(decode(await got)).toEqual({ id: cursor.id, gone: true })
    b.close()
  })

  it('serves the page, the protocol and the packages it imports, and nothing else', async () => {
    const base = (await start()).replace('ws:', 'http:').replace('/ws', '')
    for (const path of ['/', '/protocol.js', '/_/core/src/index.js', '/_/core/src/quickdraw.css', '/_/quickdraw-embed/src/index.js']) {
      expect((await fetch(base + path)).status, path).toBe(200)
    }
    for (const path of ['/_/core/package.json', '/_/quickdraw-agent/src/index.js', '/_/core/src/%2e%2e/package.json', '/../package.json']) {
      expect((await fetch(base + path)).status, path).not.toBe(200)
    }
  })
})
