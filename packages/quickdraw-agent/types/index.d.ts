import type { ColorId, Diff, GeoId, Store } from '@quickdrawjs/core'

export interface Point { x: number, y: number }

/** Where a new shape goes: `at` a page point, or `inFrame`'s free space; otherwise free space to the right. */
export interface Placement { color?: ColorId, at?: Point, inFrame?: string, w?: number, h?: number }

/** The operations, bound to one operation id. Adds return the new shape's id. */
/** A bento cell's size in grid units: columns × rows. */
export interface Span { c: number, r: number }
/** A span from { c, r } or "2x1". */
export function spanOf(v: Span | string | null | undefined): Span | undefined

/** How big the words are (the core's sizes). */
export type TextSize = 's' | 'm' | 'l' | 'xl'
/** A line's style: hand-drawn, or not. */
export type Dash = 'draw' | 'solid' | 'dashed' | 'dotted'
export type Fill = 'none' | 'semi' | 'solid' | 'pattern'

export interface Operations {
  note(text: string, opts?: Placement & { textSize?: TextSize }): string
  /** fontSize: in px, instead of textSize; w: wraps at that width, align within it */
  text(text: string, opts?: Placement & { textSize?: TextSize, fontSize?: number, align?: 'start' | 'middle' | 'end' }): string
  /** `textSize`: its label's */
  shape(geo: GeoId, label?: string, opts?: Placement & { fill?: Fill, dash?: Dash, textSize?: TextSize }): string
  markdown(md: string, opts?: Placement): string
  /** An image from a data URL of its natural size; `w`: shown width (400 at most by default). */
  image(src: string, natural: { w: number, h: number }, opts?: Placement): string
  /** A web page (live where allowed, else its link card), a link card (`link`), or inline HTML (runs when a viewer presses Run). */
  embed(what: { url?: string, html?: string, link?: boolean, title?: string, preview?: EmbedPreview }, opts?: Placement): string
  /** a card for another board: its picture, or (live) a window onto it */
  board(what: { board: string, title?: string, live?: boolean }, opts?: Placement): string
  /** A ticket for an agent (`to`, or any): in the Todo column of the board's first kanban unless placed. */
  ticket(title: string, what?: { body?: string, to?: string | null }, opts?: Placement): string
  /** Moves a ticket on; in a kanban it changes column. `by` defaults to this agent. */
  status(id: string, status: TicketStatus, change?: { by?: string | null, result?: string }): string
  /** With `inFrame` a bento grid's id: a cell at its end, `span` units big (`auto`: rows follow its contents). */
  frame(title?: string, opts?: Placement & { aspect?: string | number | null, around?: string[], span?: Span, auto?: boolean, titleInside?: boolean }): string
  /** A bento grid (quickdraw-layouts): an area whose frames (cells) pack themselves, `cols` columns `w` wide. */
  layout(opts?: { cols?: number, w?: number, gap?: number }, where?: { at?: Point }): string
  /** A cell's size in grid units, or whether its rows follow its contents; the other cells move along. */
  span(id: string, opts: Partial<Span> & { auto?: boolean }): string
  /** A bento grid's columns; its cells pack again. */
  columns(id: string, cols: number): string
  /** `bend`: how far its middle bows out (+ right as it goes, - left); `label`: a text by its middle that follows it (its `textSize`, s by default) */
  /** fromAt, toAt: where its ends are, page points at the edges of the two shapes it joins (as written; they stay at those spots on the shapes) */
  arrow(from: string | Point, to: string | Point, opts?: { color?: ColorId, line?: boolean, dash?: Dash, bend?: number, label?: string, textSize?: TextSize, fromAt?: Point, toAt?: Point }): string
  group(ids: string[], opts?: { name?: string }): string
  ungroup(idOrGroup: string): string[]
  /** `w`, `h`: a shape's size (rectangles, diamonds…; not frames); `label`: an arrow's ('' takes it off) */
  update(id: string, change: { text?: string, color?: ColorId, w?: number, h?: number, textSize?: TextSize, fontSize?: number, dash?: Dash, fill?: Fill, bend?: number, label?: string }): string
  move(id: string, to: { x?: number, y?: number, dx?: number, dy?: number }): string
  arrange(ids: string[], opts?: { layout?: 'grid' | 'row' | 'column', cols?: number, gap?: number, at?: Point }): string[]
  /** Shrinks the frame's contents and `ids` together (never enlarging) into the frame, keeping their layout. */
  fit(frameId: string, opts?: { ids?: string[] }): string[]
  delete(ids: string[]): string[]
  /** A hand-drawn pen stroke: around a shape, under it, or through page points; red unless said. */
  pen(what: { kind?: 'circle' | 'underline' | 'points', id?: string, points?: ([number, number] | Point)[], color?: ColorId, size?: string, dash?: Dash }): string
  /**
   * Draws an SVG as on a whiteboard (quickdraw-svg): a frame its size, its outlines as pen strokes, its words as texts, where it has them.
   * The SVG is kept as an asset; the frame and every part carry `svg: { asset, el, unit }`. Returns [frame, …parts].
   * `write`: how its words go on when drawn live, a character or a line at a time.
   * `replace`: a drawing's frame, drawn again from this SVG: what is drawn the same stays, only what changed goes and comes.
   */
  svg(source: string, opts?: { at?: Point, inFrame?: string, write?: 'chars' | 'lines', replace?: string }): string[]
  /** Gathers frames (default: all) close together in reading order, in rows about `width` wide from `at`; a frame brings its contents, a kanban's columns go together. */
  tidy(opts?: { ids?: string[], at?: Point, gap?: number, width?: number }): string[]
}

