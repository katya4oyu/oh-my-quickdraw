import { afterEach, describe, expect, it } from 'vitest'
import { createQuickdrawServer } from '../src/serve/index.ts'
import { openBoard } from '../src/board/open.ts'
import { joinBoard } from '../src/agent/board-agent.ts'
import { initPi, modelsOf, runPi, type PiModel, type PiSdk } from '../src/agent/pi.ts'
import { AGENT, PRESENCE, packAgent, unpackAgent, unpackPresence } from '../src/protocol.js'

const cleanup: (() => unknown)[] = []
afterEach(async () => { for (const fn of cleanup.reverse()) await fn(); cleanup.length = 0 })

// a page on the board: what it hears
async function page(url: string) {
  const ws = new WebSocket(url)
  ws.binaryType = 'arraybuffer'
  await new Promise((ok) => { ws.onopen = ok })
  const events: any[] = [], agents: any[][] = [], presences: any[] = []
  const wake = new Set<() => void>()
  ws.onmessage = ({ data }) => {
    const m = new Uint8Array(data)
    if (m[0] === PRESENCE) presences.push(unpackPresence(m))
    if (m[0] === AGENT) {
      const msg = unpackAgent(m)
      if (msg.kind === 'event') events.push(msg.event)
      if (msg.kind === 'agents') agents.push(msg.agents)
    }
    for (const fn of wake) fn()
  }
  const until = (test: () => unknown) => new Promise<void>((ok) => {
    const check = () => { if (test()) { wake.delete(check); ok() } }
    wake.add(check)
    check()
  })
  ws.send(packAgent({ kind: 'hello' }))
  cleanup.push(() => ws.close())
  return { send: (m: object) => ws.send(packAgent(m)), events, agents, presences, until }
}

const MODELS: PiModel[] = [
  { id: 'm1', name: 'M1', provider: 'test', reasoning: true },
  { id: 'm2', name: 'M2', provider: 'test', reasoning: false },
]

// pi's SDK as far as quickdraw uses it: a session runs `script` for each prompt
type Script = (s: FakeSession, text: string) => Promise<void>
class FakeSession {
  messages: any[] = []
  isStreaming = false
  steered: string[] = []
  aborted = false
  private listeners = new Set<(e: any) => void>()
  private gates: ((e: any) => Promise<any>)[] = []
  private stopWaiting = () => {}
  options: any
  private script: Script
  constructor(options: any, script: Script) {
    this.options = options
    this.script = script
    for (const ext of options.resourceLoader.options.extensionFactories) ext.factory({ on: (type: string, fn: any) => { if (type === 'tool_call') this.gates.push(fn) } })
  }
  subscribe(fn: (e: any) => void) { this.listeners.add(fn); return () => this.listeners.delete(fn) }
  emit(e: any) { for (const fn of this.listeners) fn(e) }
  // a tool call, as pi makes it: the extensions first, then the tool
  async tool(toolName: string, input: any): Promise<string> {
    for (const gate of this.gates) {
      const r = await gate({ type: 'tool_call', toolName, input })
      if (r?.block) return `blocked: ${r.reason}`
    }
    const custom = this.options.customTools.find((t: any) => t.name === toolName)
    if (custom) return (await custom.execute('call', input)).content[0].text
    this.emit({ type: 'tool_execution_start', toolName, args: input })
    this.emit({ type: 'tool_execution_end', toolName })
    return 'ran'
  }
  say(text: string, stopReason = 'stop') {
    const message = { role: 'assistant', content: [{ type: 'text', text }], stopReason, model: 'm1', provider: 'test' }
    this.emit({ type: 'message_start', message })
    this.messages.push(message)
    this.emit({ type: 'message_end', message })
  }
  // until Stop is pressed
  waitForStop() { return new Promise<void>((ok) => { this.stopWaiting = ok }) }
  async prompt(text: string) {
    this.isStreaming = true
    this.emit({ type: 'turn_start' })
    try { await this.script(this, text) } finally { this.isStreaming = false }
  }
  async steer(text: string) { this.steered.push(text) }
  async abort() { this.aborted = true; this.messages.push({ role: 'assistant', content: [], stopReason: 'aborted' }); this.stopWaiting() }
  getLastAssistantText() { return this.messages.filter((m) => m.role === 'assistant').at(-1)?.content.find((c: any) => c.type === 'text')?.text }
  dispose() {}
}
function fakeSdk(script: Script) {
  const sessions: FakeSession[] = []
  const sdk: PiSdk = {
    getAgentDir: () => '/nowhere',
    SessionManager: { inMemory: () => ({}) },
    SettingsManager: { create: () => ({ getDefaultProvider: () => undefined, getDefaultModel: () => undefined, getDefaultThinkingLevel: () => undefined }) },
    ModelRuntime: { create: async () => ({ getAvailable: async () => MODELS, getModel: (p: string, id: string) => MODELS.find((m) => m.provider === p && m.id === id) }) },
    DefaultResourceLoader: class { options: any; constructor(options: any) { this.options = options } async reload() {} },
    async createAgentSession(options: any) {
      const session = new FakeSession(options, script)
      sessions.push(session)
      return { session }
    },
  }
  return { sdk, sessions }
}

