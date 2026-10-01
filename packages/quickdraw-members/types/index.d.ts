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
