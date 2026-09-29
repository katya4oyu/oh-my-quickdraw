// `quickdraw agent pi`: pi on a board. pi runs here, in this process, through
// its SDK (@earendil-works/pi-coding-agent, an optional dependency), in the
// working directory: its files, AGENTS.md and skills, and the person's own pi
// settings and sign-ins (~/.pi/agent). The board tools go to it as custom
// tools, so they run here on the board, like any request (./board-agent.ts).
//
// One pi session per request; a person's follow-up in the panel continues it
// (steering the run if one is going). pi itself asks no one before it runs a
// command or changes a file: here bash, edit and write wait for a person in the
// panel, unless `approval` is off. pi does not talk or make images.
import { readFileSync } from 'node:fs'
import type { AgentModel, AgentRequest } from 'quickdraw-agent'
import type { BoardAgent } from './board-agent.ts'
import { clip, commandText } from './codex.ts'
import { instructions } from './instructions.ts'

type Json = any

// what is used of the SDK, as it is typed there (loosely: tests hand in their own)
export interface PiModel { id: string, name: string, provider: string, reasoning: boolean, thinkingLevelMap?: Record<string, unknown> }
export interface PiSession {
  prompt(text: string, options?: { images?: Json[], expandPromptTemplates?: boolean }): Promise<void>
  steer(text: string): Promise<void>
  abort(): Promise<void>
  subscribe(fn: (event: Json) => void): () => void
  getLastAssistantText(): string | undefined
  readonly isStreaming: boolean
  readonly messages: Json[]
  dispose(): void
}
export interface PiSdk {
  createAgentSession(options: Json): Promise<{ session: PiSession }>
  DefaultResourceLoader: new (options: Json) => { reload(): Promise<void> }
  SessionManager: { inMemory(cwd?: string): unknown }
  ModelRuntime: { create(): Promise<{ getAvailable(): Promise<readonly PiModel[]>, getModel(provider: string, id: string): PiModel | undefined }> }
  SettingsManager: { create(cwd: string): { getDefaultProvider(): string | undefined, getDefaultModel(): string | undefined, getDefaultThinkingLevel(): string | undefined } }
  getAgentDir(): string
}

export interface PiOptions {
  cwd: string
  name: string
  /** used when a request does not say: `provider/id`, and a thinking level */
  model?: string
  effort?: string
  /** bash, edit and write wait for a person in the panel (default) */
  approval?: boolean
}

