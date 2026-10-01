import { afterEach, describe, expect, it } from 'vitest'
import { fileURLToPath } from 'node:url'
import { createQuickdrawServer } from '../src/serve/index.ts'
import { openBoard } from '../src/board/open.ts'
import { joinBoard, putLive } from '../src/agent/board-agent.ts'
import { accountText, activityOf, commandText, initCodex, limitsOf, startAppServer, runCodex } from '../src/agent/codex.ts'
import { realtimeVoices, runVoice } from '../src/agent/voice.ts'
import { placeSnapshot } from 'quickdraw-screenshare'
import { findChrome } from '../src/board/chrome.ts'
import { imageSize, loadImage, splitImage, within } from '../src/agent/images.ts'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { AGENT, PRESENCE, packAgent, unpackAgent, unpackPresence } from '../src/protocol.js'

const PNG_1x1 = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64')
const hasChrome = !!findChrome()
const MOCK = fileURLToPath(new URL('./fixtures/codex-app-server.mjs', import.meta.url))
const cleanup: (() => unknown)[] = []
afterEach(async () => { for (const fn of cleanup.reverse()) await fn(); cleanup.length = 0 })

// a page on the board: what it hears, by kind
async function page(url: string) {
  const ws = new WebSocket(url)
  ws.binaryType = 'arraybuffer'
  await new Promise((ok) => { ws.onopen = ok })
  const events: any[] = [], agents: any[][] = [], presences: any[] = [], voices: any[] = []
  const wake = new Set<() => void>()
  ws.onmessage = ({ data }) => {
    const m = new Uint8Array(data)
    if (m[0] === PRESENCE) { presences.push(unpackPresence(m)); for (const fn of wake) fn() }
    if (m[0] !== AGENT) return
    const msg = unpackAgent(m)
    if (msg.kind === 'event') events.push(msg.event)
    if (msg.kind === 'agents') agents.push(msg.agents)
    if (msg.kind === 'voice') voices.push(msg)
    for (const fn of wake) fn()
  }
  const until = (test: () => unknown) => new Promise<void>((ok) => {
    const check = () => { if (test()) { wake.delete(check); ok() } }
    wake.add(check)
    check()
  })
  ws.send(packAgent({ kind: 'hello' }))
  cleanup.push(() => ws.close())
  return { send: (m: object) => ws.send(packAgent(m)), events, agents, presences, voices, until }
}

