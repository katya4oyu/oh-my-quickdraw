// Agents watching a shared screen (quickdraw-screenshare's LIVE frames), when
// the sharer lets them: the server tells them when the screen has changed, and
// they decide whether to look (and read it, as they like). Telling is cheap: a
// frame now and then is shrunk to a small grid of grey levels and compared with
// the screen as it was when they were last told. It tells only once the screen
// has settled (not while someone scrolls or types), and not too often.
import jpeg from 'jpeg-js'

export const COLS = 32
export const ROWS = 20

/** a screen as COLS × ROWS grey levels (0–255), row by row */
export type Signature = Uint8Array

/** The grey level of each cell of an RGBA picture. */
export function signatureOf(rgba: Uint8Array, w: number, h: number): Signature {
  const sum = new Float64Array(COLS * ROWS), count = new Uint32Array(COLS * ROWS)
  const step = Math.max(1, Math.floor(Math.min(w / COLS, h / ROWS) / 4)) // a few pixels per cell are enough
  for (let y = 0; y < h; y += step) {
    const row = Math.min(ROWS - 1, Math.floor((y * ROWS) / h)) * COLS
    for (let x = 0; x < w; x += step) {
      const i = (y * w + x) * 4
      const cell = row + Math.min(COLS - 1, Math.floor((x * COLS) / w))
      sum[cell] += 0.299 * rgba[i] + 0.587 * rgba[i + 1] + 0.114 * rgba[i + 2]
      count[cell]++
    }
  }
  return Uint8Array.from(sum, (s, i) => (count[i] ? Math.round(s / count[i]) : 0))
}

/** The share of cells (0–1) whose grey level moved by more than `level`. */
export function difference(a: Signature, b: Signature, level = 24): number {
  let moved = 0
  for (let i = 0; i < a.length; i++) if (Math.abs(a[i] - b[i]) > level) moved++
  return moved / a.length
}

/** A JPEG's signature; null when it cannot be read. */
export function jpegSignature(data: Uint8Array): Signature | null {
  try {
    const { width, height, data: rgba } = jpeg.decode(data, { useTArray: true, maxMemoryUsageInMB: 128 })
    return width && height ? signatureOf(rgba, width, height) : null
  } catch { return null }
}

export interface ScreenWatchOptions {
  /** the share of the screen that must have changed to tell (0.15) */
  min?: number
  /** how long it must have been still first, ms (1000) */
  settle?: number
  /** at least this long between two tellings, ms (10 000) */
  every?: number
  /** looks at a frame at most this often, ms (500) */
  sample?: number
  /** a change between two looks below this counts as still (0.02) */
  still?: number
  now?: () => number
  signature?: (data: Uint8Array) => Signature | null
}

export interface ScreenWatch {
  /** a frame from the sharer */
  feed(data: Uint8Array): void
}

export function createScreenWatch(onChange: (e: { change: number, at: number }) => void, {
  min = 0.15, settle = 1000, every = 10_000, sample = 500, still = 0.02, now = Date.now, signature = jpegSignature,
}: ScreenWatchOptions = {}): ScreenWatch {
  let base: Signature | null = null // as it was when last told (or first seen)
  let prev: Signature | null = null // as it was at the last look
  let looked = -Infinity, told = -Infinity, stillSince = 0
  return {
    feed(data) {
      const t = now()
      if (t - looked < sample) return
      looked = t
      const sig = signature(data)
      if (!sig) return
      if (!base || !prev) { base = prev = sig; stillSince = t; return }
      if (difference(prev, sig) > still) stillSince = t
      prev = sig
      const change = difference(base, sig)
      if (change >= min && t - stillSince >= settle && t - told >= every) {
        told = t
        base = sig
        onChange({ change: Math.round(change * 100) / 100, at: t })
      }
    },
  }
}