const LEVELS = ['off', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max']
const CHANGES_FILES = new Set(['edit', 'write'])

/** the models pi can use (those it has a sign-in for), for the panel's picker */
export function modelsOf(models: readonly PiModel[]): AgentModel[] {
  return models.map((m) => {
    // a level the model's map marks null is not offered; `max` only where the map names it
    const efforts = m.reasoning ? LEVELS.filter((l) => (l === 'max' ? m.thinkingLevelMap?.max != null : m.thinkingLevelMap?.[l] !== null)) : []
    return { id: `${m.provider}/${m.id}`, name: `${m.name ?? m.id} · ${m.provider}`, efforts, effort: efforts.includes('medium') ? 'medium' : efforts[0] ?? '' }
  })
}

/** what the request says, and what it is about on the board (as for Codex) */
function prompt(request: AgentRequest): string {
  const { shapeIds, frameIds, area } = request.context
  const about = shapeIds.length
    ? `\n\n(Selected on the board: ${shapeIds.join(', ')}${frameIds.length ? `; of which frames: ${frameIds.join(', ')}` : ''}.)`
    : ''
  const where = area
    ? `\n\n(They marked out where it goes: x ${Math.round(area.x)}, y ${Math.round(area.y)}, ${Math.round(area.w)} × ${Math.round(area.h)}. It is your work area already: what you add without a place goes in it.)`
    : ''
  return request.text + about + where
}

const textOf = (message: Json): string => (message?.content ?? []).filter((c: Json) => c.type === 'text').map((c: Json) => c.text).join('').trim()
const mimeOf = (file: string) => (/\.jpe?g$/i.test(file) ? 'image/jpeg' : /\.webp$/i.test(file) ? 'image/webp' : 'image/png')

/** What pi offers the panel: the models it can use, and the defaults (the options', else the person's pi settings) */
export async function initPi(sdk: PiSdk, cwd: string, defaults: { model?: string, effort?: string } = {}) {
  const runtime = await sdk.ModelRuntime.create()
  const models = modelsOf(await runtime.getAvailable())
  if (!models.length) throw new Error('pi has no model it can use: sign in or set an API key with pi first')
  const settings = sdk.SettingsManager.create(cwd)
  const set = [settings.getDefaultProvider(), settings.getDefaultModel()].filter(Boolean).join('/')
  const model = [defaults.model, set].find((m) => models.some((o) => o.id === m)) ?? defaults.model ?? models[0].id
  const effort = defaults.effort ?? settings.getDefaultThinkingLevel() ?? models.find((o) => o.id === model)?.effort
  // the default first: the board takes the first 100
  const first = models.findIndex((o) => o.id === model)
  if (first > 0) models.unshift(...models.splice(first, 1))
  return { runtime, models, model, effort: effort || undefined }
}

/** Connects pi to a board agent. */
export async function runPi(sdk: PiSdk, runtime: Awaited<ReturnType<typeof initPi>>['runtime'], agent: BoardAgent, { cwd, name, model, effort, approval = true }: PiOptions) {
  const sessions = new Map<string, { session: PiSession, stopped: boolean, announced: boolean }>()
  let running = 0, waiting = 0
  const updateStatus = () => agent.status(waiting ? 'waiting' : running ? 'working' : 'idle')

  // bash, edit and write: a person answers in the panel first (pi reports the
  // call before it asks here, so what it does is said only once it may)
  const gate = (requestId: string) => (pi: Json) => pi.on('tool_call', async (event: Json) => {
    const bash = event.toolName === 'bash'
    if (!bash && !CHANGES_FILES.has(event.toolName)) return undefined
    const command = bash ? commandText(String(event.input?.command ?? '')) : ''
    if (approval) {
      waiting++
      updateStatus()
      try {
        if (!(await agent.approve(requestId, bash ? `Run ${command}` : `Change ${event.input?.path ?? 'a file'}`))) return { block: true, reason: 'A person on the board declined it.' }
      } finally { waiting--; updateStatus() }
    }
    agent.emit(requestId, { type: 'progress', text: bash ? `Running ${command}` : `Editing ${event.input?.path ?? 'files'}` })
    if (bash) agent.activity('running', command.slice(0, 60))
    else agent.activity('editing')
    return undefined
  })

  // the board tools as pi's custom tools: they run on the board, a piece at a time
  const toolsFor = (requestId: string) => agent.tools.map((t) => ({
    name: t.name, label: t.name, description: t.description, parameters: t.inputSchema,
    async execute(_id: string, params: Json) {
      if (t.name === 'look_at') { // a picture, not text
        agent.activity('reading')
        try {
          const png = await agent.picture(params ?? {})
          return { content: png ? [{ type: 'image', data: png.toString('base64'), mimeType: 'image/png' }] : [{ type: 'text', text: 'Nothing to draw there.' }], details: {} }
        } finally { agent.activity('thinking') }
      }
      return { content: [{ type: 'text', text: await agent.runTool(requestId, t.name, params) }], details: {} }
    },
  }))

  async function start(request: AgentRequest) {
    const [provider, ...id] = (request.options?.model ?? model ?? '').split('/')
    const chosen = id.length ? runtime.getModel(provider, id.join('/')) : undefined
    const thinkingLevel = request.options?.effort ?? effort
    const resourceLoader = new sdk.DefaultResourceLoader({
      cwd, agentDir: sdk.getAgentDir(),
      extensionFactories: [{ name: 'quickdraw-approvals', factory: gate(request.id), hidden: true }],
      appendSystemPromptOverride: (base: string[]) => [...base, instructions(name, { imageGeneration: false })],
    })
    await resourceLoader.reload()
    const { session } = await sdk.createAgentSession({
      cwd, modelRuntime: runtime, resourceLoader, sessionManager: sdk.SessionManager.inMemory(cwd),
      customTools: toolsFor(request.id),
      ...(chosen ? { model: chosen } : {}), ...(thinkingLevel ? { thinkingLevel } : {}),
    })
    const s = { session, stopped: false, announced: false }
    sessions.set(request.id, s)
    session.subscribe((event) => {
      if (event.type === 'turn_start') agent.activity('thinking')
      else if (event.type === 'message_start' && event.message?.role === 'assistant' && !s.announced) {
        // the first answer says what it runs on
        s.announced = true
        agent.emit(request.id, { type: 'progress', text: [event.message.model, thinkingLevel].filter(Boolean).join(' · ') })
        agent.account({ account: event.message.provider })
      } else if (event.type === 'tool_execution_end' && (event.toolName === 'bash' || CHANGES_FILES.has(event.toolName))) agent.activity('thinking')
      else if (event.type === 'message_end' && event.message?.role === 'assistant' && event.message.stopReason === 'toolUse') {
        // what it says while it works is progress; the last answer is its reply
        const text = textOf(event.message)
        if (text) agent.emit(request.id, { type: 'progress', text: clip(text, 400) })
      }
    })
    return s
  }

  // a run, from a request or a follow-up, until pi settles: then its answer, or why it stopped
  async function run(requestId: string, text: string, images: Json[] = []) {
    const s = sessions.get(requestId)!
    s.stopped = false
    running++
    updateStatus()
    agent.activity('thinking')
    try {
      await s.session.prompt(text, { images, expandPromptTemplates: false })
      const last = [...s.session.messages].reverse().find((m: Json) => m.role === 'assistant')
      if (last?.stopReason === 'error') agent.emit(requestId, { type: 'error', message: last.errorMessage ?? 'pi stopped with an error.' })
      else if (s.stopped || last?.stopReason === 'aborted') agent.emit(requestId, { type: 'done', text: 'Stopped.' })
      else {
        const answer = s.session.getLastAssistantText()
        if (answer) agent.emit(requestId, { type: 'message', text: answer })
        agent.emit(requestId, { type: 'done' })
      }
    } catch (e) {
      agent.emit(requestId, { type: 'error', message: (e as Error).message })
    } finally {
      running--
      updateStatus()
      if (!running) agent.activity(s.stopped ? null : 'done')
    }
  }

  agent.onRequest = async (request) => {
    try {
      agent.lookAt(request)
      await start(request)
      // feedback it carries (snapshots written on): what people said, and the pictures
      let text = prompt(request)
      const images: Json[] = []
      const ids = request.context.feedback ?? []
      if (ids.length) {
        agent.emit(request.id, { type: 'progress', text: `Looking at ${ids.length} snapshot${ids.length === 1 ? '' : 's'}` })
        const fb = await agent.feedback(ids)
        if (fb.text) text = fb.text + '\n\n' + text
        for (const file of fb.images) images.push({ type: 'image', data: readFileSync(file).toString('base64'), mimeType: mimeOf(file) })
      }
      await run(request.id, text, images)
    } catch (e) {
      agent.emit(request.id, { type: 'error', message: (e as Error).message })
    }
  }
  // a person pressed Stop: the run ends where it is, and what it did stays (to keep or undo)
  agent.onStop = async (requestId) => {
    const s = sessions.get(requestId)
    if (!s?.session.isStreaming) return
    s.stopped = true
    try { await s.session.abort() } catch (e) { agent.emit(requestId, { type: 'error', message: (e as Error).message }) }
  }
  agent.onReply = async (requestId, text) => {
    const s = sessions.get(requestId)
    if (!s) return // from before this agent started
    try {
      if (s.session.isStreaming) await s.session.steer(text)
      else await run(requestId, text)
    } catch (e) { agent.emit(requestId, { type: 'error', message: (e as Error).message }) }
  }
  return { close: () => { for (const { session } of sessions.values()) session.dispose() } }
}
