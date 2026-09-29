import { describe, it, expect, afterEach } from 'vitest'
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import * as Y from 'yjs'
import { Store } from '@quickdrawjs/core'
import { bindYjs } from 'quickdraw-yjs'
import { runOp } from 'quickdraw-agent'
import { openBoard } from '../src/board/open.ts'
import { main } from '../src/commands/index.ts'
import { PassThrough } from 'node:stream'
import { chooseBoard, resolveBoard } from '../src/commands/boards.ts'
import { createQuickdrawServer } from '../src/serve/index.ts'
import { linkPreview, serverOfBoard } from '../src/board/link-preview.ts'
import { imageSize, smallJpeg } from '../src/agent/images.ts'
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

  it('lints the layout, all of it or a frame', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'qd-lint-'))
    const file = join(dir, 'board.json')
    process.env.QUICKDRAW_LOG = join(dir, 'log.jsonl')
    const run = async (...args: string[]) => { let s = ''; await main([...args, '--file', file, '--name', 'Claude'], (o) => { s += o }); return JSON.parse(s) }
    const { ids: [frame] } = await run('frame', 'Keep', '--at', '0,0', '--size', '600x400')
    await run('note', 'one', '--at', '30,30')
    await run('note', 'two', '--at', '30,130') // on top of one
    await run('note', 'three', '--at', '1000,0')
    await run('note', 'four', '--at', '1000,100') // on top of three, outside the frame
    expect(await run('lint')).toMatchObject({ problems: 2 })
    const inFrame = await run('lint', '--frame', frame)
    expect(inFrame).toMatchObject({ problems: 1, issues: [{ kind: 'overlap' }] })
    expect(inFrame.issues[0].text).toMatch(/note "one".*note "two"/)
  })
})