describe('quickdraw agent codex-app-server', () => {
  it('hands the feedback on snapshots to Codex: what people wrote, and the pictures; and lets it look at the board', async () => {
    const app = createQuickdrawServer()
    cleanup.push(() => app.close())
    const { port } = await app.listen(0)
    const url = `ws://127.0.0.1:${port}/ws/${app.boards.create('Review').id}`
    const person = await page(url)
    const board = await openBoard({ url, name: 'Codex · app' })
    const codex = startAppServer(process.cwd(), ['node', MOCK])
    const offered = await initCodex(codex)
    const agent = await joinBoard(board, { id: 'codex-app', name: 'Codex · app', knows: [], ...offered })
    cleanup.push(() => agent.close(), () => codex.close())
    await runCodex(codex, agent, { cwd: process.cwd(), name: 'Codex · app' })

    // a snapshot of the screen, and a note someone wrote on it
    const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=='
    const { frameId } = placeSnapshot({ store: board.store, viewportPageBounds: () => ({ x: 0, y: 0, w: 1600, h: 1000 }) } as never, { src: PNG, w: 800, h: 600 }, { title: '10:32 · Mac', by: 'Mac' })
    const frame = board.store.get(frameId) as any
    board.store.put({ id: 'shape:fb1', typeName: 'shape', type: 'note', x: frame.x + 40, y: frame.y + 40, rot: 0, z: board.store.maxZ() + 1, frameId, props: { text: 'Save is cut off', color: 'yellow', size: 'm', font: 'draw', scale: 1 } } as never)
    await new Promise((r) => setTimeout(r, 300)) // synced

    const request = { id: 'fb', to: 'codex-app', text: 'Fix these', context: { shapeIds: [], frameIds: [], viewport: { x: 0, y: 0, w: 1, h: 1 }, feedback: [frameId] }, anchor: {} }
    person.send({ kind: 'request', request })
    await person.until(() => person.events.some((e) => e.type === 'done' && e.requestId === 'fb'))
    expect(person.events.find((e) => e.type === 'progress' && e.requestId === 'fb' && /snapshot/.test(e.text))?.text).toBe('Looking at 1 snapshot')
    const answer = person.events.find((e) => e.type === 'message' && e.requestId === 'fb').text
    // drawn with the note over it (where there is a Chrome to draw with), and the screen as it was
    expect(answer).toBe(hasChrome
      ? '2 images; files there; notes "Save is cut off"; look_at inputImage'
      : '1 images; files there; notes "Save is cut off"; look_at failed: ' + answer.split('failed: ')[1])
  }, 60_000)

  it('talks: the offer goes to a realtime conversation, the answer back to the page that asked, and what is said and done fills the thread', async () => {
    const app = createQuickdrawServer()
    cleanup.push(() => app.close())
    const { port } = await app.listen(0)
    const url = `ws://127.0.0.1:${port}/ws/${app.boards.create('Talk').id}`
    const person = await page(url)
    const other = await page(url) // someone else on the board: sees the thread, never the call
    const board = await openBoard({ url, name: 'Codex · talk' })
    const codex = startAppServer(process.cwd(), ['node', MOCK])
    const agent = await joinBoard(board, { id: 'codex-talk', name: 'Codex · talk', knows: [], voice: true, ...(await initCodex(codex)) })
    cleanup.push(() => agent.close(), () => codex.close())
    runVoice(codex, agent, await runCodex(codex, agent, { cwd: process.cwd(), name: 'Codex · talk' }))
    await person.until(() => person.agents.at(-1)?.[0]?.voice === true)

    const request = { id: 'v1', to: 'codex-talk', text: 'Voice', context: { shapeIds: [], frameIds: [], viewport: { x: 0, y: 0, w: 1, h: 1 } }, anchor: {} }
    person.send({ kind: 'request', request, sdp: 'v=offer' })
    await person.until(() => person.voices.some((v) => v.sdp))
    expect(person.voices[0]).toEqual({ kind: 'voice', requestId: 'v1', sdp: 'v=answer' })
    await person.until(() => person.events.some((e) => e.type === 'message' && e.requestId === 'v1'))
    // what the person said, as theirs; Codex's work as progress; what was said back, as the answer
    expect(person.events.filter((e) => e.requestId === 'v1').map((e) => [e.type, e.text ?? ''])).toEqual([
      ['progress', 'fast'], ['reply', 'Put a note that says hi.'], ['op', ''], ['progress', 'Added it (true).'], ['message', 'Done, it says hi.'],
    ])
    expect(board.store.all().some((r: any) => r.props?.text === 'hi')).toBe(true)
    expect(app.threads.get('v1')?.thread.request.voice).toBe(true)
    expect(app.threads.get('v1')?.thread.status).toBe('working') // still talking

    // hanging up ends it, for the page that talked only
    person.send({ kind: 'voice', requestId: 'v1', stop: true })
    await person.until(() => person.voices.some((v) => 'end' in v))
    expect(person.voices.at(-1)).toEqual({ kind: 'voice', requestId: 'v1', end: 'requested' })
    await person.until(() => person.events.some((e) => e.type === 'done' && e.requestId === 'v1'))
    expect(other.voices).toEqual([])
    expect(other.events.some((e) => e.type === 'reply' && e.requestId === 'v1')).toBe(true)
  }, 30_000)

  it('talks in the voice the person picked, when it is one on offer; else its own', async () => {
    const app = createQuickdrawServer()
    cleanup.push(() => app.close())
    const { port } = await app.listen(0)
    const url = `ws://127.0.0.1:${port}/ws/${app.boards.create('Voices').id}`
    const person = await page(url)
    const board = await openBoard({ url, name: 'Codex' })
    const codex = startAppServer(process.cwd(), ['node', MOCK])
    const offered = await initCodex(codex)
    const voices = await realtimeVoices(codex)
    expect(voices).toEqual({ voices: ['juniper', 'sol', 'cove'], default: 'cove' }) // v1: what a v3 conversation takes
    const agent = await joinBoard(board, { id: 'codex-v', name: 'Codex', knows: [], voice: true, voices: voices!.voices, defaultVoice: 'sol', ...offered })
    cleanup.push(() => agent.close(), () => codex.close())
    runVoice(codex, agent, await runCodex(codex, agent, { cwd: process.cwd(), name: 'Codex' }), { voice: 'sol', voices: voices!.voices })
    await person.until(() => person.agents.at(-1)?.[0]?.voices?.length === 3)
    expect(person.agents.at(-1)![0]).toMatchObject({ voices: ['juniper', 'sol', 'cove'], defaultVoice: 'sol' }) // for the panel's picker

    const ask = (id: string, voice: string) => person.send({ kind: 'request', sdp: 'v=offer', request: { id, to: 'codex-v', text: 'Voice', options: { voice }, context: { shapeIds: [], frameIds: [], viewport: { x: 0, y: 0, w: 1, h: 1 } }, anchor: {} } })
    ask('c1', 'juniper')
    await person.until(() => person.voices.some((v) => v.requestId === 'c1' && v.sdp))
    expect(person.voices.find((v) => v.requestId === 'c1')!.sdp).toBe('v=answer;voice=juniper')
    ask('c2', 'marin') // not one a v3 conversation takes: its own
    await person.until(() => person.voices.some((v) => v.requestId === 'c2' && v.sdp))
    expect(person.voices.find((v) => v.requestId === 'c2')!.sdp).toBe('v=answer;voice=sol')
  }, 30_000)

  it('works in an area people see: what it adds goes there, and it hears what people did in it and where they moved it', async () => {
    const app = createQuickdrawServer()
    cleanup.push(() => app.close())
    const { port } = await app.listen(0)
    const url = `ws://127.0.0.1:${port}/ws/${app.boards.create('Together').id}`
    const person = await page(url)
    const ann = await openBoard({ url, name: 'Ann' }) // someone drawing on the board
    cleanup.push(() => ann.close())
    const board = await openBoard({ url, name: 'Codex' })
    const agent = await joinBoard(board, { id: 'codex', name: 'Codex', knows: [] })
    cleanup.push(() => agent.close())
    await person.until(() => person.agents.at(-1)?.[0]?.id === 'codex')
    person.send({ kind: 'request', request: { id: 'w1', to: 'codex', text: 'Map the flow', context: { shapeIds: [], frameIds: [], viewport: { x: 0, y: 0, w: 1200, h: 800 } }, anchor: {} } })
    await new Promise((r) => setTimeout(r, 200))

    const { area } = JSON.parse(await agent.runTool('w1', 'claim_area', { w: 600, h: 400, title: 'Flow' }))
    expect(area).toEqual({ x: 300, y: 200, w: 600, h: 400 }) // mid-view, on an empty board
    await person.until(() => person.events.some((e) => e.type === 'area'))
    expect(person.events.find((e) => e.type === 'area')).toMatchObject({ requestId: 'w1', area, title: 'Flow' })
    const within = (id: string, a: typeof area) => { const s = board.store.get(id) as any; return s.x >= a.x && s.y >= a.y && s.x + 200 <= a.x + a.w && s.y + 200 <= a.y + a.h }
    const first = JSON.parse(await agent.runTool('w1', 'add_note', { text: 'Record' }))
    expect(within(first.ids[0], area)).toBe(true)

    // Ann writes in its area: its next step hears of it
    ann.store.put({ id: 'shape:ann1', typeName: 'shape', type: 'note', x: area.x + 330, y: area.y + 60, rot: 0, z: 99, props: { text: 'Ask the team', color: 'green', size: 'm', font: 'draw', scale: 1 } } as never)
    await new Promise((r) => setTimeout(r, 300))
    const heard = await agent.runTool('w1', 'add_note', { text: 'Transcribe' })
    expect(heard).toMatch(/In your work area since your last step: People added note "Ask the team" \(shape:ann1\)\. Keep what they did/)
    expect(await agent.runTool('w1', 'read_board', {})).not.toMatch(/work area since/) // told once

    // a person moves the area: everyone sees it, and the agent builds there
    const moved = { x: 2000, y: 0, w: 600, h: 400 }
    person.send({ kind: 'reply', requestId: 'w1', message: { area: moved } })
    await person.until(() => person.events.some((e) => e.type === 'area' && e.by === 'person'))
    await new Promise((r) => setTimeout(r, 100))
    const there = await agent.runTool('w1', 'add_note', { text: 'Summarize' })
    expect(there).toMatch(/People moved your work area to x 2000, y 0 \(600 × 400\): build there\./)
    expect(within(JSON.parse(there.split('\n')[0]).ids[0], moved)).toBe(true)
    // kept with the thread: claimed, grown when Ann's note left no room, moved
    expect(app.threads.get('w1')?.thread.events.filter((e: any) => e.type === 'area').map((e: any) => [e.area.y, e.area.h > 400, e.by ?? 'agent'])).toEqual([[200, false, 'agent'], [200, true, 'agent'], [0, false, 'person']])

    // put beside it, by a place of its own: the area takes it in, so it stays where the work is
    const far = JSON.parse((await agent.runTool('w1', 'add_note', { text: 'Far', at: { x: 3000, y: 600 } })).split('\n')[0])
    expect(far.area).toMatchObject({ x: 2000, y: 0 })
    expect(far.area.x + far.area.w).toBeGreaterThanOrEqual(3200)
    expect(far.area.y + far.area.h).toBeGreaterThanOrEqual(800)
    // or claimed where the request says
    expect(JSON.parse(await agent.runTool('w1', 'claim_area', { w: 400, h: 300, x: -500, y: 900 })).area).toEqual({ x: -500, y: 900, w: 400, h: 300 })
  }, 20_000)

  it('works where a person marked out, and stops when asked, keeping what it did', async () => {
    const app = createQuickdrawServer()
    cleanup.push(() => app.close())
    const { port } = await app.listen(0)
    const url = `ws://127.0.0.1:${port}/ws/${app.boards.create('Marked').id}`
    const person = await page(url)
    const board = await openBoard({ url, name: 'Codex' })
    const codex = startAppServer(process.cwd(), ['node', MOCK])
    const agent = await joinBoard(board, { id: 'codex', name: 'Codex', knows: [], ...(await initCodex(codex)) })
    cleanup.push(() => agent.close(), () => codex.close())
    await runCodex(codex, agent, { cwd: process.cwd(), name: 'Codex' })
    await person.until(() => person.agents.at(-1)?.[0]?.id === 'codex')

    const area = { x: 1000, y: 1000, w: 600, h: 400 }
    person.send({ kind: 'request', request: { id: 'm1', to: 'codex', text: 'Wait here', context: { shapeIds: [], frameIds: [], viewport: { x: 0, y: 0, w: 1200, h: 800 }, area }, anchor: {} } })
    // its work area from the start, and Codex is told so
    await person.until(() => person.events.some((e) => e.type === 'area' && e.requestId === 'm1'))
    expect(person.events.find((e) => e.type === 'area')).toMatchObject({ requestId: 'm1', area })
    await person.until(() => person.events.some((e) => e.type === 'approval' && e.requestId === 'm1'))
    expect(person.events.find((e) => e.type === 'progress' && /marked out/.test(e.text))?.text)
      .toMatch(/They marked out where it goes: x 1000, y 1000, 600 × 400\. It is your work area already/)
    const op = person.events.find((e) => e.type === 'op' && e.requestId === 'm1')
    const note = board.store.get(op.ids[0]) as any
    expect(note.x >= 1000 && note.y >= 1000 && note.x + 200 <= 1600 && note.y + 200 <= 1400).toBe(true)

    // Stop: the turn ends where it is; what it did stays, to keep or undo
    person.send({ kind: 'reply', requestId: 'm1', message: { stop: true } })
    await person.until(() => person.events.some((e) => e.type === 'done' && e.requestId === 'm1'))
    expect(person.events.find((e) => e.type === 'done' && e.requestId === 'm1').text).toBe('Stopped.')
    expect(board.store.get(op.ids[0])).toBeTruthy()
    await person.until(() => person.agents.at(-1)?.[0]?.status === 'idle') // what it waited on was declined by stopping
  }, 20_000)

  it('shows by the cursor what Codex starts doing, and on what', () => {
    expect(activityOf({ type: 'reasoning' })).toEqual({ kind: 'thinking' })
    expect(activityOf({ type: 'webSearch', query: 'tldraw pricing' })).toEqual({ kind: 'searching', note: 'tldraw pricing' })
    expect(activityOf({ type: 'commandExecution', command: '/bin/zsh -lc "npm test"' })).toEqual({ kind: 'running', note: 'npm test' })
    expect(activityOf({ type: 'fileChange' })).toEqual({ kind: 'editing' })
    expect(activityOf({ type: 'imageGeneration' })).toEqual({ kind: 'imaging' })
    expect(activityOf({ type: 'agentMessage' })).toBeNull()
  })

  it('names the account by its kind and plan, and its usage limits by their windows', () => {
    expect(accountText({ type: 'chatgpt', email: 'a@b.c', planType: 'prolite' })).toBe('ChatGPT Pro Lite')
    expect(accountText({ type: 'chatgpt', planType: 'self_serve_business_usage_based' })).toBe('ChatGPT Self Serve Business Usage Based')
    expect(accountText({ type: 'chatgpt', planType: 'unknown' })).toBe('ChatGPT')
    expect(accountText({ type: 'apiKey' })).toBe('OpenAI API key')
    expect(accountText(null)).toBeUndefined()
    expect(limitsOf([
      { limitId: 'codex', primary: { usedPercent: 40, windowDurationMins: 300, resetsAt: 10 }, secondary: { usedPercent: 9, windowDurationMins: 10080, resetsAt: null } },
      { limitId: 'other', limitName: 'Spark', primary: { usedPercent: 1, windowDurationMins: 1440 }, secondary: null },
    ])).toEqual([
      { name: '5h', usedPercent: 40, resetsAt: 10_000 },
      { name: 'Weekly', usedPercent: 9 },
      { name: 'Spark 1-day', usedPercent: 1 },
    ])
  })

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
    // what it runs on: the plan and the usage, never the email
    await person.until(() => person.agents.at(-1)?.[0]?.limits)
    expect(person.agents.at(-1)?.[0]).toMatchObject({ account: 'ChatGPT Pro Lite', limits: [{ name: 'Weekly', usedPercent: 9, resetsAt: 1791105016000 }] })
    expect(JSON.stringify(person.agents)).not.toContain('example.com')

    const request = { id: 'r1', to: 'codex-repo', text: 'Add a note', context: { shapeIds: [], frameIds: [], viewport: { x: 0, y: 0, w: 1, h: 1 } }, anchor: {}, options: { model: 'deep', effort: 'high' } }
    person.send({ kind: 'request', request })
    await person.until(() => person.events.some((e) => e.type === 'approval'))
    expect(person.agents.at(-1)?.[0].status).toBe('waiting')
    // its cursor says so too, as an agent's, for the row of who is here
    await person.until(() => person.presences.at(-1)?.agentStatus === 'waiting')
    expect(person.presences[0]).toMatchObject({ name: 'Codex · repo', agent: true, x: null, y: null }) // here as soon as it joins
    const approval = person.events.find((e) => e.type === 'approval')
    expect(approval.text).toBe('Run ls — to see the files')
    person.send({ kind: 'reply', requestId: 'r1', message: { approval: approval.id, allow: true } })
    await person.until(() => person.events.some((e) => e.type === 'done'))

    expect(person.events.map((e) => e.type)).toEqual(['progress', 'progress', 'op', 'progress', 'approval', 'message', 'done'])
    expect(person.events[0].text).toBe('deep · high') // the model and effort chosen in the panel
    const op = person.events.find((e) => e.type === 'op')
    expect(op.diff).toBeTruthy()
    expect(person.events.find((e) => e.type === 'message').text).toBe('Added a note (Add a note).')
    // Codex's sparse update adds its 5h window and keeps the weekly one
    await person.until(() => person.agents.at(-1)?.[0]?.limits?.length === 2)
    expect(person.agents.at(-1)?.[0].limits).toEqual([
      { name: 'Weekly', usedPercent: 9, resetsAt: 1791105016000 },
      { name: '5h', usedPercent: 30 },
    ])
    // it is on the board, as the agent's, for everyone
    const note = board.store.get(op.ids[0])
    expect(note).toMatchObject({ type: 'note', props: { text: 'From Codex' }, agent: { name: 'Codex · repo', op: op.op } })
    await person.until(() => person.agents.at(-1)?.[0].status === 'idle')
    await person.until(() => person.presences.at(-1)?.agentStatus === 'idle')
    // by its cursor, what it did just then: thinks, reads the board, draws, runs a command, waits for the person, is done
    await person.until(() => person.presences.at(-1)?.agentActivity === 'done')
    const acts = person.presences.map((p) => p.agentActivity ?? null).filter((a, i, all) => a !== all[i - 1])
    expect(acts).toEqual([null, 'thinking', 'reading', 'thinking', 'drawing', 'thinking', 'drawing', 'thinking', 'running', 'waiting', 'thinking', 'done'])
    expect(person.presences.find((p) => p.agentActivity === 'running').agentNote).toBe('ls')
    await person.until(() => person.presences.at(-1)?.agentActivity === null) // a moment later, nothing in particular

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

it('moves a frame with what is in it and its title, however it is moved or laid out', async () => {
  const { Store } = await import('@quickdrawjs/core')
  const { bindFrames } = await import('quickdraw-frames')
  const { applySteps } = await import('quickdraw-agent')
  const live = new Store(); bindFrames(live)
  const { result: [frame, one, two] } = applySteps(live, 'Codex', [
    { do: 'frame', title: 'Plan', at: { x: 0, y: 0 }, w: 600, h: 400, ref: 'f' }, { do: 'note', text: 'one', in: '@f' }, { do: 'note', text: 'two', in: '@f' },
  ]) as { result: string[] }
  for (const steps of [[{ do: 'move', id: frame, dx: 700 }], [{ do: 'arrange', ids: [frame], at: { x: -300, y: 50 } }]]) {
    const copy = new Store()
    copy.loadSnapshot({ document: { store: Object.fromEntries(live.all().map((r) => [r.id, structuredClone(r)])) } })
    bindFrames(copy)
    const { diff } = applySteps(copy, 'Codex', steps)
    await putLive(live, diff, copy, () => {}, 0) // as an agent puts it on the board: a record at a time
    const f = live.get(frame) as any, title = live.get(frame + '-title') as any
    for (const id of [one, two]) {
      const n = live.get(id) as any
      expect(n.frameId).toBe(frame) // still in it
      expect(n.x - f.x).toBe((copy.get(id) as any).x - (copy.get(frame) as any).x)
    }
    expect([title.x - f.x, title.y - f.y]).toEqual([0, -34]) // not left behind, nor moved twice
  }
})

it('puts a grown bento cell on the board a piece at a time, ending as on the copy', async () => {
  const { Store } = await import('@quickdrawjs/core')
  const { bindFrames } = await import('quickdraw-frames')
  const { bindLayouts } = await import('quickdraw-layouts')
  const { applySteps } = await import('quickdraw-agent')
  const live = new Store(); bindFrames(live); bindLayouts(live)
  const { result: [, a] } = applySteps(live, 'Codex', [
    { do: 'layout', cols: 2, w: 600, at: { x: 0, y: 0 }, ref: 'g' },
    { do: 'frame', title: 'A', in: '@g', span: '2x1' }, { do: 'frame', title: 'B', in: '@g' }, { do: 'frame', title: 'C', in: '@g' },
  ]) as { result: string[] }
  const copy = new Store()
  copy.loadSnapshot({ document: { store: Object.fromEntries(live.all().map((r) => [r.id, structuredClone(r)])) } })
  bindFrames(copy); bindLayouts(copy)
  // enough notes that A grows, and B and C move down: their records come one by one
  const { diff } = applySteps(copy, 'Codex', Array.from({ length: 5 }, (_, i) => ({ do: 'note', text: `n${i}`, in: a })))
  await putLive(live, diff, copy, () => {}, 0)
  const plain = (s: typeof live) => JSON.stringify(s.all().filter((r) => r.typeName === 'shape').map((r: any) => [r.id, r.x, r.y, r.props.w, r.props.h, r.span, r.order, r.frameId]).sort())
  expect(plain(live)).toBe(plain(copy))
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

// a 300 × 200 sheet and a 1500 × 1500 picture, made with whatever is here
function sheets(dir: string) {
  writeFileSync(join(dir, 'one.png'), PNG_1x1)
  const make = (h: number, w: number, out: string) => process.platform === 'darwin'
    ? execFileSync('sips', ['-z', String(h), String(w), join(dir, 'one.png'), '--out', join(dir, out)], { stdio: 'ignore' })
    : execFileSync('uv', ['run', '--quiet', '--no-project', '--with', 'pillow', 'python', '-c', `from PIL import Image; Image.new('RGBA', (${w}, ${h}), (255, 0, 0, 255)).save('${join(dir, out)}')`])
  make(200, 300, 'sheet.png')
  make(1500, 1500, 'big.png')
}
const hasUv = (() => { try { execFileSync('uv', ['--version'], { stdio: 'ignore' }); return true } catch { return false } })()

describe.each([
  ['sips', process.platform === 'darwin'],
  ['uv', hasUv],
])('images with %s', (tool, here) => {
  afterEach(() => { delete process.env.QUICKDRAW_IMAGE_TOOL })
  it.runIf(here)('cuts an even grid into its cells, row by row, and shrinks what is large', async () => {
    process.env.QUICKDRAW_IMAGE_TOOL = tool
    const dir = mkdtempSync(join(tmpdir(), 'qd-img-'))
    sheets(dir)
    const cells = await splitImage(join(dir, 'sheet.png'), { cols: 3, rows: 2 }, [dir], { inset: 0.1 })
    expect(cells.map((c) => [c.w, c.h])).toEqual(Array(6).fill([80, 80])) // 100 × 100, 10 px off each edge
    const edge = await splitImage(join(dir, 'sheet.png'), { cols: 3, rows: 2 }, [dir])
    // sips crops the middle at 0, 0, so the top-left cell starts 1 px in
    expect(edge.map((c) => [c.w, c.h])).toEqual(tool === 'sips' ? [[99, 99], [100, 99], [100, 99], [99, 100], [100, 100], [100, 100]] : Array(6).fill([100, 100]))
    const big = await loadImage(join(dir, 'big.png'), [dir])
    expect([big.w, big.h, big.src.slice(0, 15)]).toEqual([1024, 1024, 'data:image/jpeg'])
    const clear = await loadImage(join(dir, 'big.png'), [dir], { transparent: true })
    expect([clear.w, clear.src.slice(0, 14)]).toEqual([1024, 'data:image/png'])
    await expect(splitImage(join(dir, 'sheet.png'), { cols: 1, rows: 1 }, [dir])).rejects.toThrow(/2 to 64/)
    await expect(splitImage('/etc/hosts', { cols: 2, rows: 2 }, [dir])).rejects.toThrow(/outside/)
  }, 120_000)
})

it('without sips or uv, images go as they are and sheets are not cut', async () => {
  process.env.QUICKDRAW_IMAGE_TOOL = 'none'
  try {
    const dir = mkdtempSync(join(tmpdir(), 'qd-img-'))
    writeFileSync(join(dir, 'a.png'), PNG_1x1)
    await expect(splitImage(join(dir, 'a.png'), { cols: 2, rows: 2 }, [dir])).rejects.toThrow(/needs sips \(macOS\) or uv/)
  } finally { delete process.env.QUICKDRAW_IMAGE_TOOL }
})
