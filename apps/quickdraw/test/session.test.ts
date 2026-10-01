import { describe, it, expect, afterEach } from 'vitest'
import { existsSync, mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { runOp } from 'quickdraw-agent'
import { openBoard } from '../src/board/open.ts'
import { main } from '../src/commands/index.ts'
import { createQuickdrawServer } from '../src/serve/index.ts'
import { startSession } from '../src/session/daemon.ts'
import { sessionFile } from '../src/session/client.ts'
import { AGENT, PRESENCE, packAgent, packPresence, unpackAgent, unpackPresence } from '../src/protocol.js'

// a page's side of the AI panel: what the server sends it, taken by kind
function pageOf(ws: WebSocket) {
  const got: any[] = []
  const waiting: [(m: any) => boolean, (m: any) => void][] = []
  ws.addEventListener('message', ({ data }) => {
    const m = new Uint8Array(data)
    if (m[0] !== AGENT) return
    const msg = unpackAgent(m)
    const i = waiting.findIndex(([ok]) => ok(msg))
    if (i >= 0) waiting.splice(i, 1)[0][1](msg)
    else got.push(msg)
  })
  const take = (ok: (m: any) => boolean): Promise<any> => {
    const i = got.findIndex(ok)
    if (i >= 0) return Promise.resolve(got.splice(i, 1)[0])
    return new Promise((resolve) => waiting.push([ok, resolve]))
  }
  return { take, event: (type: string) => take((m) => m.kind === 'event' && m.event.type === type).then((m) => m.event) }
}
const request = (id: string, to: string, extra = {}) => ({ id, to, text: 'Put a note here', context: { shapeIds: [], frameIds: [], viewport: { x: 0, y: 0, w: 800, h: 600 } }, anchor: { x: 10, y: 10 }, ...extra })

describe('a session: an agent with a shell, on the board', () => {
  let app: ReturnType<typeof createQuickdrawServer> | undefined
  let session: Awaited<ReturnType<typeof startSession>> | undefined
  const home = process.cwd()
  afterEach(async () => { await session?.close(); session = undefined; process.chdir(home); await app?.close() })

  async function setup(idle?: number) {
    app = createQuickdrawServer()
    const { port } = await app.listen(0)
    const url = `ws://127.0.0.1:${port}/ws/${app.boards.create('Live').id}`
    const dir = mkdtempSync(join(tmpdir(), 'qd-session-'))
    process.chdir(dir)
    process.env.QUICKDRAW_LOG = join(dir, 'log.jsonl')
    session = await startSession({ url, name: 'Claude', cwd: dir, idle })
    const ws = new WebSocket(url)
    ws.binaryType = 'arraybuffer'
    await new Promise((ok) => (ws.onopen = ok))
    const page = pageOf(ws)
    ws.send(packAgent({ kind: 'hello' }))
    const agents = (await page.take((m) => m.kind === 'agents' && m.agents.length)).agents
    const run = async (...args: string[]) => { const lines: string[] = []; await main(args, (l) => { lines.push(l) }); return lines.map((l) => JSON.parse(l)) }
    return { url, dir, ws, page, agents, run }
  }

  it('is in the AI panel, takes a request, draws in its thread, talks and finishes', async () => {
    const { ws, page, agents, run, dir } = await setup()
    expect(agents).toMatchObject([{ name: 'Claude', status: 'idle' }])
    expect(existsSync(sessionFile(dir))).toBe(true)

    ws.send(packAgent({ kind: 'request', request: request('r1', agents[0].id) }))
    const [got] = await run('next', '--timeout', '5')
    expect(got).toMatchObject({ type: 'request', id: 'r1', text: 'Put a note here', changes: { added: [], changed: [], removed: [] } })

    const [made] = await run('note', 'Hello')
    expect(made.ids).toHaveLength(1)
    const op = await page.event('op')
    expect(op).toMatchObject({ requestId: 'r1', ids: made.ids })
    expect(Object.keys(op.diff.added)).toContain(made.ids[0]) // the panel can undo it
    // the thread says what it did, a line a change, as it goes
    expect(await page.take((m) => m.kind === 'event' && m.event.type === 'progress' && /^Added/.test(m.event.text)).then((m) => m.event.text)).toBe('Added note "Hello"')

    // a person answers while it works: the next result says so, and next gives it
    ws.send(packAgent({ kind: 'reply', requestId: 'r1', message: 'And a blue one' }))
    await new Promise((r) => setTimeout(r, 100))
    const [again] = await run('note', 'Blue', '--color', 'blue')
    expect(again.inbox).toMatchObject({ reply: 1 })
    expect((await run('next'))[0]).toEqual({ type: 'reply', request: 'r1', text: 'And a blue one' })

    await run('say', 'Added two notes')
    expect(await page.event('message')).toMatchObject({ requestId: 'r1', text: 'Added two notes' })
    await run('finish', 'Two notes')
    expect(await page.event('done')).toMatchObject({ requestId: 'r1', text: 'Two notes' })
    // its ticket for the request: up at its first note, done with it
    const [ticket] = (await run('tickets')).flat().filter((t: any) => t?.work?.request === 'r1')
    expect(ticket).toMatchObject({ title: 'Put a note here', status: 'done', by: 'Claude', result: 'Two notes' })
    ws.close()
  }, 20_000)

  it('sees who is here and what changed, gets tickets and Stop, and waits no longer than asked', async () => {
    const { url, ws, agents, run } = await setup()
    ws.send(packPresence({ name: 'Ann', color: '#e03131', x: 100, y: 120, view: { x: 0, y: 0, w: 800, h: 600 } }))
    const person = await openBoard({ url, name: 'Ann' })
    person.store.put({ id: 'shape:ann', typeName: 'shape', type: 'note', x: 40, y: 40, rot: 0, z: 1, props: { text: 'From Ann', color: 'yellow', size: 'm', font: 'draw', scale: 1 } } as never)
    await new Promise((r) => setTimeout(r, 200))

    const [who] = await run('who')
    expect(who.you).toBe('Claude')
    expect(who.here).toContainEqual(expect.objectContaining({ name: 'Ann', agent: false, cursor: { x: 100, y: 120 } }))
    const [changes] = await run('changes')
    expect(changes.added).toEqual([{ id: 'shape:ann', type: 'note', text: 'From Ann', by: 'people' }])
    expect((await run('changes'))[0].added).toEqual([]) // seen now

    const { result: ticket } = runOp(person.store, 'Ann', (ops) => ops.ticket('Tidy the board'))
    const [t] = await run('next', '--timeout', '5')
    expect(t).toMatchObject({ type: 'ticket', ticket: { id: ticket, title: 'Tidy the board', status: 'todo' } })

    ws.send(packAgent({ kind: 'request', request: request('r2', agents[0].id) }))
    await run('next', '--timeout', '5')
    ws.send(packAgent({ kind: 'reply', requestId: 'r2', message: { stop: true } }))
    expect((await run('next', '--timeout', '5'))[0]).toMatchObject({ type: 'stop', request: 'r2' })

    const t0 = Date.now()
    expect((await run('next', '--timeout', '0.3'))[0]).toEqual({ type: null, timeout: true })
    expect(Date.now() - t0).toBeLessThan(2000)
    await person.close()
    ws.close()
  }, 20_000)

  it('gets a request when another agent writes a note that mentions it', async () => {
    const { url, page, run, dir } = await setup()
    // another agent (a command from another directory, by the same person) writes the note
    process.chdir(mkdtempSync(join(tmpdir(), 'qd-other-')))
    const lines: string[] = []
    await main(['note', '@Claude sort these ideas', '--board', url, '--name', 'Codex'], (l) => { lines.push(l) })
    const [note] = JSON.parse(lines[0]).ids
    process.chdir(dir)
    const [got] = await run('next', '--timeout', '5')
    expect(got).toMatchObject({ type: 'request', text: 'sort these ideas', from: 'Codex', about: [{ id: note, type: 'note' }] })
    expect((await page.take((m) => m.kind === 'thread')).thread.request.from).toBe('Codex') // people see who asked
    // and what the session itself writes to itself does not ask it
    await run('note', '@Claude not me')
    expect((await run('next', '--timeout', '0.3'))[0]).toMatchObject({ type: null })
  }, 20_000)

  it('points with the laser (everyone sees it, then it fades) and marks with the pen', async () => {
    const { ws, run } = await setup()
    const seen: any[] = []
    ws.addEventListener('message', ({ data }) => { const m = new Uint8Array(data); if (m[0] === PRESENCE) seen.push(unpackPresence(m)) })
    const [n] = await run('note', 'this one', '--at', '400,300')
    expect(await run('point', n.ids[0], '--circle')).toEqual([{ pointed: n.ids[0] }])
    await new Promise((r) => setTimeout(r, 100))
    const lasers = seen.filter((p) => p.name === 'Claude' && p.laser)
    expect(Math.max(...lasers.map((p) => p.laser[0]?.points.length ?? 0))).toBeGreaterThan(30) // drawn a little at a time, all the way round
    expect(lasers.at(-1).laser).toEqual([]) // then gone
    const [ring] = await run('pen', 'circle', n.ids[0])
    const d = (await run('read', '--format', 'json'))[0]
    expect(d.items.find((i: any) => i.id === ring.ids[0])).toMatchObject({ type: 'draw', by: 'Claude' })
  }, 20_000)

  it('hears of a ticket again when a person gives it to it, and is working while it holds one', async () => {
    const { url, page, run } = await setup()
    const [left] = await run('ticket', 'Tidy the board') // left for any agent, by itself: not news to it
    expect((await run('next', '--timeout', '0.3'))[0]).toMatchObject({ type: null })
    const person = await openBoard({ url, name: 'Ann' })
    person.store.update(left.ids[0], { props: { to: 'Claude' }, edited: { by: 'Ann', at: Date.now() } } as never) // Ann gives it to Claude (her page marks the edit)
    const [got] = await run('next', '--timeout', '5')
    expect(got).toMatchObject({ type: 'ticket', ticket: { id: left.ids[0], to: 'Claude' }, made_by: 'Claude', changed_by: 'Ann' }) // for asking the one who started it
    await run('take', left.ids[0])
    expect((await page.take((m) => m.kind === 'agents' && m.agents[0]?.status === 'working')).agents[0].status).toBe('working')
    await run('done', left.ids[0], '--result', 'Tidied')
    expect((await page.take((m) => m.kind === 'agents' && m.agents[0]?.status === 'idle')).agents[0].status).toBe('idle')
    await person.close()
  }, 20_000)

  it('waits with wait: its cursor stays by the people, ready for a request; --take takes a ticket', async () => {
    const { url, ws, run } = await setup()
    const seen: any[] = []
    ws.addEventListener('message', ({ data }) => { const m = new Uint8Array(data); if (m[0] === PRESENCE) seen.push(unpackPresence(m)) })
    ws.send(packPresence({ name: 'Ann', color: '#e03131', x: 1000, y: 500 })) // Ann is here
    expect((await run('wait', '--timeout', '1.5'))[0]).toEqual({ type: null, timeout: true })
    const mine = seen.filter((p) => p.name === 'Claude' && p.x != null)
    expect(mine.length).toBeGreaterThan(0)
    const after = seen.slice(seen.indexOf(mine[0])).filter((p) => p.name === 'Claude')
    expect(after.every((p) => p.x != null)).toBe(true) // it stays: no blinking out while it waits
    const last = mine.at(-1)
    expect(Math.hypot(last.x - 1090, last.y - 560)).toBeLessThan(60) // beside Ann, not on her
    expect(seen.some((p) => p.name === 'Claude' && p.agentActivity === 'available')).toBe(true)

    const person = await openBoard({ url, name: 'Ann' })
    const { result: id } = runOp(person.store, 'Ann', (ops) => ops.ticket('Tidy up'))
    const [took] = await run('wait', '--take', '--timeout', '5')
    expect(took).toMatchObject({ ids: [id], ticket: { status: 'doing', by: 'Claude' } })
    await person.close()
  }, 20_000)

  it('puts what has no place by the people, not off to the right of everything', async () => {
    const { ws, run } = await setup()
    await run('note', 'far away', '--at', '0,0')
    ws.send(packPresence({ name: 'Ann', color: '#e03131', x: 3000, y: 2000 }))
    await new Promise((r) => setTimeout(r, 100))
    const [made] = await run('note', 'here')
    const d = (await run('read', '--format', 'json'))[0]
    const it = d.items.find((i: any) => i.id === made.ids[0])
    expect(Math.hypot(it.x + it.w / 2 - 3000, it.y + it.h / 2 - 2000)).toBeLessThan(600)
  }, 20_000)

  it('moves a frame with what is in it', async () => {
    const { run } = await setup()
    const [f] = await run('frame', 'Plan', '--at', '0,0', '--size', '600x400')
    const [n] = await run('note', 'one', '--in', f.ids[0])
    await run('move', f.ids[0], '--by', '700,0')
    const d = (await run('read', '--format', 'json'))[0]
    expect(d.frames[0]).toMatchObject({ x: 700, members: [n.ids[0]] })
    expect(d.items.find((i: any) => i.id === n.ids[0]).x).toBe(724)
  }, 20_000)

  it('leaves when told, or when left idle; then the commands go back to working alone', async () => {
    const { page, run, dir } = await setup(0.005) // 0.3 seconds
    await new Promise((r) => setTimeout(r, 900))
    expect((await page.take((m) => m.kind === 'agents' && !m.agents.length)).agents).toEqual([])
    expect(existsSync(sessionFile(dir))).toBe(false)
    await expect(run('next')).rejects.toThrow(/quickdraw join/)
    session = undefined
  }, 20_000)

  it('leave', async () => {
    const { run, dir } = await setup()
    expect(await run('leave')).toEqual([{ left: true }])
    await session!.closed
    expect(existsSync(sessionFile(dir))).toBe(false)
    session = undefined
  }, 20_000)
})
