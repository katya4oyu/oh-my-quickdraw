import { describe, it, expect } from 'vitest'
import { Store, pageBounds } from '@quickdrawjs/core'
import { bindFrames } from 'quickdraw-frames'
import { registerMarkdown } from 'quickdraw-markdown'
import { describeBoard, boardToMarkdown, runOp, applySteps, undoDiff, BOARD_TOOLS, installMeasure, freeSpot } from '../src/index.js'

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

describe('images', () => {
  const PNG = 'data:image/png;base64,iVBORw0KGgo='
  it('puts an image (its asset and shape) in free space or a frame, sized to fit, and undoes both', () => {
    const store = board()
    const [f] = applySteps(store, 'Codex', [{ do: 'frame', title: 'F', at: { x: 0, y: 0 }, w: 600, h: 500 }]).result
    const { result: [img], diff } = applySteps(store, 'Codex', [{ do: 'image', src: PNG, natural: { w: 1254, h: 1254 }, in: f }])
    const shape = store.get(img)
    expect(shape).toMatchObject({ type: 'image', frameId: f, props: { w: 400, h: 400 } })
    expect(store.get(shape.props.assetId)).toMatchObject({ typeName: 'asset', src: PNG, w: 1254, h: 1254 })
    undoDiff(store, diff)
    expect(store.get(img)).toBeUndefined()
    expect(store.get(shape.props.assetId)).toBeUndefined()
    expect(() => applySteps(store, 'Codex', [{ do: 'image', src: 'https://example.com/x.png', natural: { w: 1, h: 1 } }])).toThrow(/data:image/)
  })
})

describe('arrange', () => {
  it('lays a grid out in as many columns as asked', () => {
    const store = board()
    const ids = applySteps(store, 'Codex', Array.from({ length: 8 }, (_, i) => ({ do: 'note', text: String(i) }))).result
    applySteps(store, 'Codex', [{ do: 'arrange', ids, cols: 4, gap: 10, at: { x: 0, y: 0 } }])
    const xs = new Set(ids.map((id) => store.get(id).x)), ys = new Set(ids.map((id) => store.get(id).y))
    expect([xs.size, ys.size]).toEqual([4, 2])
  })
})

describe('embeds', () => {
  const PREVIEW = { title: 'Quickdraw', siteName: 'GitHub', image: 'data:image/jpeg;base64,/9j/4AAQ' }
  it('puts a page, a link card or inline HTML in free space, marked, and undoes it', () => {
    const store = board()
    store.put(human('shape:h', 'Mine', 0, 0))
    const { op, diff, result: [page, card, html] } = applySteps(store, 'Codex', [
      { do: 'embed', url: 'https://youtu.be/dQw4w9WgXcQ' },
      { do: 'embed', url: 'https://github.com/katya4oyu/quickdraw', link: true, title: 'The fork', preview: PREVIEW },
      { do: 'embed', html: '<button>hi</button>', w: 200, h: 120 },
    ])
    expect(op).toMatch(/^op:/)
    expect(store.get(page)).toMatchObject({ type: 'embed', agent: { name: 'Codex' }, props: { kind: 'url', url: 'https://youtu.be/dQw4w9WgXcQ', w: 480, h: 270 } })
    expect(store.get(card).props).toMatchObject({ kind: 'link', title: 'The fork', preview: PREVIEW })
    expect(store.get(html).props).toMatchObject({ kind: 'html', html: '<button>hi</button>', w: 200, h: 120 })
    expect(store.get(page).x).toBeGreaterThan(200) // clear of the person's note
    const md = boardToMarkdown(store)
    expect(md).toMatch(/\[embed, by Codex\] The fork/)
    expect(undoDiff(store, diff).reverted).toBe(3)
    expect(store.shapes().map((s) => s.id)).toEqual(['shape:h'])
  })

  it('shows a plain http link as a card, and refuses what is not a page', () => {
    const store = board()
    const { result: [id] } = applySteps(store, 'Codex', [{ do: 'embed', url: 'http://example.com/' }])
    expect(store.get(id).props.kind).toBe('link')
    expect(() => applySteps(store, 'Codex', [{ do: 'embed', url: 'javascript:alert(1)' }])).toThrow(/http\(s\) URL/)
    expect(() => applySteps(store, 'Codex', [{ do: 'embed' }])).toThrow(/http\(s\) URL/)
    expect(() => applySteps(store, 'Codex', [{ do: 'embed', html: 'x'.repeat(200_001) }])).toThrow(/too long/)
    expect(store.shapes()).toHaveLength(1)
  })

  it('is a board tool too', () => {
    const store = board()
    const tool = BOARD_TOOLS.find((t) => t.name === 'add_embed')
    const { ids: [id] } = tool.run(store, { url: 'https://www.figma.com/file/abc', at: { x: 10, y: 20 } }, { name: 'Codex' })
    expect(store.get(id)).toMatchObject({ x: 10, y: 20, props: { kind: 'url' } })
  })
})

