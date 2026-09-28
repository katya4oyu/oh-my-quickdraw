import { describe, it, expect } from 'vitest'
import { Store } from '@quickdrawjs/core'
import { runOp } from '../src/ops.js'
import { undoAgentRequest, agentOptions, limitText, limitLevel, buildAgentRequest, detectAgentMention, updateAgentThread, hasAgentThreadForAnchor } from '../src/panel.js'

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

  it('runs a request on the chosen model and effort, falling back to what the agent and the model offer', () => {
    const agent = { id: 'codex', name: 'Codex', knows: [], status: 'idle', model: 'b', effort: 'high', models: [
      { id: 'a', name: 'A', efforts: ['low', 'medium'], effort: 'medium' },
      { id: 'b', name: 'B', efforts: ['low', 'medium', 'high'], effort: 'medium' },
    ] }
    expect(agentOptions(agent)).toEqual({ model: 'b', effort: 'high' }) // the agent's defaults
    expect(agentOptions(agent, { model: 'a' })).toEqual({ model: 'a', effort: 'medium' }) // that model's default
    expect(agentOptions(agent, { model: 'a', effort: 'high' })).toEqual({ model: 'a', effort: 'medium' }) // not offered there
    expect(agentOptions(agent, { model: 'gone', effort: 'low' })).toEqual({ model: 'b', effort: 'low' })
    expect(agentOptions({ ...agent, models: undefined })).toBeUndefined()
    expect(buildAgentRequest({ id: 'r', to: 'codex', text: 'x', editor, options: { model: 'a', effort: 'low' } }).options).toEqual({ model: 'a', effort: 'low' })
  })

  it('says how much of a usage limit is used, and when it starts again', () => {
    const now = Date.UTC(2026, 8, 28)
    expect(limitText({ name: 'Weekly', usedPercent: 9.4, resetsAt: now + 6 * 86400_000 }, now)).toBe('9% · resets in 6d')
    expect(limitText({ name: '5h', usedPercent: 50, resetsAt: now + 3 * 3600_000 }, now)).toBe('50% · resets in 3h')
    expect(limitText({ name: '5h', usedPercent: 50, resetsAt: now + 40 * 60_000 }, now)).toBe('50% · resets in 40m')
    expect(limitText({ name: '5h', usedPercent: 50, resetsAt: now - 1000 }, now)).toBe('50% · resets in 1m') // about to
    expect(limitText({ name: 'Weekly', usedPercent: 3 })).toBe('3%')
    expect([0, 79, 80, 100].map((usedPercent) => limitLevel({ name: 'x', usedPercent }))).toEqual(['', '', 'high', 'full'])
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
    const done = { ...thread, status: 'done' }
    expect(updateAgentThread(done, { type: 'reply', text: 'thanks' }).status).toBe('done')
    expect(updateAgentThread(done, { type: 'message', text: 'you are welcome' }).status).toBe('done')
    expect(updateAgentThread(done, { type: 'question', text: 'which one?' }).status).toBe('waiting')
  })

  it('pins a thread that is not about a shape to the first shape it adds', () => {
    let thread = { request: { id: 'r', anchor: { x: 1, y: 2 } }, events: [], diffs: [], status: 'working' }
    thread = updateAgentThread(thread, { type: 'op', op: 'op:1', diff: { records: [] }, ids: ['frame', 'note'] })
    thread = updateAgentThread(thread, { type: 'op', op: 'op:2', diff: { records: [] }, ids: ['other'] })
    expect(thread.request.anchor).toEqual({ x: 1, y: 2, shapeId: 'frame' })
    const about = updateAgentThread({ request: { id: 's', anchor: { shapeId: 'mine' } }, events: [], diffs: [] }, { type: 'op', op: 'op:3', diff: { records: [] }, ids: ['frame'] })
    expect(about.request.anchor.shapeId).toBe('mine')
  })

  it('takes an undo from another device', () => {
    let thread = { request: { id: 'r' }, events: [], diffs: [], status: 'working' }
    thread = updateAgentThread(thread, { type: 'op', op: 'op:1', diff: { records: [] } })
    thread = updateAgentThread(thread, { type: 'done' })
    thread = updateAgentThread(thread, { type: 'undo', reverted: 2, skipped: ['shape:x'] })
    expect(thread).toMatchObject({ diffs: [], undoResult: { reverted: 2, skipped: ['shape:x'] }, status: 'done' })
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
