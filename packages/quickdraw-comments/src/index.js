// Comments on a drawing: a thread on a frame, which people and agents both
// write and read. An agent leaves one when it cannot decide something on its
// own (what to leave out, what to make stand out), people answer in the
// thread, and whoever works on the drawing next reads it first — so what was
// meant and what was agreed stays with the drawing, not in anyone's memory.
//
// The threads are kept in the board's Yjs document (a map beside the board's
// own, `comments` by default), not as shapes: they sync, persist and are kept
// in versions with the board. One thread per frame, by the frame's id; a
// comment is { id, by, text, at } (by: a person's or an agent's name; at: ms).

import * as Y from 'yjs'

export { createComments, commentTools, COMMENT_ICON, threadSpot } from './ui.js'

export const MAX_TEXT = 2000

let seq = 0
const newId = () => Date.now().toString(36) + (seq++ % 1296).toString(36).padStart(2, '0') + Math.random().toString(36).slice(2, 6)
const clean = (v) => String(v ?? '').replace(/\r\n?/g, '\n').replace(/[ \t]+\n/g, '\n').trim().slice(0, MAX_TEXT)
const read = (c) => (c && typeof c === 'object' && typeof c.text === 'string' && typeof c.id === 'string' ? c : null)

/** The comment threads of a board's Yjs document. */
export function bindComments(ydoc, { name = 'comments' } = {}) {
  const map = ydoc.getMap(name)
  const arrayOf = (frameId) => map.get(frameId)
  const api = {
    /** a frame's thread, oldest first */
    list(frameId) {
      const arr = arrayOf(frameId)
      return arr && typeof arr.toArray === 'function' ? arr.toArray().map(read).filter(Boolean) : []
    },
    /** the frames that have a thread */
    frames() {
      return [...map.keys()].filter((id) => api.list(id).length)
    },
    /** Adds a comment to a frame's thread (made when it is the first). Returns it. */
    add(frameId, text, by = '') {
      if (!frameId) throw new Error('a comment needs a frame')
      const t = clean(text)
      if (!t) throw new Error('a comment needs some text')
      const c = { id: newId(), by: String(by ?? '').trim().slice(0, 200), text: t, at: Date.now() }
      ydoc.transact(() => {
        let arr = arrayOf(frameId)
        if (!arr || typeof arr.push !== 'function') { arr = new Y.Array(); map.set(frameId, arr) }
        arr.push([c])
      })
      return c
    },
    /** Takes a comment out of its thread (the thread goes when it is empty). */
    remove(frameId, commentId) {
      const arr = arrayOf(frameId)
      if (!arr || typeof arr.toArray !== 'function') return false
      const i = arr.toArray().findIndex((c) => c?.id === commentId)
      if (i < 0) return false
      ydoc.transact(() => {
        arr.delete(i, 1)
        if (!arr.length) map.delete(frameId)
      })
      return true
    },
    /** fn() on every change, here or from elsewhere; returns an unbind */
    onChange(fn) {
      const observer = () => fn()
      map.observeDeep(observer)
      return () => map.unobserveDeep(observer)
    },
  }
  return api
}

const isFrame = (s) => !!s && s.isFrame === true
const titleOf = (store, id) => store.get(id + '-title')?.props?.text ?? ''
const when = (at) => new Date(at).toISOString().slice(0, 16).replace('T', ' ') // UTC, to the minute

/** The frames `ids` are (or are in): what an operation on them touches. */
export function framesOf(store, ids) {
  const out = new Set()
  for (const id of ids) {
    const s = store.get(id)
    if (!s) continue
    if (isFrame(s)) out.add(s.id)
    for (let f = store.get(s.frameId), n = 0; f && n < 20; f = store.get(f.frameId), n++) if (isFrame(f)) out.add(f.id)
  }
  return [...out]
}

/**
 * The threads as an agent reads them (Markdown), on the frames still on the
 * board: all of them, or those of `frames`. Empty when there are none.
 */
export function commentsText(store, comments, { frames } = {}) {
  const ids = (frames ?? comments.frames()).filter((id) => isFrame(store.get(id)) && comments.list(id).length)
  if (!ids.length) return ''
  const parts = ids.map((id) => {
    const title = titleOf(store, id)
    const lines = comments.list(id).map((c) => `- ${c.by || 'Someone'} (${when(c.at)}): ${c.text.replace(/\n/g, '\n  ')}`)
    return `### Frame ${title ? `"${title}" ` : ''}(${id})\n${lines.join('\n')}`
  })
  return '## Comments\n\nWhat was meant and asked about these drawings, and the answers: follow what was agreed when you change them.\n\n' + parts.join('\n\n')
}
