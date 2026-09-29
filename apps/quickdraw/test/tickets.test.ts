import { describe, it, expect, afterEach } from 'vitest'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { runOp } from 'quickdraw-agent'
import { openBoard } from '../src/board/open.ts'
import { main } from '../src/commands/index.ts'
import { createQuickdrawServer } from '../src/serve/index.ts'

const tempLog = () => { process.env.QUICKDRAW_LOG = join(mkdtempSync(join(tmpdir(), 'qd-tickets-')), 'log.jsonl') }

describe('tickets on a file board', () => {
  it('are written, listed, taken and closed, one undoable operation each', async () => {
    tempLog()
    const file = join(mkdtempSync(join(tmpdir(), 'qd-tickets-')), 'board.json')
    const run = async (name: string, ...args: string[]) => { let s = ''; await main([...args, '--file', file, '--name', name], (o) => { s += o }); return JSON.parse(s) }
    const a = await run('Yuya', 'ticket', 'Fix', 'the', 'login', '--body', 'on Safari', '--to', 'Codex')
    expect(a.ticket).toMatchObject({ title: 'Fix the login', body: 'on Safari', to: 'Codex', from: 'Yuya', status: 'todo' })
    const b = await run('Yuya', 'ticket', 'Tidy up')
    expect((await run('pi', 'tickets', '--mine')).map((t: { id: string }) => t.id)).toEqual([b.ids[0]])
    expect((await run('Codex', 'tickets', '--mine')).map((t: { id: string }) => t.id)).toEqual([a.ids[0], b.ids[0]])

    await expect(run('pi', 'take', a.ids[0])).rejects.toThrow(/for Codex/)
    const took = await run('Codex', 'take', a.ids[0])
    expect(took.ticket).toMatchObject({ status: 'doing', by: 'Codex' })
    await expect(run('pi', 'take', a.ids[0])).rejects.toThrow(/taken by Codex \(doing\)/)
    expect(await run('Codex', 'done', a.ids[0], '--result', 'Fixed the cookie')).toMatchObject({ ticket: { status: 'done', by: 'Codex', result: 'Fixed the cookie' } })
    expect(await run('pi', 'fail', b.ids[0], '--result', 'no access')).toMatchObject({ ticket: { status: 'failed', by: 'pi' } })
    expect((await run('x', 'tickets', '--status', 'done,failed'))).toHaveLength(2)
    expect(await run('pi', 'undo')).toMatchObject({ reverted: 1 })
    expect((await run('x', 'tickets', '--status', 'todo')).map((t: { id: string }) => t.id)).toEqual([b.ids[0]])
    await expect(run('pi', 'wait')).rejects.toThrow(/needs a live board/)
  })
})

describe('tickets on a live board', () => {
  let app: ReturnType<typeof createQuickdrawServer> | undefined
  afterEach(() => app?.close())

  async function live() {
    tempLog()
    app = createQuickdrawServer()
    const { port } = await app.listen(0)
    const url = `ws://127.0.0.1:${port}/ws/${app.boards.create('Live').id}`
    const lines: Record<string, string[]> = {}
    const run = (name: string, args: string[], signal?: AbortSignal) => {
      const out = (lines[name] ??= [])
      return main([...args, '--board', url, '--name', name], (o) => { out.push(o) }, { signal }).then(() => out.map((l) => JSON.parse(l)))
    }
    return { url, run }
  }

  it('wait answers at once when a ticket is to do, else when one is put on the board', async () => {
    const { url, run } = await live()
    const person = await openBoard({ url, name: 'Yuya' })
    const { result: first } = runOp(person.store, 'Yuya', (ops) => ops.ticket('First'))
    await new Promise((r) => setTimeout(r, 200))
    expect((await run('a', ['wait']))[0]).toMatchObject({ ticket: { id: first, title: 'First' } })

    runOp(person.store, 'Yuya', (ops) => ops.status(first, 'done', { by: 'Yuya' }))
    const waiting = run('b', ['wait', '--take'])
    await new Promise((r) => setTimeout(r, 300))
    runOp(person.store, 'Yuya', (ops) => ops.ticket('For pi only', { to: 'pi' })) // not for b
    const { result: second } = runOp(person.store, 'Yuya', (ops) => ops.ticket('Second'))
    const [got] = await waiting
    expect(got).toMatchObject({ ids: [second], ticket: { title: 'Second', status: 'doing', by: 'b' } })
    await new Promise((r) => setTimeout(r, 200))
    expect(person.store.get(second)).toMatchObject({ props: { status: 'doing', by: 'b' } }) // the person's page sees it taken
    await person.close()
  }, 15_000)

  it('wait gives up after --timeout, and stops when told', async () => {
    const { run } = await live()
    expect(await run('a', ['wait', '--timeout', '0.3'])).toEqual([{ ticket: null, timeout: true }])
    const stop = new AbortController()
    setTimeout(() => stop.abort(), 200)
    expect(await run('b', ['wait'], stop.signal)).toEqual([{ ticket: null, stopped: true }])
  })

  it('a ticket taken by one agent is refused to the next', async () => {
    const { url, run } = await live()
    const person = await openBoard({ url, name: 'Yuya' })
    const { result: id } = runOp(person.store, 'Yuya', (ops) => ops.ticket('Only one'))
    await new Promise((r) => setTimeout(r, 200))
    expect((await run('a', ['take', id]))[0].ticket).toMatchObject({ by: 'a' })
    await expect(run('b', ['take', id])).rejects.toThrow(/taken by a/)
    await person.close()
  }, 15_000)

  it('watch prints each change to the tickets as a line of JSON', async () => {
    const { url, run } = await live()
    const person = await openBoard({ url, name: 'Yuya' })
    const stop = new AbortController()
    const watching = run('w', ['watch', '--mine'], stop.signal)
    await new Promise((r) => setTimeout(r, 300))
    const { result: id } = runOp(person.store, 'Yuya', (ops) => ops.ticket('Watch me'))
    runOp(person.store, 'Yuya', (ops) => ops.ticket('Not for w', { to: 'pi' }))
    runOp(person.store, 'Yuya', (ops) => ops.move(id, { dx: 50 })) // moving is not a change
    runOp(person.store, 'Yuya', (ops) => ops.status(id, 'doing', { by: 'Yuya' }))
    runOp(person.store, 'Yuya', (ops) => ops.update(id, { text: 'Watch me closely' }))
    await new Promise((r) => setTimeout(r, 300))
    stop.abort()
    const events = await watching
    expect(events.map((e: { event: string, ticket: { title: string, status: string } }) => [e.event, e.ticket.title, e.ticket.status])).toEqual([
      ['added', 'Watch me', 'todo'],
      ['status', 'Watch me', 'doing'],
      ['changed', 'Watch me closely', 'doing'],
    ])
    await person.close()
  }, 15_000)
})
