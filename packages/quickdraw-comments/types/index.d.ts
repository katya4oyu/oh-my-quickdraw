import type * as Y from 'yjs'
import type { Store } from '@quickdrawjs/core'

/** A comment in a frame's thread. */
export interface Comment {
  id: string
  /** who wrote it: a person's or an agent's name */
  by: string
  text: string
  /** when (ms) */
  at: number
}

export interface Comments {
  /** a frame's thread, oldest first */
  list(frameId: string): Comment[]
  /** the frames that have a thread */
  frames(): string[]
  /** Adds a comment to a frame's thread (made when it is the first). */
  add(frameId: string, text: string, by?: string): Comment
  /** Takes a comment out of its thread; false when there was none. */
  remove(frameId: string, commentId: string): boolean
  /** fn() on every change, here or from elsewhere; returns an unbind */
  onChange(fn: () => void): () => void
}

export const MAX_TEXT: number
/** The comment threads of a board's Yjs document (a map named `comments` by default). */
export function bindComments(ydoc: Y.Doc, opts?: { name?: string }): Comments
/** The frames `ids` are (or are in). */
export function framesOf(store: Store, ids: string[]): string[]
/** The threads as an agent reads them (Markdown): all, or those of `frames`; '' when there are none. */
export function commentsText(store: Store, comments: Comments, opts?: { frames?: string[] }): string

export const COMMENT_ICON: string
/** Where a thread goes beside its marker, or a sheet on a narrow board. */
export function threadSpot(marker: { x: number, y: number }, view: { w: number, h: number }, size?: { w: number, h: number }, gap?: number):
  { side: 'right' | 'left', x: number, y: number } | { side: 'sheet' }
/** Markers on the frames with a thread, and a thread opened beside its marker. */
export function createComments(opts: { editor: any, comments: Comments, me?: () => { name?: string } | null, container?: HTMLElement }):
  { open(frameId: string): void, close(): void, refresh(): void, destroy(): void }
/** A selected frame's Comment button (quickdraw-toolbar). */
export function commentTools(view: { open(frameId: string): void }): { context: unknown[] }
