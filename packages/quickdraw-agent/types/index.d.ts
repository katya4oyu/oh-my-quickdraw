import type { ColorId, Diff, GeoId, Store } from '@quickdrawjs/core'

export interface Point { x: number, y: number }

/** Where a new shape goes: `at` a page point, or `inFrame`'s free space; otherwise free space to the right. */
export interface Placement { color?: ColorId, at?: Point, inFrame?: string, w?: number, h?: number }

/** The operations, bound to one operation id. Adds return the new shape's id. */
export interface Operations {
  note(text: string, opts?: Placement): string
  text(text: string, opts?: Placement): string
  shape(geo: GeoId, label?: string, opts?: Placement & { fill?: string }): string
  markdown(md: string, opts?: Placement): string
  /** An image from a data URL of its natural size; `w`: shown width (400 at most by default). */
  image(src: string, natural: { w: number, h: number }, opts?: Placement): string
  frame(title?: string, opts?: Placement & { aspect?: string | number | null, around?: string[] }): string
  arrow(from: string | Point, to: string | Point, opts?: { color?: ColorId, line?: boolean }): string
  update(id: string, change: { text?: string, color?: ColorId }): string
  move(id: string, to: { x?: number, y?: number, dx?: number, dy?: number }): string
  arrange(ids: string[], opts?: { layout?: 'grid' | 'row' | 'column', cols?: number, gap?: number, at?: Point }): string[]
  /** Shrinks the frame's contents and `ids` together (never enlarging) into the frame, keeping their layout. */
  fit(frameId: string, opts?: { ids?: string[] }): string[]
  delete(ids: string[]): string[]
}

export interface Operation<T = unknown> {
  /** `op:…`; what it added carries `agent: { name, op }`. */
  op: string
  /** Everything it changed, for a log and for `undoDiff`. */
  diff: Diff
  result: T
  /** Where it worked, to show a cursor there. */
  focus: Point | null
}

/** A step of `applySteps`: `{ do: 'note', text, … }`; `ref` names what it adds, `"@ref"` points at it. */
export interface Step { do: string, ref?: string, [field: string]: unknown }

export interface BoardDescription {
  frames: { id: string, title: string, aspect?: number, x: number, y: number, w: number, h: number, members: string[] }[]
  items: { id: string, type: string, text: string, color?: string, frame?: string, by?: string, x: number, y: number, w: number, h: number }[]
  arrows: { id: string, type: 'arrow' | 'line', from?: string, to?: string }[]
}

export function describeBoard(store: Store): BoardDescription
export function boardToMarkdown(store: Store): string
export function textOf(store: Store, shape: object): string
export function runOp<T>(store: Store, name: string, fn: (ops: Operations) => T): Operation<T>
export function applySteps(store: Store, name: string, steps: Step[]): Operation<unknown[]>
/** Reverts what nobody changed since the diff; the rest is reported as skipped. */
export function undoDiff(store: Store, diff: Diff): { reverted: number, skipped: string[] }
export function parseRatio(s: string | number | null | undefined): number | null

/** A JSON Schema for a tool's arguments. */
export type JsonSchema = Record<string, unknown>

export interface BoardTool {
  name: string
  description: string
  inputSchema: JsonSchema
  /** Reading tools return the board; writing tools make one operation. */
  run(store: Store, args: any, context?: { name?: string }): string | BoardDescription | ToolOperation
}

export interface ToolOperation { op: string, diff: Diff, focus: Point | null, ids: string[] }

export const BOARD_TOOLS: BoardTool[]

/** In Node (no canvas): installs an estimating text measurer for the core. False when there is a real one. */
export function installMeasure(): boolean
export function estimateWidth(font: string, text: string): number

