// `omq agent codex-app-server`: Codex on a board, without its TUI. Runs `codex app-server` in the
// working directory (so it has that directory, its AGENTS.md and skills, and
// the person's own Codex settings: model, sandbox, approvals) and speaks its
// JSON-RPC over stdio. The board tools go to Codex as client-defined tools
// (`dynamicTools`, part of app-server's experimental API): Codex calls them,
// and they run here on the board, so no board command runs in Codex's sandbox.
//
// One Codex thread per request; a person's follow-up in the panel continues it
// (steering the turn if one is running). Codex's approval requests go to the
// panel and wait for a person. A voice conversation (./voice.ts) is a request
// too, on a thread of its own.
import { spawn, type ChildProcess } from 'node:child_process'
import { createInterface } from 'node:readline'
import type { AgentLimit, AgentRequest } from 'quickdraw-agent'
import type { Activity, BoardAgent } from './board-agent.ts'
import { instructions } from './instructions.ts'

type Json = any

export interface AppServer {
  request(method: string, params: Json): Promise<Json>
  notify(method: string, params?: Json): void
  /** each listener hears every notification */
  onNotification(fn: (method: string, params: Json) => void): void
  /** answers the server's requests (approvals, tool calls) */
  onRequest(fn: (method: string, params: Json) => Promise<Json>): void
  onExit(fn: (code: number | null) => void): void
  close(): void
}

/** `codex app-server` (or `command`, for tests) as a JSON-RPC connection over stdio */
export function startAppServer(cwd: string, command = ['codex', 'app-server']): AppServer {
  const child: ChildProcess = spawn(command[0], command.slice(1), { cwd, stdio: ['pipe', 'pipe', 'inherit'] })
  let nextId = 1
  const pending = new Map<number, { ok: (v: Json) => void, fail: (e: Error) => void }>()
  const onNote = new Set<(method: string, params: Json) => void>()
  let onReq: (method: string, params: Json) => Promise<Json> = async () => { throw new Error('not handled') }
  const write = (m: Json) => { if (child.stdin?.writable) child.stdin.write(JSON.stringify(m) + '\n') }

  createInterface({ input: child.stdout! }).on('line', (line) => {
    let m: Json
    try { m = JSON.parse(line) } catch { return }
    if (m.id != null && m.method === undefined) { // a response
      const p = pending.get(m.id)
      pending.delete(m.id)
      if (m.error) p?.fail(new Error(m.error.message ?? 'error'))
      else p?.ok(m.result)
    } else if (m.id != null) { // a request from the server
      onReq(m.method, m.params).then(
        (result) => write({ id: m.id, result }),
        (e: Error) => write({ id: m.id, error: { code: -32000, message: e.message } }),
      )
    } else if (m.method) for (const fn of onNote) fn(m.method, m.params)
  })

  return {
    request(method, params) {
      const id = nextId++
      return new Promise((ok, fail) => { pending.set(id, { ok, fail }); write({ id, method, params }) })
    },
    notify: (method, params) => write(params === undefined ? { method } : { method, params }),
    onNotification(fn) { onNote.add(fn) },
    onRequest(fn) { onReq = fn },
    onExit(fn) { child.on('exit', fn) },
    close() { child.kill() },
  }
}

/** what the request says, and what it is about on the board */
function prompt(request: AgentRequest): string {
  const { shapeIds, frameIds, area } = request.context
  const about = shapeIds.length
    ? `\n\n(Selected on the board: ${shapeIds.join(', ')}${frameIds.length ? `; of which frames: ${frameIds.join(', ')}` : ''}.)`
    : ''
  const where = area
    ? `\n\n(They marked out where it goes: x ${Math.round(area.x)}, y ${Math.round(area.y)}, ${Math.round(area.w)} × ${Math.round(area.h)}. It is your work area already: what you add without a place goes in it.)`
    : ''
  // another agent asked, by a note on the board mentioning you
  const by = request.from ? `\n\n(${request.from}, another agent on the board, asked this in a note (${shapeIds[0] ?? ''}). Answer on the board or in your reply as for a person.)` : ''
  return request.text + about + where + by
}

