import { describe, it, expect } from 'vitest'
import { mentionQuery, matchAgents } from '../src/mention-picker.js'
import { detectAgentMention } from '../src/panel.js'

const agents = [
  { id: 'c', name: 'Claude · my-repo' },
  { id: 'x', name: 'Codex · api-server' },
  { id: 'p', name: 'pi · my-repo' },
]

describe('mention picker', () => {
  it('knows when an agent name is being written at the start of a note', () => {
    expect(mentionQuery('@')).toEqual({ query: '', start: 0, end: 1 })
    expect(mentionQuery('  @cod')).toEqual({ query: 'cod', start: 2, end: 6 })
    expect(mentionQuery('@co please check', 3)).toEqual({ query: 'co', start: 0, end: 3 }) // the caret mid-word: the whole word goes
    expect(mentionQuery('@cox please', 2)).toEqual({ query: 'c', start: 0, end: 4 })
    expect(mentionQuery('hi @cod')).toBeNull() // only at the start: a mention anywhere else asks no one
    expect(mentionQuery('@Codex\nmore')).toBeNull() // on the next line
  })

  it('lists the agents a query could mean, best first; none once a full name is written', () => {
    expect(matchAgents(agents, '').map((a) => a.id)).toEqual(['c', 'x', 'p'])
    expect(matchAgents(agents, 'co').map((a) => a.id)).toEqual(['x'])
    expect(matchAgents(agents, 'my').map((a) => a.id)).toEqual(['c', 'p']) // a word of the name
    expect(matchAgents(agents, 'repo').map((a) => a.id)).toEqual(['c', 'p']) // anywhere
    expect(matchAgents(agents, 'claude my').map((a) => a.id)).toEqual(['c']) // "·" need not be typed
    expect(matchAgents(agents, 'Codex · api-server check this')).toEqual([])
    expect(matchAgents(agents, 'zz')).toEqual([])
  })

  it('writes what makes a request: the full name, then the request', () => {
    const picked = '@' + agents[1].name + ' ' + 'check the API section'
    expect(detectAgentMention(picked, agents)).toEqual({ to: 'x', text: 'check the API section' })
  })
})
