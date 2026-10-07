import { describe, it, expect } from 'vitest'
import * as Y from 'yjs'
import { Store } from '@quickdrawjs/core'
import { bindFrames, createFrame } from 'quickdraw-frames'
import { bindComments, commentsText, framesOf, threadSpot } from '../src/index.js'

// two peers of one board, kept in sync as a relay would
function pair() {
  const a = new Y.Doc(), b = new Y.Doc()
  a.on('update', (u, origin) => { if (origin !== 'b') Y.applyUpdate(b, u, 'a') })
  b.on('update', (u, origin) => { if (origin !== 'a') Y.applyUpdate(a, u, 'b') })
  return [bindComments(a), bindComments(b)]
}

describe('comments', () => {
  it('keeps a thread per frame, for everyone on the board', () => {
    const [codex, ann] = pair()
    let changes = 0
    ann.onChange(() => changes++)
    const q = codex.add('frame:a', 'Put "test env" in, as a fourth cause?  \n It would not fit the boxes.', 'Codex')
    expect(ann.list('frame:a')).toEqual([{ ...q, text: 'Put "test env" in, as a fourth cause?\n It would not fit the boxes.' }])
    ann.add('frame:a', 'No: three causes, and test env in a drawing of its own.', 'Ann')
    expect(codex.list('frame:a').map((c) => c.by)).toEqual(['Codex', 'Ann'])
    expect(codex.frames()).toEqual(['frame:a'])
    expect(changes).toBe(2)
  })

  it('takes a comment back, and the thread when it is empty; needs some text', () => {
    const [a, b] = pair()
    const c = a.add('frame:a', 'one', 'Ann')
    expect(() => a.add('frame:a', '  ', 'Ann')).toThrow(/needs some text/)
    expect(a.add('frame:a', 'x'.repeat(3000)).text).toHaveLength(2000)
    expect(b.remove('frame:a', c.id)).toBe(true)
    expect(a.list('frame:a')).toHaveLength(1)
    b.remove('frame:a', a.list('frame:a')[0].id)
    expect(a.frames()).toEqual([])
    expect(b.remove('frame:a', 'nope')).toBe(false)
  })
})

describe('for agents', () => {
  it('reads the threads of the frames on the board, and finds the frames a change touched', () => {
    const store = new Store()
    bindFrames(store)
    const f = createFrame(store, { x: 0, y: 0, title: 'Why the release slipped' })
    const g = createFrame(store, { x: 0, y: 600, title: 'Plan' })
    const [comments] = pair()
    expect(commentsText(store, comments)).toBe('')
    comments.add(f, 'Left the sticky note out: it is a fourth cause.\nKeep it?', 'Codex')
    comments.add('frame:gone', 'on a frame no longer there', 'Ann')
    const text = commentsText(store, comments)
    expect(text).toMatch(/## Comments/)
    expect(text).toContain(`### Frame "Why the release slipped" (${f})`)
    expect(text).toMatch(/- Codex \(\d{4}-\d\d-\d\d \d\d:\d\d\): Left the sticky note out: it is a fourth cause.\n  Keep it\?/)
    expect(text).not.toContain('frame:gone')
    expect(commentsText(store, comments, { frames: [g] })).toBe('')
    expect(framesOf(store, [f + '-title', g, 'shape:none'])).toEqual([f, g]) // a member (its title), a frame, nothing
  })
})

describe('threadSpot', () => {
  const view = { w: 1200, h: 800 }
  it('puts the thread beside its marker, kept on the screen; a sheet when narrow', () => {
    expect(threadSpot({ x: 400, y: 100 }, view)).toEqual({ side: 'right', x: 434, y: 76 })
    expect(threadSpot({ x: 1000, y: 100 }, view)).toEqual({ side: 'left', x: 646, y: 76 })
    expect(threadSpot({ x: 400, y: 790 }, view, { w: 320, h: 360 }).y).toBe(428)
    expect(threadSpot({ x: 200, y: 100 }, { w: 400, h: 800 })).toEqual({ side: 'sheet' })
  })
})
