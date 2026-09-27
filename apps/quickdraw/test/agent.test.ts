import { afterEach, describe, expect, it } from 'vitest'
import { fileURLToPath } from 'node:url'
import { createQuickdrawServer } from '../src/serve/index.ts'
import { openBoard } from '../src/board/open.ts'
import { joinBoard, putLive } from '../src/agent/board-agent.ts'
import { commandText, initCodex, startAppServer, runCodex } from '../src/agent/codex.ts'
import { imageSize, loadImage, splitImage, within } from '../src/agent/images.ts'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { AGENT, packAgent, unpackAgent } from '../src/protocol.js'

const PNG_1x1 = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64')
const MOCK = fileURLToPath(new URL('./fixtures/codex-app-server.mjs', import.meta.url))
const cleanup: (() => unknown)[] = []
afterEach(async () => { for (const fn of cleanup.reverse()) await fn(); cleanup.length = 0 })

// a page on the board: what it hears, by kind
async function page(url: string) {
  const ws = new WebSocket(url)
  ws.binaryType = 'arraybuffer'
  await new Promise((ok) => { ws.onopen = ok })
  const events: any[] = [], agents: any[][] = []
  const wake = new Set<() => void>()
  ws.onmessage = ({ data }) => {
    const m = new Uint8Array(data)
    if (m[0] !== AGENT) return
    const msg = unpackAgent(m)
    if (msg.kind === 'event') events.push(msg.event)
    if (msg.kind === 'agents') agents.push(msg.agents)
    for (const fn of wake) fn()
  }
  const until = (test: () => unknown) => new Promise<void>((ok) => {
    const check = () => { if (test()) { wake.delete(check); ok() } }
    wake.add(check)
    check()
  })
  ws.send(packAgent({ kind: 'hello' }))
  cleanup.push(() => ws.close())
  return { send: (m: object) => ws.send(packAgent(m)), events, agents, until }
}