export type AgentStatus = 'idle' | 'working' | 'waiting'
/** A model an agent can run a request on, with the reasoning efforts it takes and its default. */
export interface AgentModel { id: string, name: string, efforts: string[], effort: string }
export interface AgentParticipant {
  id: string
  name: string
  knows: string[]
  status: AgentStatus
  /** what the person may choose from, per request; `model` and `effort`: the agent's defaults */
  models?: AgentModel[]
  model?: string
  effort?: string
}
export interface AgentViewport { x: number, y: number, w: number, h: number }
export interface AgentAnchor { shapeId?: string, x?: number, y?: number }
export interface AgentRequest {
  id: string
  to: string
  text: string
  /** What was selected; `frameIds`: the frames among it. */
  context: { shapeIds: string[], frameIds: string[], viewport: AgentViewport }
  anchor: AgentAnchor
  /** chosen in the panel, for an agent that offers models */
  options?: { model?: string, effort?: string }
}
export type AgentEvent =
  | { type: 'progress' | 'message' | 'question', requestId: string, text: string }
  | { type: 'approval', requestId: string, id: string, text?: string }
  /** `ids`: what it added; a thread not about a shape is pinned to the first. */
  | { type: 'op', requestId: string, op: string, diff: Diff, ids?: string[] }
  | { type: 'done', requestId: string, text?: string }
  /** A person's follow-up: the host sends it back to every viewer, this one too. */
  | { type: 'reply', requestId: string, text: string }
  /** Undone, here or on another device. */
  | { type: 'undo', requestId: string, reverted: number, skipped: string[] }
  | { type: 'error', requestId: string, message: string }
export type AgentHostEvent =
  | { type: 'agents', agents?: AgentParticipant[] }
  | { type: 'event', event: AgentEvent }
  /** Threads the panel did not have: stored ones once connected, or one started on another device. */
  | { type: 'threads', threads: AgentThread[] }
  | { type: 'thread', thread: AgentThread }
export interface AgentUndoResult { reverted: number, skipped: string[] }
export interface AgentThread {
  request: AgentRequest
  events: AgentEvent[]
  diffs: Diff[]
  status: string
  undoResult?: AgentUndoResult
  undoSyncError?: string
}
export interface AgentHost {
  agents(): AgentParticipant[]
  ask(request: AgentRequest): void | Promise<void>
  reply(requestId: string, message: string | { approval: string, allow: boolean } | { undo: AgentUndoResult }): void | Promise<void>
  threads(): AgentThread[]
  onEvent(fn: (event: AgentHostEvent | AgentEvent) => void): void | (() => void)
}
export interface AgentEditor {
  readonly store: Store
  readonly selection: Set<string>
  readonly camera: { x: number, y: number, z: number }
  viewportPageBounds(): AgentViewport
  pageToScreen(x: number, y: number): Point
  setCamera(camera: { x: number, y: number, z: number }, opts?: { animate?: number }): void
  on(event: string, fn: (...args: unknown[]) => void): () => void
}
export interface AgentPanel {
  askSelection(shapeIds?: string[]): AgentRequest
  openForSelection(shapeIds: string[]): void
  askText(text: string, anchor?: AgentAnchor): AgentRequest
  show(): void
  hide(): void
  toggle(): void
  /** Show one thread. */
  open(requestId: string): void
  readonly threads: AgentThread[]
  destroy(): void
}
/** Add a host-driven panel (in the core's .qd-ui: a card on wide screens, a sheet on phones) and thread pins on the canvas. It starts hidden. */
export function createAgentPanel(options: {
  editor: AgentEditor
  store?: Store
  container?: HTMLElement
  host: AgentHost
}): AgentPanel
export const AGENT_ICON: string
/** quickdraw-toolbar items: AI on the rail (toggles the panel), "Ask AI" on the selection bar. */
export function agentTools(panel: AgentPanel): {
  rail: { id: string, title: string, icon: string, run(): void }[]
  context: { id: string, title: string, icon: string, when(shape: object): boolean, run(ctx: { shape: { id: string } }): void }[]
}
export function buildAgentRequest(options: {
  id: string
  to: string
  text: string
  editor: AgentEditor
  shapeIds?: string[]
  frameIds?: string[]
  options?: { model?: string, effort?: string }
  anchor?: AgentAnchor
}): AgentRequest
/** The model and effort a request to `agent` runs on: the person's choice where the agent offers it, else its defaults; undefined for an agent that offers none. */
export function agentOptions(agent: AgentParticipant | undefined, choice?: { model?: string, effort?: string }): { model: string, effort: string } | undefined
export function detectAgentMention(text: string, agents: AgentParticipant[]): { to: string, text: string } | null
export function updateAgentThread(thread: AgentThread, event: AgentEvent): AgentThread
export function undoAgentRequest(store: Store, diffs: Diff[]): { reverted: number, skipped: string[] }
export function hasAgentThreadForAnchor(shapeId: string, threads: Iterable<AgentThread>): boolean