export const clip = (s: string, n = 200) => (s.length > n ? s.slice(0, n - 1) + '…' : s)
// `/bin/zsh -lc "rg --files …"` reads as `rg --files …`
export function commandText(command: string): string {
  const inner = command.match(/^\S*\/?(?:zsh|bash|sh) -l?c (.*)$/s)?.[1]
  const text = inner ? inner.replace(/^(["'])([\s\S]*)\1$/, '$2') : command
  return clip(text.replace(/\s+/g, ' ').trim(), 80)
}

/** what an item Codex starts shows by the cursor (see BoardAgent.activity), and on what; null: nothing new */
export function activityOf(item: Json): { kind: Activity, note?: string } | null {
  switch (item?.type) {
    case 'reasoning': return { kind: 'thinking' }
    case 'webSearch': return { kind: 'searching', ...(item.query ? { note: clip(String(item.query), 60) } : {}) }
    case 'commandExecution': return { kind: 'running', ...(item.command ? { note: commandText(String(item.command)).slice(0, 60) } : {}) }
    case 'fileChange': return { kind: 'editing' }
    case 'imageGeneration': return { kind: 'imaging' }
    default: return null
  }
}

/** Starts the conversation with app-server: the models it offers (for the panel), and the person's defaults */
export async function initCodex(server: AppServer, defaults: { model?: string, effort?: string } = {}) {
  await server.request('initialize', {
    clientInfo: { name: 'quickdraw', title: 'Quickdraw', version: '0.1.0' },
    capabilities: { experimentalApi: true, requestAttestation: false }, // dynamicTools is experimental
  })
  server.notify('initialized')
  const listed: Json[] = (await server.request('model/list', {}))?.data ?? []
  const models = listed.filter((m) => !m.hidden).map((m) => ({
    id: m.id, name: m.displayName ?? m.id,
    efforts: (m.supportedReasoningEfforts ?? []).map((e: Json) => e.reasoningEffort),
    effort: m.defaultReasoningEffort,
  }))
  const config = (await server.request('config/read', {}).catch(() => null))?.config ?? {}
  const model = defaults.model ?? config.model ?? listed.find((m) => m.isDefault)?.id
  const effort = defaults.effort ?? config.model_reasoning_effort ?? models.find((m) => m.id === model)?.effort
  return { models, model, effort }
}

// What Codex runs on, for the panel: the account's kind and plan (never its
// email: everyone on the board sees it), and how much of each usage limit is used.
const PLANS: Record<string, string> = { prolite: 'Pro Lite', edu_plus: 'Edu Plus', edu_pro: 'Edu Pro' }
const planName = (plan: string) => PLANS[plan] ?? plan.split('_').map((w) => w[0].toUpperCase() + w.slice(1)).join(' ')
export function accountText(account: Json, plan = account?.planType): string | undefined {
  if (account?.type === 'chatgpt') return plan && plan !== 'unknown' ? `ChatGPT ${planName(plan)}` : 'ChatGPT'
  if (account?.type === 'apiKey') return 'OpenAI API key'
  if (account?.type === 'amazonBedrock') return 'Amazon Bedrock'
}
const windowName = (mins: number | null) =>
  mins == null ? 'Limit' : mins === 10080 ? 'Weekly' : mins % 1440 === 0 ? `${mins / 1440}-day` : mins % 60 === 0 ? `${mins / 60}h` : `${mins}m`
/** the windows of Codex's rate-limit snapshots, one per limit (`codex`, or others by their names) */
export function limitsOf(snapshots: Json[]): AgentLimit[] {
  return snapshots.flatMap((s) => [s.primary, s.secondary].filter(Boolean).map((w: Json) => ({
    name: (s.limitId && s.limitId !== 'codex' && s.limitName ? s.limitName + ' ' : '') + windowName(w.windowDurationMins),
    usedPercent: w.usedPercent,
    ...(w.resetsAt ? { resetsAt: w.resetsAt * 1000 } : {}),
  })))
}

export interface CodexOptions {
  cwd: string
  name: string
  /** used when a request does not say (the panel sends what the person chose) */
  model?: string
  effort?: string
}

export interface Codex {
  /** a Codex thread for a request, with the board tools; `voice`: for a spoken conversation (./voice.ts) */
  startThread(request: AgentRequest, opts?: { voice?: boolean }): Promise<string>
  /** the request a Codex thread is for */
  requestOf(threadId: string): string | undefined
}

/** Connects an initialized app-server (initCodex) to a board agent. */
export async function runCodex(server: AppServer, agent: BoardAgent, { cwd, name, model, effort }: CodexOptions): Promise<Codex> {

  // `voice`: its turns are handed to it by a voice conversation, which goes on
  // after each of them; what it says is the conversation's, not an answer
  const byRequest = new Map<string, { threadId: string, turnId: string | null, effort?: string, voice?: boolean }>()
  const requestOf = new Map<string, string>() // Codex thread -> request
  let waiting = 0
  const updateStatus = () => {
    const busy = [...byRequest.values()].some((t) => t.turnId)
    agent.status(waiting ? 'waiting' : busy ? 'working' : 'idle')
  }

  async function turn(requestId: string, text: string, more: Json[] = []) {
    const t = byRequest.get(requestId)!
    const input = [{ type: 'text', text, text_elements: [] }, ...more]
    if (t.turnId) await server.request('turn/steer', { threadId: t.threadId, input, expectedTurnId: t.turnId })
    else await server.request('turn/start', { threadId: t.threadId, input, ...(t.effort ? { effort: t.effort } : {}) })
  }

  // the account and its usage: read once, then kept up to date from Codex's
  // notifications (sparse: a value missing from one keeps the last one), and
  // read again after a turn, at most once a minute
  let account: Json = null, plan: string | undefined, readAt = 0
  const snapshots = new Map<string, Json>() // by limit id
  const merge = (id: string, s: Json) => snapshots.set(id, { ...snapshots.get(id), ...Object.fromEntries(Object.entries(s).filter(([, v]) => v != null)) })
  const share = () => agent.account({ account: accountText(account, plan), limits: limitsOf([...snapshots.values()]) })
  async function readUsage() {
    readAt = Date.now()
    const r = await server.request('account/rateLimits/read', { excludeResetCreditDetails: true }).catch(() => null)
    if (!r) return // an API key has no such limits
    for (const [id, s] of Object.entries(r.rateLimitsByLimitId ?? { [r.rateLimits?.limitId ?? 'codex']: r.rateLimits })) if (s) merge(id, s)
    share()
  }
  server.request('account/read', {}).then((r) => { account = r?.account; plan = account?.planType; share(); return readUsage() }, () => {})

  server.onNotification((method, p) => {
    if (method === 'account/rateLimits/updated' && p?.rateLimits) { merge(p.rateLimits.limitId ?? 'codex', p.rateLimits); return share() }
    if (method === 'account/updated') { if (p?.planType) plan = p.planType; return share() }
    if (method === 'turn/completed' && Date.now() - readAt > 60_000) readUsage()
    const requestId = requestOf.get(p?.threadId)
    if (!requestId) return
    const t = byRequest.get(requestId)!
    if (method === 'turn/started') { t.turnId = p.turn.id; updateStatus(); agent.activity('thinking') }
    else if (method === 'turn/completed') {
      t.turnId = null
      const { status, error } = p.turn
      if (status === 'failed') agent.emit(requestId, { type: 'error', message: error?.message ?? 'Codex stopped with an error.' })
      else if (!t.voice) agent.emit(requestId, { type: 'done', ...(status === 'interrupted' ? { text: 'Stopped.' } : {}) })
      updateStatus()
      if (![...byRequest.values()].some((r) => r.turnId)) agent.activity(status === 'completed' ? 'done' : null)
    } else if (method === 'item/started') {
      const item = p.item
      if (item.type === 'commandExecution') agent.emit(requestId, { type: 'progress', text: `Running ${commandText(item.command)}` })
      else if (item.type === 'webSearch' && item.query) agent.emit(requestId, { type: 'progress', text: `Searching the web: ${clip(item.query)}` })
      else if (item.type === 'fileChange') agent.emit(requestId, { type: 'progress', text: 'Editing files' })
      else if (item.type === 'imageGeneration') agent.emit(requestId, { type: 'progress', text: 'Generating an image…' })
      const act = activityOf(item)
      if (act) agent.activity(act.kind, act.note)
    } else if (method === 'item/completed' && p.item.type === 'imageGeneration' && p.item.savedPath) {
      // add_image puts it on the board, where the model says
      const n = agent.generated(requestId, p.item.savedPath, { transparent: p.item.transparentBackground === true })
      agent.emit(requestId, { type: 'progress', text: `Generated image ${n}` })
      agent.activity('thinking')
    } else if (method === 'item/completed' && p.item.type === 'agentMessage' && p.item.text) {
      // commentary while it works is progress; the final answer is its reply
      agent.emit(requestId, { type: p.item.phase === 'commentary' || t.voice ? 'progress' : 'message', text: p.item.text })
    } else if (method === 'item/completed' && activityOf(p.item)) agent.activity('thinking') // back from a search, a command…
  })

  server.onRequest(async (method, p) => {
    const requestId = requestOf.get(p?.threadId)
    if (!requestId) throw new Error('not a board request')
    if (method === 'item/tool/call' && p.tool === 'look_at') { // a picture, not text
      agent.activity('reading')
      try {
        const png = await agent.picture(p.arguments ?? {})
        if (!png) return { success: false, contentItems: [{ type: 'inputText', text: 'Nothing to draw there.' }] }
        return { success: true, contentItems: [{ type: 'inputImage', imageUrl: `data:image/png;base64,${png.toString('base64')}` }] }
      } catch (e) {
        return { success: false, contentItems: [{ type: 'inputText', text: `Could not draw it: ${(e as Error).message}` }] }
      } finally { agent.activity('thinking') }
    }
    if (method === 'item/tool/call' && p.tool === 'look_at_screen') { // the shared screen as it is now: a picture
      agent.activity('reading')
      try {
        const f = await agent.screenFrame()
        return { success: true, contentItems: [{ type: 'inputText', text: `${f.sharer ? f.sharer + '\'s' : 'The shared'} screen, now:` }, { type: 'inputImage', imageUrl: `data:image/jpeg;base64,${f.jpeg.toString('base64')}` }] }
      } catch (e) {
        return { success: false, contentItems: [{ type: 'inputText', text: (e as Error).message }] }
      } finally { agent.activity('thinking') }
    }
    if (method === 'item/tool/call') {
      try {
        const text = await agent.runTool(requestId, p.tool, p.arguments)
        return { success: true, contentItems: [{ type: 'inputText', text }] }
      } catch (e) {
        return { success: false, contentItems: [{ type: 'inputText', text: (e as Error).message }] }
      }
    }
    const ask = async (text: string) => {
      waiting++
      updateStatus()
      try { return await agent.approve(requestId, text) } finally { waiting--; updateStatus() }
    }
    const why = p.reason ? ` — ${p.reason}` : ''
    if (method === 'item/commandExecution/requestApproval') {
      return { decision: (await ask(`Run ${p.command ? commandText(p.command) : 'a command'}${why}`)) ? 'accept' : 'decline' }
    }
    if (method === 'item/fileChange/requestApproval') {
      return { decision: (await ask(`Change files${why}`)) ? 'accept' : 'decline' }
    }
    if (method === 'item/permissions/requestApproval') {
      const allow = await ask(`Allow more access${why}`)
      const granted = Object.fromEntries(Object.entries(p.permissions ?? {}).filter(([, v]) => v != null))
      return { permissions: allow ? granted : {}, scope: 'turn' }
    }
    throw new Error(`${method} is not supported on a board`)
  })

  async function startThread(request: AgentRequest, { voice = false } = {}) {
    const use = { model: request.options?.model ?? model, effort: request.options?.effort ?? effort }
    const started = await server.request('thread/start', {
      cwd,
      ...(use.model ? { model: use.model } : {}),
      developerInstructions: instructions(name, { voice }),
      dynamicTools: agent.tools.map((t) => ({ type: 'function', ...t })),
    })
    const { thread } = started
    const used = [started.model, use.effort ?? started.reasoningEffort].filter(Boolean).join(' · ')
    if (used) agent.emit(request.id, { type: 'progress', text: used })
    byRequest.set(request.id, { threadId: thread.id, turnId: null, effort: use.effort, voice })
    requestOf.set(thread.id, request.id)
    return thread.id as string
  }

  agent.onRequest = async (request) => {
    try {
      agent.lookAt(request)
      await startThread(request)
      // feedback it carries (snapshots written on): what people said, and the pictures
      const more: Json[] = []
      const ids = request.context.feedback ?? []
      if (ids.length) {
        agent.emit(request.id, { type: 'progress', text: `Looking at ${ids.length} snapshot${ids.length === 1 ? '' : 's'}` })
        const fb = await agent.feedback(ids)
        if (fb.text) more.push({ type: 'text', text: fb.text, text_elements: [] })
        for (const path of fb.images) more.push({ type: 'localImage', path })
      }
      await turn(request.id, prompt(request), more)
    } catch (e) {
      agent.emit(request.id, { type: 'error', message: (e as Error).message })
    }
  }
  // a person pressed Stop: the turn ends where it is, and what it did stays (to keep or undo)
  agent.onStop = async (requestId) => {
    const t = byRequest.get(requestId)
    if (!t?.turnId) return
    try { await server.request('turn/interrupt', { threadId: t.threadId, turnId: t.turnId }) } catch (e) { agent.emit(requestId, { type: 'error', message: (e as Error).message }) }
  }
  agent.onReply = async (requestId, text) => {
    if (!byRequest.has(requestId)) return // from before this agent started
    try { await turn(requestId, text) } catch (e) { agent.emit(requestId, { type: 'error', message: (e as Error).message }) }
  }
  return { startThread, requestOf: (threadId) => requestOf.get(threadId) }
}
