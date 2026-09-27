import { describe, it, expect, afterEach } from 'vitest'
import { mkdtempSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import * as Y from 'yjs'
import { Store } from '@quickdrawjs/core'
import { bindYjs } from 'quickdraw-yjs'
import { runOp } from 'quickdraw-agent'
import { openBoard } from '../src/board/open.ts'
import { main } from '../src/commands/index.ts'
import { resolveBoard } from '../src/commands/boards.ts'
import { createQuickdrawServer } from '../src/serve/index.ts'
import { PRESENCE, UPDATE, unpackPresence } from '../src/protocol.js'

describe('the CLI on a file board', () => {
  it('writes, reads, logs and undoes', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'qd-agent-'))
    const file = join(dir, 'board.json')
    process.env.QUICKDRAW_LOG = join(dir, 'log.jsonl')
    const run = async (...args: string[]) => { let s = ''; await main([...args, '--file', file, '--name', 'Claude'], (o) => { s += o }); return s }
    const { ids: [id] } = JSON.parse(await run('note', 'hello'))
    expect(JSON.parse(readFileSync(file, 'utf8')).shapes[0]).toMatchObject({ id, props: { text: 'hello' } })
    expect(await run('read')).toMatch(/hello/)
    expect(JSON.parse(await run('log'))).toHaveLength(1)
    expect(JSON.parse(await run('undo'))).toMatchObject({ reverted: 1 })
    expect(JSON.parse(readFileSync(file, 'utf8')).shapes).toHaveLength(0)
  })
})

describe('a live board', () => {
  let app: ReturnType<typeof createQuickdrawServer> | undefined
  afterEach(() => app?.close())

  it('joins through the relay: peers see the change and the cursor', async () => {
    app = createQuickdrawServer()
    const { port } = await app.listen(0)
    const url = `ws://127.0.0.1:${port}/ws/${app.boards.create('Live').id}`

    // a browser-like peer, bound the way the page is
    const doc = new Y.Doc(), peer = new Store()
    const ws = new WebSocket(url)
    ws.binaryType = 'arraybuffer'
    const presence: { name?: string, x?: number, y?: number }[] = []
    await new Promise((ok) => (ws.onopen = ok))
    ws.onmessage = ({ data }) => {
      const m = new Uint8Array(data)
      if (m[0] === UPDATE) Y.applyUpdate(doc, m.subarray(1), 'relay')
      if (m[0] === PRESENCE) presence.push(unpackPresence(m))
    }
    bindYjs(peer, doc)

    const agent = await openBoard({ url, name: 'Claude' })
    const { result: id } = runOp(agent.store, 'Claude', (ops) => ops.note('from the agent'))
    agent.cursor(10, 20)
    await new Promise((r) => setTimeout(r, 200))
    await agent.close()
    ws.close()

    expect((peer.get(id) as { props: { text: string } } | undefined)?.props.text).toBe('from the agent')
    expect(presence.find((p) => p.name === 'Claude')).toMatchObject({ x: 10, y: 20 })

    // and a second agent session sees what the first wrote (the server kept it)
    const again = await openBoard({ url })
    expect((again.store.get(id) as { agent?: { name: string } } | undefined)?.agent?.name).toBe('Claude')
    await again.close()
  })
})

describe('which board', () => {
  let app: ReturnType<typeof createQuickdrawServer> | undefined
  afterEach(() => app?.close())

  it('by id, page URL or relay URL; without one, the only board — never a new one', async () => {
    app = createQuickdrawServer()
    const server = `http://127.0.0.1:${(await app.listen(0)).port}`
    await expect(resolveBoard(undefined, server)).rejects.toThrow(/no boards yet/)
    expect(app.boards.list()).toHaveLength(0)

    const a = app.boards.create('Plan')
    expect(await resolveBoard(undefined, server)).toBe(`ws://127.0.0.1:${server.split(':').pop()}/ws/${a.id}`)
    expect(await resolveBoard(a.id, server)).toMatch(new RegExp(`/ws/${a.id}$`))
    expect(await resolveBoard(`https://mac.example.ts.net:8795/b/${a.id}`, server)).toBe(`wss://mac.example.ts.net:8795/ws/${a.id}`)
    expect(await resolveBoard('ws://elsewhere/ws/abcd1234', server)).toBe('ws://elsewhere/ws/abcd1234')
    await expect(resolveBoard('Not An Id', server)).rejects.toThrow(/not a board/)

    const b = app.boards.create('Retro')
    await expect(resolveBoard(undefined, server)).rejects.toThrow(new RegExp(`2 boards; pass --board ID:\\n  ${a.id}  Plan\\n  ${b.id}  Retro`))
  })

  it('lists and makes boards from the command line', async () => {
    app = createQuickdrawServer()
    const server = `http://127.0.0.1:${(await app.listen(0)).port}`
    const run = async (...args: string[]) => { let s = ''; await main([...args, '--server', server], (o) => { s += o }); return JSON.parse(s) }
    const made = await run('new', 'Sprint', '12')
    expect(made).toMatchObject({ title: 'Sprint 12', url: `${server}/b/${made.id}` })
    expect((await run('boards')).map((b: { id: string }) => b.id)).toEqual([made.id])
    expect(await run('note', 'hi')).toMatchObject({ ids: [expect.any(String)] }) // the only board
  })
})