describe('quickdraw agent codex', () => {
  it('joins the board, turns a request into a Codex turn, runs its tool calls on the board, and asks people for approvals', async () => {
    const app = createQuickdrawServer()
    cleanup.push(() => app.close())
    const { port } = await app.listen(0)
    const id = app.boards.create('Test').id
    const url = `ws://127.0.0.1:${port}/ws/${id}`
    const person = await page(url)

    const board = await openBoard({ url, name: 'Codex · repo' })
    const codex = startAppServer(process.cwd(), ['node', MOCK])
    const offered = await initCodex(codex, { effort: 'medium' })
    // what people may choose from: the models Codex lists (not hidden ones), and the defaults
    expect(offered).toEqual({ model: 'fast', effort: 'medium', models: [
      { id: 'fast', name: 'Fast', efforts: ['low', 'medium'], effort: 'low' },
      { id: 'deep', name: 'Deep', efforts: ['medium', 'high'], effort: 'high' },
    ] })
    const agent = await joinBoard(board, { id: 'codex-repo', name: 'Codex · repo', knows: ['repo'], ...offered }, { imageRoots: [process.cwd(), tmpdir()] })
    cleanup.push(() => agent.close(), () => codex.close())
    await runCodex(codex, agent, { cwd: process.cwd(), name: 'Codex · repo', model: offered.model, effort: offered.effort })
    await person.until(() => person.agents.at(-1)?.[0]?.name === 'Codex · repo')
    expect(person.agents.at(-1)?.[0]).toMatchObject({ model: 'fast', effort: 'medium', models: offered.models })

    const request = { id: 'r1', to: 'codex-repo', text: 'Add a note', context: { shapeIds: [], frameIds: [], viewport: { x: 0, y: 0, w: 1, h: 1 } }, anchor: {}, options: { model: 'deep', effort: 'high' } }
    person.send({ kind: 'request', request })
    await person.until(() => person.events.some((e) => e.type === 'approval'))
    expect(person.agents.at(-1)?.[0].status).toBe('waiting')
    const approval = person.events.find((e) => e.type === 'approval')
    expect(approval.text).toBe('Run ls — to see the files')
    person.send({ kind: 'reply', requestId: 'r1', message: { approval: approval.id, allow: true } })
    await person.until(() => person.events.some((e) => e.type === 'done'))

    expect(person.events.map((e) => e.type)).toEqual(['progress', 'progress', 'op', 'progress', 'approval', 'message', 'done'])
    expect(person.events[0].text).toBe('deep · high') // the model and effort chosen in the panel
    const op = person.events.find((e) => e.type === 'op')
    expect(op.diff).toBeTruthy()
    expect(person.events.find((e) => e.type === 'message').text).toBe('Added a note (Add a note).')
    // it is on the board, as the agent's, for everyone
    const note = board.store.get(op.ids[0])
    expect(note).toMatchObject({ type: 'note', props: { text: 'From Codex' }, agent: { name: 'Codex · repo', op: op.op } })
    await person.until(() => person.agents.at(-1)?.[0].status === 'idle')

    // an image it generated goes on the board with add_image, as one more undoable operation
    const dir = mkdtempSync(join(tmpdir(), 'qd-img-'))
    writeFileSync(join(dir, 'made.png'), PNG_1x1)
    expect(agent.generated('r1', join(dir, 'made.png'))).toBe(1)
    const placed = JSON.parse(await agent.runTool('r1', 'add_image', { image: 'latest', w: 120 }))
    const image = board.store.get(placed.ids[0]) as any
    expect(image).toMatchObject({ type: 'image', props: { w: 120, h: 120 } })
    expect((board.store.get(image.props.assetId) as any).src).toBe('data:image/png;base64,' + PNG_1x1.toString('base64'))
    await expect(agent.runTool('r1', 'add_image', { image: '2' })).rejects.toThrow(/no image 2/)
    if (process.platform === 'darwin') { // a sticker sheet, cut into its cells, as a grid in a frame
      execFileSync('sips', ['-z', '200', '300', join(dir, 'made.png'), '--out', join(dir, 'sheet.png')], { stdio: 'ignore' })
      agent.generated('r1', join(dir, 'sheet.png'))
      const cut = JSON.parse(await agent.runTool('r1', 'add_image', { image: 'latest', split: { cols: 3, rows: 2 }, frame: 'Stickers', w: 80 }))
      const pieces = cut.ids.map((id: string) => board.store.get(id) as any).filter((r: any) => r.type === 'image')
      expect(pieces).toHaveLength(6)
      expect(pieces.map((p: any) => p.props.w)).toEqual(Array(6).fill(80))
      expect(new Set(pieces.map((p: any) => p.x)).size).toBe(3) // three across, two down
      expect(new Set(pieces.map((p: any) => p.y)).size).toBe(2)
      const frame = cut.ids.map((id: string) => board.store.get(id) as any).find((r: any) => r.isFrame)
      expect(pieces.every((p: any) => p.frameId === frame.id)).toBe(true)
    }
    await expect(agent.runTool('r1', 'add_image', { image: '/etc/hosts' })).rejects.toThrow(/outside the working directory/)

    // a follow-up continues the same Codex thread
    person.send({ kind: 'reply', requestId: 'r1', message: 'Thanks' })
    await person.until(() => person.events.filter((e) => e.type === 'done').length === 2)
    expect(person.events.filter((e) => e.type === 'message').at(-1).text).toBe('You said: Thanks')
  })
})

it('shows a shell command as the command it runs', () => {
  expect(commandText('/bin/zsh -lc "rg --files -g package.json"')).toBe('rg --files -g package.json')
  expect(commandText("bash -c 'ls'")).toBe('ls')
  expect(commandText('ls -la')).toBe('ls -la')
  expect(commandText('/bin/zsh -lc "' + 'x'.repeat(200) + '"')).toHaveLength(80)
})