describe('images, embeds and grids from the CLI', () => {
  const PNG_1x1 = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64')
  const home = process.cwd()
  afterEach(() => process.chdir(home))

  it('puts images (whole, or a sheet cut into its cells), embeds, and lays out in columns', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'qd-cli-'))
    process.chdir(dir) // images are read from the working directory
    const file = join(dir, 'board.json')
    process.env.QUICKDRAW_LOG = join(dir, 'log.jsonl')
    const run = async (...args: string[]) => { let s = ''; await main([...args, '--file', file, '--name', 'Claude'], (o) => { s += o }); return JSON.parse(s) }
    const shapes = () => JSON.parse(readFileSync(file, 'utf8')).shapes as any[]
    const get = (id: string) => shapes().find((s) => s.id === id)

    writeFileSync(join(dir, 'dot.png'), PNG_1x1)
    const { ids: [image] } = await run('image', 'dot.png', '--width', '50')
    expect(get(image)).toMatchObject({ type: 'image', agent: { name: 'Claude' }, props: { w: 50, h: 50 } })
    await expect(run('image', '/etc/hosts')).rejects.toThrow(/outside the working directory/)

    const { ids: [page] } = await run('embed', 'https://youtu.be/dQw4w9WgXcQ')
    const { ids: [card] } = await run('embed', 'https://example.com/a', '--link', '--title', 'An article', '--size', '300x200')
    writeFileSync(join(dir, 'demo.html'), '<button>hi</button>')
    const { ids: [html] } = await run('embed', '--html-file', 'demo.html')
    expect(get(page).props).toMatchObject({ kind: 'url', url: 'https://youtu.be/dQw4w9WgXcQ' })
    expect(get(card).props).toMatchObject({ kind: 'link', title: 'An article', w: 300, h: 200 })
    expect(get(card).props.preview).toBeUndefined() // a file board has no server to ask
    expect(get(html).props).toMatchObject({ kind: 'html', html: '<button>hi</button>' })
    await expect(run('embed')).rejects.toThrow(/needs a URL/)

    const notes = []
    for (let i = 0; i < 6; i++) notes.push((await run('note', 'n' + i)).ids[0])
    await run('arrange', notes.join(','), '--cols', '3', '--at', '0,2000')
    expect(new Set(notes.map((id) => get(id).y)).size).toBe(2)

    if (process.platform === 'darwin') {
      execFileSync('sips', ['-z', '200', '200', join(dir, 'dot.png'), '--out', join(dir, 'sheet.png')], { stdio: 'ignore' })
      const cut = await run('image', 'sheet.png', '--split', '2x2', '--frame', 'Stickers')
      const pieces = cut.ids.map(get).filter((r: any) => r.type === 'image')
      expect(pieces).toHaveLength(4)
      const frame = cut.ids.map(get).find((r: any) => r.isFrame)
      expect(pieces.every((p: any) => p.frameId === frame.id)).toBe(true)
    }
  }, 60_000)

  it('asks the board\'s server for a link card\'s preview, and shrinks its picture to fit the card', async () => {
    expect(serverOfBoard('ws://127.0.0.1:8795/ws/abc')).toBe('http://127.0.0.1:8795')
    expect(serverOfBoard('wss://mac.example.ts.net:8795/ws/abc')).toBe('https://mac.example.ts.net:8795')
    const asked: string[] = []
    const answer = (body: object, ok = true) => (async (u: string) => { asked.push(u); return { ok, json: async () => body } }) as never
    expect(await linkPreview('http://h', 'https://example.com/a?b=1', { fetch: answer({ title: 'A', image: 'data:image/png;base64,iVBORw0KGgo=' }) }))
      .toEqual({ title: 'A', image: 'data:image/png;base64,iVBORw0KGgo=' })
    expect(asked[0]).toBe('http://h/preview?url=https%3A%2F%2Fexample.com%2Fa%3Fb%3D1')
    expect(await linkPreview('http://h', 'https://x', { fetch: answer({ error: 'refused' }, false) })).toBeUndefined()
    expect(await linkPreview('http://h', 'https://x', { fetch: (async () => { throw new Error('down') }) as never })).toBeUndefined()
    if (process.platform === 'darwin') { // a picture too big for a card is made small enough
      const dir = mkdtempSync(join(tmpdir(), 'qd-prev-'))
      writeFileSync(join(dir, 'dot.png'), PNG_1x1)
      execFileSync('sips', ['-z', '1200', '1600', join(dir, 'dot.png'), '--out', join(dir, 'big.png')], { stdio: 'ignore' })
      const small = await smallJpeg('data:image/png;base64,' + readFileSync(join(dir, 'big.png')).toString('base64'), 480)
      expect(small?.slice(0, 15)).toBe('data:image/jpeg')
      expect(imageSize(Buffer.from(small!.split(',')[1], 'base64'))).toEqual({ w: 480, h: 360 })
    }
    expect(await smallJpeg('https://x/y.png', 480)).toBeNull()
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
    expect(presence[0]).toMatchObject({ name: 'Claude', agent: true, x: null, y: null }) // here as soon as it joins, as an agent
    expect(presence.find((p) => p.name === 'Claude' && p.x != null)).toMatchObject({ x: 10, y: 20 })

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

    // a person at a terminal chooses by number, asked again until it is one
    const input = new PassThrough(), output = new PassThrough()
    let shown = ''
    output.on('data', (d) => { shown += d })
    input.end('5\nretro\n2\n')
    expect(await resolveBoard(undefined, server, (boards) => chooseBoard(boards, 'quickdraw agent codex', input, output))).toMatch(new RegExp(`/ws/${b.id}$`))
    expect(shown).toContain(`1) Plan  (${a.id})`)
    expect(shown.match(/Number \(1-2\)/g)).toHaveLength(3)
    expect(shown).toContain(`Next time: quickdraw agent codex --board ${b.id}`)
    const none = new PassThrough()
    none.end('')
    await expect(chooseBoard([a, b], 'x', none, new PassThrough())).rejects.toThrow(/no board chosen/)
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
