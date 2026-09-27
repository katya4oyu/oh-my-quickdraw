import { afterEach, describe, expect, it } from 'vitest'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import * as Y from 'yjs'
import { DatabaseSync } from 'node:sqlite'
import { importSingleBoard } from '../src/serve/boards.ts'
import { createQuickdrawServer, type ServeOptions } from '../src/serve/index.ts'
import { PRESENCE, SV, UPDATE, pack } from '../src/protocol.js'

let apps: ReturnType<typeof createQuickdrawServer>[] = []
afterEach(async () => { for (const app of apps) await app.close(); apps = [] })

async function start(opts?: ServeOptions) {
  const app = createQuickdrawServer(opts)
  apps.push(app)
  const { port } = await app.listen(0)
  const id = app.boards.list()[0]?.id ?? app.boards.create('Test').id // after a restart: the same board
  return `ws://127.0.0.1:${port}/ws/${id}`
}
const httpOf = (ws: string) => ws.replace('ws:', 'http:').replace(/\/ws\/.*/, '')

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

  it('serves the boards, their pages, the protocol and the packages the page imports, and nothing else', async () => {
    const url = await start()
    const base = httpOf(url)
    const id = url.split('/').pop()
    for (const path of ['/', `/b/${id}`, '/protocol.js', '/_/core/src/index.js', '/_/core/src/quickdraw.css', '/_/quickdraw-embed/src/index.js']) {
      expect((await fetch(base + path)).status, path).toBe(200)
    }
    for (const path of ['/b/nosuchboard', '/board.html', '/_/core/package.json', '/_/quickdraw-agent/src/index.js', '/_/core/src/%2e%2e/package.json', '/../package.json']) {
      expect((await fetch(base + path)).status, path).not.toBe(200)
    }
  })
})

describe('boards', () => {
  it('keep their own updates and peers', async () => {
    const url = await start()
    const app = apps[0]
    const other = url.replace(/[^/]+$/, app.boards.create('Other').id)
    const [a, b] = await Promise.all([open(url), open(other)])
    let crossed = false
    b.onmessage = () => { crossed = true }
    a.send(pack(UPDATE, edit(2)))
    expect(Object.keys(await fetchState(url))).toHaveLength(2)
    expect(Object.keys(await fetchState(other))).toHaveLength(0)
    expect(crossed).toBe(false)
    a.close(); b.close()
  })

  it('are made on purpose: an unknown board is refused, not created', async () => {
    const url = await start()
    await expect(open(url.replace(/[^/]+$/, 'nosuchboard'))).rejects.toBeTruthy()
    await expect(open(url.replace(/\/ws\/.*/, '/ws'))).rejects.toBeTruthy()
    expect(apps[0].boards.list()).toHaveLength(1)
  })

  it('are listed and created through the API, which takes JSON only', async () => {
    const base = httpOf(await start())
    const made = await (await fetch(base + '/api/boards', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ title: 'Sprint 12' }) })).json()
    expect(made).toMatchObject({ title: 'Sprint 12', id: expect.stringMatching(/^[a-z0-9]{10}$/) })
    expect((await (await fetch(base + '/api/boards')).json()).map((b: { title: string }) => b.title)).toEqual(['Test', 'Sprint 12'])
    expect((await fetch(base + '/api/boards/' + made.id)).status).toBe(200)
    expect((await fetch(base + '/api/boards', { method: 'POST', body: 'title=x' })).status).toBe(415) // a cross-site form
  })

  it('take in a board from before there were several, once', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'qd-import-'))
    const old = new DatabaseSync(join(dir, 'board.sqlite'))
    old.exec('CREATE TABLE updates (seq INTEGER PRIMARY KEY AUTOINCREMENT, data BLOB NOT NULL)')
    old.prepare('INSERT INTO updates (data) VALUES (?)').run(edit(3))
    old.close()
    const app = createQuickdrawServer({ dbPath: join(dir, 'boards.sqlite') })
    apps.push(app)
    const board = importSingleBoard(app.boards, join(dir, 'board.sqlite'))!
    expect(importSingleBoard(app.boards, join(dir, 'board.sqlite'))).toBeNull() // renamed: not again
    const doc = new Y.Doc()
    Y.applyUpdate(doc, app.boards.state(board.id))
    expect(doc.getMap('quickdraw').size).toBe(3)
  })
})
