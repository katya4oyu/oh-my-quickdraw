// `quickdraw agent codex`: Codex on a board. Runs `codex app-server` in the
// working directory (so it has that directory, its AGENTS.md and skills, and
// the person's own Codex settings: model, sandbox, approvals) and speaks its
// JSON-RPC over stdio. The board tools go to Codex as client-defined tools
// (`dynamicTools`, part of app-server's experimental API): Codex calls them,
// and they run here on the board, so no board command runs in Codex's sandbox.
//
// One Codex thread per request; a person's follow-up in the panel continues it
// (steering the turn if one is running). Codex's approval requests go to the
// panel and wait for a person.
import { spawn, type ChildProcess } from 'node:child_process'
import { createInterface } from 'node:readline'
import type { AgentRequest } from 'quickdraw-agent'
import type { BoardAgent } from './board-agent.ts'
import { instructions } from './instructions.ts'

type Json = any

export interface AppServer {
  request(method: string, params: Json): Promise<Json>
  notify(method: string, params?: Json): void
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
  let onNote: (method: string, params: Json) => void = () => {}
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
    } else if (m.method) onNote(m.method, m.params)
  })

  return {
    request(method, params) {
      const id = nextId++
      return new Promise((ok, fail) => { pending.set(id, { ok, fail }); write({ id, method, params }) })
    },
    notify: (method, params) => write(params === undefined ? { method } : { method, params }),
    onNotification(fn) { onNote = fn },
    onRequest(fn) { onReq = fn },
    onExit(fn) { child.on('exit', fn) },
    close() { child.kill() },
  }
}

/** what the request says, and what it is about on the board */
function prompt(request: AgentRequest): string {
  const { shapeIds, frameIds } = request.context
  const about = shapeIds.length
    ? `\n\n(Selected on the board: ${shapeIds.join(', ')}${frameIds.length ? `; of which frames: ${frameIds.join(', ')}` : ''}.)`
    : ''
  return request.text + about
}

const clip = (s: string, n = 200) => (s.length > n ? s.slice(0, n - 1) + '…' : s)
// `/bin/zsh -lc "rg --files …"` reads as `rg --files …`
export function commandText(command: string): string {
  const inner = command.match(/^\S*\/?(?:zsh|bash|sh) -l?c (.*)$/s)?.[1]
  const text = inner ? inner.replace(/^(["'])([\s\S]*)\1$/, '$2') : command
  return clip(text.replace(/\s+/g, ' ').trim(), 80)
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

export interface CodexOptions {
  cwd: string
  name: string
  /** used when a request does not say (the panel sends what the person chose) */
  model?: string
  effort?: string
}

/** Connects an initialized app-server (initCodex) to a board agent. */
export async function runCodex(server: AppServer, agent: BoardAgent, { cwd, name, model, effort }: CodexOptions) {

  const byRequest = new Map<string, { threadId: string, turnId: string | null, effort?: string }>()
  const requestOf = new Map<string, string>() // Codex thread -> request
  let waiting = 0
  const updateStatus = () => {
    const busy = [...byRequest.values()].some((t) => t.turnId)
    agent.status(waiting ? 'waiting' : busy ? 'working' : 'idle')
  }

  async function turn(requestId: string, text: string) {
    const t = byRequest.get(requestId)!
    const input = [{ type: 'text', text, text_elements: [] }]
    if (t.turnId) await server.request('turn/steer', { threadId: t.threadId, input, expectedTurnId: t.turnId })
    else await server.request('turn/start', { threadId: t.threadId, input, ...(t.effort ? { effort: t.effort } : {}) })
  }

  server.onNotification((method, p) => {
    const requestId = requestOf.get(p?.threadId)
    if (!requestId) return
    const t = byRequest.get(requestId)!
    if (method === 'turn/started') { t.turnId = p.turn.id; updateStatus() }
    else if (method === 'turn/completed') {
      t.turnId = null
      const { status, error } = p.turn
      if (status === 'failed') agent.emit(requestId, { type: 'error', message: error?.message ?? 'Codex stopped with an error.' })
      else agent.emit(requestId, { type: 'done', ...(status === 'interrupted' ? { text: 'Stopped.' } : {}) })
      updateStatus()
    } else if (method === 'item/started') {
      const item = p.item
      if (item.type === 'commandExecution') agent.emit(requestId, { type: 'progress', text: `Running ${commandText(item.command)}` })
      else if (item.type === 'webSearch' && item.query) agent.emit(requestId, { type: 'progress', text: `Searching the web: ${clip(item.query)}` })
      else if (item.type === 'fileChange') agent.emit(requestId, { type: 'progress', text: 'Editing files' })
    } else if (method === 'item/completed' && p.item.type === 'agentMessage' && p.item.text) {
      // commentary while it works is progress; the final answer is its reply
      agent.emit(requestId, { type: p.item.phase === 'commentary' ? 'progress' : 'message', text: p.item.text })
    }
  })

  server.onRequest(async (method, p) => {
    const requestId = requestOf.get(p?.threadId)
    if (!requestId) throw new Error('not a board request')
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

  agent.onRequest = async (request) => {
    try {
      agent.lookAt(request)
      const use = { model: request.options?.model ?? model, effort: request.options?.effort ?? effort }
      const started = await server.request('thread/start', {
        cwd,
        ...(use.model ? { model: use.model } : {}),
        developerInstructions: instructions(name),
        dynamicTools: agent.tools.map((t) => ({ type: 'function', ...t })),
      })
      const { thread } = started
      const used = [started.model, use.effort ?? started.reasoningEffort].filter(Boolean).join(' · ')
      if (used) agent.emit(request.id, { type: 'progress', text: used })
      byRequest.set(request.id, { threadId: thread.id, turnId: null, effort: use.effort })
      requestOf.set(thread.id, request.id)
      await turn(request.id, prompt(request))
    } catch (e) {
      agent.emit(request.id, { type: 'error', message: (e as Error).message })
    }
  }
  agent.onReply = async (requestId, text) => {
    if (!byRequest.has(requestId)) return // from before this agent started
    try { await turn(requestId, text) } catch (e) { agent.emit(requestId, { type: 'error', message: (e as Error).message }) }
  }
}