async function setUp(script: Script) {
  const app = createQuickdrawServer()
  cleanup.push(() => app.close())
  const { port } = await app.listen(0)
  const url = `ws://127.0.0.1:${port}/ws/${app.boards.create('Test').id}`
  const person = await page(url)
  const { sdk, sessions } = fakeSdk(script)
  const offered = await initPi(sdk, process.cwd())
  const board = await openBoard({ url, name: 'pi · repo' })
  const agent = await joinBoard(board, { id: 'pi-repo', name: 'pi · repo', knows: ['repo'], models: offered.models, model: offered.model, effort: offered.effort })
  cleanup.push(() => agent.close())
  const running = await runPi(sdk, offered.runtime, agent, { cwd: process.cwd(), name: 'pi · repo', model: offered.model, effort: offered.effort })
  cleanup.push(running.close)
  await person.until(() => person.agents.at(-1)?.[0]?.name === 'pi · repo')
  return { person, board, sessions, offered }
}
const ask = (id: string, text: string, options?: object) => ({ kind: 'request', request: { id, to: 'pi-repo', text, context: { shapeIds: [], frameIds: [], viewport: { x: 0, y: 0, w: 1, h: 1 } }, anchor: {}, ...(options ? { options } : {}) } })

describe('quickdraw agent pi', () => {
  it('turns a request into a pi run with the board tools, and asks people before a command', async () => {
    // as pi does: an answer with a tool call, then the call
    const { person, board, sessions, offered } = await setUp(async (s) => {
      s.say('Adding a note.', 'toolUse')
      await s.tool('add_note', { text: 'From pi' })
      s.say('Cleaning up.', 'toolUse')
      s.say(`Added a note (${await s.tool('bash', { command: 'rm -rf build' })}).`)
    })
    expect(offered).toMatchObject({ model: 'test/m1', effort: 'medium' })
    // the panel offers both, the one that does not reason with no effort
    expect(person.agents.at(-1)?.[0].models).toEqual([
      { id: 'test/m1', name: 'M1 · test', efforts: ['off', 'minimal', 'low', 'medium', 'high', 'xhigh'], effort: 'medium' },
      { id: 'test/m2', name: 'M2 · test', efforts: [], effort: '' },
    ])
    person.send(ask('r1', 'Add a note', { model: 'test/m2' }))
    await person.until(() => person.events.some((e) => e.type === 'approval'))
    expect(person.agents.at(-1)?.[0].status).toBe('waiting')
    const approval = person.events.find((e) => e.type === 'approval')
    expect(approval.text).toBe('Run rm -rf build')
    person.send({ kind: 'reply', requestId: 'r1', message: { approval: approval.id, allow: false } })
    await person.until(() => person.events.some((e) => e.type === 'done'))

    // the model chosen in the panel, and the instructions for a board
    expect(sessions[0].options.model).toBe(MODELS[1])
    expect(sessions[0].options.resourceLoader.options.appendSystemPromptOverride([])[0]).toMatch(/You cannot generate images here/)
    // what it runs on, what it says while it works, the note, the command declined
    expect(person.events.map((e) => [e.type, e.text])).toEqual([
      ['progress', 'm1 · medium'], ['progress', 'Adding a note.'], ['op', undefined], ['progress', 'Cleaning up.'],
      ['approval', 'Run rm -rf build'], ['message', 'Added a note (blocked: A person on the board declined it.).'], ['done', undefined],
    ])
    const op = person.events.find((e) => e.type === 'op')
    expect(board.store.get(op.ids[0])).toMatchObject({ type: 'note', props: { text: 'From pi' }, agent: { name: 'pi · repo' } })
    await person.until(() => person.agents.at(-1)?.[0].status === 'idle')
    expect(person.agents.at(-1)?.[0].account).toBe('test')
  })

  it('steers a run with a follow-up, and stops it', async () => {
    const { person, sessions } = await setUp((s) => s.waitForStop())
    person.send(ask('r2', 'Draw a map'))
    await person.until(() => person.agents.at(-1)?.[0].status === 'working')
    person.send({ kind: 'reply', requestId: 'r2', message: 'Bigger, please' })
    await new Promise((r) => setTimeout(r, 100))
    expect(sessions[0].steered).toEqual(['Bigger, please'])
    person.send({ kind: 'reply', requestId: 'r2', message: { stop: true } })
    await person.until(() => person.events.some((e) => e.type === 'done'))
    expect(sessions[0].aborted).toBe(true)
    expect(person.events.find((e) => e.type === 'done').text).toBe('Stopped.')
  })
})

it('offers the models pi can use, with the thinking levels a reasoning model takes', () => {
  expect(modelsOf([
    { id: 'a', name: 'A', provider: 'p', reasoning: true, thinkingLevelMap: { minimal: null, max: 'max' } },
    { id: 'b', name: 'B', provider: 'p', reasoning: false },
  ])).toEqual([
    { id: 'p/a', name: 'A · p', efforts: ['off', 'low', 'medium', 'high', 'xhigh', 'max'], effort: 'medium' },
    { id: 'p/b', name: 'B · p', efforts: [], effort: '' },
  ])
})

it('puts the default model first, since the board takes only so many', async () => {
  const { sdk } = fakeSdk(async () => {})
  const offered = await initPi(sdk, process.cwd(), { model: 'test/m2' })
  expect(offered.model).toBe('test/m2')
  expect(offered.models.map((m) => m.id)).toEqual(['test/m2', 'test/m1'])
  expect(offered.effort).toBeUndefined() // m2 takes none
})
