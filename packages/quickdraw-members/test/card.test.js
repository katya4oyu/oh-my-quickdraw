import { describe, it, expect } from 'vitest'
import * as Y from 'yjs'
import { Store, pageBounds } from '@quickdrawjs/core'
import { bindMembers, bindMemberCards, createMemberCard, validateMemberCard, colorOf } from '../src/index.js'

describe('profile cards', () => {
  it('show what the table says of the agent, and follow it; removing one leaves the role', () => {
    const members = bindMembers(new Y.Doc())
    members.set('Codex · api', { role: 'reviewer', about: 'Reads the PRs' }, 'Ann')
    const store = new Store()
    const id = createMemberCard(store, { x: 0, y: 0, name: 'codex · api', members })
    expect(store.get(id).props).toMatchObject({ name: 'Codex · api', role: 'reviewer', about: 'Reads the PRs' })
    bindMemberCards(store, members)
    members.set('Codex · api', { role: 'researcher', about: '' }, 'Codex · api')
    expect(store.get(id).props).toMatchObject({ role: 'researcher', about: '' })
    // a card put without the table (pasted, imported) catches up
    store.put({ ...store.get(id), id: 'shape:copy', props: { ...store.get(id).props, role: 'old' } })
    expect(store.get('shape:copy').props.role).toBe('researcher')
    store.remove([id, 'shape:copy'])
    expect(members.get('Codex · api').role).toBe('researcher')
  })

  it('grows with its text, keeps a width, and has the same colour everywhere', () => {
    const store = new Store()
    const short = pageBounds(store.get(createMemberCard(store, { x: 0, y: 0, name: 'pi' })))
    const long = pageBounds(store.get(createMemberCard(store, { x: 0, y: 0, name: 'pi', members: { get: () => ({ name: 'pi', role: 'researcher', about: 'Looks things up on the web and writes what it found in a Markdown card, with the links' }) } })))
    expect(short.w).toBe(260)
    expect(long.h).toBeGreaterThan(short.h)
    expect(colorOf('Codex · api')).toBe(colorOf('Codex · api'))
    expect(validateMemberCard({ props: { name: 'pi', role: 'r', about: '', w: 260 } })).toBeNull()
    expect(validateMemberCard({ props: { name: '', w: 260 } })).toBe('bad props.name')
  })
})
