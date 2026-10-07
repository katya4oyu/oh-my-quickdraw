import { afterEach, describe, expect, it } from 'vitest'
import { fileURLToPath } from 'node:url'
import { createQuickdrawServer } from '../src/serve/index.ts'
import { openBoard } from '../src/board/open.ts'
import { joinBoard, putLive } from '../src/agent/board-agent.ts'
import { accountText, activityOf, commandText, initCodex, limitsOf, startAppServer, runCodex } from '../src/agent/codex.ts'
import { realtimeVoices, runVoice } from '../src/agent/voice.ts'
import { placeSnapshot } from 'quickdraw-screenshare'
import { createKanban } from 'quickdraw-tickets'
import { readPet, setPet } from '../src/board/avatar.ts'
import { main } from '../src/commands/index.ts'
import { deflateSync } from 'node:zlib'
import { findChrome } from '../src/board/chrome.ts'
import { imageSize, imageSteps, loadImage, splitImage, within } from '../src/agent/images.ts'
import { Store } from '@quickdrawjs/core'
import { applySteps } from 'quickdraw-agent'
import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { AGENT, PRESENCE, packAgent, unpackAgent, unpackPresence } from '../src/protocol.js'

// a see-through PNG of any size (what a pet's sheet looks like to the checks)
function blankPng(w: number, h: number) {
  const crc = (b: Buffer) => { let c = ~0; for (const x of b) { c ^= x; for (let k = 0; k < 8; k++) c = (c >>> 1) ^ (0xedb88320 & -(c & 1)) } return ~c >>> 0 }
  const chunk = (type: string, data: Buffer) => { const t = Buffer.from(type); const len = Buffer.alloc(4); len.writeUInt32BE(data.length); const c = Buffer.alloc(4); c.writeUInt32BE(crc(Buffer.concat([t, data]))); return Buffer.concat([len, t, data, c]) }
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 6
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(Buffer.alloc((w * 4 + 1) * h))), chunk('IEND', Buffer.alloc(0))])
}
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

