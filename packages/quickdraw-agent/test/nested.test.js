import { describe, it, expect } from 'vitest'
import { Store, pageBounds } from '@quickdrawjs/core'
import { bindFrames } from 'quickdraw-frames'
import { describeBoard, boardToMarkdown, applySteps, installMeasure, lintBoard } from '../src/index.js'

installMeasure()
const board = () => { const s = new Store(); bindFrames(s); return s }

describe('frames in frames, for agents', () => {
  function project() {
    const store = board()
    const { result: [outer, inner, note, loose] } = applySteps(store, 'Codex', [
      { do: 'frame', title: 'Project', at: { x: 0, y: 0 }, w: 900, h: 600, ref: 'o' },
      { do: 'frame', title: 'Step 1', in: '@o', w: 400, h: 300, ref: 'i' },
      { do: 'note', text: 'Do this', in: '@i' },
      { do: 'note', text: 'About it', in: '@o' },
    ])
    return { store, outer, inner, note, loose }
  }

  it('puts a frame in a frame (in), and reads them nested', () => {
    const { store, outer, inner, note, loose } = project()
    expect(store.get(inner).frameId).toBe(outer)
    expect(store.get(note).frameId).toBe(inner)
    expect(store.get(loose).frameId).toBe(outer)
    const d = describeBoard(store)
    expect(d.frames.find((f) => f.id === inner)).toMatchObject({ frame: outer })
    expect(d.frames.find((f) => f.id === outer).members).toEqual(expect.arrayContaining([inner, loose]))
    const md = boardToMarkdown(store)
    expect(md).toMatch(new RegExp(`## Project \\(frame; id ${outer}\\)\\n\\n- \\[note, by Codex\\] About it \\(id ${loose}\\)\\n\\n### Step 1 \\(frame, in Project; id ${inner}\\)\\n\\n- \\[note, by Codex\\] Do this`))
    expect(md.match(/Step 1/g)).toHaveLength(1) // not again at the top level
  })

  it('does not call a frame inside another an overlap', () => {
    const { store } = project()
    expect(lintBoard(store).filter((i) => i.kind === 'frames-overlap')).toEqual([])
  })

  it('tidies only the outer frames (inner ones come along) and fits a frame with a frame in it', () => {
    const { store, outer, inner, note } = project()
    applySteps(store, 'Codex', [{ do: 'frame', title: 'Other', at: { x: 3000, y: 0 }, w: 300, h: 200 }])
    const before = { o: store.get(outer).x, i: store.get(inner).x, n: store.get(note).x }
    applySteps(store, 'Codex', [{ do: 'tidy', at: { x: 0, y: 1000 } }])
    const dx = store.get(outer).x - before.o, dy = store.get(outer).y
    expect(store.get(inner).x - before.i).toBe(dx) // moved with its frame, not laid out on its own
    expect(store.get(note).x - before.n).toBe(dx)
    expect(store.get(inner).frameId).toBe(outer)
    // shrinking what is in the outer frame takes the inner frame and its note along
    applySteps(store, 'Codex', [{ do: 'update', id: outer, text: 'Project' }])
    const { result } = applySteps(store, 'Codex', [{ do: 'fit', frame: outer }])
    expect(result[0]).toContain(inner)
    const i = store.get(inner), n = store.get(note)
    expect(n.x >= i.x && n.y >= i.y && n.x <= i.x + i.props.w && n.y <= i.y + i.props.h).toBe(true)
    void dy
  })
})

describe('a frame with its title inside', () => {
  it('is made so (title_inside), says so, and what goes in it keeps clear of its title', () => {
    const store = board()
    const { result: [f, n] } = applySteps(store, 'Codex', [
      { do: 'frame', title: 'Inside', at: { x: 0, y: 0 }, w: 600, h: 400, title_inside: true, ref: 'f' },
      { do: 'note', text: 'First', in: '@f' },
    ])
    const t = store.get(f + '-title')
    expect(t).toMatchObject({ x: 12, y: 8 })
    expect(describeBoard(store).frames[0]).toMatchObject({ id: f, title_inside: true })
    const nb = pageBounds(store.get(n)), tb = pageBounds(t)
    const clear = nb.x >= tb.x + tb.w || nb.x + nb.w <= tb.x || nb.y >= tb.y + tb.h || nb.y + nb.h <= tb.y
    expect(clear).toBe(true) // not over its title
  })
})

describe('a board in a board', () => {
  it('puts a card for another board, and reads it as one', () => {
    const store = board()
    const { result: [card] } = applySteps(store, 'Codex', [{ do: 'board', board: 'b2', title: 'Roadmap', live: true }])
    expect(store.get(card).props).toMatchObject({ board: 'b2', title: 'Roadmap', live: true })
    expect(boardToMarkdown(store)).toMatch(/\[boardcard, by Codex\] Roadmap \(board b2, live\)/)
    expect(() => applySteps(store, 'Codex', [{ do: 'board', board: '' }])).toThrow(/needs a board id/)
  })
})
