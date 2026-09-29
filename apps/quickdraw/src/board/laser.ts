// An agent points at something the way a person does, with the laser pointer:
// a stroke drawn a little at a time with its cursor on the tip, held a moment,
// then faded. Everyone sees it (quickdraw-presence shares lasers). Nothing is
// left on the board.
import type { Relay } from './relay.ts'

export interface Target { x: number, y: number, w?: number, h?: number }
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

/** The stroke: around a box (circle), or a quick tick under a point. */
export function laserPath(t: Target, { circle = false } = {}): [number, number][] {
  if (circle && t.w != null && t.h != null) {
    const cx = t.x + t.w / 2, cy = t.y + t.h / 2, rx = t.w / 2 + 22, ry = t.h / 2 + 18
    return Array.from({ length: 42 }, (_, i) => {
      const a = -Math.PI * 0.55 + (i / 40) * Math.PI * 2.1 // a little past a full turn, as a hand does
      return [Math.round(cx + rx * Math.cos(a)), Math.round(cy + ry * Math.sin(a))]
    })
  }
  const x = t.w != null ? t.x + t.w / 2 : t.x, y = t.h != null ? t.y + t.h + 12 : t.y + 12
  // a short swoop that ends under it
  return Array.from({ length: 14 }, (_, i) => { const k = i / 13; return [Math.round(x - 60 + 60 * k), Math.round(y + 26 * Math.sin(Math.PI * (1 - k)) * (1 - k))] })
}

/** Points with the laser: drawn over about half a second, held, then faded. */
export async function pointWith(relay: Pick<Relay, 'cursor' | 'laser'>, t: Target, { circle = false, hold = 900 } = {}) {
  const path = laserPath(t, { circle })
  const step = Math.max(1, Math.ceil(path.length / 12))
  for (let i = step; i <= path.length + step - 1; i += step) {
    const drawn = path.slice(0, Math.min(i, path.length))
    const [x, y] = drawn.at(-1)!
    relay.cursor(x, y)
    relay.laser([{ points: drawn, opacity: 1 }])
    await sleep(45)
  }
  await sleep(hold)
  for (const opacity of [0.7, 0.4, 0.15]) { relay.laser([{ points: path, opacity }]); await sleep(90) }
  relay.laser([])
  return path
}
