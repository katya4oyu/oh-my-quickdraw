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
  frame(title?: string, opts?: Placement & { aspect?: string | number | null, around?: string[] }): string
  arrow(from: string | Point, to: string | Point, opts?: { color?: ColorId, line?: boolean }): string
  update(id: string, change: { text?: string, color?: ColorId }): string
  move(id: string, to: { x?: number, y?: number, dx?: number, dy?: number }): string
  arrange(ids: string[], opts?: { layout?: 'grid' | 'row' | 'column', gap?: number, at?: Point }): string[]
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
