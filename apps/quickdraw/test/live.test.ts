import { expect, it } from 'vitest'
import { Store } from '@quickdrawjs/core'
import { bindFrames } from 'quickdraw-frames'
import { applySteps, installMeasure, undoDiff } from 'quickdraw-agent'
import { copyOf, HAND, putLive, stopDrawing } from '../src/board/live.ts'

installMeasure()
HAND.speed = 6000 // a quick hand: the same steps, sooner

const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 400 200"><title>Two</title>
  <rect x="20" y="40" width="120" height="80" fill="none" stroke="#4263eb"/><text x="30" y="85" font-size="16">Page</text>
  <rect x="260" y="40" width="120" height="80" fill="none" stroke="#4263eb"/><text x="270" y="85" font-size="16">Relay</text></svg>`
const shapes = (s: Store) => JSON.stringify(s.all().sort((a, b) => (a.id < b.id ? -1 : 1)))

it('draws an SVG by hand: strokes grow, words are written, and it ends as the operation made it (so undo takes it back)', async () => {
  const live = new Store(); bindFrames(live)
  const copy = copyOf(live)
  const { op, diff } = applySteps(copy, 'Pen', [{ do: 'svg', svg, at: [0, 0] }]) as { op: string, diff: any }
  const grew: number[] = [], texts: string[] = []
  live.listen((d) => {
    for (const [, [, to]] of Object.entries(d.updated) as [string, [any, any]][]) {
      if (to.type === 'draw') grew.push(to.props.pts.length)
      if (to.type === 'text') texts.push(to.props.text)
    }
  })
  const seen: [number, number][] = []
  await putLive(live, diff, copy, (x, y) => seen.push([x, y]), 0, { op })
  expect(shapes(live)).toBe(shapes(copy))
  expect(grew.length).toBeGreaterThan(4) // a stroke a little at a time
  expect(texts).toContain('Pa') // a character at a time
  expect(seen.length).toBeGreaterThan(10) // the cursor on the tip
  undoDiff(live, diff)
  expect(live.all()).toEqual([])
})

it('stops a drawing still going on: the rest never goes on, and undo takes back what did', async () => {
  const live = new Store(); bindFrames(live)
  const copy = copyOf(live)
  const { op, diff } = applySteps(copy, 'Pen', [{ do: 'svg', svg, at: [0, 0] }]) as { op: string, diff: any }
  let n = 0
  const drawing = putLive(live, diff, copy, () => { if (++n === 8) void stopDrawing(op) }, 0, { op })
  await drawing
  expect(live.all().length).toBeLessThan(copy.all().length)
  const r = undoDiff(live, diff)
  expect(r.skipped).toEqual([]) // what was half drawn was finished first
  expect(live.all()).toEqual([])
  expect(await stopDrawing(op)).toBe(false) // nothing going on any more
})

it('omq svg draws a file on a board, and --show gives the SVG back', async () => {
  const { mkdtempSync, writeFileSync } = await import('node:fs')
  const { tmpdir } = await import('node:os')
  const { join } = await import('node:path')
  const { main } = await import('../src/commands/index.ts')
  const dir = mkdtempSync(join(tmpdir(), 'omq-svg-'))
  writeFileSync(join(dir, 'two.svg'), svg)
  process.env.QUICKDRAW_LOG = join(dir, 'log.jsonl')
  const out: string[] = []
  await main(['svg', join(dir, 'two.svg'), '--file', join(dir, 'board.json'), '--at', '100,50'], (s) => out.push(s))
  const r = JSON.parse(out[0])
  expect(r).toMatchObject({ at: '100,50', size: '400x200', units: 2, strokes: 2, words: 2 })
  const shown: string[] = []
  await main(['svg', '--show', r.frame, '--file', join(dir, 'board.json')], (s) => shown.push(s))
  expect(shown[0]).toBe(svg)
  const undone: string[] = []
  await main(['undo', '--file', join(dir, 'board.json')], (s) => undone.push(s))
  expect(JSON.parse(undone[0])).toMatchObject({ undone: r.op, skipped: [] })
})
