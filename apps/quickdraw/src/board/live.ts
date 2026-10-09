// What an operation did, put on a live board the way people see work grow:
// tried on a copy first (checked, all or nothing), then put a record at a time
// with the cursor on each. What was drawn from an SVG (ops.svg) goes on as by
// hand: each stroke grows from where it starts with the cursor on its tip, the
// pen lifts and travels to the next, words are written a character (or a line)
// at a time, with a breath between the SVG's units. Every record ends exactly
// as the operation made it, so undoing the operation takes it all back. A
// drawing still going on can be stopped (undo does, first).
import { pageBounds, Store, type BoardRecord, type Diff, type Store as StoreType } from '@quickdrawjs/core'
import { bindFrames } from 'quickdraw-frames'
import { bindLayouts, settled } from 'quickdraw-layouts'

const sleep = (ms: number) => new Promise((ok) => setTimeout(ok, ms))
const isShape = (r: BoardRecord) => r.typeName === 'shape' && !(r as { isFrameTitle?: boolean }).isFrameTitle

/** The board as it is, to try an operation on. */
export function copyOf(store: StoreType): StoreType {
  const copy = new Store()
  copy.loadSnapshot({ document: { store: Object.fromEntries(store.all().map((r) => [r.id, structuredClone(r)])) } })
  bindFrames(copy)
  bindLayouts(copy)
  return copy
}

// drawings going on, by operation: stop() ends one (what is half drawn is finished first)
const going = new Map<string, { stop: () => void, ended: Promise<void> }>()
/** Stops the drawing of an operation, if it is still going on; resolves once it has stopped. */
export async function stopDrawing(op: string) {
  const g = going.get(op)
  if (!g) return false
  g.stop()
  await g.ended
  return true
}

/** How fast a hand draws (page units a second), and how long a line of words takes at most. */
export const HAND = { speed: 900, frame: 33, lift: 60, unit: 250, line: 900 }

type Svg = { asset?: string, el?: string, unit?: number }
type Rec = { id: string, typeName: string, type?: string, x: number, y: number, svg?: Svg, props: Record<string, any> } // eslint-disable-line @typescript-eslint/no-explicit-any
const asRecord = (r: Rec) => r as unknown as BoardRecord

/**
 * Puts what an operation did on `done` (a copy it ran on) onto `store` a record
 * at a time, pointing at each; `pace` spreads it over about that long. The
 * records are taken as they ended up on the copy: a diff's added records are
 * as they were added, before listeners (frame membership) touched them.
 * `op` names it, for stopDrawing.
 */
