import { describe, expect, it } from 'vitest'
import jpeg from 'jpeg-js'
import { COLS, ROWS, createScreenWatch, difference, jpegSignature, type Signature } from '../src/serve/screen-watch.ts'

// a screen whose first `share` of cells is white, the rest black
const screen = (share: number): Signature => Uint8Array.from({ length: COLS * ROWS }, (_, i) => (i < share * COLS * ROWS ? 255 : 0))

describe('the screen watch', () => {
  // frames are a byte naming the screen they show, at a clock the test moves
  function setup() {
    let t = 0
    const screens: Signature[] = []
    const told: { change: number, at: number }[] = []
    const watch = createScreenWatch((e) => told.push(e), { now: () => t, signature: (d) => screens[d[0]] })
    const show = (s: Signature, ms: number, every = 150) => {
      screens.push(s)
      const frame = Uint8Array.of(screens.length - 1)
      for (const end = t + ms; t < end; t += every) watch.feed(frame)
    }
    return { told, show }
  }

  it('tells once a big change has settled, not while it moves, and not too often', () => {
    const { told, show } = setup()
    show(screen(0), 2000) // the screen at first: nothing to tell
    expect(told).toEqual([])
    for (let i = 1; i <= 6; i++) show(screen(i / 10), 400) // scrolling: never still for a second
    expect(told).toEqual([])
    show(screen(0.6), 1500) // settled
    expect(told).toHaveLength(1)
    expect(told[0].change).toBe(0.6)
    show(screen(0.62), 3000) // a little more: not enough
    expect(told).toHaveLength(1)
    show(screen(0.1), 3000) // big, but only seconds after the last telling
    expect(told).toHaveLength(1)
    show(screen(0.1), 8000) // once it may tell again: it does
    expect(told).toHaveLength(2)
  })

  it('reads a JPEG into grey cells', () => {
    const w = 64, h = 40
    const rgba = new Uint8Array(w * h * 4)
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) rgba.fill(x < w / 2 ? 255 : 0, (y * w + x) * 4, (y * w + x) * 4 + 4)
    const sig = jpegSignature(jpeg.encode({ width: w, height: h, data: rgba }, 90).data)!
    expect(sig[0]).toBeGreaterThan(240) // left: white
    expect(sig[COLS - 1]).toBeLessThan(15) // right: black
    expect(difference(sig, screen(0))).toBeCloseTo(0.5, 1)
    expect(jpegSignature(Uint8Array.of(1, 2, 3))).toBeNull()
  })
})
