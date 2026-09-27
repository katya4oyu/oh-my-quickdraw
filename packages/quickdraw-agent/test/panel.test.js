import { describe, it, expect } from 'vitest'
import { Store } from '@quickdrawjs/core'
import { runOp } from '../src/ops.js'
import { undoAgentRequest, buildAgentRequest, detectAgentMention, updateAgentThread, hasAgentThreadForAnchor } from '../src/panel.js'

const editor = { viewportPageBounds: () => ({ x: -10, y: 20, w: 800, h: 600 }) }

describe('agent panel request model', () => {
  it('builds the same request context from panel, selection and note anchors', () => {
    const selection = buildAgentRequest({ id: 's', to: 'board', text: 'Arrange these', editor, shapeIds: ['a', 'f1', 'f2'], frameIds: ['f1', 'f2'], anchor: { shapeId: 'a', x: 5, y: 6 } })
    const panel = buildAgentRequest({ id: 'p', to: 'board', text: 'Summarize', editor, anchor: {} })
    const note = buildAgentRequest({ id: 'n', to: 'board', text: 'Research', editor, anchor: { shapeId: 'note', x: 1, y: 2 } })
    expect(selection).toEqual({ id: 's', to: 'board', text: 'Arrange these', context: { shapeIds: ['a', 'f1', 'f2'], frameIds: ['f1', 'f2'], viewport: { x: -10, y: 20, w: 800, h: 600 } }, anchor: { shapeId: 'a', x: 5, y: 6 } })
    expect(panel.context).toMatchObject({ shapeIds: [], frameIds: [] })
    expect(note.anchor.shapeId).toBe('note')
  })

  it('recognizes only explicit @AI or known @agent-name mentions', () => {
    const agents = [{ id: 'board', name: 'Board AI' }, { id: 'codex', name: 'Codex · project' }]
    expect(detectAgentMention('@AI organize these', agents)).toEqual({ to: 'board', text: 'organize these' })
    expect(detectAgentMention('@Codex · project summarize', agents)).toEqual({ to: 'codex', text: 'summarize' })
    expect(detectAgentMention('AI organize these', agents)).toBeNull()
  })

  it('recognizes notes already anchored by live or restored threads', () => {
    const threads = [
      { request: { anchor: { shapeId: 'already-sent' } } },
      { request: { anchor: {} } },
    ]
    expect(hasAgentThreadForAnchor('already-sent', threads)).toBe(true)
    expect(hasAgentThreadForAnchor('new-note', threads)).toBe(false)
  })

  it('tracks event history, status transitions and operation diffs per thread', () => {
    let thread = { request: { id: 'r' }, events: [], diffs: [], status: 'working' }
    thread = updateAgentThread(thread, { type: 'progress', text: 'Reading board' })
    thread = updateAgentThread(thread, { type: 'op', op: 'add_note', diff: { records: [] } })
    thread = updateAgentThread(thread, { type: 'approval', id: 'approval-1' })
    expect(thread.events.map((event) => event.type)).toEqual(['progress', 'op', 'approval'])
    expect(thread.diffs).toHaveLength(1)
    expect(thread.status).toBe('waiting')
    expect(updateAgentThread(thread, { type: 'done' }).status).toBe('done')
    expect(updateAgentThread({ ...thread, status: 'done' }, { type: 'reply', text: 'thanks' }).status).toBe('done')
  })

  it('pins a thread that is not about a shape to the first shape it adds', () => {
    let thread = { request: { id: 'r', anchor: { x: 1, y: 2 } }, events: [], diffs: [], status: 'working' }
    thread = updateAgentThread(thread, { type: 'op', op: 'op:1', diff: { records: [] }, ids: ['frame', 'note'] })
    thread = updateAgentThread(thread, { type: 'op', op: 'op:2', diff: { records: [] }, ids: ['other'] })
    expect(thread.request.anchor).toEqual({ x: 1, y: 2, shapeId: 'frame' })
    const about = updateAgentThread({ request: { id: 's', anchor: { shapeId: 'mine' } }, events: [], diffs: [] }, { type: 'op', op: 'op:3', diff: { records: [] }, ids: ['frame'] })
    expect(about.request.anchor.shapeId).toBe('mine')
  })

  it('undoes newest operation first and reports only changed records as skipped', () => {
    const store = new Store()
    const first = runOp(store, 'Agent', (ops) => ops.note('first', { at: { x: 0, y: 0 } }))
    const second = runOp(store, 'Agent', (ops) => ops.note('second', { at: { x: 300, y: 0 } }))
    const secondId = second.result
    store.update(secondId, { props: { text: 'human edit' } })
    const result = undoAgentRequest(store, [first.diff, second.diff])
    expect(result.reverted).toBeGreaterThan(0)
    expect(result.skipped).toContain(secondId)
    expect(store.get(first.result)).toBeUndefined()
    expect(store.get(secondId).props.text).toBe('human edit')
  })
})