export interface Operation<T = unknown> {
  /** `op:…`; what it added carries `agent: { name, op }`. */
  op: string
  /** Everything it changed, for a log and for `undoDiff`. */
  diff: Diff
  result: T
  /** Where it worked, to show a cursor there. */
  focus: Point | null
  /** The work area it was given, grown if what it added did not fit. */
  area?: Rect
}
/** A work area: where what is added without a place goes (it grows downwards when full). */
export interface Rect { x: number, y: number, w: number, h: number }

/** A step of `applySteps`: `{ do: 'note', text, … }`; `ref` names what it adds, `"@ref"` points at it. */
/** A link card's preview, as quickdraw-embed stores it (the image an inline data URL). */
export interface EmbedPreview { title?: string, description?: string, siteName?: string, image?: string }

export type TicketStatus = 'todo' | 'doing' | 'done' | 'failed'

export interface Step { do: string, ref?: string, [field: string]: unknown }
/**
 * One unit of thought (a question, its options, the arrows between them), drawn
 * as written: every position in `items` (`at`, a move's x/y, pen points) is from
 * `origin` — a board point, or with `in` a point in that frame — and whatever an
 * item puts needs its `at` (a frame `around` shapes or a bento cell aside).
 */
export interface Unit { unit?: string, origin: [number, number] | Point, in?: string, items: Step[] }
/** What an item of a unit became, measured, never changed to fit: `at` from the origin; an arrow's ends and its label's box. */
export interface Placed {
  ref?: string, id: string, do: string
  at?: [number, number], size?: [number, number]
  /** a shape's label: the lines it wraps to, and whether it fits the shape */
  lines?: number, fits?: boolean
  /** a text's size in px */
  font_size?: number
  /** with the unit's `in`: whether it lies inside that frame */
  inside?: boolean
  from?: string, to?: string
  /** what it runs into as drawn: "crosses arrow @x", "over text \"…\" @y", "on arrow @x", "under arrow @x", "overlaps rectangle @z" */
  hits?: string[]
  /** an arrow's two ends, from the origin */
  ends?: [[number, number], [number, number]]
  label?: { at: [number, number], size: [number, number] }
}

