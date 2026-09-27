// An agent's side of a board, whatever it runs on: it joins the board as a
// participant, takes the requests addressed to it, runs the board tools
// (quickdraw-agent's BOARD_TOOLS) on its own copy of the board, and reports
// back — progress, messages, each operation with its diff (so the panel can
// undo a request), approvals it waits for, done. A runtime (./codex.ts) turns
// its own events into these.
import { BOARD_TOOLS, type AgentEvent, type AgentRequest } from 'quickdraw-agent'
import type { Board } from '../board/open.ts'

export interface Participant { id: string, name: string, knows: string[] }

export interface BoardAgent {
  /** set by the runtime: a new request */
  onRequest(request: AgentRequest): void
  /** set by the runtime: a person's follow-up in a request's thread */
  onReply(requestId: string, text: string): void
  /** the tools, as the runtime hands them to the model */
  tools: { name: string, description: string, inputSchema: object }[]
  /** runs a tool for a request: what the model gets back, as text */
  runTool(requestId: string, name: string, args: unknown): string
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

export function joinBoard(board: Board, me: Participant): Promise<BoardAgent> {
  if (!board.relay) throw new Error('an agent needs a live board (quickdraw serve), not a file')
  const relay = board.relay
  const approvals = new Map<string, (allow: boolean) => void>()
  const approvalBase = Date.now().toString(36)
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
    runTool(requestId, name, args) {
      const tool = BOARD_TOOLS.find((t) => t.name === name)
      if (!tool) throw new Error(`no tool ${name}`)
      const result = tool.run(board.store as never, (args ?? {}) as never, { name: me.name }) as unknown
      if (typeof result === 'string') return result // read_board as Markdown
      const r = result as { op?: string, diff?: unknown, ids?: string[], focus?: { x: number, y: number } | null }
      if (!r.op) return JSON.stringify(result) // read_board as data
      emit(requestId, { type: 'op', op: r.op, diff: r.diff, ids: r.ids })
      if (r.focus) board.cursor(r.focus.x, r.focus.y)
      return JSON.stringify({ op: r.op, ids: r.ids })
    },
    emit,
    approve(requestId, text) {
      const id = `${approvalBase}:${nextApproval++}`
      emit(requestId, { type: 'approval', id, text })
      return new Promise((ok) => approvals.set(id, ok))
    },
    status(status) {
      relay.send({ kind: 'status', status })
      if (status === 'idle') board.cursor(null, null)
    },
    close: () => board.close(),
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
