// An agent's side of a board, whatever it runs on: it joins the board as a
// participant, takes the requests addressed to it, runs the board tools
// (quickdraw-agent's BOARD_TOOLS) on its own copy of the board, and reports
// back — progress, messages, each operation with its diff (so the panel can
// undo a request), approvals it waits for, done. A runtime (./codex.ts) turns
// its own events into these.
//
// People watch it work: an operation is made on a copy of the board first
// (so it is checked, all or nothing, and laid out as one), then put on the
// board a piece at a time with the cursor on each — one undo, as before.
import { pageBounds, Store, type BoardRecord, type Diff, type Store as StoreType } from '@quickdrawjs/core'
import { bindFrames } from 'quickdraw-frames'
import { BOARD_TOOLS, type AgentEvent, type AgentRequest } from 'quickdraw-agent'
import type { Board } from '../board/open.ts'

import type { AgentModel } from 'quickdraw-agent'

export interface Participant { id: string, name: string, knows: string[], models?: AgentModel[], model?: string, effort?: string }

export interface BoardAgent {
  /** set by the runtime: a new request */
  onRequest(request: AgentRequest): void
  /** set by the runtime: a person's follow-up in a request's thread */
  onReply(requestId: string, text: string): void
  /** the tools, as the runtime hands them to the model */
  tools: { name: string, description: string, inputSchema: object }[]
  /** runs a tool for a request, a piece at a time: what the model gets back, as text */
  runTool(requestId: string, name: string, args: unknown): Promise<string>
  /** puts the cursor on what a request is about, while the agent thinks */
  lookAt(request: AgentRequest): void
  /** an event in a request's thread */
  emit(requestId: string, event: Omit<AgentEvent, 'requestId'> & Record<string, unknown>): void
  /** asks the people on the board; resolves with their answer */
  approve(requestId: string, text: string): Promise<boolean>
  /** what the agent is doing overall, shown next to its name */
  status(status: 'idle' | 'working' | 'waiting'): void
  /** leaves the board */
  close(): Promise<void>
}

type Emitted = Omit<AgentEvent, 'requestId'> & Record<string, unknown>

const sleep = (ms: number) => new Promise((ok) => setTimeout(ok, ms))
const isShape = (r: BoardRecord) => r.typeName === 'shape' && !(r as { isFrameTitle?: boolean }).isFrameTitle

// the board as it is, to try an operation on
function copyOf(store: StoreType): StoreType {
  const copy = new Store()
  copy.loadSnapshot({ document: { store: Object.fromEntries(store.all().map((r) => [r.id, structuredClone(r)])) } })
  bindFrames(copy)
  return copy
}

/**
 * Puts what an operation did on `done` (a copy it ran on) onto `store` a record
 * at a time, pointing at each; `pace` spreads it over about that long. The
 * records are taken as they ended up on the copy: a diff's added records are
 * as they were added, before listeners (frame membership) touched them.
 */
export async function putLive(store: StoreType, diff: Diff, done: StoreType, point: (x: number, y: number) => void, pace = 2500) {
  const final = (id: string) => done.get(id) as BoardRecord
  // frames first (a member put before its frame would be let go of), arrows
  // last (after what they connect); otherwise in the order they were made
  const rank = (r: BoardRecord) => ((r as { isFrame?: boolean }).isFrame ? 0 : (r as { type?: string }).type === 'arrow' ? 2 : 1)
  const added = Object.keys(diff.added).map(final).filter(Boolean).sort((a, b) => rank(a) - rank(b))
  const updated = Object.entries(diff.updated).map(([id, [from]]) => [id, [from, final(id)]] as [string, [BoardRecord, BoardRecord]]).filter(([, [, to]]) => to)
  const shown = added.filter(isShape).length + updated.filter(([, [, to]]) => isShape(to)).length
  const gap = shown ? Math.min(250, Math.max(40, pace / shown)) : 0
  const one = async (d: Partial<Diff>, rec: BoardRecord) => {
    store.applyDiff({ added: {}, updated: {}, removed: {}, ...d }, 'user')
    if (!isShape(rec)) return
    const b = pageBounds(rec as never)
    point(b.x + b.w / 2, b.y + b.h / 2)
    await sleep(gap)
  }
  for (const rec of added) await one({ added: { [rec.id]: rec } }, rec)
  for (const [id, pair] of updated) await one({ updated: { [id]: pair } }, pair[1])
  if (Object.keys(diff.removed).length) store.applyDiff({ added: {}, updated: {}, removed: diff.removed }, 'user')
}

