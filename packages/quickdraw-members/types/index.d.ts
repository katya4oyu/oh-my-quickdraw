import type { Doc } from 'yjs'

export interface Member {
  name: string
  /** a few words: "transcriber", "reviewer" */
  role: string
  /** a line on what it does */
  about: string
  avatar: unknown
  /** who set it last: a person's or an agent's name */
  by: string
  at: number
}

export interface Members {
  list(): Member[]
  get(name: string): Member | null
  /** what is not given stays; an empty role and about (and no avatar) takes it out of the table */
  set(name: string, change?: { role?: string, about?: string, avatar?: unknown }, by?: string): Member | null
  remove(name: string): void
  onChange(fn: () => void): () => void
}

export const MAX_ROLE: number
export const MAX_ABOUT: number
/** The members table of a board's Yjs document (a map named `members` beside the board's). */
export function bindMembers(ydoc: Doc, options?: { name?: string }): Members

// ---- the profile card on the board (needs the fork's registerShapeType) ----
export const CARD: 'member'
export function isMemberCard(shape: unknown): boolean
export function isCardSupported(): boolean
/** Registers the card's shape type; false on a core without registerShapeType. */
export function registerMemberCard(): boolean
/** Puts an agent's card on the board, with what the table says of it. Returns its id. */
export function createMemberCard(store: unknown, options: { x: number, y: number, name: string, members?: Members, w?: number }): string
/** For quickdraw-import's `types`: an error message, or null. */
export function validateMemberCard(shape: { props: Record<string, unknown> }): string | null
/** Keeps the cards with the table (their role and line). Returns an unbind. */
export function bindMemberCards(store: unknown, members: Members): () => void
/** Edits a card's role (first line) and line (the rest) over it; they go to the table. */
export function editMemberCard(editor: unknown, id: string, members: Members, by?: string): Promise<Member | null>
/** Double-click a card to edit its role. Returns an unbind. */
export function bindMemberCardEditing(editor: unknown, members: Members, options?: { me?: () => { name: string } | null }): () => void
/** Toolbar items: a profile card from the rail (a menu of the agents), Edit role on a selected one. */
export function memberTools(options: { members: Members, agents?: () => { name: string }[], me?: () => { name: string } | null }): { rail: object[], context: object[] }
/** An agent's colour on its card, from its name. */
export function colorOf(name: string): string
export const CARD_ICONS: { card: string, edit: string }
