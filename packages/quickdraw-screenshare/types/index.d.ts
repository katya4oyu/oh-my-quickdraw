import type { Editor, Store } from '@quickdrawjs/core'

/** Messages to the host (to every other page on the board; `snap` to the sharer). */
export type ShareOut = { kind: 'start', name: string } | { kind: 'stop' } | { kind: 'snap', by: string }
/** Messages from the host. `sharing.mine`: this page is the one sharing. */
export type ShareIn =
  | { kind: 'sharing', sharer: { name: string } | null, mine?: boolean }
  | { kind: 'frame', data: Uint8Array }
  | { kind: 'snap', by: string }

export interface ShareHost {
  me(): { name: string }
  send(message: ShareOut): void
  /** a live frame (JPEG); the host may drop it */
  sendFrame(jpeg: Uint8Array): void
  /** false while the last frame is still on its way: the next one is skipped */
  canSend?(): boolean
  onMessage(fn: (message: ShareIn) => void): void | (() => void)
}

export interface ScreenShare {
  readonly sharer: { name: string } | null
  readonly sharing: boolean
  /** shares a tab or window (the browser asks which), or the given stream */
  start(stream?: MediaStream): Promise<void>
  stop(): void
  /** taken here when sharing (resolves to the placed ids), else asked of the sharer (null) */
  snap(): Promise<{ frameId: string, imageId: string } | null>
  onChange(fn: () => void): () => void
  destroy(): void
}

export function createScreenShare(opts: {
  editor: Editor
  container?: HTMLElement
  host: ShareHost
  /** the live picture: its long side, JPEG quality, and the shortest time between frames (ms) */
  live?: { maxSide: number, quality: number, every: number }
  /** a snapshot: its long side and JPEG quality */
  snapshot?: { maxSide: number, quality: number }
}): ScreenShare

export const SHARE_ICONS: { share: string, snap: string, fold: string, unfold: string }
/** quickdraw-toolbar items for the "…" menu */
export function screenShareTools(share: ScreenShare): { menu: object[] }

export interface SnapshotMark { at: number, by: string, imageId: string, sent?: string }
export interface SnapshotFeedback {
  frameId: string
  title: string
  at: number
  by: string
  imageId: string
  /** what people put in the frame: everything but the still and the title */
  shapeIds: string[]
  key: string
  /** something is there that was not sent yet */
  pending: boolean
}

export function isSnapshot(rec: unknown): boolean
export function snapshots(store: Store): Array<{ id: string, snapshot: SnapshotMark } & Record<string, any>>
/** Puts a still in a frame of its own: right of the last snapshot, or mid-view. */
export function placeSnapshot(
  editor: Pick<Editor, 'store' | 'viewportPageBounds'>,
  image: { src: string, w: number, h: number },
  opts?: { title?: string, by?: string, at?: number, width?: number },
): { frameId: string, imageId: string }
export function snapshotFeedback(store: Store, frameId: string): SnapshotFeedback | null
export function pendingFeedback(store: Store): SnapshotFeedback[]
/** notes that these snapshots' feedback, as it is now, went out */
export function markSent(store: Store, frameIds: string[]): void
