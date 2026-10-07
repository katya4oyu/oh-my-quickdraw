import { describe, it, expect } from 'vitest'
import { Store, pageBounds } from '@quickdrawjs/core'
import { bindFrames } from 'quickdraw-frames'
import { registerMarkdown } from 'quickdraw-markdown'
import { bindKanban, createKanban, createTicket } from 'quickdraw-tickets'
import { bindLayouts } from 'quickdraw-layouts'
import { describeBoard, boardToMarkdown, runOp, applySteps, undoDiff, BOARD_TOOLS, installMeasure, estimateWidth, freeSpot, lintBoard, lintText, fixLayout, fixText, checkWritten } from '../src/index.js'

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

describe('tickets', () => {
  const tool = (name) => BOARD_TOOLS.find((t) => t.name === name)

  it('reads tickets with who they are for and where they stand, and a kanban\'s columns', () => {
    const store = board()
    const { columns } = createKanban(store, { x: 0, y: 0 })
    const a = createTicket(store, { x: 20, y: 20, title: 'Fix login', body: 'on Safari', to: 'Codex' })
    const b = createTicket(store, { x: 2000, y: 0, title: 'Tidy' })
    const d = describeBoard(store)
    expect(d.frames.find((f) => f.id === columns.doing).kanban.status).toBe('doing')
    expect(d.items.find((it) => it.id === a)).toMatchObject({ type: 'ticket', text: 'Fix login\non Safari', frame: columns.todo, ticket: { status: 'todo', to: 'Codex', by: null } })
    const md = boardToMarkdown(store)
    expect(md).toMatch(/## Todo \(kanban column: todo tickets; id /)
    expect(md).toContain(`- [ticket, todo → Codex] Fix login / on Safari (id ${a})`)
    expect(md).toContain(`- [ticket, todo → any agent] Tidy (id ${b})`)
  })

  it('adds a ticket to the kanban\'s Todo column, and moves it on as one undo each', () => {
    const store = board()
    bindKanban(store)
    const { columns } = createKanban(store, { x: 0, y: 0 })
    const add = tool('add_ticket').run(store, { title: 'Write the README', to: 'pi' }, { name: 'Codex' })
    const [id] = add.ids
    expect(store.get(id)).toMatchObject({ frameId: columns.todo, agent: { name: 'Codex' }, props: { from: 'Codex', to: 'pi', status: 'todo' } })
    const take = tool('set_ticket_status').run(store, { id, status: 'doing' }, { name: 'pi' })
    expect(store.get(id)).toMatchObject({ frameId: columns.doing, props: { status: 'doing', by: 'pi' } })
    const done = tool('set_ticket_status').run(store, { id, status: 'done', result: 'Written' }, { name: 'pi' })
    expect(store.get(id)).toMatchObject({ frameId: columns.done, props: { status: 'done', by: 'pi', result: 'Written' } })
    expect(boardToMarkdown(store)).toContain('[ticket, done, pi] Write the README — Written')
    expect(undoDiff(store, done.diff).skipped).toEqual([])
    expect(store.get(id)).toMatchObject({ frameId: columns.doing, props: { status: 'doing', result: null } })
    undoDiff(store, take.diff)
    expect(store.get(id)).toMatchObject({ frameId: columns.todo, props: { status: 'todo', by: null } })
  })

  it('puts a ticket in free space without a kanban, and refuses what is not a ticket', () => {
    const store = board()
    const { result: [id, note] } = applySteps(store, 'Codex', [{ do: 'ticket', title: 'Look into it' }, { do: 'note', text: 'hi' }])
    expect(store.get(id).frameId).toBeUndefined()
    expect(() => applySteps(store, 'Codex', [{ do: 'status', id: note, status: 'done' }])).toThrow(/is not a ticket/)
    expect(() => applySteps(store, 'Codex', [{ do: 'status', id, status: 'later' }])).toThrow(/unknown status/)
    applySteps(store, 'Codex', [{ do: 'update', id, text: 'Look into it now\nfirst thing' }])
    expect(store.get(id).props).toMatchObject({ title: 'Look into it now', body: 'first thing' })
  })
})

describe('the pen', () => {
  it('circles, underlines, or draws through points, as a hand-drawn stroke that lint leaves alone', () => {
    const store = board()
    const { result: [note] } = applySteps(store, 'Claude', [{ do: 'note', text: 'Look', at: { x: 100, y: 100 } }])
    const { result: [ring, line, free] } = applySteps(store, 'Claude', [
      { do: 'pen', kind: 'circle', id: note }, { do: 'pen', kind: 'underline', id: note, color: 'blue' }, { do: 'pen', points: [[0, 0], [50, 20], [90, 0]] },
    ])
    const [n, r, l] = [note, ring, line].map((id) => pageBounds(store.get(id)))
    expect(store.get(ring)).toMatchObject({ type: 'draw', props: { color: 'red', dash: 'draw', done: true }, agent: { name: 'Claude' } })
    expect(r.x).toBeLessThan(n.x); expect(r.y).toBeLessThan(n.y) // around it
    expect(r.x + r.w).toBeGreaterThan(n.x + n.w); expect(r.y + r.h).toBeGreaterThan(n.y + n.h)
    expect(l.y).toBeGreaterThan(n.y + n.h) // under it
    expect(store.get(line).props.color).toBe('blue')
    expect(store.get(free).props.pts.length).toBe(9)
    expect(lintBoard(store)).toEqual([]) // marks may sit on anything
    expect(() => applySteps(store, 'Claude', [{ do: 'pen', kind: 'zigzag', id: note }])).toThrow(/unknown pen/)
  })
})

describe('who made what', () => {
  it('marks what an agent makes and changes, and reads who made it and who changed it last', () => {
    const store = board()
    const { result: [id] } = applySteps(store, 'Claude', [{ do: 'note', text: 'Plan' }])
    expect(store.get(id).made).toMatchObject({ by: 'Claude' })
    store.update(id, { props: { text: 'Plan v2' }, edited: { by: 'Ann', at: 1 } }) // Ann's page marks her edit
    expect(describeBoard(store).items[0]).toMatchObject({ by: 'Claude', edited_by: 'Ann' })
    expect(boardToMarkdown(store)).toContain('[note, by Claude, edited by Ann] Plan v2')
    const { diff } = runOp(store, 'Codex', (ops) => ops.move(id, { dx: 10 }))
    expect(store.get(id).edited).toMatchObject({ by: 'Codex' })
    expect(undoDiff(store, diff).skipped).toEqual([]) // the mark goes with the change
    expect(store.get(id).edited.by).toBe('Ann')
  })
})

describe('where things go, and gathering frames', () => {
  it('puts what has no place near where people look, clear of what is there, the next below the last', () => {
    const store = board()
    store.put(human('shape:there', 'In the way', 900, 480))
    const { result: [a, b] } = applySteps(store, 'Claude', [{ do: 'note', text: 'A' }, { do: 'note', text: 'B' }], { prefer: { x: 1000, y: 580 } })
    const [pa, pb, there] = [a, b, 'shape:there'].map((id) => pageBounds(store.get(id)))
    for (const p of [pa, pb]) {
      expect(Math.hypot(p.x + p.w / 2 - 1000, p.y + p.h / 2 - 580)).toBeLessThan(700) // near, not off to the right of everything
      expect(p.x < there.x + there.w && p.x + p.w > there.x && p.y < there.y + there.h && p.y + p.h > there.y).toBe(false)
    }
    expect(pb.y).toBeGreaterThan(pa.y)
  })

  it('gathers spread-out frames in reading order, in rows, each with what is in it and its title', () => {
    const store = board()
    const { result: [f1, n1, f2, f3] } = applySteps(store, 'Claude', [
      { do: 'frame', title: 'One', at: { x: 0, y: 0 }, w: 400, h: 300, ref: 'a' }, { do: 'note', text: 'in one', in: '@a' },
      { do: 'frame', title: 'Two', at: { x: 5000, y: 3000 }, w: 400, h: 300 },
      { do: 'frame', title: 'Three', at: { x: 9000, y: -2000 }, w: 400, h: 300 },
    ])
    const before = store.get(n1).x - store.get(f1).x
    const { result: moved, diff } = runOp(store, 'Claude', (ops) => ops.tidy({ width: 900 }))
    expect(moved).toHaveLength(3)
    const [a, b, c] = [f1, f2, f3].map((id) => store.get(id))
    // reading order: Three (highest) first, then One, then Two; two to a row of 900
    expect([c.x, c.y]).toEqual([9000, -2000]) // the first stays where it is
    expect(a.y).toBe(c.y)
    expect(a.x).toBe(c.x + 400 + 80)
    expect(b.x).toBe(c.x)
    expect(b.y).toBeGreaterThan(c.y + 300)
    expect(store.get(n1).x - a.x).toBe(before) // its note came along
    expect(store.get(f1 + '-title').x).toBe(a.x)
    expect(undoDiff(store, diff).skipped).toEqual([])
    expect(store.get(f2).x).toBe(5000)
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
      { do: 'shape', shape: 'diamond', text: 'Wall', w: 120, h: 1400, at: { x: 300, y: -60 } }, // too tall to bend round
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


describe('bento grids', () => {
  const grid = () => { const s = board(); bindLayouts(s); return s }

  it('makes a grid and cells, and reads them back', () => {
    const store = grid()
    const { result: [g, main, side] } = applySteps(store, 'Claude', [
      { do: 'layout', cols: 4, at: { x: 0, y: 0 }, ref: 'g' },
      { do: 'frame', title: 'Main', in: '@g', span: '2x2' },
      { do: 'frame', title: 'Side', in: '@g' },
    ])
    expect(store.get(main)).toMatchObject({ layoutId: g, span: { c: 2, r: 2 }, agent: { name: 'Claude' } })
    const d = describeBoard(store)
    expect(d.layouts).toMatchObject([{ id: g, cols: 4, cells: [main, side] }])
    expect(d.frames.find((f) => f.id === main).cell).toMatchObject({ layout: g, c: 2, r: 2 })
    expect(d.items.some((it) => it.id === g)).toBe(false) // the area is not a shape among the others
    const md = boardToMarkdown(store)
    expect(md).toMatch(/## Bento grid \(4 columns; id /)
    expect(md).toMatch(/## Main \(bento cell 2×2 in /)
  })

  it('a full cell grows a row instead of refusing, and the cells after it move along', () => {
    const store = grid()
    const { result: [g, a, b] } = applySteps(store, 'Claude', [
      { do: 'layout', cols: 2, w: 600, at: { x: 0, y: 0 }, ref: 'g' },
      { do: 'frame', title: 'A', in: '@g', span: '2x1' },
      { do: 'frame', title: 'B', in: '@g', span: '2x1' },
    ])
    const bBefore = store.get(b).y
    const { result: notes } = applySteps(store, 'Claude', Array.from({ length: 6 }, (_, i) => ({ do: 'note', text: `n${i}`, in: a })))
    expect(store.get(a).span.r).toBeGreaterThan(1)
    expect(store.get(b).y).toBeGreaterThan(bBefore)
    for (const id of notes) expect(store.get(id).frameId).toBe(a)
    const cell = pageBounds(store.get(a))
    for (const id of notes) { const n = pageBounds(store.get(id)); expect(n.y + n.h).toBeLessThanOrEqual(cell.y + cell.h) }
    expect(lintBoard(store)).toEqual([]) // the area under the cells is not an overlap
    expect(g).toBeTruthy()
  })

  it('span and columns change the grid; a cell cannot be sized like a shape', () => {
    const store = grid()
    const { result: [g, a, b] } = applySteps(store, 'Claude', [
      { do: 'layout', cols: 4, at: { x: 0, y: 0 }, ref: 'g' },
      { do: 'frame', title: 'A', in: '@g' },
      { do: 'frame', title: 'B', in: '@g' },
    ])
    applySteps(store, 'Claude', [{ do: 'span', id: a, span: '4x1' }])
    expect(store.get(b).y).toBeGreaterThan(store.get(a).y) // pushed to the next row
    applySteps(store, 'Claude', [{ do: 'columns', id: g, cols: 2 }])
    expect(store.get(g).layout.cols).toBe(2)
    expect(store.get(a).span.c).toBe(4) // kept, packed as 2 wide
    expect(() => applySteps(store, 'Claude', [{ do: 'update', id: a, w: 900 }])).toThrow(/span/)
    expect(() => applySteps(store, 'Claude', [{ do: 'frame', title: 'X', span: '2x1' }])).toThrow(/bento grid/)
  })

  it('tidy moves a grid as one, its cells with it', () => {
    const store = grid()
    const { result: [g, a] } = applySteps(store, 'Claude', [
      { do: 'layout', cols: 4, at: { x: 5000, y: 5000 }, ref: 'g' },
      { do: 'frame', title: 'A', in: '@g' },
    ])
    applySteps(store, 'Claude', [{ do: 'note', text: 'in A', in: a }])
    const before = store.get(a)
    applySteps(store, 'Claude', [{ do: 'tidy', at: { x: 0, y: 0 } }])
    const dx = store.get(g).x - 5000
    expect(dx).not.toBe(0)
    expect(store.get(a).x - before.x).toBe(dx)
    expect(store.get(a).layoutId).toBe(g)
  })
})

describe('styles and arrow labels', () => {
  it('sets how big the words are, line style, fill and bend, and checks them', () => {
    const store = board()
    const [h, n, s, a] = applySteps(store, 'Claude', [
      { do: 'text', text: 'Heading', text_size: 'xl', ref: 'h' },
      { do: 'note', text: 'Note', text_size: 's' },
      { do: 'shape', shape: 'rectangle', text: 'Box', text_size: 'l', dash: 'dashed', fill: 'solid', ref: 's' },
      { do: 'arrow', from: '@h', to: '@s', bend: 30, dash: 'dotted' },
    ]).result
    expect(store.get(h).props.size).toBe('xl')
    expect(pageBounds(store.get(h)).h).toBeGreaterThan(50) // 48px words: a taller box than a medium line
    expect(store.get(n).props.size).toBe('s')
    expect(store.get(s).props).toMatchObject({ labelSize: 'l', dash: 'dashed', fill: 'solid' })
    expect(store.get(a).props).toMatchObject({ bend: 30, dash: 'dotted' })
    expect(() => applySteps(store, 'Claude', [{ do: 'text', text: 'x', text_size: 'huge' }])).toThrow(/text size "huge"/)
    expect(() => applySteps(store, 'Claude', [{ do: 'shape', shape: 'rectangle', fill: 'red' }])).toThrow(/fill "red"/)
    applySteps(store, 'Claude', [{ do: 'update', id: s, text_size: 's', dash: 'solid', fill: 'none' }, { do: 'update', id: a, bend: 0 }])
    expect(store.get(s).props).toMatchObject({ labelSize: 's', dash: 'solid', fill: 'none' })
    expect(store.get(a).props.bend).toBe(0)
    expect(() => applySteps(store, 'Claude', [{ do: 'update', id: n, fill: 'solid' }])).toThrow(/has no fill/)
    expect(() => applySteps(store, 'Claude', [{ do: 'update', id: n, bend: 10 }])).toThrow(/not an arrow/)
  })

  it('puts a label by an arrow, above it, and keeps it there when the arrow moves', () => {
    const store = board()
    const [p, q, a] = applySteps(store, 'Claude', [
      { do: 'shape', shape: 'rectangle', text: 'A', at: { x: 0, y: 0 }, ref: 'p' },
      { do: 'shape', shape: 'rectangle', text: 'B', at: { x: 500, y: 0 }, ref: 'q' },
      { do: 'arrow', from: '@p', to: '@q', label: 'causes' },
    ]).result
    const label = () => store.shapes().find((l) => l.labelOf === a)
    const by = () => { const l = pageBounds(label()), ar = store.get(a); return { l, mid: { x: ar.x + ar.props.dx / 2, y: ar.y + ar.props.dy / 2 } } }
    let { l, mid } = by()
    expect(label().props).toMatchObject({ text: 'causes', size: 's' })
    expect(l.y + l.h).toBeLessThanOrEqual(mid.y) // above the line…
    expect(Math.abs(l.x + l.w / 2 - mid.x)).toBeLessThan(2) // …by its middle
    // the shapes move: the arrow, and its label with it
    runOp(store, 'Claude', (ops) => ops.move(q, { y: 600 }))
    ;({ l, mid } = by())
    expect(Math.hypot(l.x + l.w / 2 - mid.x, l.y + l.h / 2 - mid.y)).toBeLessThan(l.w) // still by its middle
    // read shows it with the connection, not as a loose text
    const d = describeBoard(store)
    expect(d.arrows[0]).toMatchObject({ from: p, to: q, label: 'causes' })
    expect(d.items.some((i) => i.text === 'causes')).toBe(false)
    expect(boardToMarkdown(store)).toMatch(/A → B \("causes", arrow /)
    // the arrow across its own label is no problem
    expect(lintBoard(store).filter((i) => i.kind === 'arrow-crosses')).toEqual([])
    // changed, then taken off; deleting an arrow takes its label
    applySteps(store, 'Claude', [{ do: 'update', id: a, label: 'leads to' }])
    expect(label().props.text).toBe('leads to')
    applySteps(store, 'Claude', [{ do: 'update', id: a, label: '' }])
    expect(label()).toBeUndefined()
    applySteps(store, 'Claude', [{ do: 'update', id: a, label: 'again' }])
    runOp(store, 'Claude', (ops) => ops.delete([a]))
    expect(label()).toBeUndefined()
  })

  it('puts a bent arrow\'s label on the side it bows to, and a vertical one\'s to its right', () => {
    const store = board()
    const [, , down, , , side] = applySteps(store, 'Claude', [
      { do: 'shape', shape: 'rectangle', text: 'A', at: { x: 0, y: 0 }, ref: 'p' },
      { do: 'shape', shape: 'rectangle', text: 'B', at: { x: 0, y: 500 }, ref: 'q' },
      { do: 'arrow', from: '@p', to: '@q', label: 'then' },
      { do: 'shape', shape: 'rectangle', text: 'C', at: { x: 800, y: 0 }, ref: 'r' },
      { do: 'shape', shape: 'rectangle', text: 'D', at: { x: 1400, y: 0 }, ref: 's' },
      { do: 'arrow', from: '@r', to: '@s', label: 'bows', bend: 60 },
    ]).result
    const lab = (id) => pageBounds(store.shapes().find((l) => l.labelOf === id))
    const d = store.get(down)
    expect(lab(down).x).toBeGreaterThanOrEqual(d.x) // right of a line going down
    const s = store.get(side)
    expect(lab(side).y).toBeGreaterThan(s.y + 60) // a rightward arrow bent +60 bows down: its label below the curve
  })
})

describe('a frame made and moved in one operation', () => {
  it('brings what it was put around, what was put in it and its title, when arranged, moved or tidied', () => {
    const store = board()
    const notes = ['a', 'b', 'c', 'd'].map((t, i) => human(`shape:${t}`, t, i * 260, 0))
    for (const n of notes) store.put(n)
    const [, g1, , g2] = applySteps(store, 'Claude', [
      { do: 'arrange', ids: ['shape:a', 'shape:b'], layout: 'row' },
      { do: 'frame', title: 'One', around: ['shape:a', 'shape:b'], ref: 'g1' },
      { do: 'arrange', ids: ['shape:c', 'shape:d'], layout: 'row' },
      { do: 'frame', title: 'Two', around: ['shape:c', 'shape:d'], ref: 'g2' },
      { do: 'text', text: 'inside', at: { x: 560, y: 80 }, ref: 'n' }, // lies in it, not yet a member
      { do: 'arrange', ids: ['@g1', '@g2'], layout: 'column', gap: 80 },
      { do: 'move', id: '@g2', dx: 500 },
    ]).result
    const inside = (id, f) => { const b = pageBounds(store.get(id)), fb = pageBounds(store.get(f)); return b.x >= fb.x && b.y >= fb.y && b.x + b.w <= fb.x + fb.w && b.y + b.h <= fb.y + fb.h }
    for (const id of ['shape:a', 'shape:b']) expect(inside(id, g1)).toBe(true)
    for (const id of ['shape:c', 'shape:d']) expect(inside(id, g2)).toBe(true)
    const label = store.shapes().find((s) => s.type === 'text' && s.props.text === 'inside')
    expect(inside(label.id, g2)).toBe(true) // and what lay in it
    expect(lintBoard(store).filter((i) => ['outside-frame', 'straddles-frame'].includes(i.kind))).toEqual([])
    // tidied in the same operation as well
    const [f] = applySteps(store, 'Claude', [
      { do: 'note', text: 'e', at: { x: 3000, y: 0 }, ref: 'e' },
      { do: 'frame', title: 'Three', around: ['@e'], ref: 'f' },
      { do: 'tidy', ids: ['@f'], at: { x: 0, y: 2000 } },
    ]).result.slice(1)
    expect(store.get(f).y).toBeGreaterThan(1900)
    expect(lintBoard(store).filter((i) => ['outside-frame', 'straddles-frame'].includes(i.kind))).toEqual([])
  })
})

describe('labels at the sides of a diamond or an ellipse', () => {
  it('finds a label wider than a diamond where it sits, and --fix makes the diamond bigger', () => {
    const store = board()
    const [wide, ok] = applySteps(store, 'Claude', [
      { do: 'shape', shape: 'diamond', text: 'Onboarding or billing first?', w: 240, h: 160, at: { x: 0, y: 0 } },
      { do: 'shape', shape: 'diamond', text: 'Paid?', w: 180, h: 100, at: { x: 600, y: 0 } },
    ]).result
    const issues = lintBoard(store)
    expect(issues).toMatchObject([{ kind: 'text-overflow', ids: [wide] }])
    expect(issues[0].text).toMatch(/spills out at the sides.*update_shape w, h/)
    expect(lintBoard(store, { words: 'cli' })[0].text).toMatch(new RegExp(`omq update ${wide} --size WxH`))
    const r = fixLayout(store, 'Claude')
    expect(r.fixed.join()).toMatch(/bigger for its label/)
    expect(store.get(wide).props.w).toBeGreaterThan(240)
    expect(store.get(ok).props.w).toBe(180)
    expect(lintBoard(store)).toEqual([])
  })
})

describe('checked as written', () => {
  it('fixes what needs no judgement in the same operation and says the rest; leaves a Venn alone', () => {
    const store = board()
    const one = applySteps(store, 'Claude', [{ do: 'note', text: 'one', at: { x: 0, y: 0 } }])
    const two = checkWritten(store, 'Claude', applySteps(store, 'Claude', [{ do: 'note', text: 'two', at: { x: 20, y: 20 } }]))
    expect(two.check.fixed.join()).toMatch(/moved note "two"/)
    expect(Object.keys(two.diff.added)).toHaveLength(1) // the note, where it ended up: one diff, one undo
    expect(lintBoard(store)).toEqual([])
    undoDiff(store, two.diff)
    expect(store.shapes().map((s) => s.props.text)).toEqual(['one'])
    const venn = checkWritten(store, 'Claude', applySteps(store, 'Claude', [
      { do: 'shape', shape: 'ellipse', w: 320, h: 320, at: { x: 1000, y: 0 } },
      { do: 'shape', shape: 'ellipse', w: 320, h: 320, at: { x: 1200, y: 0 } },
    ]))
    expect(venn.check).toBeUndefined() // nothing said, nothing moved
    expect(store.get(venn.result[1]).x).toBe(1200)
    expect(one.op).toBeTruthy()
  })
})

describe('said as written, with what to do', () => {
  it("leaves a label's fit and an arrow's way to the agent, saying how much to cut or what bend clears it", () => {
    const store = board()
    const r1 = checkWritten(store, 'C', applySteps(store, 'C', [{ do: 'shape', shape: 'rectangle', text: 'A label far too long for this small box to hold', w: 160, h: 40, at: { x: 0, y: 0 } }]))
    expect(store.get(r1.result[0]).props.h).toBe(40) // not grown: shortening may read better
    expect(r1.check.problems.join()).toMatch(/does not fit — \d+ lines at this width, room for 1: shorten it by about \d+ characters, or make it 160 × \d+/)
    const r2 = checkWritten(store, 'C', applySteps(store, 'C', [
      { do: 'shape', shape: 'rectangle', text: 'A', w: 120, h: 80, at: { x: 0, y: 600 }, ref: 'a' },
      { do: 'shape', shape: 'rectangle', text: 'Wall', w: 120, h: 80, at: { x: 300, y: 600 } },
      { do: 'shape', shape: 'rectangle', text: 'C', w: 120, h: 80, at: { x: 600, y: 600 }, ref: 'c' },
      { do: 'arrow', from: '@a', to: '@c' },
    ]))
    expect(store.get(r2.result[3]).props.bend).toBe(0) // not bent
    expect(r2.check.problems.join()).toMatch(/bend -?\d+ takes it round/)
    expect(fixLayout(store, 'C', {}).fixed.join()).toMatch(/bent arrow/) // lint --fix still does both, when asked
  })

  it('says in words what a picture used to show: colours, sentences, a written-out \\n', () => {
    const store = board()
    const colours = ['red', 'green', 'blue', 'orange', 'violet'].map((color, i) => ({ do: 'shape', shape: 'rectangle', text: color, color, at: { x: i * 220, y: 0 } }))
    const r = checkWritten(store, 'C', applySteps(store, 'C', [
      ...colours,
      { do: 'text', text: 'Step 3\\nKey later', at: { x: 0, y: 300 } },
      { do: 'shape', shape: 'rectangle', text: 'This label is a whole sentence that goes on and on where a few words would do', w: 600, h: 200, at: { x: 0, y: 500 } },
    ]))
    const said = r.check.problems.join('\n')
    expect(said).toMatch(/5 colours/)
    expect(said).toMatch(/shows "\\n" as two characters/)
    expect(said).toMatch(/\d+ words — a sentence/)
  })
})

describe('an arrow label between shapes close together', () => {
  it('wraps to the length of the line, so it does not lie on the shapes at its ends', () => {
    const store = board()
    const r = checkWritten(store, 'C', applySteps(store, 'C', [
      { do: 'shape', shape: 'rectangle', text: 'Relay', w: 160, h: 90, at: { x: 0, y: 0 }, ref: 'a' },
      { do: 'shape', shape: 'rectangle', text: 'SQLite', w: 160, h: 90, at: { x: 260, y: 0 }, ref: 'b' },
      { do: 'arrow', from: '@a', to: '@b', label: 'persist, compact every 500 updates' },
    ]))
    const label = store.shapes().find((l) => l.labelOf === r.result[2])
    expect(label.props).toMatchObject({ autosize: false, text: 'persist, compact every 500 updates' }) // words as they are
    expect(r.check?.problems ?? []).toEqual([]) // not on the boxes
    const close = checkWritten(store, 'C', applySteps(store, 'C', [
      { do: 'shape', shape: 'rectangle', text: 'P', w: 160, h: 90, at: { x: 0, y: 400 }, ref: 'p' },
      { do: 'shape', shape: 'rectangle', text: 'Q', w: 160, h: 90, at: { x: 200, y: 400 }, ref: 'q' },
      { do: 'arrow', from: '@p', to: '@q', label: 'dispatches requests' },
    ]))
    const narrow = store.shapes().find((l) => l.labelOf === close.result[2])
    expect(narrow.props.w).toBeGreaterThanOrEqual(estimateWidth('20px sans-serif', 'dispatches')) // a word is not broken in two
    runOp(store, 'C', (ops) => ops.move(r.result[1], { x: 900 })) // room again: one line
    expect(store.shapes().find((l) => l.labelOf === r.result[2]).props.autosize).toBe(true)
  })
})

describe('as written: a little room for a cramped label; arrows may pass labels', () => {
  it('gives a label that only just fits room without saying so, and does not count an arrow across another arrow\'s label', () => {
    const store = board()
    const r = checkWritten(store, 'C', applySteps(store, 'C', [{ do: 'shape', shape: 'rectangle', text: 'One line', w: 160, h: 30, at: { x: 0, y: 0 } }]))
    expect(store.get(r.result[0]).props.h).toBeGreaterThan(30)
    expect(r.check.fixed.join()).toMatch(/taller for its label/)
    expect(r.check.problems).toBeUndefined()
    const s = checkWritten(store, 'C', applySteps(store, 'C', [
      { do: 'shape', shape: 'rectangle', text: 'A', w: 120, h: 80, at: { x: 0, y: 400 }, ref: 'a' },
      { do: 'shape', shape: 'rectangle', text: 'B', w: 120, h: 80, at: { x: 600, y: 400 }, ref: 'b' },
      { do: 'shape', shape: 'rectangle', text: 'C', w: 120, h: 80, at: { x: 300, y: 200 }, ref: 'c' },
      { do: 'shape', shape: 'rectangle', text: 'D', w: 120, h: 80, at: { x: 300, y: 650 }, ref: 'd' },
      { do: 'arrow', from: '@a', to: '@b', label: 'crossing here' },
      { do: 'arrow', from: '@c', to: '@d' },
    ]))
    expect((s.check?.problems ?? []).join()).not.toMatch(/runs across text/)
  })
})

describe('as written, the drawing keeps its layout', () => {
  it('does not shrink a frame\'s contents to fit, nor lay it out afresh; it says so', () => {
    const store = board()
    const [f] = applySteps(store, 'C', [{ do: 'frame', title: 'Keep', w: 600, h: 300, at: { x: 0, y: 0 } }]).result
    const r = checkWritten(store, 'C', applySteps(store, 'C', [
      { do: 'shape', shape: 'rectangle', text: 'One', w: 180, h: 100, at: { x: 40, y: 60 } },
      { do: 'shape', shape: 'rectangle', text: 'Two', w: 180, h: 100, at: { x: 500, y: 60 } }, // over the frame's right edge
    ]))
    expect(store.get(r.result[0]).props.w).toBe(180)
    expect(store.get(r.result[1]).props.w).toBe(180) // not shrunk
    expect(r.check.problems.join()).toMatch(/sticks out of|lies across|right against/)
    expect(f).toBeTruthy()
  })
})

describe('there and back', () => {
  it('puts the labels of two arrows between the same shapes on either side', () => {
    const store = board()
    const r = checkWritten(store, 'C', applySteps(store, 'C', [
      { do: 'shape', shape: 'rectangle', text: 'Page', w: 160, h: 90, at: { x: 0, y: 0 }, ref: 'a' },
      { do: 'shape', shape: 'rectangle', text: 'Relay', w: 160, h: 90, at: { x: 500, y: 0 }, ref: 'b' },
      { do: 'arrow', from: '@a', to: '@b', label: 'Yjs updates' },
      { do: 'arrow', from: '@b', to: '@a', label: 'broadcast' },
    ]))
    expect(r.check?.problems ?? []).toEqual([])
    const ys = [r.result[2], r.result[3]].map((id) => pageBounds(store.shapes().find((l) => l.labelOf === id)).y)
    expect(Math.abs(ys[0] - ys[1])).toBeGreaterThan(20)
  })
})

describe('placed by what it is joined to, and by the frame it goes in', () => {
  it('puts a shape next to another, joined by an arrow, further along when the spot is taken; nothing else moves', () => {
    const store = board()
    const [b] = applySteps(store, 'C', [{ do: 'shape', shape: 'rectangle', text: 'B', w: 160, h: 80, at: { x: 0, y: 0 } }]).result
    const [blocker] = applySteps(store, 'C', [{ do: 'note', text: 'in the way', at: { x: 240, y: -60 } }]).result
    const before = store.get(blocker)
    const r = checkWritten(store, 'C', applySteps(store, 'C', [
      { do: 'shape', shape: 'rectangle', text: 'A', w: 160, h: 80, from: b, side: 'right', label: 'calls', ref: 'a' },
      { do: 'shape', shape: 'rectangle', text: 'C', w: 160, h: 80, from: b, side: 'below' },
    ]))
    const [a, c] = r.result
    const ab = pageBounds(store.get(a)), bb = pageBounds(store.get(b)), cb = pageBounds(store.get(c))
    expect(ab.x).toBeGreaterThan(bb.x + bb.w) // to its right, clear of the note in the way and of the arrow's way to it
    const nb = pageBounds(before)
    expect(ab.x >= nb.x + nb.w || ab.y >= nb.y + nb.h || ab.y + ab.h <= nb.y || ab.x + ab.w <= nb.x).toBe(true)
    expect(cb.y).toBeGreaterThan(bb.y + bb.h)
    expect(store.get(blocker)).toEqual(before) // nothing else moved
    expect(describeBoard(store).arrows).toEqual(expect.arrayContaining([expect.objectContaining({ from: b, to: a, label: 'calls' }), expect.objectContaining({ from: b, to: c })]))
    expect(r.check?.problems ?? []).toEqual([])
  })

  it('lines up what is put in a frame that arranges, frames in frames too, and the frame grows to hold it', () => {
    const store = board()
    const [col] = applySteps(store, 'C', [{ do: 'frame', title: 'Actions', arrange: 'column', w: 300, h: 100, at: { x: 0, y: 0 } }]).result
    const ids = applySteps(store, 'C', ['Ren', 'Sora', 'Taku'].map((t) => ({ do: 'shape', shape: 'rectangle', text: t, w: 200, h: 60, in: col }))).result
    const ys = ids.map((id) => store.get(id).y)
    expect(ys[1]).toBeGreaterThan(ys[0] + 60)
    expect(ys[2]).toBeGreaterThan(ys[1] + 60)
    expect(new Set(ids.map((id) => store.get(id).x)).size).toBe(1) // one column
    const fb = pageBounds(store.get(col))
    expect(fb.y + fb.h).toBeGreaterThanOrEqual(ys[2] + 60) // grown to hold them
    // a row of frames, each lining up its own
    const [row] = applySteps(store, 'C', [{ do: 'frame', title: 'Board', arrange: 'row', w: 200, h: 100, at: { x: 0, y: 600 } }]).result
    const [p, q] = applySteps(store, 'C', [{ do: 'frame', title: 'Decided', arrange: 'column', w: 220, h: 80, in: row }, { do: 'frame', title: 'Open', arrange: 'column', w: 220, h: 80, in: row }]).result
    expect(store.get(q).x).toBeGreaterThan(store.get(p).x + 220)
    expect(store.get(p).frameId).toBe(row)
    applySteps(store, 'C', [{ do: 'note', text: 'Ship v2', in: p }, { do: 'note', text: 'Drop old API', in: p }])
    expect(lintBoard(store).map((i) => i.text)).toEqual([])
    expect(boardToMarkdown(store)).toMatch(/lines up what is put in it: column/)
  })

  it('as written, moves only what was just written', () => {
    const store = board()
    const [old] = applySteps(store, 'C', [{ do: 'note', text: 'old', at: { x: 100, y: 0 } }]).result
    const before = store.get(old)
    const r = checkWritten(store, 'C', applySteps(store, 'C', [{ do: 'note', text: 'new', at: { x: 0, y: 0 } }])) // earlier in reading order than old
    expect(store.get(old)).toEqual(before) // the old one stays
    expect(r.check.fixed.join()).toMatch(/moved note "new"/)
  })
})