describe('snapshots', () => {
  it('reads a snapshot frame as one, and its still as a screenshot', () => {
    const store = board()
    const { result: [frame, image] } = applySteps(store, 'Ann', [
      { do: 'frame', title: '10:32 · Ann', at: { x: 0, y: 0 }, w: 600, h: 400 },
      { do: 'image', src: 'data:image/png;base64,iVBORw0KGgo=', natural: { w: 400, h: 300 }, at: { x: 24, y: 24 } },
    ])
    store.update(frame, { snapshot: { at: 5, by: 'Ann', imageId: image } })
    store.put(human('shape:fb', 'Button is cut off', 450, 100))
    const d = describeBoard(store)
    expect(d.frames[0]).toMatchObject({ id: frame, snapshot: { at: 5, by: 'Ann' } })
    expect(d.items.find((it) => it.id === image).text).toBe('(screenshot)')
    const md = boardToMarkdown(store)
    expect(md).toMatch(/## 10:32 · Ann \(snapshot of a shared screen; its notes and marks are feedback; id /)
    expect(md).toMatch(/Button is cut off/)
  })
})

describe('a work area', () => {
  const inside = (b, a) => b.x >= a.x && b.y >= a.y && b.x + b.w <= a.x + a.w && b.y + b.h <= a.y + a.h
  it('finds free space near where it is wanted, clear of what is there', () => {
    const store = board()
    expect(freeSpot(store, 600, 400, { x: 100, y: 100 })).toEqual({ x: 100, y: 100 }) // an empty board
    store.put(human('shape:h', 'Mine', 150, 150))
    const at = freeSpot(store, 600, 400, { x: 100, y: 100 })
    const note = pageBounds(store.get('shape:h'))
    expect(at.x + 600 < note.x || at.x > note.x + note.w || at.y + 400 < note.y || at.y - 40 > note.y + note.h).toBe(true)
  })

  it('takes what is added without a place, and grows down when full', () => {
    const store = board()
    const area = { x: 1000, y: 0, w: 520, h: 300 }
    store.put(human('shape:h', 'Mine', 1030, 50)) // a person's note in it already
    const r = applySteps(store, 'Codex', [
      { do: 'note', text: 'a' }, { do: 'note', text: 'b' }, { do: 'note', text: 'c' },
    ], { area })
    const boxes = r.result.map((id) => pageBounds(store.get(id)))
    for (const b of boxes) expect(inside(b, r.area)).toBe(true)
    expect(boxes.every((b) => !(b.x < 1230 && b.x + b.w > 1030 && b.y < 250 && b.y + b.h > 50))).toBe(true) // not on the person's note
    expect(r.area).toMatchObject({ x: 1000, y: 0, w: 520 })
    expect(r.area.h).toBeGreaterThan(300) // three notes and the person's do not fit: it grew down
    expect(area.h).toBe(300) // the caller's, untouched
    // a place given wins; no area, no area back
    const at = applySteps(store, 'Codex', [{ do: 'note', text: 'd', at: { x: -500, y: -500 } }], { area })
    expect(store.get(at.result[0])).toMatchObject({ x: -500, y: -500 })
    expect(applySteps(store, 'Codex', [{ do: 'note', text: 'e' }]).area).toBeUndefined()
  })

  it('goes through the board tools', () => {
    const store = board()
    const tool = BOARD_TOOLS.find((t) => t.name === 'add_note')
    const out = tool.run(store, { text: 'x' }, { name: 'Codex', area: { x: 0, y: 0, w: 400, h: 300 } })
    expect(inside(pageBounds(store.get(out.ids[0])), out.area)).toBe(true)
  })
})