export interface BoardDescription {
  frames: { id: string, title: string, aspect?: number, x: number, y: number, w: number, h: number, members: string[],
    /** a snapshot of a shared screen (quickdraw-screenshare): when and by whom */
    snapshot?: { at: number, by: string },
    /** a kanban's column (quickdraw-tickets) */
    kanban?: { id: string, status: 'todo' | 'doing' | 'done' },
    /** a bento cell (quickdraw-layouts): its grid and size in units */
    cell?: { layout: string, c: number, r: number, auto?: boolean },
    /** the frame it is in (frames nest) */
    frame?: string,
    title_inside?: boolean }[]
  /** bento grids (quickdraw-layouts), with their cells (frames) in order */
  layouts?: { id: string, type: string, cols: number, x: number, y: number, w: number, h: number, cells: string[] }[]
  /** `by`: who made it; `edited_by`: who changed it last, when someone else */
  items: { id: string, type: string, text: string, color?: string, frame?: string, by?: string, edited_by?: string, x: number, y: number, w: number, h: number,
    /** a ticket's state: who it is for (null: any agent), who has it, and how it went */
    ticket?: { status: TicketStatus, to: string | null, by: string | null, result?: string } }[]
  /** `label`: the text by its middle (`label_id`: that text) */
  arrows: { id: string, type: 'arrow' | 'line', from?: string, to?: string, label?: string, label_id?: string }[]
}

export function describeBoard(store: Store): BoardDescription
export function boardToMarkdown(store: Store): string
export function textOf(store: Store, shape: object): string
/** `area`: where what has no place goes (see Rect); else `prefer`: near that page point (where people look), in free space; else right of everything. */
export function runOp<T>(store: Store, name: string, fn: (ops: Operations) => T, opts?: { area?: Rect, prefer?: Point }): Operation<T>
/** drawing 'units' (agents): things are added only in a unit, every size a number; a plain list only changes what is there. */
export function applySteps(store: Store, name: string, steps: Step[], opts?: { area?: Rect, prefer?: Point, drawing?: 'units' }): Operation<unknown[]>
/** A unit drawn as written: positions are from `origin`; what it adds is where `at` says (no free space is looked for), then measured. */
export function applySteps(store: Store, name: string, unit: Unit, opts?: { area?: Rect, prefer?: Point, drawing?: 'units' }): Operation<unknown[]> & { unit?: string, placed: Placed[] }
/** Free space for a w × h box (and a frame's title above it), clear of every shape: at `prefer` (its top-left) if free, else the nearest free spot. */
export function freeSpot(store: Store, w: number, h: number, prefer: Point, opts?: { gap?: number, above?: number }): Point
/** Reverts what nobody changed since the diff; the rest is reported as skipped. */
export function undoDiff(store: Store, diff: Diff): { reverted: number, skipped: string[] }
export function parseRatio(s: string | number | null | undefined): number | null

/** A problem in how the board is laid out, and the shapes it is about. */
export interface LintIssue { kind: 'overlap' | 'frames-overlap' | 'outside-frame' | 'straddles-frame' | 'touches-frame' | 'text-overflow' | 'arrow-crosses', ids: string[], text: string }
/** Layout problems: shapes on top of each other, arrows across shapes they do not connect, what sticks out of a frame or lies across its edge, frames on top of each other. Narrowed to a frame, some shapes or an area. */
/** What to check; `words`: how fixes are named, as the board tools (default) or as omq commands ('cli'). */
export interface LintScope { frame?: string, ids?: string[], area?: Rect, words?: 'tools' | 'cli' }
/** Where a linked arrow goes now: its written ends where they are on its shapes, else edge to edge. */
export function linkRoute(store: Store, arrow: object): { x: number, y: number, dx: number, dy: number } | null
export function lintBoard(store: Store, scope?: LintScope): LintIssue[]
/** A shape's label as the core lays it out: the lines it wraps to, and whether it fits the shape; null for what has no label. */
export function labelFit(shape: object): { lines: number, fits: boolean } | null
/** Issues as a model or a person reads them. */
export function lintText(issues: LintIssue[]): string
/** Fixes, as one operation on what agents made, what needs no judgement: labels too big for their shapes, shapes or frames on top of each other, what hangs over a frame's edge. Null when there is nothing it can fix. */
export function fixLayout(store: Store, name: string, scope?: LintScope): (Operation<unknown> & { fixed: string[], left: LintIssue[] }) | null
/** What fixLayout did and what is left, as text. */
export function fixText(result: { fixed: string[], left: LintIssue[] }): string