export function joinBoard(board: Board, me: Participant): Promise<BoardAgent> {
  if (!board.relay) throw new Error('an agent needs a live board (quickdraw serve), not a file')
  const relay = board.relay
  const approvals = new Map<string, (allow: boolean) => void>()
  const approvalBase = Date.now().toString(36)
  let hideTimer: ReturnType<typeof setTimeout> | undefined
  const holdCursor = () => clearTimeout(hideTimer)
  let nextApproval = 1

  relay.onMessage((m) => {
    if (m.kind === 'request' && m.request?.id) agent.onRequest(m.request)
    else if (m.kind === 'reply' && typeof m.message === 'string') agent.onReply(m.requestId, m.message)
    else if (m.kind === 'reply' && typeof m.message?.approval === 'string') {
      const resolve = approvals.get(m.message.approval)
      approvals.delete(m.message.approval)
      resolve?.(m.message.allow === true)
    }
  })

  function emit(requestId: string, event: Emitted) {
    relay.send({ kind: 'event', event: { ...event, requestId } })
  }

  const agent: BoardAgent = {
    onRequest() {},
    onReply() {},
    tools: BOARD_TOOLS.map(({ name, description, inputSchema }) => ({ name, description, inputSchema })),
    async runTool(requestId, name, args) {
      const tool = BOARD_TOOLS.find((t) => t.name === name)
      if (!tool) throw new Error(`no tool ${name}`)
      if (name === 'read_board') {
        const result = tool.run(board.store as never, (args ?? {}) as never, { name: me.name }) as unknown
        return typeof result === 'string' ? result : JSON.stringify(result)
      }
      // made on a copy (checked, all or nothing), then put on the board a piece at a time
      const copy = copyOf(board.store)
      const r = tool.run(copy as never, (args ?? {}) as never, { name: me.name }) as { op: string, diff: Diff, ids: string[] }
      holdCursor()
      emit(requestId, { type: 'op', op: r.op, diff: r.diff, ids: r.ids }) // first, so the panel can take the view there
      await putLive(board.store, r.diff, copy, board.cursor)
      return JSON.stringify({ op: r.op, ids: r.ids })
    },
    lookAt(request) {
      const shape = request.anchor.shapeId ? board.store.get(request.anchor.shapeId) : undefined
      const b = shape?.typeName === 'shape' ? pageBounds(shape as never) : null
      const v = request.context.viewport
      holdCursor()
      if (b) board.cursor(b.x + b.w / 2, b.y + b.h / 2)
      else board.cursor(request.anchor.x ?? v.x + v.w / 2, request.anchor.y ?? v.y + v.h / 2)
    },
    emit,
    approve(requestId, text) {
      const id = `${approvalBase}:${nextApproval++}`
      emit(requestId, { type: 'approval', id, text })
      return new Promise((ok) => approvals.set(id, ok))
    },
    status(status) {
      relay.send({ kind: 'status', status })
      // the cursor stays a moment after the work, so people see where it ended
      if (status === 'idle') hideTimer = setTimeout(() => board.cursor(null, null), 3000)
    },
    close: () => { clearTimeout(hideTimer); return board.close() },
  }

  return new Promise((resolve) => {
    const off = relay.onMessage((m) => {
      if (m.kind !== 'joined') return
      off()
      resolve(agent)
    })
    relay.send({ kind: 'join', agent: me })
  })
}
