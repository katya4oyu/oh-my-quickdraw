import { afterEach, describe, expect, it, vi } from 'vitest'
import { mkdtempSync } from 'node:fs'
import { connect } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import * as Y from 'yjs'
import { DatabaseSync } from 'node:sqlite'
import { importSingleBoard } from '../src/serve/boards.ts'
import { isLocal } from '../src/serve/local.ts'
import { createQuickdrawServer, type ServeOptions } from '../src/serve/index.ts'
import { AGENT, LIVE, PRESENCE, SHARE, SV, UPDATE, pack, packAgent, packShare, unpackAgent, unpackShare } from '../src/protocol.js'

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

const open = (u: string, headers?: Record<string, string>) => new Promise<WebSocket>((ok, fail) => {
  const ws = headers ? new WebSocket(u, { headers } as never) : new WebSocket(u) // (Node's WebSocket takes headers)
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

// sends one message split into `parts` frames, as a browser sends a large one,
// with a ping between the first two (control frames may come between fragments)
async function sendFragmented(url: string, message: Uint8Array, parts: number) {
  const { hostname, port, pathname } = new URL(url)
  const socket = connect(Number(port), hostname)
  await new Promise((ok) => socket.once('connect', ok))
  socket.write(`GET ${pathname} HTTP/1.1\r\nHost: x\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==\r\nSec-WebSocket-Version: 13\r\n\r\n`)
  await new Promise((ok) => socket.once('data', ok))
  const size = Math.ceil(message.length / parts)
  for (let i = 0; i < parts; i++) {
    const part = message.subarray(i * size, (i + 1) * size)
    const head = Buffer.alloc(14) // a 64-bit length and a zero mask
    head[0] = (i === parts - 1 ? 0x80 : 0) | (i === 0 ? 2 : 0)
    head[1] = 0x80 | 127
    head.writeBigUInt64BE(BigInt(part.length), 2)
    socket.write(Buffer.concat([head, part]))
    if (i === 0) socket.write(Buffer.from([0x89, 0x80, 0, 0, 0, 0]))
  }
  return socket
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

  it('puts a message sent in fragments back together', async () => {
    const url = await start()
    const b = await open(url)
    const msg = pack(UPDATE, edit(1, 200_000))
    const got = next(b)
    const socket = await sendFragmented(url, msg, 3)
    expect(await got).toEqual(msg)
    socket.destroy()
    expect((await fetchState(url))['shape:0'].pad).toHaveLength(200_000)
    b.close()
  })

  it('neither keeps nor passes on an update that cannot be read', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const url = await start()
    const [a, b] = await Promise.all([open(url), open(url)])
    const got = next(b)
    a.send(pack(UPDATE, edit(1, 1000).subarray(0, 500))) // cut short
    const good = pack(UPDATE, edit(2))
    a.send(good)
    expect(await got).toEqual(good) // the first thing b hears
    expect(Object.keys(await fetchState(url))).toEqual(['shape:0', 'shape:1'])
    expect(warn).toHaveBeenCalledWith(expect.stringMatching(/ignored an update that cannot be read \(500 bytes\)/))
    warn.mockRestore()
    for (const ws of [a, b]) ws.close()
  })

  it('sets aside a stored update that cannot be read, and keeps the rest', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const dbPath = join(mkdtempSync(join(tmpdir(), 'qd-yjs-')), 'board.sqlite')
    let url = await start({ dbPath, compactEvery: 4 })
    const a = await open(url)
    const doc = new Y.Doc()
    a.send(pack(UPDATE, edit(1, 10, doc)))
    await fetchState(url)
    a.close()
    await apps.pop()!.close()
    // as a truncated update got stored before: the server would not start again
    const db = new DatabaseSync(dbPath)
    db.prepare('INSERT INTO updates (board, data) SELECT board, ? FROM updates LIMIT 1').run(edit(1, 1000).subarray(0, 500))
    db.close()

    url = await start({ dbPath, compactEvery: 4 })
    const b = await open(url)
    b.send(pack(UPDATE, edit(1, 10, doc))) // compacts (three stored)
    b.send(pack(UPDATE, edit(1, 10, doc)))
    expect(Object.keys(await fetchState(url))).toEqual(['shape:0', 'shape:1', 'shape:2'])
    b.close()
    await apps.pop()!.close()
    const check = new DatabaseSync(dbPath)
    expect(check.prepare('SELECT count(*) AS n FROM broken_updates').get()).toEqual({ n: 1 })
    expect((check.prepare('SELECT data FROM broken_updates').get() as { data: Uint8Array }).data).toHaveLength(500)
    check.close()
    expect(warn).toHaveBeenCalledWith(expect.stringMatching(/set aside update \d+ \(500 bytes\)/))
    warn.mockRestore()
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

  it('tells a page who is here already when it connects, and forgets whoever left', async () => {
    const url = await start()
    const decode = (m: Uint8Array) => { expect(m[0]).toBe(PRESENCE); return JSON.parse(new TextDecoder().decode(m.subarray(1))) }
    const [a, b] = await Promise.all([open(url), open(url)])
    let got = next(b)
    a.send(pack(PRESENCE, new TextEncoder().encode(JSON.stringify({ name: 'Mac', x: 1, y: 2 }))))
    const first = decode(await got)
    got = next(b)
    a.send(pack(PRESENCE, new TextEncoder().encode(JSON.stringify({ name: 'Ann', status: 'away', x: 3, y: 4 }))))
    await got
    // a page coming later hears the latest, without waiting for a move
    const c = await open(url)
    expect(decode(await next(c))).toEqual({ name: 'Ann', status: 'away', x: 3, y: 4, id: first.id })
    got = next(b)
    a.close()
    await got
    const d = await open(url)
    let heard = false
    d.onmessage = ({ data }) => { if (new Uint8Array(data as ArrayBuffer)[0] === PRESENCE) heard = true }
    await fetchState(url) // a round trip
    expect(heard).toBe(false)
    for (const ws of [b, c, d]) ws.close()
  })

  it('serves the boards, their pages, the protocol and the packages the page imports, and nothing else', async () => {
    const url = await start()
    const base = httpOf(url)
    const id = url.split('/').pop()
    for (const path of ['/', `/b/${id}`, '/protocol.js', '/_/core/src/index.js', '/_/core/src/quickdraw.css', '/_/quickdraw-embed/src/index.js', '/_/quickdraw-agent/src/panel.js', '/versions.js']) {
      expect((await fetch(base + path)).status, path).toBe(200)
    }
    for (const path of ['/b/nosuchboard', '/board.html', '/_/core/package.json', '/_/core/src/%2e%2e/package.json', '/../package.json']) {
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

// AGENT messages to a connection, in order; `take(kind)` waits for the next of that kind
function agentInbox(ws: WebSocket) {
  const got: any[] = []
  const waiting: [string, (m: any) => void][] = []
  ws.addEventListener('message', ({ data }) => {
    const m = new Uint8Array(data)
    if (m[0] !== AGENT) return
    const msg = unpackAgent(m)
    const i = waiting.findIndex(([kind]) => kind === msg.kind)
    if (i >= 0) waiting.splice(i, 1)[0][1](msg)
    else got.push(msg)
  })
  return {
    take(kind: string): Promise<any> {
      const i = got.findIndex((m) => m.kind === kind)
      if (i >= 0) return Promise.resolve(got.splice(i, 1)[0])
      return new Promise((ok) => waiting.push([kind, ok]))
    },
    has: (kind: string) => got.some((m) => m.kind === kind),
  }
}
const request = (id: string, to = 'board-ai') => ({ id, to, text: 'Sort these', context: { shapeIds: [], frameIds: [], viewport: { x: 0, y: 0, w: 1, h: 1 } }, anchor: {} })

describe('agents', () => {
  async function setup(opts?: ServeOptions) {
    const url = await start(opts)
    const page = await open(url), agent = await open(url)
    const pageIn = agentInbox(page), agentIn = agentInbox(agent)
    page.send(packAgent({ kind: 'hello' }))
    expect((await pageIn.take('agents')).agents).toEqual([])
    agent.send(packAgent({ kind: 'join', agent: { id: 'board-ai', name: 'Board AI', knows: ['This board'] } }))
    expect((await agentIn.take('joined')).id).toBe('board-ai')
    expect((await pageIn.take('agents')).agents).toEqual([{ id: 'board-ai', name: 'Board AI', knows: ['This board'], status: 'idle' }])
    return { url, page, agent, pageIn, agentIn }
  }

  it('lists the agents on a board, and drops one that leaves', async () => {
    const { page, agent, pageIn } = await setup()
    agent.send(packAgent({ kind: 'status', status: 'working' }))
    expect((await pageIn.take('agents')).agents[0].status).toBe('working')
    agent.close()
    expect((await pageIn.take('agents')).agents).toEqual([])
    page.close()
  })

  it('takes a request to its agent and the agent\'s events to every page, and keeps the thread', async () => {
    const dbPath = join(mkdtempSync(join(tmpdir(), 'qd-agent-')), 'board.sqlite')
    const { url, page, agent, pageIn, agentIn } = await setup({ dbPath })
    const other = await open(url)
    const otherIn = agentInbox(other)
    other.send(packAgent({ kind: 'hello' }))
    await otherIn.take('threads')

    page.send(packAgent({ kind: 'request', request: request('r1') }))
    expect((await agentIn.take('request')).request.id).toBe('r1')
    expect((await otherIn.take('thread')).thread.request.id).toBe('r1') // started on another device

    agent.send(packAgent({ kind: 'event', event: { type: 'op', requestId: 'r1', op: 'op:1', diff: { records: [] }, ids: ['shape:f'] } }))
    agent.send(packAgent({ kind: 'event', event: { type: 'done', requestId: 'r1' } }))
    for (const inbox of [pageIn, otherIn]) {
      expect((await inbox.take('event')).event.type).toBe('op')
      expect((await inbox.take('event')).event.type).toBe('done')
    }

    // a person's reply comes back to every page, the sender too, and goes to the agent
    page.send(packAgent({ kind: 'reply', requestId: 'r1', message: 'Thanks' }))
    expect((await pageIn.take('event')).event).toEqual({ type: 'reply', requestId: 'r1', text: 'Thanks' })
    expect((await agentIn.take('reply')).message).toBe('Thanks')
    // an approval goes to the agent only; an undo is kept
    page.send(packAgent({ kind: 'reply', requestId: 'r1', message: { approval: 'a1', allow: true } }))
    expect((await agentIn.take('reply')).message).toEqual({ approval: 'a1', allow: true })
    page.send(packAgent({ kind: 'reply', requestId: 'r1', message: { undo: { reverted: 1, skipped: [] } } }))
    expect((await otherIn.take('event')).event.type).toBe('reply')
    expect((await otherIn.take('event')).event).toMatchObject({ type: 'undo', reverted: 1 })

    for (const ws of [page, agent, other]) ws.close()
    await apps.pop()!.close()

    // after a restart, a page gets the thread as it was
    const again = await open(await start({ dbPath }))
    const againIn = agentInbox(again)
    again.send(packAgent({ kind: 'hello' }))
    const [thread] = (await againIn.take('threads')).threads
    expect(thread).toMatchObject({ status: 'done', diffs: [], undoResult: { reverted: 1, skipped: [] }, request: { id: 'r1', anchor: { shapeId: 'shape:f' } } })
    expect(thread.events.map((e: { type: string }) => e.type)).toEqual(['op', 'done', 'reply', 'undo'])
    again.close()
  })

  it('lets only this computer ask an agent or answer it, unless the agent allows anyone', async () => {
    const { url, page, pageIn, agentIn } = await setup()
    expect((await pageIn.take('you')).local).toBe(true)
    // through `tailscale serve`: from 127.0.0.1 too, but proxied
    const remote = await open(url, { 'tailscale-user-login': 'someone@example.com', 'x-forwarded-for': '100.64.0.2' })
    const remoteIn = agentInbox(remote)
    remote.send(packAgent({ kind: 'hello' }))
    expect((await remoteIn.take('you')).local).toBe(false)
    await remoteIn.take('threads')

    remote.send(packAgent({ kind: 'request', request: request('far') }))
    expect((await remoteIn.take('event')).event).toMatchObject({ type: 'error', requestId: 'far', message: expect.stringMatching(/only from the computer running quickdraw serve/) })
    page.send(packAgent({ kind: 'request', request: request('near') }))
    expect((await agentIn.take('request'))).toMatchObject({ request: { id: 'near' }, local: true }) // not 'far': it never got there
    expect(pageIn.has('thread') || (await remoteIn.take('thread')).thread.request.id === 'near').toBe(true)
    // nor its replies or approvals; a person here may
    remote.send(packAgent({ kind: 'reply', requestId: 'near', message: { approval: 'a1', allow: true } }))
    expect((await remoteIn.take('event')).event).toMatchObject({ type: 'error', requestId: 'near' })
    page.send(packAgent({ kind: 'reply', requestId: 'near', message: { approval: 'a1', allow: false } }))
    expect((await agentIn.take('reply'))).toMatchObject({ message: { approval: 'a1', allow: false }, local: true })

    // an agent started with --allow-remote takes them from anyone, and says whom from
    const open2 = await open(url)
    const openIn = agentInbox(open2)
    open2.send(packAgent({ kind: 'join', agent: { id: 'anyone', name: 'Anyone', remote: true } }))
    await openIn.take('joined')
    let listed: any
    while (!(listed = (await remoteIn.take('agents')).agents.find((a: any) => a.id === 'anyone')));
    expect(listed).toMatchObject({ remote: true })
    remote.send(packAgent({ kind: 'request', request: request('far2', 'anyone') }))
    expect(await openIn.take('request')).toMatchObject({ request: { id: 'far2' }, local: false })
    for (const ws of [page, remote, open2]) ws.close()
  })

  it('connects a call between the page that asks to talk and an agent that talks, and nobody else', async () => {
    const { url, page, agent, pageIn, agentIn } = await setup()
    // an agent that does not talk is not asked
    page.send(packAgent({ kind: 'request', request: request('mute'), sdp: 'v=offer' }))
    expect(await pageIn.take('voice')).toEqual({ kind: 'voice', requestId: 'mute', end: 'That agent does not talk.' })
    expect(agentIn.has('request')).toBe(false)

    const talker = await open(url)
    const talkerIn = agentInbox(talker)
    talker.send(packAgent({ kind: 'join', agent: { id: 'talker', name: 'Talker', voice: true } }))
    await talkerIn.take('joined')
    let listed
    while (!(listed = (await pageIn.take('agents')).agents.find((a: any) => a.id === 'talker')));
    expect(listed).toMatchObject({ voice: true })
    const other = await open(url)
    const otherIn = agentInbox(other)
    other.send(packAgent({ kind: 'hello' }))
    await otherIn.take('threads')

    page.send(packAgent({ kind: 'request', request: request('call', 'talker'), sdp: 'v=offer' }))
    expect(await talkerIn.take('request')).toMatchObject({ request: { id: 'call', voice: true }, sdp: 'v=offer', local: true })
    const { thread } = await otherIn.take('thread')
    expect(thread.request.voice).toBe(true)
    expect(JSON.stringify(thread)).not.toContain('v=offer') // the offer is not kept
    // the answer to the page that asked only; what the person said, to every page
    talker.send(packAgent({ kind: 'voice', requestId: 'call', sdp: 'v=answer' }))
    expect(await pageIn.take('voice')).toEqual({ kind: 'voice', requestId: 'call', sdp: 'v=answer' })
    talker.send(packAgent({ kind: 'event', event: { type: 'reply', requestId: 'call', text: 'Sort these' } }))
    expect((await otherIn.take('event')).event).toEqual({ type: 'reply', requestId: 'call', text: 'Sort these' })
    expect(otherIn.has('voice')).toBe(false)
    // an agent's `reply` outside a call is not kept
    agent.send(packAgent({ kind: 'event', event: { type: 'reply', requestId: 'mute', text: 'x' } }))
    // someone else cannot hang up; the page that talks can, and closing it does too
    other.send(packAgent({ kind: 'voice', requestId: 'call', stop: true }))
    page.send(packAgent({ kind: 'voice', requestId: 'call', stop: true }))
    expect(await talkerIn.take('voice')).toEqual({ kind: 'voice', requestId: 'call', stop: true })
    expect(talkerIn.has('voice')).toBe(false)
    page.close()
    expect(await talkerIn.take('voice')).toEqual({ kind: 'voice', requestId: 'call', stop: true })
    talker.send(packAgent({ kind: 'voice', requestId: 'call', end: 'requested' })) // too late: the call is gone
    talker.send(packAgent({ kind: 'event', event: { type: 'done', requestId: 'call' } }))
    expect((await otherIn.take('event')).event.type).toBe('done')
    expect(otherIn.has('event')).toBe(false) // not the stray reply
    for (const ws of [agent, talker, other]) ws.close()
  })

  it('knows a connection from this computer from a proxied one, another site, or a DNS name that points here', () => {
    const req = (headers: Record<string, string>, remoteAddress = '127.0.0.1') => ({ headers, socket: { remoteAddress } })
    expect(isLocal(req({ host: '127.0.0.1:8795' }))).toBe(true) // the CLI: no Origin
    expect(isLocal(req({ host: 'localhost:8795', origin: 'http://localhost:8795' }))).toBe(true) // its page
    expect(isLocal(req({ host: '[::1]:8795', origin: 'http://[::1]:8795' }, '::1'))).toBe(true)
    expect(isLocal(req({ host: 'localhost:8795', origin: 'https://evil.example' }))).toBe(false) // another site in this browser
    expect(isLocal(req({ host: 'evil.example:8795', origin: 'http://evil.example:8795' }))).toBe(false) // DNS rebinding
    expect(isLocal(req({ host: 'localhost:8795', 'x-forwarded-for': '100.64.0.2' }))).toBe(false) // a proxy
    expect(isLocal(req({ host: 'mac.tailnet.ts.net', 'tailscale-user-login': 'a@b.c' }))).toBe(false) // tailscale serve
    expect(isLocal(req({ host: '192.168.1.5:8795' }, '192.168.1.9'))).toBe(false) // served on the LAN (--host 0.0.0.0)
  })

  it('refuses events from an agent a request was not to, and says when no agent is there', async () => {
    const { url, page, agent, pageIn } = await setup()
    const intruder = await open(url)
    intruder.send(packAgent({ kind: 'join', agent: { id: 'board-ai', name: 'Other' } }))
    expect((await agentInbox(intruder).take('joined')).id).toBe('board-ai-2')

    page.send(packAgent({ kind: 'request', request: request('r2') }))
    intruder.send(packAgent({ kind: 'event', event: { type: 'message', requestId: 'r2', text: 'not mine' } }))
    agent.send(packAgent({ kind: 'event', event: { type: 'message', requestId: 'r2', text: 'mine' } }))
    expect((await pageIn.take('event')).event.text).toBe('mine')

    page.send(packAgent({ kind: 'request', request: request('r3', 'nobody') }))
    expect((await pageIn.take('event')).event).toMatchObject({ type: 'error', requestId: 'r3' })

    // an agent that leaves mid-request says so in the thread
    page.send(packAgent({ kind: 'request', request: request('r4') }))
    await new Promise((r) => setTimeout(r, 50))
    agent.close()
    const left = [(await pageIn.take('event')).event, (await pageIn.take('event')).event]
    expect(left.map((e) => e.requestId).sort()).toEqual(['r2', 'r4']) // both unfinished
    expect(left[0]).toMatchObject({ type: 'error', message: 'Board AI left the board.' })
    for (const ws of [page, intruder]) ws.close()
  })
})

describe('managing boards', () => {
  const send = (base: string, method: string, path: string, body?: object) =>
    fetch(base + path, { method, headers: { 'content-type': 'application/json' }, body: body && JSON.stringify(body) }).then(async (r) => ({ status: r.status, body: await r.json() }))
  const note = (id: string, text: string) => ({ id, typeName: 'shape', type: 'note', x: 0, y: 0, rot: 0, z: 1, props: { text, color: 'yellow', size: 'm', font: 'draw', scale: 1 } })

  it('renames, archives and brings back, copies, and makes a board from a JSON file', async () => {
    const url = await start()
    const base = httpOf(url), id = url.split('/').pop()!
    const a = await open(url)
    a.send(pack(UPDATE, edit(2)))
    await new Promise((r) => setTimeout(r, 50))

    expect((await send(base, 'PATCH', `/api/boards/${id}`, { title: 'Ideas' })).body.title).toBe('Ideas')
    const copy = (await send(base, 'POST', '/api/boards', { from: id })).body
    expect(copy.title).toBe('Ideas (copy)')
    expect(Object.keys(await fetchState(url.replace(id, copy.id)))).toEqual(['shape:0', 'shape:1'])

    expect((await send(base, 'PATCH', `/api/boards/${id}`, { archived: true })).body.archivedAt).toBeTruthy()
    expect((await send(base, 'GET', '/api/boards')).body.map((b: { id: string }) => b.id)).toEqual([copy.id])
    expect((await send(base, 'GET', '/api/boards?archived=1')).body.map((b: { id: string }) => b.id)).toEqual([id])
    expect((await send(base, 'GET', `/b/${id}`.replace('/b/', '/api/boards/'))).status).toBe(200) // still there
    await send(base, 'PATCH', `/api/boards/${id}`, { archived: false })

    const file = { quickdraw: 1, shapes: [note('shape:n', 'From a file')], assets: {} }
    const made = (await send(base, 'POST', '/api/boards', { title: 'From file', file })).body
    expect(made.title).toBe('From file')
    expect((await fetchState(url.replace(id, made.id)))['shape:n'].props.text).toBe('From a file')
    expect((await send(base, 'POST', '/api/boards', { file: { nope: 1 } })).status).toBe(400)
    a.close()
  })

  it('keeps versions, restores one over the board for everyone on it, or opens it as a board', async () => {
    const url = await start()
    const base = httpOf(url), id = url.split('/').pop()!
    const doc = new Y.Doc()
    const a = await open(url), b = await open(url)
    a.send(pack(UPDATE, edit(1, 10, doc)))
    await new Promise((r) => setTimeout(r, 50))
    const v1 = (await send(base, 'POST', `/api/boards/${id}/versions`, { name: 'One note' })).body
    a.send(pack(UPDATE, edit(2, 10, doc))) // two more
    await new Promise((r) => setTimeout(r, 50))
    expect(Object.keys(await fetchState(url))).toHaveLength(3)

    // a peer on the board gets the restore as an update
    const got = new Promise<Uint8Array>((ok) => { b.onmessage = ({ data }) => { const m = new Uint8Array(data); if (m[0] === UPDATE) ok(m) } })
    expect((await send(base, 'POST', `/api/boards/${id}/versions/${v1.id}/restore`, { as: 'board' })).status).toBe(200)
    const m = await got
    expect(m[0]).toBe(UPDATE)
    Y.applyUpdate(doc, m.subarray(1))
    expect(Object.keys(doc.getMap('quickdraw').toJSON())).toEqual(['shape:0'])
    expect(Object.keys(await fetchState(url))).toEqual(['shape:0'])

    const versions = (await send(base, 'GET', `/api/boards/${id}/versions`)).body
    expect(versions.map((v: { name: string, auto: boolean }) => [v.name, v.auto])).toEqual([['Before restoring', true], ['One note', false]])
    const back = versions[0] // the three notes, before the restore
    const opened = (await send(base, 'POST', `/api/boards/${id}/versions/${back.id}/restore`, { as: 'new' })).body
    expect(Object.keys(await fetchState(url.replace(id, opened.id)))).toHaveLength(3)
    expect((await send(base, 'POST', `/api/boards/${id}/versions/9999/restore`, { as: 'board' })).status).toBe(404)
    a.close(); b.close()
  })

  it('keeps a version before each AI request, and counts the agents on a board', async () => {
    const url = await start()
    const base = httpOf(url), id = url.split('/').pop()!
    const page = await open(url), agent = await open(url)
    const agentIn = agentInbox(agent)
    agent.send(packAgent({ kind: 'join', agent: { id: 'ai', name: 'AI' } }))
    await agentIn.take('joined')
    expect((await send(base, 'GET', '/api/boards')).body[0].agents).toBe(1)
    page.send(packAgent({ kind: 'request', request: request('r1', 'ai') }))
    await agentIn.take('request')
    expect((await send(base, 'GET', `/api/boards/${id}/versions`)).body.map((v: { name: string }) => v.name)).toEqual(['Before AI: Sort these'])
    page.close(); agent.close()
  })
})

describe('thumbnails', () => {
  it('keeps the picture a page sends of its board, and lists when it was made', async () => {
    const url = await start()
    const base = httpOf(url), id = url.split('/').pop()!
    expect((await fetch(`${base}/api/boards/${id}/thumbnail`)).status).toBe(404)
    const jpeg = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3])
    expect((await fetch(`${base}/api/boards/${id}/thumbnail`, { method: 'PUT', headers: { 'content-type': 'image/jpeg' }, body: jpeg })).status).toBe(204)
    const r = await fetch(`${base}/api/boards/${id}/thumbnail`)
    expect([r.status, r.headers.get('content-type')]).toEqual([200, 'image/jpeg'])
    expect(new Uint8Array(await r.arrayBuffer())).toEqual(jpeg)
    const [listed] = await (await fetch(`${base}/api/boards`)).json()
    expect(listed.thumbnailAt).toBeTruthy()
    expect((await fetch(`${base}/api/boards/${id}/thumbnail`, { method: 'PUT', headers: { 'content-type': 'text/html' }, body: '<b>' })).status).toBe(415)
    expect((await fetch(`${base}/api/boards/${id}/thumbnail`, { method: 'PUT', headers: { 'content-type': 'image/png' }, body: new Uint8Array(600_000) })).status).toBe(413)
    expect((await fetch(`${base}/api/boards/nosuchboard/thumbnail`)).status).toBe(404)
  })
})

describe('screen sharing', () => {
  // SHARE messages and LIVE frames to a connection, in order
  function shareInbox(ws: WebSocket) {
    const got: any[] = []
    const wake = new Set<() => void>()
    ws.addEventListener('message', ({ data }) => {
      const m = new Uint8Array(data)
      if (m[0] === SHARE) got.push(unpackShare(m))
      else if (m[0] === LIVE) got.push({ kind: 'frame', data: [...m.subarray(1)] })
      else return
      for (const fn of wake) fn()
    })
    const until = (test: () => unknown) => new Promise<void>((ok) => {
      const check = () => { if (test()) { wake.delete(check); ok() } }
      wake.add(check)
      check()
    })
    return { got, until, last: (kind: string) => got.filter((m) => m.kind === kind).at(-1) }
  }

  it('has one sharer per board, sends its frames to the others, its snapshots asked of it, and ends when it leaves', async () => {
    const url = await start()
    const [ann, bo, cy] = await Promise.all([open(url), open(url), open(url)])
    const [a, b, c] = [ann, bo, cy].map(shareInbox)
    for (const ws of [ann, bo]) ws.send(packAgent({ kind: 'hello' }))
    await a.until(() => a.last('sharing'))
    expect(a.last('sharing')).toEqual({ kind: 'sharing', sharer: null, mine: false })

    ann.send(packShare({ kind: 'start', name: 'Ann' }))
    await b.until(() => b.last('sharing')?.sharer)
    expect(b.last('sharing')).toEqual({ kind: 'sharing', sharer: { name: 'Ann' }, mine: false })
    await a.until(() => a.last('sharing')?.mine)

    // frames: from the sharer only, to the others (and not back to it)
    ann.send(pack(LIVE, new Uint8Array([1, 2, 3])))
    bo.send(pack(LIVE, new Uint8Array([9]))) // not the sharer: dropped
    await b.until(() => b.last('frame'))
    await c.until(() => c.last('frame')) // a page that never said hello still watches
    expect(b.got.filter((m) => m.kind === 'frame')).toEqual([{ kind: 'frame', data: [1, 2, 3] }])
    expect(a.last('frame')).toBeUndefined()

    // a snapshot asked by someone else goes to the sharer
    bo.send(packShare({ kind: 'snap', by: 'Bo' }))
    await a.until(() => a.last('snap'))
    expect(a.last('snap')).toEqual({ kind: 'snap', by: 'Bo' })

    // someone else takes over; the one before is told it no longer shares
    bo.send(packShare({ kind: 'start', name: 'Bo' }))
    await a.until(() => a.last('sharing')?.sharer?.name === 'Bo')
    expect(a.last('sharing').mine).toBe(false)
    ann.send(packShare({ kind: 'stop' })) // not the sharer any more: nothing happens
    // leaving ends it
    bo.close()
    await a.until(() => a.last('sharing')?.sharer === null)
    for (const ws of [ann, cy]) ws.close()
  })
})
