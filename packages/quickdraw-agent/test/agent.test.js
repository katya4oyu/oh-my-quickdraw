import { describe, it, expect } from 'vitest'
import { Store, pageBounds } from '@quickdrawjs/core'
import { bindFrames } from 'quickdraw-frames'
import { registerMarkdown } from 'quickdraw-markdown'
import { describeBoard, boardToMarkdown, runOp, applySteps, undoDiff, BOARD_TOOLS, installMeasure, freeSpot, lintBoard, lintText, fixLayout, fixText } from '../src/index.js'

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

  it('puts several things into a frame in one operation side by side, not on top of each other', () => {
    const store = board()
    const { result: [f, ...notes] } = applySteps(store, 'C', [
      { do: 'frame', title: 'Keep', at: { x: 0, y: 0 }, w: 280, h: 700, ref: 'f' },
      ...[1, 2, 3].map((i) => ({ do: 'note', text: `n${i}`, in: '@f' })),
    ])
    const bs = notes.map((id) => pageBounds(store.get(id)))
    for (let i = 0; i < bs.length; i++) for (let j = i + 1; j < bs.length; j++) {
      const a = bs[i], b = bs[j]
      expect(a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h, `${notes[i]} and ${notes[j]}`).toBe(false)
    }
    for (const id of notes) expect(inside(store, id, f), id).toBe(true)
    // and one that no longer fits is refused there too, the whole operation with it
    expect(() => applySteps(store, 'C', [1, 2].map((i) => ({ do: 'note', text: `more${i}`, in: f })))).toThrow(/is full/)
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

describe('checking the layout', () => {
  const kinds = (issues) => issues.map((i) => i.kind)

  it('finds nothing wrong in what the operations lay out by themselves', () => {
    const store = board()
    const { result: [f] } = applySteps(store, 'C', [{ do: 'frame', title: 'Keep', w: 700, h: 300, at: { x: 0, y: 0 } }])
    for (const i of [1, 2, 3]) applySteps(store, 'C', [{ do: 'note', text: `n${i}`, in: f }])
    applySteps(store, 'C', [
      { do: 'shape', shape: 'rectangle', text: 'A', ref: 'a' },
      { do: 'shape', shape: 'rectangle', text: 'B', ref: 'b' },
      { do: 'arrow', from: '@a', to: '@b' },
    ])
    expect(lintBoard(store)).toEqual([])
    expect(lintText([])).toBe('No layout problems found.')
  })

  it('finds shapes on top of each other, a heading over a frame title, and says who made them', () => {
    const store = board()
    const { result: [a, b] } = applySteps(store, 'C', [
      { do: 'note', text: 'First', at: { x: 0, y: 0 } },
      { do: 'note', text: 'Second', at: { x: 0, y: 110 } }, // 200 tall: 90 on top of the first
    ])
    store.put(human('shape:p', 'Mine', 150, 0))
    const issues = lintBoard(store)
    expect(issues.map((i) => i.ids)).toEqual(expect.arrayContaining([[a, b], [a, 'shape:p'], [b, 'shape:p']]))
    expect(issues.find((i) => i.ids.includes('shape:p')).text).toMatch(/note "Mine" \(shape:p, by a person\)/)
    expect(lintText(issues)).toMatch(/^3 layout problems:\n- note "First"/)

    const s2 = board()
    const { result: [f] } = applySteps(s2, 'C', [{ do: 'frame', title: 'Keep', at: { x: 0, y: 100 }, w: 400, h: 300 }])
    const { result: [t] } = applySteps(s2, 'C', [{ do: 'text', text: 'A big heading over it all', at: { x: 0, y: 70 } }])
    expect(lintBoard(s2)).toEqual(expect.arrayContaining([expect.objectContaining({ kind: 'overlap', ids: [f + '-title', t] })]))
  })

  it('finds an arrow across a shape it does not connect', () => {
    const store = board()
    const { result: [a, , c, arrow] } = applySteps(store, 'C', [
      { do: 'shape', shape: 'rectangle', text: 'A', w: 120, h: 80, at: { x: 0, y: 0 }, ref: 'a' },
      { do: 'shape', shape: 'diamond', text: 'Wall', w: 120, h: 80, at: { x: 300, y: 0 } },
      { do: 'shape', shape: 'rectangle', text: 'C', w: 120, h: 80, at: { x: 600, y: 0 }, ref: 'c' },
      { do: 'arrow', from: '@a', to: '@c' },
    ])
    const [issue] = lintBoard(store)
    expect(issue).toMatchObject({ kind: 'arrow-crosses' })
    expect(issue.ids[0]).toBe(arrow)
    expect(issue.text).toMatch(/runs across diamond "Wall"/)
    expect(issue.ids).not.toContain(a)
    expect(issue.ids).not.toContain(c)
  })

  it('finds what lies across a frame\'s edge, and frames on top of each other', () => {
    const store = board()
    const { result: [f, g] } = applySteps(store, 'C', [
      { do: 'frame', title: 'One', at: { x: 0, y: 0 }, w: 400, h: 300 },
      { do: 'frame', title: 'Two', at: { x: 300, y: 100 }, w: 400, h: 300 },
    ])
    applySteps(store, 'C', [{ do: 'note', text: 'Half out', at: { x: 900, y: 150 } }])
    const n = store.shapes().find((s) => s.type === 'note')
    store.update(n.id, { x: 620, y: 300 }) // across Two's bottom-right corner
    const issues = lintBoard(store)
    expect(kinds(issues)).toContain('frames-overlap')
    expect(issues.find((i) => i.kind === 'frames-overlap').ids).toEqual([f, g])
    expect(issues.some((i) => ['straddles-frame', 'outside-frame'].includes(i.kind) && i.ids.includes(n.id))).toBe(true)
  })

  it('finds a label that does not fit its shape, which update_shape makes room for', () => {
    const store = board()
    const { result: [box] } = applySteps(store, 'C', [{ do: 'shape', shape: 'rectangle', text: 'Not yet: resend link\nand check email', w: 210, h: 70, at: { x: 0, y: 0 } }])
    const [issue] = lintBoard(store)
    expect(issue).toMatchObject({ kind: 'text-overflow', ids: [box] })
    expect(issue.text).toMatch(/update_shape w, h/)
    applySteps(store, 'C', [{ do: 'update', id: box, w: 260, h: 110 }])
    expect(store.get(box).props).toMatchObject({ w: 260, h: 110 })
    expect(lintBoard(store)).toEqual([])
    expect(() => applySteps(store, 'C', [{ do: 'frame', title: 'F', ref: 'f' }, { do: 'update', id: '@f', w: 900 }])).toThrow(/cannot be resized/)
  })

  it('finds what sits right against a frame\'s edge, in it or not', () => {
    const store = board()
    const { result: [f] } = applySteps(store, 'C', [{ do: 'frame', title: 'Keep', at: { x: 0, y: 0 }, w: 300, h: 300 }])
    applySteps(store, 'C', [{ do: 'note', text: 'Below', at: { x: 40, y: 297 } }]) // 3 on it: not in, not clear
    const issues = lintBoard(store)
    expect(issues).toEqual([expect.objectContaining({ kind: 'touches-frame', ids: [issues[0].ids[0], f] })])
  })

  it('checks only a frame, some shapes or an area when asked', () => {
    const store = board()
    const { result: [f] } = applySteps(store, 'C', [{ do: 'frame', title: 'Mine', at: { x: 0, y: 0 }, w: 600, h: 400 }])
    applySteps(store, 'C', [
      { do: 'note', text: 'In', at: { x: 30, y: 30 } }, { do: 'note', text: 'In too', at: { x: 30, y: 130 } }, // in the frame, on each other
      { do: 'note', text: 'Out', at: { x: 1000, y: 0 } }, { do: 'note', text: 'Out too', at: { x: 1000, y: 100 } }, // elsewhere, on each other
    ])
    expect(lintBoard(store)).toHaveLength(2)
    const inFrame = lintBoard(store, { frame: f })
    expect(inFrame).toHaveLength(1)
    expect(inFrame[0].text).toMatch(/"In"/)
    expect(lintBoard(store, { area: { x: 900, y: -50, w: 500, h: 500 } })[0].text).toMatch(/"Out"/)
    expect(() => lintBoard(store, { frame: 'shape:nope' })).toThrow(/not a frame/)
  })

  it('is a tool: by default it checks the work area', () => {
    const store = board()
    applySteps(store, 'C', [
      { do: 'note', text: 'Here', at: { x: 0, y: 0 } }, { do: 'note', text: 'Here too', at: { x: 0, y: 100 } },
      { do: 'note', text: 'Away', at: { x: 2000, y: 0 } }, { do: 'note', text: 'Away too', at: { x: 2000, y: 100 } },
    ])
    const check = BOARD_TOOLS.find((t) => t.name === 'check_board')
    const text = check.run(store, {}, { name: 'C', area: { x: -50, y: -50, w: 400, h: 500 } })
    expect(text).toMatch(/^1 layout problem:/)
    expect(text).toMatch(/"Here"/)
    expect(check.run(store, {}, { name: 'C' })).toMatch(/^2 layout problems:/)
  })
})

describe('fixing the layout', () => {
  it('pulls notes piled in a small frame apart and fits them in, as one undoable operation', () => {
    const store = board()
    const { result: [f] } = applySteps(store, 'C', [{ do: 'frame', title: 'Keep', at: { x: 0, y: 0 }, w: 280, h: 460 }])
    const notes = [1, 2, 3].map((i) => applySteps(store, 'C', [{ do: 'note', text: `n${i}`, at: { x: 40, y: 40 } }]).result[0])
    expect(lintBoard(store, { frame: f }).length).toBeGreaterThan(0)
    const r = fixLayout(store, 'C', { frame: f })
    expect(r.left).toEqual([])
    expect(lintBoard(store)).toEqual([])
    for (const id of notes) expect(store.get(id).frameId).toBe(f)
    expect(fixText(r)).toMatch(/^Fixed \d+ by itself:[\s\S]*No layout problems left\.$/)
    undoDiff(store, r.diff) // one undo
    expect(notes.map((id) => [store.get(id).x, store.get(id).y])).toEqual([[40, 40], [40, 40], [40, 40]])
  })

  it('grows a shape for its label, and moves a heading off a frame\'s title', () => {
    const store = board()
    const { result: [box] } = applySteps(store, 'C', [{ do: 'shape', shape: 'rectangle', text: 'Not yet: resend link\nand check email', w: 210, h: 70, at: { x: 0, y: 600 } }])
    applySteps(store, 'C', [{ do: 'frame', title: 'Keep', at: { x: 0, y: 100 }, w: 400, h: 300 }])
    const { result: [t] } = applySteps(store, 'C', [{ do: 'text', text: 'A big heading', at: { x: 0, y: 70 } }])
    const y0 = store.get(t).y
    const r = fixLayout(store, 'C')
    expect(store.get(box).props.h).toBeGreaterThan(70)
    expect(store.get(t).y).toBeLessThan(y0)
    expect(r.left).toEqual([])
  })

  it('moves only what agents made, and leaves what needs judgement', () => {
    const store = board()
    store.put(human('shape:p', 'Mine', 0, 0))
    const { result: [n] } = applySteps(store, 'C', [{ do: 'note', text: 'Agent', at: { x: 50, y: 50 } }])
    applySteps(store, 'C', [
      { do: 'shape', shape: 'rectangle', text: 'A', w: 120, h: 80, at: { x: 0, y: 600 }, ref: 'a' },
      { do: 'shape', shape: 'diamond', text: 'Wall', w: 120, h: 80, at: { x: 300, y: 600 } },
      { do: 'shape', shape: 'rectangle', text: 'C', w: 120, h: 80, at: { x: 600, y: 600 }, ref: 'c' },
      { do: 'arrow', from: '@a', to: '@c' },
    ])
    const r = fixLayout(store, 'C')
    expect(store.get('shape:p')).toMatchObject({ x: 0, y: 0 })
    expect(store.get(n).x !== 50 || store.get(n).y !== 50).toBe(true)
    expect(r.left.map((i) => i.kind)).toEqual(['arrow-crosses'])
    expect(fixText(r)).toMatch(/^NOT DONE: 1 problem left for you to fix[\s\S]*runs across diamond "Wall"/)
    expect(fixLayout(store, 'C')).toBeNull() // nothing more it can fix
  })

  it('is check_board with fix', () => {
    const store = board()
    applySteps(store, 'C', [{ do: 'note', text: 'One', at: { x: 0, y: 0 } }, { do: 'note', text: 'Two', at: { x: 0, y: 100 } }])
    const check = BOARD_TOOLS.find((t) => t.name === 'check_board')
    const r = check.run(store, { fix: true }, { name: 'C' })
    expect(r).toMatchObject({ op: expect.stringMatching(/^op:/), ids: expect.any(Array) })
    expect(r.text).toMatch(/No layout problems left/)
    expect(check.run(store, { fix: true }, { name: 'C' })).toBe('No layout problems found.')
  })
})