export async function putLive(store: StoreType, diff: Diff, done: StoreType, point: (x: number, y: number) => void, pace = 2500, { op }: { op?: string } = {}) {
  const final = (id: string) => done.get(id) as BoardRecord
  // frames first (a member put before its frame would be let go of), arrows
  // last (after what they connect); otherwise in the order they were made
  const rank = (r: BoardRecord) => ((r as { isFrame?: boolean }).isFrame ? 0 : (r as { type?: string }).type === 'arrow' ? 2 : 1)
  const added = Object.keys(diff.added).map(final).filter(Boolean).sort((a, b) => rank(a) - rank(b))
  // moved or changed in the same order: a frame first, which brings its members (and title) along;
  // a member moved before its frame would land outside it and be let go of, and the title moved twice
  const updated = Object.entries(diff.updated).map(([id, [from]]) => [id, [from, final(id)]] as [string, [BoardRecord, BoardRecord]])
    .filter(([, [, to]]) => to).sort(([, [, a]], [, [, b]]) => rank(a) - rank(b))
  const shown = added.filter(isShape).length + updated.filter(([, [, to]]) => isShape(to)).length
  const gap = shown ? Math.min(250, Math.max(40, pace / shown)) : 0
  let stopped = false, end = () => {}
  if (op) going.set(op, { stop: () => { stopped = true }, ended: new Promise<void>((ok) => { end = ok }) })
  const apply = (d: Partial<Diff>) => settled(store, () => store.applyDiff({ added: {}, updated: {}, removed: {}, ...d }, 'user'))
  const one = async (d: Partial<Diff>, rec: BoardRecord) => {
    // laid out on the copy already: a bento grid must not read the pieces as drags
    apply(d)
    if (!isShape(rec)) return
    const b = pageBounds(rec as never)
    point(b.x + b.w / 2, b.y + b.h / 2)
    await sleep(gap)
  }
  // by hand: where the pen is, and the unit it is in
  let pen: [number, number] | null = null, unit: number | undefined
  const travel = async (x: number, y: number) => {
    const from = pen ?? [x, y], n = Math.min(8, Math.max(1, Math.round(Math.hypot(x - from[0], y - from[1]) / 120)))
    for (let i = 1; i <= n; i++) { point(from[0] + ((x - from[0]) * i) / n, from[1] + ((y - from[1]) * i) / n); await sleep(HAND.frame) }
    pen = [x, y]
  }
  const stroke = async (rec: Rec) => {
    const pts: number[] = rec.props.pts, path: [number, number][] = []
    for (let i = 0; i + 1 < pts.length; i += 3) path.push([rec.x + pts[i], rec.y + pts[i + 1]])
    await travel(...path[0])
    const along = [0]
    for (let i = 1; i < path.length; i++) along.push(along[i - 1] + Math.hypot(path[i][0] - path[i - 1][0], path[i][1] - path[i - 1][1]))
    const total = along.at(-1)!, ms = Math.max(120, (total / HAND.speed) * 1000)
    const upTo = (t: number) => { const k = along.findIndex((a) => a > (t / ms) * total); return k < 0 ? path.length : Math.max(2, k) }
    const part = (n: number) => ({ ...rec, props: { ...rec.props, pts: pts.slice(0, n * 3), done: false } })
    apply({ added: { [rec.id]: asRecord(part(2)) } })
    for (let t = HAND.frame; t < ms && !stopped; t += HAND.frame) {
      const n = upTo(t)
      store.put(asRecord(part(n)), 'user')
      point(...path[n - 1])
      await sleep(HAND.frame)
    }
    store.put(asRecord(rec), 'user') // as the operation made it
    pen = path.at(-1)!
    point(...pen)
    await sleep(HAND.lift)
  }
  const words = async (rec: Rec, by: 'chars' | 'lines') => {
    const b = pageBounds(rec as never), chars = [...String(rec.props.text)]
    await travel(b.x, b.y + b.h * 0.7)
    if (by === 'lines' || chars.length < 2) { apply({ added: { [rec.id]: asRecord(rec) } }); point(b.x + b.w, b.y + b.h * 0.7); pen = [b.x + b.w, b.y + b.h * 0.7]; await sleep(150); return }
    const per = Math.max(12, Math.min(45, HAND.line / chars.length)) // a line in about a second at most
    apply({ added: { [rec.id]: asRecord({ ...rec, props: { ...rec.props, text: chars[0] } }) } })
    for (let i = 2; i <= chars.length && !stopped; i++) {
      store.put(asRecord({ ...rec, props: { ...rec.props, text: chars.slice(0, i).join('') } }), 'user')
      const x = b.x + (b.w * i) / chars.length
      point(x, b.y + b.h * 0.7); pen = [x, b.y + b.h * 0.7]
      await sleep(per)
    }
    store.put(asRecord(rec), 'user')
    await sleep(80)
  }
  try {
    for (const rec of added as unknown as Rec[]) {
      if (stopped) break
      const svg = rec.svg
      if (svg?.el != null && isShape(asRecord(rec))) {
        if (unit != null && svg.unit !== unit) await sleep(HAND.unit) // a breath between units
        unit = svg.unit
        const by = (svg.asset ? (done.get(svg.asset) as { write?: 'chars' | 'lines' } | undefined)?.write : undefined) ?? 'chars'
        if (rec.type === 'draw' && rec.props.pts?.length >= 6) await stroke(rec)
        else if (rec.type === 'text') await words(rec, by)
        else await one({ added: { [rec.id]: asRecord(rec) } }, asRecord(rec))
      } else await one({ added: { [rec.id]: asRecord(rec) } }, asRecord(rec))
    }
    if (stopped) return // undo takes back what is on the board; the rest never goes on
    for (const [id, pair] of updated) await one({ updated: { [id]: pair } }, pair[1])
    if (Object.keys(diff.removed).length) settled(store, () => store.applyDiff({ added: {}, updated: {}, removed: diff.removed }, 'user'))
  } finally {
    if (op) { going.delete(op); end() }
  }
}
