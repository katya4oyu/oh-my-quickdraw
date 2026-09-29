import { describe, it, expect } from 'vitest'
import { Store } from '@quickdrawjs/core'
import { authorsOf, bindAuthorship } from '../src/authorship.js'

const note = (id, text, x = 0) => ({ id, typeName: 'shape', type: 'note', x, y: 0, rot: 0, z: 1, props: { text } })

describe('who made what, and who changed it last', () => {
  it('marks what this page\'s person adds and changes, in the same undo step', () => {
    const store = new Store()
    let t = 1000
    let who = 'Ann'
    bindAuthorship(store, { me: () => ({ name: who }), now: () => t })
    store.put(note('shape:a', 'hi'))
    expect(store.get('shape:a').made).toEqual({ by: 'Ann', at: 1000 })
    expect(store.undos).toHaveLength(1) // the add and its mark: one step

    who = 'Bob'; t = 5000
    store.update('shape:a', { x: 50 })
    expect(store.get('shape:a')).toMatchObject({ made: { by: 'Ann' }, edited: { by: 'Bob', at: 5000 } })
    expect(authorsOf(store.get('shape:a'))).toEqual({ made_by: 'Ann', edited_by: 'Bob' })
    expect(store.undos).toHaveLength(2)
    store.undo() // back as it was, marks included; undoing is not an edit
    expect(store.get('shape:a').x).toBe(0)
    expect(store.get('shape:a').edited).toBeUndefined()
  })

  it('leaves what comes from others alone, and marks a drag once a second', () => {
    const store = new Store()
    let t = 0
    bindAuthorship(store, { me: () => ({ name: 'Ann' }), now: () => t })
    store.put(note('shape:r', 'theirs'), 'remote')
    expect(store.get('shape:r').made).toBeUndefined() // marked where it was made
    store.put(note('shape:d', 'drag'))
    let marks = 0
    store.listen((d) => { for (const [, [a, b]] of Object.entries(d.updated)) if (a.edited !== b.edited) marks++ })
    store.beginBatch()
    for (let i = 1; i <= 10; i++) { t = i * 100; store.update('shape:d', { x: i }) } // one second of dragging
    store.endBatch()
    expect(marks).toBe(1)
    expect(authorsOf({ agent: { name: 'Codex' } })).toEqual({ made_by: 'Codex' })
  })
})