describe('omq agent codex-app-server', () => {
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
      ['progress', 'fast'], ['reply', 'Put a note that says hi.'], ['area', ''], ['op', ''], ['progress', 'Added it (true).'], ['message', 'Done, it says hi.'],
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
    // kept with the thread: claimed (its ticket at the top, notes around it and Ann's), moved
    expect(app.threads.get('w1')?.thread.events.filter((e: any) => e.type === 'area').map((e: any) => [e.area.y, e.area.h > 400, e.by ?? 'agent'])).toEqual([[200, false, 'agent'], [0, false, 'person']])
    const ticket = board.store.shapes().find((s: any) => s.type === 'ticket') as any
    expect([ticket.x, ticket.y, ticket.props.status]).toEqual([324, 244, 'doing'])

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

    // its first note marks out its work area (where it put it), and puts up its ticket there
    expect(person.events.map((e) => e.type)).toEqual(['progress', 'progress', 'area', 'op', 'progress', 'approval', 'message', 'done'])
    const ticket = board.store.shapes().find((s: any) => s.type === 'ticket') as any
    expect(ticket.props).toMatchObject({ title: 'Add a note', to: 'Codex · repo', by: 'Codex · repo', status: 'done', result: 'Added a note (Add a note).', work: { request: 'r1' } })
    const area = person.events.find((e) => e.type === 'area').area
    expect(ticket.x >= area.x && ticket.y >= area.y && ticket.x + ticket.props.w <= area.x + area.w).toBe(true) // in its work area
    expect(ticket.props.work.area).toEqual(area)
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

describe('work tickets', () => {
  const ask = (id: string, to: string, text: string) => ({ kind: 'request', request: { id, to, text, context: { shapeIds: [], frameIds: [], viewport: { x: 0, y: 0, w: 1200, h: 800 } }, anchor: {} } })
  const ticketsOf = (store: any) => store.shapes().filter((s: any) => s.type === 'ticket')
  const settle = (ms = 250) => new Promise((r) => setTimeout(r, ms))
  async function twoAgents(title: string) {
    const app = createQuickdrawServer()
    cleanup.push(() => app.close())
    const { port } = await app.listen(0)
    const url = `ws://127.0.0.1:${port}/ws/${app.boards.create(title).id}`
    const person = await page(url)
    const adaBoard = await openBoard({ url, name: 'Ada' })
    const ada = await joinBoard(adaBoard, { id: 'ada', name: 'Ada', knows: [] })
    const boBoard = await openBoard({ url, name: 'Bo' })
    const bo = await joinBoard(boBoard, { id: 'bo', name: 'Bo', knows: [] })
    cleanup.push(() => ada.close(), () => bo.close())
    await person.until(() => person.agents.at(-1)?.length === 2)
    return { person, ada, adaBoard, bo, boBoard }
  }

  it('puts up a ticket for what it works on, at its first change; agents keep out of each other\'s work; it closes when done, or fails when it leaves', async () => {
    const { person, ada, adaBoard, bo, boBoard } = await twoAgents('Work')
    person.send(ask('a1', 'ada', 'Map the flow\nwith the error paths'))
    person.send(ask('b1', 'bo', 'Tidy the board'))
    await settle()

    // reading changes nothing: no ticket
    await ada.runTool('a1', 'read_board', {})
    expect(ticketsOf(adaBoard.store)).toEqual([])
    const first = JSON.parse(await ada.runTool('a1', 'add_note', { text: 'Start' }))
    const [ticket] = ticketsOf(adaBoard.store)
    expect(ticket.props).toMatchObject({ title: 'Map the flow', body: 'with the error paths', to: 'Ada', by: 'Ada', status: 'doing', work: { request: 'a1' } })
    const area = ticket.props.work.area
    const note = adaBoard.store.get(first.ids[0]) as any
    expect(note.x >= area.x && note.y >= area.y && note.x + 200 <= area.x + area.w && note.y + 200 <= area.y + area.h).toBe(true)
    // only once: its next steps are in the same ticket and area
    await ada.runTool('a1', 'add_note', { text: 'Then' })
    expect(ticketsOf(adaBoard.store)).toHaveLength(1)

    // Bo may not change what is in Ada's work, nor put things there
    await settle()
    await expect(bo.runTool('b1', 'update_shape', { id: first.ids[0], text: 'Mine now' })).rejects.toThrow(/^Ada is working there: "Map the flow" \(its ticket .*\)\. Agents keep out of each other's work/)
    await expect(bo.runTool('b1', 'add_note', { text: 'Here', at: { x: area.x + 10, y: area.y + 10 } })).rejects.toThrow(/Ada is working there/)
    expect((boBoard.store.get(first.ids[0]) as any).props.text).toBe('Start')
    // elsewhere is fine
    await bo.runTool('b1', 'add_note', { text: 'Elsewhere', at: { x: 6000, y: 6000 } })
    expect(ticketsOf(boBoard.store).map((t: any) => [t.props.by, t.props.status])).toEqual([['Ada', 'doing'], ['Bo', 'doing']])

    // done: its ticket says so, with what it said last; then its part of the board is open to others
    ada.emit('a1', { type: 'message', text: 'Mapped it: 2 paths.\nMore below' })
    ada.emit('a1', { type: 'done' })
    expect(adaBoard.store.get(ticket.id)).toMatchObject({ props: { status: 'done', result: 'Mapped it: 2 paths.' } })
    await settle()
    await bo.runTool('b1', 'update_shape', { id: first.ids[0], text: 'Bo was here' })

    // Bo leaves before it is done: its ticket failed
    await bo.close()
    await settle()
    const bos = ticketsOf(adaBoard.store).find((t: any) => t.props.by === 'Bo')
    expect(bos.props).toMatchObject({ status: 'failed', result: 'Bo left the board before it was done.' })
  }, 20_000)

  it('joins with a role; agents set roles; read_board ends with the team: roles, who is here, what each works on', async () => {
    const app = createQuickdrawServer()
    cleanup.push(() => app.close())
    const { port } = await app.listen(0)
    const url = `ws://127.0.0.1:${port}/ws/${app.boards.create('Team').id}`
    const person = await page(url)
    const adaBoard = await openBoard({ url, name: 'Ada' })
    const ada = await joinBoard(adaBoard, { id: 'ada', name: 'Ada', knows: [], role: 'transcriber' })
    const boBoard = await openBoard({ url, name: 'Bo' })
    const bo = await joinBoard(boBoard, { id: 'bo', name: 'Bo', knows: [] })
    cleanup.push(() => ada.close(), () => bo.close())
    await person.until(() => person.agents.at(-1)?.length === 2)
    person.send(ask('a1', 'ada', 'Write down what we said'))
    person.send(ask('b1', 'bo', 'Look things up'))
    await settle()
    expect(boBoard.members!.get('ada')).toMatchObject({ role: 'transcriber', by: 'Ada' })

    // Bo takes a role, and gives Ada a line on what it does
    expect(JSON.parse(await bo.runTool('b1', 'set_role', { role: 'researcher', about: 'Looks things up on the web' })).member).toMatchObject({ name: 'Bo', role: 'researcher', by: 'Bo' })
    await bo.runTool('b1', 'set_role', { name: 'Ada', role: 'transcriber', about: 'Writes down what people say' })
    await ada.runTool('a1', 'add_note', { text: 'Notes' })
    await settle()
    const read = await bo.runTool('b1', 'read_board', {})
    expect(read).toMatch(/## Team: the agents of this board, their roles and what they work on\n\n- Bo \(you\) — role: researcher \(Looks things up on the web\), set by Bo\n- Ada — role: transcriber \(Writes down what people say\), set by Bo — working on "Write down what we said" \(shape:/)
    expect(await bo.runTool('b1', 'read_board', { format: 'json' })).not.toMatch(/Team/)
    // an empty role takes it off
    await bo.runTool('b1', 'set_role', { role: '' })
    expect(boBoard.members!.get('Bo')).toBeNull()
    await settle()
    expect(adaBoard.members!.get('Bo')).toBeNull() // for everyone
  }, 20_000)

  it('asks in a frame\'s thread what it cannot decide; read_board shows the threads with the answers', async () => {
    const app = createQuickdrawServer()
    cleanup.push(() => app.close())
    const { port } = await app.listen(0)
    const url = `ws://127.0.0.1:${port}/ws/${app.boards.create('Comments').id}`
    const person = await page(url)
    const adaBoard = await openBoard({ url, name: 'Ada' })
    const ada = await joinBoard(adaBoard, { id: 'ada', name: 'Ada', knows: [] })
    cleanup.push(() => ada.close())
    await person.until(() => person.agents.at(-1)?.length === 1)
    person.send(ask('a1', 'ada', 'Draw why the release slipped'))
    await settle()
    const frame = JSON.parse(await ada.runTool('a1', 'add_frame', { title: 'Why the release slipped', w: 600, h: 400 })).ids[0]
    expect(JSON.parse(await ada.runTool('a1', 'add_comment', { frame, text: 'Left the test-env note out. Keep it out?' }))).toMatchObject({ frame })
    await expect(ada.runTool('a1', 'add_comment', { frame: 'shape:nope', text: 'hi' })).rejects.toThrow(/not a frame/)
    adaBoard.comments!.add(frame, 'Keep it out.', 'Ann')
    expect(await ada.runTool('a1', 'read_board', {})).toMatch(/## Comments[\s\S]*- Ada \([^)]+\): Left the test-env note out\. Keep it out\?\n- Ann \([^)]+\): Keep it out\./)
  }, 20_000)

  it('joins with a Codex pet: its sheet goes on the board (smaller), the table points at it, and goes when it is taken off', async () => {
    const app = createQuickdrawServer()
    cleanup.push(() => app.close())
    const { port } = await app.listen(0)
    const url = `ws://127.0.0.1:${port}/ws/${app.boards.create('Pets').id}`
    const dir = mkdtempSync(join(tmpdir(), 'qd-pet-'))
    writeFileSync(join(dir, 'pet.json'), JSON.stringify({ id: 'mio', displayName: 'Mio', spritesheetPath: 'spritesheet.png' }))
    writeFileSync(join(dir, 'spritesheet.png'), blankPng(1536, 1872))
    writeFileSync(join(dir, 'small.png'), blankPng(192, 208))
    const adaBoard = await openBoard({ url, name: 'Ada' })
    const ada = await joinBoard(adaBoard, { id: 'ada', name: 'Ada', knows: [], avatar: dir })
    cleanup.push(() => ada.close())
    const avatar = adaBoard.members!.get('Ada')!.avatar as any
    expect(avatar).toMatchObject({ kind: 'codex-pet', name: 'Mio' })
    const asset = adaBoard.store.asset(avatar.asset) as any
    expect(asset.src).toMatch(/^data:image\/(webp|png);base64,/)
    expect([768, 1536]).toContain(asset.w) // half its size where uv can, else as it is
    await expect(setPet(adaBoard, 'Ada', join(dir, 'small.png'), 'Ada')).rejects.toThrow(/a Codex pet's sheet is 1536 × 1872 \(8 × 9 cells of 192 × 208\), not 192 × 208/)
    await setPet(adaBoard, 'Ada', null, 'Ann')
    expect(adaBoard.members!.get('Ada')).toBeNull()
    expect(adaBoard.store.asset(avatar.asset)).toBeFalsy() // nothing else used it
  }, 60_000)

  it('finds a pet installed for Codex by its name, and lists them', async () => {
    const home = mkdtempSync(join(tmpdir(), 'qd-codex-'))
    const was = process.env.CODEX_HOME
    process.env.CODEX_HOME = home
    cleanup.push(() => { if (was === undefined) delete process.env.CODEX_HOME; else process.env.CODEX_HOME = was })
    for (const [dir, name] of [['mio', 'Mio'], ['rocket-cat', 'Rocket Cat']]) {
      mkdirSync(join(home, 'pets', dir), { recursive: true })
      writeFileSync(join(home, 'pets', dir, 'pet.json'), JSON.stringify({ id: dir, displayName: name, description: `${name}, a pet`, spritesheetPath: 'spritesheet.png' }))
      writeFileSync(join(home, 'pets', dir, 'spritesheet.png'), blankPng(1536, 1872))
    }
    mkdirSync(join(home, 'pets', 'not-a-pet'))
    const lines: string[] = []
    await main(['avatar', '--list'], (l) => { lines.push(l) }) // no board needed
    expect(JSON.parse(lines.join('\n')).map((p: any) => [p.name, p.displayName])).toEqual([['mio', 'Mio'], ['rocket-cat', 'Rocket Cat']])
    expect((await readPet('mio')).name).toBe('Mio') // its folder's name
    expect((await readPet('rocket cat')).name).toBe('Rocket Cat') // or what it is called
    await expect(readPet('dog')).rejects.toThrow(/no pet "dog" in .*pets \(there: mio, rocket-cat\)/)
  }, 60_000)

  it('reads the boards on this board\'s cards: their titles, frames and how much is in them', async () => {
    const app = createQuickdrawServer()
    cleanup.push(() => app.close())
    const { port } = await app.listen(0)
    const home = app.boards.create('Home').id, road = app.boards.create('Roadmap').id, gone = app.boards.create('Old').id
    const url = (id: string) => `ws://127.0.0.1:${port}/ws/${id}`
    const other = await openBoard({ url: url(road), name: 'Ann' })
    applySteps(other.store as never, 'Ann', [
      { do: 'frame', title: 'Q1', at: { x: 0, y: 0 }, w: 600, h: 400, ref: 'f' }, { do: 'note', text: 'Launch', in: '@f' }, { do: 'note', text: 'Hire', in: '@f' },
      { do: 'note', text: 'Loose', at: { x: 900, y: 0 } },
    ] as never)
    await other.close()
    app.boards.archive(gone, true)
    const board = await openBoard({ url: url(home), name: 'Codex' })
    const agent = await joinBoard(board, { id: 'codex', name: 'Codex', knows: [] })
    cleanup.push(() => agent.close())
    applySteps(board.store as never, 'Codex', [{ do: 'board', board: road, title: 'Roadmap', live: true }, { do: 'board', board: gone, title: 'Old', at: { x: 0, y: 600 } }] as never)
    await new Promise((r) => setTimeout(r, 300))
    const read = await agent.runTool('r', 'read_board', {})
    expect(read).toMatch(new RegExp(`## Boards on this board \\(board cards: .*\\)\\n\\n- Roadmap \\(board ${road}, live\\): frames: Q1 \\(2 in it\\); 1 shape outside frames`))
    expect(read).toMatch(new RegExp(`- Old \\(board ${gone}\\): not on the server now`))
  }, 20_000)

  it('keeps out only of the work of agents on the board, and puts its ticket in the Doing column of a kanban', async () => {
    const { person, ada, adaBoard, bo, boBoard } = await twoAgents('Kanban')
    const { columns } = createKanban(adaBoard.store as never, { x: -2000, y: 0 }) as { columns: Record<string, string> }
    person.send(ask('a1', 'ada', 'Draw a box'))
    person.send(ask('b1', 'bo', 'Draw next to it'))
    await settle()
    const made = JSON.parse(await ada.runTool('a1', 'add_note', { text: 'Box' }))
    const [ticket] = ticketsOf(adaBoard.store)
    expect(ticket.frameId).toBe(columns.doing)
    const areaEvent = person.events.find((e) => e.type === 'area' && e.requestId === 'a1')
    expect(areaEvent.area.x).toBeGreaterThan(-500) // around its note, not the kanban
    await settle()
    // Ada is gone (its ticket left as it was, say): Bo may work there
    await ada.close()
    adaBoard.store.update(ticket.id, { props: { status: 'doing' } } as never)
    await settle()
    await bo.runTool('b1', 'update_shape', { id: made.ids[0], text: 'Box, by Bo' })
    expect((boBoard.store.get(made.ids[0]) as any).props.text).toBe('Box, by Bo')
  }, 20_000)
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

it('puts an SVG as it is, with a size from its viewBox; and does not cut one', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'qd-svg-'))
  writeFileSync(join(dir, 'icon.svg'), '<?xml version="1.0"?>\n<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 12"><rect width="24" height="12" fill="teal"/></svg>\n')
  writeFileSync(join(dir, 'fake.svg'), 'not svg at all')
  const img = await loadImage(join(dir, 'icon.svg'), [dir])
  expect(img.src).toMatch(/^data:image\/svg\+xml;base64,/)
  expect([img.w, img.h]).toEqual([24, 12])
  expect(Buffer.from(img.src.split(',')[1], 'base64').toString()).toContain('<svg width="24" height="12" xmlns=')
  await expect(loadImage(join(dir, 'fake.svg'), [dir])).rejects.toThrow(/is not SVG/)
  await expect(splitImage(join(dir, 'icon.svg'), { cols: 2, rows: 2 }, [dir])).rejects.toThrow(/an SVG is not cut into cells/)
  // on a board: an image of its own size (400 wide unless told)
  const store = new Store()
  const { result } = applySteps(store as never, 'Agent', await imageSteps(join(dir, 'icon.svg'), { w: 240 }, [dir]) as never) as any
  const shape = store.get(result[0]) as any
  expect([shape.type, shape.props.w, shape.props.h]).toEqual(['image', 240, 120])
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