/** A JSON Schema for a tool's arguments. */
export type JsonSchema = Record<string, unknown>

export interface BoardTool {
  name: string
  description: string
  inputSchema: JsonSchema
  /** Reading tools return the board; writing tools make one operation. */
  run(store: Store, args: any, context?: { name?: string, area?: Rect, prefer?: Point }): string | BoardDescription | ToolOperation
}

export interface ToolOperation { op: string, diff: Diff, focus: Point | null, ids: string[], area?: Rect, /** for the model: what check_board fixed and what is left */ text?: string }

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
  /** the other boards it is on (one agent on several), and whether it works there now */
  elsewhere?: { id: string, title: string, working?: boolean }[]
  /** what it runs on, as the agent says: its account ("ChatGPT Pro"), and how much of its usage limits is used */
  account?: string
  limits?: AgentLimit[]
  /** takes requests from anyone on the board; else only from its owner, and whom they open it to */
  remote?: boolean
  /** who brought it (it runs on their account), as the host says */
  owner?: { name: string }
  /** for this viewer: whether it is theirs, and whether they may ask it */
  mine?: boolean
  canAsk?: boolean
  /** for its owner: who else may ask it — nobody, everyone, or the people named */
  sharedWith?: 'owner' | 'all' | string[]
  /** people can talk with it: a request to talk carries a WebRTC offer (see apps/quickdraw's protocol) */
  voice?: boolean
  /** the voices it can talk in, and the one it uses unless a person picks another (the panel's picker) */
  voices?: string[]
  defaultVoice?: string
}
export interface AgentLimit {
  /** "5h", "Weekly", … */
  name: string
  usedPercent: number
  /** when it starts again, in ms since the epoch */
  resetsAt?: number
}
export interface AgentViewport { x: number, y: number, w: number, h: number }
export interface AgentAnchor { shapeId?: string, x?: number, y?: number }
export interface AgentRequest {
  id: string
  to: string
  text: string
  /** What was selected; `frameIds`: the frames among it. */
  /** `feedback`: ids of what the host offered as feedback (see AgentHost.feedback), e.g. snapshot frames */
  /** `area`: where the person marked out that it should work (it becomes its work area) */
  context: { shapeIds: string[], frameIds: string[], viewport: AgentViewport, feedback?: string[], area?: Rect }
  anchor: AgentAnchor
  /** chosen in the panel, for an agent that offers models */
  options?: { model?: string, effort?: string, voice?: string }
  /** a spoken conversation, not a written request: its thread is what was said, and what was done */
  voice?: boolean
  /** set by the server when another agent (or a command) asked, by a note that mentions this one: who wrote it */
  from?: string
}
export type AgentEvent =
  | { type: 'progress' | 'message' | 'question', requestId: string, text: string }
  | { type: 'approval', requestId: string, id: string, text?: string }
  /** `ids`: what it added; a thread not about a shape is pinned to the first. */
  | { type: 'op', requestId: string, op: string, diff: Diff, ids?: string[] }
  /** Where the agent works for this request (people may move it: `by: 'person'`); shown while it works. */
  | { type: 'area', requestId: string, area: Rect, title?: string, by?: 'person' }
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
  /** where the agent works on it (shown while it does), and what it makes */
  area?: Rect & { title?: string }
  undoResult?: AgentUndoResult
  undoSyncError?: string
}
export interface AgentHost {
  agents(): AgentParticipant[]
  ask(request: AgentRequest): void | Promise<void>
  reply(requestId: string, message: string | { approval: string, allow: boolean } | { undo: AgentUndoResult }): void | Promise<void>
  threads(): AgentThread[]
  onEvent(fn: (event: AgentHostEvent | AgentEvent) => void): void | (() => void)
  /** How to bring an agent to this board, shown (with a copy button) while none has joined. */
  join?(): { text?: string, command: string } | undefined
  /** Why this viewer may not ask this agent or answer its approvals (shown instead of the input); nothing if they may. */
  cannotAsk?(agent: AgentParticipant): string | undefined
  /** Its owner opens an agent to everyone ('all'), to people (ids from `people()`), or closes it ('owner'); the panel offers it for agents marked `mine`. */
  share?(agentId: string, withWhom: 'owner' | 'all' | Array<string | number>): void
  /** The people on the board, to open an agent to. */
  people?(): Array<{ id: string | number, name: string }>
  /** Feedback the next new request carries (e.g. snapshots written on): shown as chips, each set aside with its ×; their ids go in `context.feedback`. */
  feedback?(): Array<{ id: string, label: string, count?: number }>
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
  options?: { model?: string, effort?: string, voice?: string }
  anchor?: AgentAnchor
  /** where it should work, marked out on the board */
  area?: Rect
}): AgentRequest
/** The model and effort a request to `agent` runs on: the person's choice where the agent offers it, else its defaults; undefined for an agent that offers none. */
/** "9% · resets in 6d": how much of a usage limit is used, and when it starts again */
export function limitText(limit: AgentLimit, now?: number): string
/** how close to a limit: 'full' at 100%, 'high' from 80%, else '' */
export function limitLevel(limit: AgentLimit): '' | 'high' | 'full'
/** the ids of the feedback a request carries: `items` less the `skipped` ones */
export function feedbackToSend(items: Array<{ id: string }> | undefined, skipped?: Set<string>): string[]
export function agentOptions(agent: AgentParticipant | undefined, choice?: { model?: string, effort?: string }): { model: string, effort: string } | undefined
/** A new request's id: a UUID, on plain http pages too (where crypto.randomUUID is not). */
export function requestId(): string
export function detectAgentMention(text: string, agents: AgentParticipant[]): { to: string, text: string } | null
/** The agent name being written at the start of a note ("@Cla…"), if the caret is in it. */
export function mentionQuery(value: string, caret?: number): { query: string, start: number, end: number } | null
/** The agents a query could mean, best first; none once a full name is written. */
export function matchAgents<T extends { name: string }>(agents: T[], query: string): T[]
/** While a note is written, "@" at its start lists the agents (agents()) to write one's full name. Returns an unbind. The AI panel binds it itself. */
export function bindMentionPicker(options: { editor: unknown, container?: HTMLElement, agents: () => AgentParticipant[] }): () => void
export function updateAgentThread(thread: AgentThread, event: AgentEvent): AgentThread
/** A work area dragged by dx, dy (board units): moved by its label, or resized by its corner. */
export function dragArea<T extends Rect>(area: T, handle: 'move' | 'resize', dx: number, dy: number): T
/** The approval a thread waits on (its last event, not answered yet), or null. */
export function pendingApproval(thread: AgentThread, answered?: Set<string>): Extract<AgentEvent, { type: 'approval' }> | null
/** A box dragged out on the board between two page points, or null when smaller than `min` (120) either way. */
export function markedArea(a: Point, b: Point, min?: number): Rect | null
export function undoAgentRequest(store: Store, diffs: Diff[]): { reverted: number, skipped: string[] }
export function hasAgentThreadForAnchor(shapeId: string, threads: Iterable<AgentThread>): boolean

/** The two shapes an arrow's ends land on (not frames, not other arrows), or null. */
export function arrowEnds(store: unknown, arrow: unknown): { from: string, to: string } | null
/** Where a linked arrow goes now, from edge to edge, or null when an end is gone. */
export function arrowRoute(store: unknown, arrow: unknown): { x: number, y: number, dx: number, dy: number } | null
/** Arrows follow what they connect, for this page's edits: linked once drawn between two shapes, rerouted as they move. Returns an unbind. */
export function bindArrows(editor: unknown): () => void
