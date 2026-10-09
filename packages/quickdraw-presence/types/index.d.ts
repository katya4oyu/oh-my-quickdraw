import type { Editor } from '@quickdrawjs/core'

export type Rect = { x: number, y: number, w: number, h: number }
export type AgentStatus = 'idle' | 'working' | 'waiting'
/** what an agent is doing just now, shown by its cursor */
export type AgentActivity = 'thinking' | 'reading' | 'searching' | 'running' | 'editing' | 'imaging' | 'drawing' | 'waiting' | 'done' | 'available'

/** What a page says about itself; page coordinates, x/y null while off the board. */
export interface Presence {
  name: string
  color: string
  /** a word or two of your own: "reviewing", "away" */
  status?: string
  x: number | null
  y: number | null
  /** the part of the page on the screen, for those following */
  view?: Rect
  /** set by an agent */
  agent?: boolean
  /** an agent's: who started it, as the host says */
  owner?: string
  agentStatus?: AgentStatus
  agentActivity?: AgentActivity | null
  /** on what: a search, a command… */
  agentNote?: string
}
export type PresenceMessage = (Partial<Presence> & { id: string | number, gone?: false }) | { id: string | number, gone: true }

export interface PresenceHost {
  /** yours, whenever it changes */
  send(presence: Presence): void
  /** someone else's, or their leaving; may return an unsubscribe */
  onMessage(fn: (message: PresenceMessage) => void): void | (() => void)
}
export interface PresenceStorage {
  get(key: string): unknown
  set(key: string, value: unknown): void
}
export interface Me { name: string, color: string, status: string }
export type Peer = Presence & { id: string | number, status: string, agent: boolean, agentStatus: AgentStatus | null, agentActivity: AgentActivity | null, agentNote: string, view: Rect | null }

export interface PresenceHandle {
  me(): Me
  setMe(patch: Partial<Me>): void
  /** the board's title, before the people (onclick: what clicking it does, as renaming it); '' hides it */
  setTitle(text: string, onclick?: () => void): void
  /** follow someone by id; null stops */
  follow(id: string | number | null): void
  following(): string | number | null
  peers(): Peer[]
  /** a name for you until you choose one (the host knows who you are, from its tailnet, say): not kept */
  suggestName(name: string): void
  /** say who you are again (after a reconnect) */
  resend(): void
  /** everyone else has gone (a disconnect) */
  clear(): void
  destroy(): void
}

export const COLORS: string[]
export function createPresence(options: {
  editor: Editor
  container?: HTMLElement
  host: PresenceHost
  /** used until the person sets their own */
  defaults?: Partial<Me>
  /** where you are kept; localStorage by default */
  storage?: PresenceStorage
  key?: string
  /** an element beside an agent's cursor (its pet), playing what it does; dx: how far its cursor moved sideways; null for none */
  avatar?: ((peer: Presence & { id: string | number }, motion: { dx: number }) => HTMLElement | null) | null
}): PresenceHandle
/** "Ann · reviewing", "Codex · working" */
/** A label in parts: the name (an agent's with whose it is), the status or what the agent is doing, and on what ('' when none). */
export function presenceParts(p: Partial<Presence> & { name: string }): { name: string, status: string, note: string }
export function presenceLabel(p: Partial<Presence> & { name: string }): string
/** what each activity says on the label */
export const ACTIVITIES: Record<AgentActivity, string>

export function edgePoint(box: { w: number, h: number }, p: { x: number, y: number }, margin?: number): { x: number, y: number, angle: number } | null
export function fitView(box: { w: number, h: number }, view: Rect): { x: number, y: number, z: number }
export function centreOn(box: { w: number, h: number }, p: { x: number, y: number }, z: number): { x: number, y: number, z: number }
export function wellInside(v: Rect, p: { x: number, y: number }, edge?: number): boolean
export function initials(name?: string): string
