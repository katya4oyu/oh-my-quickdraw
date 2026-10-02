import { describe, it, expect, afterEach } from 'vitest'
import { existsSync, mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { runOp } from 'quickdraw-agent'
import { openBoard } from '../src/board/open.ts'
import { main } from '../src/commands/index.ts'
import { createQuickdrawServer } from '../src/serve/index.ts'
import { startSession } from '../src/session/daemon.ts'
import { joinBoard } from '../src/agent/board-agent.ts'
import { sessionFile } from '../src/session/client.ts'
import { AGENT, LIVE, PRESENCE, SHARE, pack, packAgent, packPresence, packShare, unpackAgent, unpackPresence, unpackShare } from '../src/protocol.js'
import jpeg from 'jpeg-js'
import { readFileSync } from 'node:fs'
import { createFrame } from 'quickdraw-frames'

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
  const cleanupLater: (() => unknown)[] = []
  afterEach(async () => { for (const fn of cleanupLater.splice(0)) await fn(); await session?.close(); session = undefined; process.chdir(home); await app?.close() })

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
    expect((await run('next'))[0]).toMatchObject({ type: 'reply', request: 'r1', board: { title: 'Live' }, text: 'And a blue one' })

    await run('say', 'Added two notes')
    expect(await page.event('message')).toMatchObject({ requestId: 'r1', text: 'Added two notes' })
    await run('finish', 'Two notes')
    expect(await page.event('done')).toMatchObject({ requestId: 'r1', text: 'Two notes' })
    // its ticket for the request: up at its first note, done with it
    const [ticket] = (await run('tickets')).flat().filter((t: any) => t?.work?.request === 'r1')
    expect(ticket).toMatchObject({ title: 'Put a note here', status: 'done', by: 'Claude', result: 'Two notes' })
    ws.close()
  }, 20_000)

  it('keeps roles: its own and others\', for the team, with each request', async () => {
    const { url, ws, agents, run } = await setup()
    const other = await openBoard({ url, name: 'Codex · api' })
    await joinBoard(other, { id: 'codex', name: 'Codex · api', knows: [], role: 'researcher' }).then((a) => cleanupLater.push(() => a.close()))
    await new Promise((r) => setTimeout(r, 200))

    expect((await run('role', 'reviewer', '--about', 'Reads the PRs'))[0].member).toMatchObject({ name: 'Claude', role: 'reviewer', about: 'Reads the PRs', by: 'Claude' })
    const [team] = await run('members')
    expect(team.map((m: any) => [m.name, m.role ?? null, m.here, !!m.you])).toEqual([['Claude', 'reviewer', true, true], ['Codex · api', 'researcher', true, false]])
    const [who] = await run('who')
    expect(who.your_role).toBe('reviewer')
    expect(who.here.find((p: any) => p.name === 'Codex · api')?.role).toBe('researcher')
    // given another's, then taken off
    await run('role', 'note taker', '--of', 'Codex · api')
    expect(other.members!.get('Codex · api')).toMatchObject({ role: 'note taker', by: 'Claude' })
    await run('role', '--clear')
    expect((await run('members'))[0].find((m: any) => m.name === 'Claude').role).toBeUndefined()
    // a request comes with the team; read ends with it
    ws.send(packAgent({ kind: 'request', request: request('r1', agents[0].id) }))
    const [got] = await run('next', '--timeout', '5')
    expect(got.team.find((m: any) => m.name === 'Codex · api')).toMatchObject({ role: 'note taker', here: true })
    const lines: string[] = []
    await main(['read'], (l) => { lines.push(l) })
    expect(lines.join('\n')).toMatch(/## Team: [^\n]*\n\n- Claude \(you\) — no role yet\n- Codex · api — role: note taker, set by Claude/)
    ws.close()
  }, 20_000)

  it('is on several boards at once, and always says which: requests come with their board, commands go to it', async () => {
    const { ws, agents, run, url } = await setup()
    const second = url.replace(/\/ws\/[^/]+$/, '/ws/' + app!.boards.create('Roadmap').id)
    const joined = (await run('join', '--board', second, '--name', 'Claude'))[0]
    expect(joined).toMatchObject({ joined: true, boards: [{ title: 'Live' }, { title: 'Roadmap' }] })
    // a page on the second board, asking there
    const ws2 = new WebSocket(second)
    ws2.binaryType = 'arraybuffer'
    await new Promise((ok) => (ws2.onopen = ok))
    const page2 = pageOf(ws2)
    ws2.send(packAgent({ kind: 'hello' }))
    const agents2 = (await page2.take((m) => m.kind === 'agents' && m.agents.length)).agents
    expect(agents2[0].elsewhere).toEqual([{ id: url.split('/').pop(), title: 'Live' }]) // the people there see where else it is
    ws2.send(packAgent({ kind: 'request', request: request('r2', agents2[0].id) }))
    const [got] = await run('next', '--timeout', '5')
    expect(got).toMatchObject({ type: 'request', id: 'r2', board: { title: 'Roadmap' } })
    // a command while on it: on that board
    const [made] = await run('note', 'On the roadmap')
    const look = await openBoard({ url: second, name: 'Ann' })
    expect(look.store.shapes().some((x: any) => x.props?.text === 'On the roadmap')).toBe(true) // there, not on the first
    await look.close()
    await run('finish', 'Done there')
    // nothing to work on, two boards: which one?
    await expect(run('note', 'Where?')).rejects.toThrow(/which board\? You are on Live \(.*\), Roadmap \(.*\): add --board ID/)
    const [onFirst] = await run('note', 'Here', '--board', url.split('/').pop()!)
    expect(onFirst.ids).toHaveLength(1)
    const [whoThere] = await run('who', '--board', second.split('/').pop()!)
    expect(whoThere).toMatchObject({ board: { title: 'Roadmap' }, your_boards: [{ title: 'Live' }, { title: 'Roadmap' }] })
    // off one board: still on the other
    const [left] = await run('leave', '--board', second.split('/').pop()!)
    expect(left).toMatchObject({ left: { title: 'Roadmap' }, still_on: [{ title: 'Live' }] })
    await new Promise((r) => setTimeout(r, 200))
    const [n] = await run('note', 'Only one board now')
    expect(n.ids).toHaveLength(1)
    void made; void agents
    ws2.close(); ws.close()
  }, 30_000)

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

  it('watches the shared screen when the sharer lets agents: told when it changes, looks, snaps', async () => {
    const { url, ws, run, dir } = await setup()
    expect((await run('screen'))[0]).toMatchObject({ sharing: false, watching: false })
    // the page shares, and lets agents see it
    ws.send(packShare({ kind: 'start', name: 'Ann' }))
    ws.send(packShare({ kind: 'agents', allow: true }))
    await new Promise((r) => setTimeout(r, 100))
    const [watching] = await run('screen', '--watch')
    expect(watching).toMatchObject({ sharing: true, sharer: 'Ann', allowed: true, watching: true })
    expect(watching.note).toMatch(/quickdraw screen --out/)

    const picture = (grey: number) => jpeg.encode({ width: 64, height: 40, data: new Uint8Array(64 * 40 * 4).fill(grey) }, 80).data
    ws.send(pack(LIVE, picture(0)))
    await new Promise((r) => setTimeout(r, 600))
    const white = picture(255)
    const feeding = setInterval(() => ws.send(pack(LIVE, white)), 150)
    try {
      const [told] = await run('wait', '--timeout', '8')
      expect(told).toMatchObject({ type: 'screen', event: 'changed', change: 1, sharer: 'Ann', board: { title: 'Live' } })
      expect(told.note).toMatch(/changed \(100% of it/)
    } finally { clearInterval(feeding) }
    const [looked] = await run('screen', '--out', join(dir, 'now.jpg'))
    expect(looked).toMatchObject({ wrote: join(dir, 'now.jpg'), sharer: 'Ann' })
    expect(readFileSync(join(dir, 'now.jpg'))).toEqual(Buffer.from(white))

    // a snapshot: Ann's page takes it (here, a frame marked as hers is) and it lands for Claude
    const pageBoard = await openBoard({ url, name: 'Ann' })
    cleanupLater.push(() => pageBoard.close())
    ws.addEventListener('message', ({ data }) => {
      const m = new Uint8Array(data)
      if (m[0] !== SHARE) return
      const msg = unpackShare(m)
      if (msg.kind !== 'snap') return
      const id = createFrame(pageBoard.store as never, { x: 0, y: 0, title: '12:08 · ' + msg.by })
      pageBoard.store.update(id, { snapshot: { at: Date.now(), by: msg.by, imageId: 'shape:none' } } as never)
    })
    const [snapped] = await run('snap')
    expect(snapped).toMatchObject({ title: '12:08 · Claude', sharer: 'Ann' })
    expect(snapped.note).toContain(`--frame ${snapped.snapshot}`)

    ws.send(packShare({ kind: 'stop' }))
    expect((await run('wait', '--timeout', '5'))[0]).toMatchObject({ type: 'screen', event: 'stopped', sharing: false, note: 'Screen sharing stopped.' })
    await expect(run('screen', '--out', join(dir, 'gone.jpg'))).rejects.toThrow(/No one is sharing/)
    ws.close()
  }, 30_000)

  it('leave', async () => {
    const { run, dir } = await setup()
    expect(await run('leave')).toEqual([{ left: true }])
    await session!.closed
    expect(existsSync(sessionFile(dir))).toBe(false)
    session = undefined
  }, 20_000)
})
