import { describe, it, expect } from 'vitest'
import * as Y from 'yjs'
import { bindMembers } from '../src/index.js'

// two peers of one board, kept in sync as a relay would
function pair() {
  const a = new Y.Doc(), b = new Y.Doc()
  a.on('update', (u, origin) => { if (origin !== 'b') Y.applyUpdate(b, u, 'a') })
  b.on('update', (u, origin) => { if (origin !== 'a') Y.applyUpdate(a, u, 'b') })
  return [bindMembers(a), bindMembers(b)]
}

describe('members', () => {
  it('keeps each agent\'s role, set by people or agents, for everyone on the board', () => {
    const [ann, codex] = pair()
    let changes = 0
    codex.onChange(() => changes++)
    ann.set('Codex · api', { role: 'reviewer', about: 'Reads  the PRs\nand comments' }, 'Ann')
    expect(codex.get('codex · API')).toMatchObject({ name: 'Codex · api', role: 'reviewer', about: 'Reads the PRs and comments', by: 'Ann' })
    expect(changes).toBe(1)
    // an agent changes its own: what it does not give stays
    codex.set('Codex · api', { role: 'researcher' }, 'Codex · api')
    expect(ann.get('Codex · api')).toMatchObject({ role: 'researcher', about: 'Reads the PRs and comments', by: 'Codex · api' })
    ann.set('Claude · repo', { role: 'transcriber' }, 'Ann')
    expect(codex.list().map((m) => [m.name, m.role])).toEqual([['Claude · repo', 'transcriber'], ['Codex · api', 'researcher']])
  })

  it('takes an agent out when nothing is left to say, and keeps roles short', () => {
    const [ann] = pair()
    ann.set('pi', { role: 'x'.repeat(100) })
    expect(ann.get('pi').role).toHaveLength(60)
    ann.set('pi', { role: '', about: '' })
    expect(ann.get('pi')).toBeNull()
    expect(() => ann.set('  ', { role: 'r' })).toThrow(/needs a name/)
  })
})
