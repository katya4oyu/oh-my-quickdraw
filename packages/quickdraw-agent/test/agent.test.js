import { describe, it, expect, afterEach } from 'vitest'
import { mkdtempSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import * as Y from 'yjs'
import { Store } from '@quickdrawjs/core'
import { bindYjs } from 'quickdraw-yjs'
import { bindFrames } from 'quickdraw-frames'
import { registerMarkdown } from 'quickdraw-markdown'
import { openBoard, describeBoard, boardToMarkdown, runOp, applySteps, undoDiff } from '../src/index.js'
import { main } from '../src/cli.js'
import { createExampleServer } from '../../../examples/quickdraw-yjs/server.mjs'

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

describe('the CLI on a file board', () => {
  it('writes, reads, logs and undoes', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'qd-agent-'))
    const file = join(dir, 'board.json')
    process.env.QUICKDRAW_AGENT_LOG = join(dir, 'log.jsonl')
    const run = async (...args) => { let s = ''; await main([...args, '--file', file, '--name', 'Claude'], (o) => { s += o }); return s }
    const { ids: [id] } = JSON.parse(await run('note', 'hello'))
    expect(JSON.parse(readFileSync(file, 'utf8')).shapes[0]).toMatchObject({ id, props: { text: 'hello' } })
    expect(await run('read')).toMatch(/hello/)
    expect(JSON.parse(await run('log'))).toHaveLength(1)
    expect(JSON.parse(await run('undo'))).toMatchObject({ reverted: 1 })
    expect(JSON.parse(readFileSync(file, 'utf8')).shapes).toHaveLength(0)
  })
})

describe('a live board', () => {
  let app
  afterEach(() => app?.close())

  it('joins through the relay: peers see the change and the cursor', async () => {
    app = createExampleServer()
    const { port } = await app.listen(0)
    const url = `ws://127.0.0.1:${port}/ws`

    // a browser-like peer, bound the same way the demo is
    const doc = new Y.Doc(), peer = new Store()
    const ws = new WebSocket(url)
    ws.binaryType = 'arraybuffer'
    const presence = []
    await new Promise((ok) => (ws.onopen = ok))
    ws.onmessage = ({ data }) => {
      const m = new Uint8Array(data)
      if (m[0] === 0) Y.applyUpdate(doc, m.subarray(1), 'relay')
      if (m[0] === 2) presence.push(JSON.parse(new TextDecoder().decode(m.subarray(1))))
    }
    bindYjs(peer, doc)

    const agent = await openBoard({ url, name: 'Claude' })
    const { result: id } = runOp(agent.store, 'Claude', (ops) => ops.note('from the agent'))
    agent.cursor(10, 20)
    await new Promise((r) => setTimeout(r, 200))
    await agent.close()
    ws.close()

    expect(peer.get(id)?.props.text).toBe('from the agent')
    expect(presence.find((p) => p.name === 'Claude')).toMatchObject({ x: 10, y: 20 })

    // and a second agent session sees what the first wrote (the server kept it)
    const again = await openBoard({ url })
    expect(again.store.get(id)?.agent.name).toBe('Claude')
    await again.close()
  })
})