it('puts an operation on the board a piece at a time, ending as the operation would, and undoes as one', async () => {
  const { Store } = await import('@quickdrawjs/core')
  const { bindFrames } = await import('quickdraw-frames')
  const { applySteps, undoDiff } = await import('quickdraw-agent')
  const steps = [{ do: 'note', text: 'A', ref: 'a' }, { do: 'note', text: 'B', ref: 'b' }, { do: 'arrow', from: '@a', to: '@b' }, { do: 'frame', title: 'F', around: ['@a', '@b'] }]
  const atOnce = new Store(); bindFrames(atOnce)
  const live = new Store(); bindFrames(live)
  const { diff } = applySteps(atOnce, 'Codex', steps)
  const seen: number[] = []
  let changes = 0
  live.listen(() => { changes++ })
  await putLive(live, diff, atOnce, (x) => seen.push(x), 100)
  const plain = (s: typeof live) => JSON.stringify(s.all().filter((r) => r.typeName === 'shape').sort((a, b) => (a.id < b.id ? -1 : 1)))
  expect(plain(live)).toBe(plain(atOnce))
  expect(changes).toBeGreaterThan(3) // a piece at a time
  expect(seen.length).toBe(4) // the cursor on each shape (not the frame's title)
  undoDiff(live, diff)
  expect(live.all().filter((r) => r.typeName === 'shape')).toEqual([])
})

it('reads image sizes and keeps to the allowed folders', () => {
  expect(imageSize(PNG_1x1)).toEqual({ w: 1, h: 1 })
  expect(imageSize(Buffer.from('GIF89a\x10\x00\x20\x00', 'latin1'))).toEqual({ w: 16, h: 32 })
  expect(imageSize(Buffer.from('not an image'))).toBeNull()
  expect(within('/a/b/c.png', ['/a'])).toBe(true)
  expect(within('/a/../etc/x.png', ['/a'])).toBe(false)
  expect(within('/ab/c.png', ['/a'])).toBe(false)
})

it('turns an image file into a data URL of its size', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'qd-img-'))
  writeFileSync(join(dir, 'a.png'), PNG_1x1)
  writeFileSync(join(dir, 'a.txt'), 'x')
  expect(await loadImage(join(dir, 'a.png'), [dir])).toEqual({ src: 'data:image/png;base64,' + PNG_1x1.toString('base64'), w: 1, h: 1 })
  await expect(loadImage(join(dir, 'a.txt'), [dir])).rejects.toThrow(/not a PNG/)
})

it.runIf(process.platform === 'darwin')('cuts an even grid into its cells, row by row', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'qd-img-'))
  writeFileSync(join(dir, 'one.png'), PNG_1x1)
  execFileSync('sips', ['-z', '200', '300', join(dir, 'one.png'), '--out', join(dir, 'sheet.png')], { stdio: 'ignore' })
  const cells = await splitImage(join(dir, 'sheet.png'), { cols: 3, rows: 2 }, [dir], { inset: 0.1 })
  // 100 × 100, 10 px off each edge (the top-left one starts 1 px in: sips crops the middle at 0, 0)
  expect(cells.map((c) => [c.w, c.h])).toEqual([[80, 80], [80, 80], [80, 80], [80, 80], [80, 80], [80, 80]])
  const edge = await splitImage(join(dir, 'sheet.png'), { cols: 3, rows: 2 }, [dir])
  expect(edge.map((c) => [c.w, c.h])).toEqual([[99, 99], [100, 99], [100, 99], [99, 100], [100, 100], [100, 100]])
  await expect(splitImage(join(dir, 'sheet.png'), { cols: 1, rows: 1 }, [dir])).rejects.toThrow(/2 to 64/)
  await expect(splitImage('/etc/hosts', { cols: 2, rows: 2 }, [dir])).rejects.toThrow(/outside/)
})
