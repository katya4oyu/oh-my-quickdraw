import { describe, it, expect } from 'vitest'
import { Store, pageBounds } from '@quickdrawjs/core'
import { bindFrames } from 'quickdraw-frames'
import { registerMarkdown } from 'quickdraw-markdown'
import { describeBoard, boardToMarkdown, runOp, applySteps, undoDiff, BOARD_TOOLS, installMeasure } from '../src/index.js'

installMeasure() // Node has no canvas to measure text with

registerMarkdown()
const board = () => { const s = new Store(); bindFrames(s); return s }
const human = (id, text, x, y) => ({ id, typeName: 'shape', type: 'note', x, y, rot: 0, z: 1, props: { text, color: 'yellow', size: 'm', font: 'draw', scale: 1 } })

describe('reading', () => {
  it('describes frames, members, loose shapes and connections', () => {
    const store = board()
    const { result: [frame, a, b] } = applySteps(store, 'Claude', [
      { do: 'frame', title: 'Plan', aspect: '16:9' },
      { do: 'note', text: 'Idea', in: '@f', ref: 'a' },
      { do: 'shape', shape: 'rectangle', text: 'Box', ref: 'b' },
      { do: 'arrow', from: '@a', to: '@b' },
    ].map((s, i) => (i === 0 ? { ...s, ref: 'f' } : s)))
    const d = describeBoard(store)
    expect(d.frames).toMatchObject([{ id: frame, title: 'Plan', members: [a] }])
    expect(d.items.find((it) => it.id === a)).toMatchObject({ type: 'note', text: 'Idea', frame, by: 'Claude' })
    expect(d.arrows[0]).toMatchObject({ from: a, to: b })
    const md = boardToMarkdown(store)
    expect(md).toMatch(/## Plan \(frame, 16:9/)
    expect(md).toMatch(/- Idea → Box/)
  })
})

describe('operations', () => {
  it('marks what they add, and place it clear of the board', () => {
    const store = board()
    store.put(human('shape:h', 'mine', 0, 0))
    const { result: id } = runOp(store, 'Claude', (ops) => ops.note('hi'))
    const s = store.get(id)
    expect(s.agent).toMatchObject({ name: 'Claude' })
    expect(s.x).toBeGreaterThan(200) // to the right of the human's note
  })

  it('are all or nothing', () => {
    const store = board()
    expect(() => applySteps(store, 'Claude', [{ do: 'note', text: 'ok' }, { do: 'shape', shape: 'blob' }])).toThrow(/unknown shape/)
    expect(store.shapes()).toHaveLength(0)
  })

  it('refuse to delete what a person made, and bad input', () => {
    const store = board()
    store.put(human('shape:h', 'mine', 0, 0))
    expect(() => runOp(store, 'Claude', (ops) => ops.delete(['shape:h']))).toThrow(/not added by an agent/)
    expect(() => runOp(store, 'Claude', (ops) => ops.note('x', { color: 'url(x)' }))).toThrow(/unknown color/)
    expect(store.has('shape:h')).toBe(true)
  })

  it('reroute linked arrows when their shapes move', () => {
    const store = board()
    const { result: [a, b, arrow] } = applySteps(store, 'Claude', [
      { do: 'shape', shape: 'rectangle', text: 'A', ref: 'a', at: { x: 0, y: 0 } },
      { do: 'shape', shape: 'rectangle', text: 'B', ref: 'b', at: { x: 400, y: 0 } },
      { do: 'arrow', from: '@a', to: '@b' },
    ])
    runOp(store, 'Claude', (ops) => ops.move(b, { x: 400, y: 600 }))
    expect(describeBoard(store).arrows[0]).toMatchObject({ id: arrow, from: a, to: b })
    expect(store.get(arrow).props.dy).toBeGreaterThan(300)
  })

  it('undo only what nobody changed since', () => {
    const store = board()
    const one = runOp(store, 'Claude', (ops) => [ops.note('a'), ops.note('b')])
    const [a, b] = one.result
    store.update(b, { props: { text: 'edited by a person' } })
    expect(undoDiff(store, one.diff)).toEqual({ reverted: 1, skipped: [b] })
    expect(store.has(a)).toBe(false)
    expect(store.get(b).props.text).toBe('edited by a person')
  })
})

describe('tools', () => {
  const tool = (name) => BOARD_TOOLS.find((t) => t.name === name)

  it('describe themselves with a JSON Schema', () => {
    for (const t of BOARD_TOOLS) {
      expect(t.name).toMatch(/^[a-z_]+$/)
      expect(t.description.length).toBeGreaterThan(10)
      expect(t.inputSchema).toMatchObject({ type: 'object', additionalProperties: false })
    }
    expect(tool('add_note').inputSchema.properties.color.enum).toContain('yellow')
  })

  it('make one operation each, as the same step would', () => {
    const store = board()
    const { ids: [frame], op } = tool('add_frame').run(store, { title: 'Plan' }, { name: 'Codex' })
    const note = tool('add_note').run(store, { text: 'Idea', in: frame }, { name: 'Codex' })
    expect(store.get(note.ids[0])).toMatchObject({ frameId: frame, agent: { name: 'Codex', op: note.op } })
    expect(op).not.toBe(note.op)
    expect(tool('read_board').run(store, {})).toMatch(/## Plan[\s\S]*Idea/)
    expect(tool('read_board').run(store, { format: 'json' }).frames[0].members).toEqual(note.ids)
    // frame membership is set by a listener as the note lands: still one undo
    expect(undoDiff(store, note.diff)).toEqual({ reverted: 1, skipped: [] })
    expect(store.has(note.ids[0])).toBe(false)
  })

  it('apply several steps as one operation, all or nothing', () => {
    const store = board()
    const { ids } = tool('apply_steps').run(store, { steps: [
      { do: 'shape', shape: 'rectangle', text: 'A', ref: 'a' },
      { do: 'shape', shape: 'ellipse', text: 'B', ref: 'b' },
      { do: 'arrow', from: '@a', to: '@b' },
    ] })
    expect(ids).toHaveLength(3)
    expect(() => tool('delete_shapes').run(store, { ids: ['shape:nope'] })).toThrow(/no shape/)
  })
})

describe('frames keep their size', () => {
  const inside = (store, id, f) => {
    const b = pageBounds(store.get(id)), fb = pageBounds(store.get(f))
    return b.x >= fb.x && b.y >= fb.y && b.x + b.w <= fb.x + fb.w && b.y + b.h <= fb.y + fb.h
  }

  it('a full frame refuses more, rather than growing or piling up', () => {
    const store = board()
    const { result: f } = runOp(store, 'C', (ops) => ops.frame('Small', { at: { x: 0, y: 0 }, w: 480, h: 320 }))
    let added = 0, refused = null
    for (let i = 0; i < 10 && !refused; i++) {
      try { runOp(store, 'C', (ops) => ops.note(`n${i}`, { inFrame: f })); added++ } catch (e) { refused = e }
    }
    expect(refused?.message).toMatch(/is full.*fit/)
    const members = store.shapes().filter((s) => s.frameId === f && s.type === 'note')
    expect(members).toHaveLength(added)
    for (const m of members) expect(inside(store, m.id, f), m.id).toBe(true) // none piled at an edge
    expect(store.get(f).props).toMatchObject({ w: 480, h: 320 })
  })

  it('fit shrinks the contents and the shapes named together, keeping their layout and the frame', () => {
    const store = board()
    const { result: f } = runOp(store, 'C', (ops) => ops.frame('Slide', { at: { x: 0, y: 0 }, w: 480, aspect: '16:9' }))
    // built in free space: six notes in two columns, far to the right
    const { result: notes } = applySteps(store, 'C', [0, 1, 2, 3, 4, 5].map((i) => ({ do: 'note', text: `n${i}`, at: { x: 2000 + (i % 2) * 240, y: (i >> 1) * 240 } })))
    const op = runOp(store, 'C', (ops) => ops.fit(f, { ids: notes }))
    expect(store.get(f).props).toMatchObject({ w: 480, h: 270 }) // the frame: untouched, 16:9
    for (const id of notes) {
      expect(inside(store, id, f), id).toBe(true)
      expect(store.get(id).frameId).toBe(f)
      expect(store.get(id).props.scale).toBeLessThan(1)
    }
    const [a, b, c] = notes.map((id) => store.get(id))
    expect(a.x).toBeLessThan(b.x) // same columns and rows as before
    expect(a.y).toBe(b.y)
    expect(c.y).toBeGreaterThan(a.y)
    expect(undoDiff(store, op.diff)).toMatchObject({ skipped: [] })
    expect(store.get(notes[0])).toMatchObject({ x: 2000, y: 0, props: { scale: 1 } })
    expect(store.get(notes[0]).frameId).toBeUndefined()
  })

  it('fit never enlarges, and refuses what would become unreadable', () => {
    const store = board()
    const { result: [f, n] } = runOp(store, 'C', (ops) => { const f = ops.frame('Big', { at: { x: 0, y: 0 }, w: 1600, h: 900 }); return [f, ops.note('x', { at: { x: 3000, y: 0 } })] })
    runOp(store, 'C', (ops) => ops.fit(f, { ids: [n] }))
    expect(store.get(n).props.scale).toBe(1)
    const { result: tiny } = runOp(store, 'C', (ops) => ops.frame('Tiny', { at: { x: 0, y: 2000 }, w: 120, h: 80 }))
    expect(() => runOp(store, 'C', (ops) => ops.fit(tiny, { ids: [n] }))).toThrow(/too much to fit/)
    expect(store.get(n).frameId).toBe(f)
  })

  it('fit leaves a neighbouring frame and loose shapes alone', () => {
    const store = board()
    store.put(human('shape:h', 'mine', 1100, 0)) // outside both frames
    const { result: [f, g, m] } = runOp(store, 'C', (ops) => {
      const f = ops.frame('A', { at: { x: 0, y: 0 }, w: 480, h: 320 })
      const g = ops.frame('B', { at: { x: 520, y: 0 }, w: 480, h: 320 })
      return [f, g, ops.note('in B', { inFrame: g })]
    })
    const beforeG = store.get(g), beforeM = store.get(m), beforeH = store.get('shape:h')
    runOp(store, 'C', (ops) => ops.fit(f, { ids: [ops.note('new')] }))
    expect(store.get(g)).toEqual(beforeG)
    expect(store.get(m)).toEqual(beforeM)
    expect(store.get('shape:h')).toEqual(beforeH)
  })

  it('arrange counts a frame\'s title, so frames in a column do not overlap', () => {
    const store = board()
    const { result: [f, g] } = runOp(store, 'C', (ops) => [ops.frame('One', { at: { x: 0, y: 0 } }), ops.frame('Two', { at: { x: 900, y: 0 } })])
    runOp(store, 'C', (ops) => ops.arrange([f, g], { layout: 'column', gap: 24 }))
    const titleOfG = pageBounds(store.get(g + '-title')), one = pageBounds(store.get(f))
    expect(titleOfG.y).toBeGreaterThanOrEqual(one.y + one.h + 24)
  })
})
