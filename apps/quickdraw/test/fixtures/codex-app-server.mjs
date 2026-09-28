// A stand-in for `codex app-server` (stdio JSON-RPC): for each turn it says
// something, calls the board tools it was given, asks to run a command, and
// answers — or, for a follow-up, just answers.
import { createInterface } from 'node:readline'

const out = (m) => process.stdout.write(JSON.stringify(m) + '\n')
let nextId = 1000
const waiting = new Map()
const ask = (method, params) => new Promise((ok) => { const id = nextId++; waiting.set(id, ok); out({ id, method, params }) })
let tools = []
let threads = 0, turns = 0

createInterface({ input: process.stdin }).on('line', async (line) => {
  const m = JSON.parse(line)
  if (m.id != null && !m.method) { waiting.get(m.id)?.(m.result ?? m.error); waiting.delete(m.id); return }
  if (m.method === 'initialize') return out({ id: m.id, result: { userAgent: 'mock' } })
  if (m.method === 'model/list') return out({ id: m.id, result: { data: [
    { id: 'fast', displayName: 'Fast', hidden: false, isDefault: true, defaultReasoningEffort: 'low', supportedReasoningEfforts: [{ reasoningEffort: 'low' }, { reasoningEffort: 'medium' }] },
    { id: 'deep', displayName: 'Deep', hidden: false, isDefault: false, defaultReasoningEffort: 'high', supportedReasoningEfforts: [{ reasoningEffort: 'medium' }, { reasoningEffort: 'high' }] },
    { id: 'secret', displayName: 'Secret', hidden: true, isDefault: false, defaultReasoningEffort: 'low', supportedReasoningEfforts: [] },
  ], nextCursor: null } })
  if (m.method === 'config/read') return out({ id: m.id, result: { config: {} } })
  if (m.method === 'thread/start') {
    tools = m.params.dynamicTools.map((t) => t.name)
    process.stderr.write(`cwd=${m.params.cwd} tools=${tools.length} instructions=${m.params.developerInstructions.length}\n`)
    return out({ id: m.id, result: { thread: { id: `thread-${++threads}` }, model: m.params.model ?? 'fast', reasoningEffort: null } })
  }
  if (m.method === 'turn/start') {
    const threadId = m.params.threadId, turnId = `turn-${++turns}`, text = m.params.input[0].text
    process.stderr.write(`effort=${m.params.effort}\n`)
    out({ id: m.id, result: { turn: { id: turnId } } })
    out({ method: 'turn/started', params: { threadId, turn: { id: turnId, status: 'inProgress' } } })
    if (turns === 1) {
      out({ method: 'item/completed', params: { threadId, turnId, item: { type: 'agentMessage', phase: 'commentary', text: 'Looking at the board.' } } })
      const board = await ask('item/tool/call', { threadId, turnId, callId: 'c1', tool: 'read_board', arguments: {} })
      const note = await ask('item/tool/call', { threadId, turnId, callId: 'c2', tool: 'add_note', arguments: { text: 'From Codex' } })
      const bad = await ask('item/tool/call', { threadId, turnId, callId: 'c3', tool: 'add_note', arguments: { text: 'x', in: 'shape:nope' } })
      out({ method: 'item/started', params: { threadId, turnId, item: { type: 'commandExecution', command: 'ls' } } })
      const run = await ask('item/commandExecution/requestApproval', { threadId, turnId, itemId: 'i1', command: 'ls', reason: 'to see the files' })
      process.stderr.write(`board=${JSON.stringify(board.contentItems[0].text.slice(0, 20))} note=${note.success} bad=${bad.success} run=${run.decision}\n`)
      out({ method: 'item/completed', params: { threadId, turnId, item: { type: 'agentMessage', phase: 'final_answer', text: `Added a note (${text.split('\n')[0]}).` } } })
    } else {
      out({ method: 'item/completed', params: { threadId, turnId, item: { type: 'agentMessage', phase: 'final_answer', text: `You said: ${text}` } } })
    }
    out({ method: 'turn/completed', params: { threadId, turn: { id: turnId, status: 'completed', error: null } } })
  }
})
