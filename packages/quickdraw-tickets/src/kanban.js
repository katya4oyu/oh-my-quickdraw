// A kanban: three frames side by side, Todo / Doing / Done, each marked
// `kanban: { id, status }` (the frames are quickdraw-frames' own, so they move,
// resize and export as frames do). Tickets in a column are stacked from its top.
// - setTicketStatus moves a ticket in a kanban to its status's column
// - bindKanban gives a ticket a person drags into a column that column's status
// A failed ticket sits in Done, with its own sign.
import { pageBounds, composeDiff } from '@quickdrawjs/core'
import { createFrame, isFrame } from 'quickdraw-frames'
import { isTicket, STATUSES } from './index.js'

export const COLUMNS = [['todo', 'Todo'], ['doing', 'Doing'], ['done', 'Done']]
const COL_W = 280
const COL_H = 520
const GAP = 48
const INSET = 20 // tickets from the column's edges
const SPACE = 14 // between tickets

export const isColumn = (s) => isFrame(s) && !!s.kanban?.id
const columnStatus = (status) => (status === 'failed' ? 'done' : status)

// Three columns with their top-left at x, y. Returns { id, columns: { todo, doing, done } }.
export function createKanban(store, { x, y, w = COL_W, h = COL_H }) {
  const id = 'kanban:' + Math.random().toString(36).slice(2, 10)
  const columns = {}
  store.transact(() => {
    COLUMNS.forEach(([status, title], i) => {
      const f = createFrame(store, { x: x + i * (w + GAP), y, w, h, title })
      store.update(f, { kanban: { id, status } })
      columns[status] = f
    })
  })
  return { id, columns }
}

// the column a shape is in, or null
export function columnOf(store, s) {
  const f = s?.frameId && store.get(s.frameId)
  return isColumn(f) ? f : null
}

// a kanban's column for a status (failed: Done)
export function kanbanColumn(store, kanbanId, status) {
  const want = columnStatus(status)
  return store.shapes().find((f) => isColumn(f) && f.kanban.id === kanbanId && f.kanban.status === want) ?? null
}

// The kanban nearest the middle of `rect` among those it overlaps (the view, say), or null.
export function kanbanNear(store, rect) {
  const cx = rect.x + rect.w / 2, cy = rect.y + rect.h / 2
  let best = null, dist = Infinity
  for (const f of store.shapes()) {
    if (!isColumn(f)) continue
    const b = pageBounds(f)
    if (b.x > rect.x + rect.w || b.x + b.w < rect.x || b.y > rect.y + rect.h || b.y + b.h < rect.y) continue
    const d = Math.hypot(b.x + b.w / 2 - cx, b.y + b.h / 2 - cy)
    if (d < dist) { best = f.kanban.id; dist = d }
  }
  return best
}

// the tickets in a column, top to bottom
const ticketsIn = (store, frameId, except) => store.shapes()
  .filter((s) => isTicket(s) && s.frameId === frameId && s.id !== except)
  .sort((a, b) => a.y - b.y || a.x - b.x)

// Where a ticket h high goes in a column: under its lowest ticket. The column
// grows to hold it.
export function placeInColumn(store, frameId, h, { except } = {}) {
  const f = store.get(frameId)
  const bottom = Math.max(f.y + INSET, ...ticketsIn(store, frameId, except).map((s) => { const b = pageBounds(s); return b.y + b.h + SPACE }))
  if (bottom + h + INSET > f.y + f.props.h) store.update(f.id, { props: { h: bottom + h + INSET - f.y } })
  return { x: f.x + INSET, y: bottom }
}

// Stacks a column's tickets from its top, in their order, with no gaps.
function restack(store, frameId) {
  const f = store.get(frameId)
  let y = f.y + INSET
  for (const s of ticketsIn(store, frameId)) {
    const b = pageBounds(s)
    if (s.x !== f.x + INSET || b.y !== y) store.update(s.id, { x: f.x + INSET + (s.x - b.x), y: s.y + (y - b.y) })
    y += b.h + SPACE
  }
}

// Sets a ticket's status (and who has it, and how it went). In a kanban it
// goes to the bottom of that status's column, and both columns close up.
// Back to todo, it is nobody's and has no result, unless those are given.
export function setTicketStatus(store, id, status, { by, result } = {}) {
  const s = store.get(id)
  if (!isTicket(s)) throw new Error(`${id} is not a ticket`)
  if (!STATUSES.includes(status)) throw new Error(`unknown status "${status}" (one of ${STATUSES.join(', ')})`)
  store.transact(() => {
    const reopen = status === 'todo'
    store.update(id, { props: { status, by: by !== undefined ? by : reopen ? null : s.props.by ?? null, result: result !== undefined ? result : reopen ? null : s.props.result ?? null } })
    const from = columnOf(store, s)
    const to = from && kanbanColumn(store, from.kanban.id, status)
    if (!to || to.id === from.id) return
    const t = store.get(id)
    const b = pageBounds(t)
    const at = placeInColumn(store, to.id, b.h)
    store.put({ ...t, x: at.x + (t.x - b.x), y: at.y + (t.y - b.y), frameId: to.id })
    restack(store, from.id)
  })
  return id
}

// Keeps tickets' status with the column people put them in: dragged (or
// pasted) into a column, a ticket takes its status. Local edits only; each
// peer handles its own. Returns an unbind.
export function bindKanban(store) {
  let busy = false
  return store.listen((diff) => {
    if (busy) return
    const moved = []
    for (const id of [...Object.keys(diff.added), ...Object.keys(diff.updated)]) {
      const s = store.get(id)
      if (!isTicket(s)) continue
      const [from] = diff.updated[id] || []
      if (from && from.frameId === s.frameId) continue // not into a column just now
      const col = columnOf(store, s)
      if (col && columnStatus(s.props.status) !== col.kanban.status) moved.push([id, col.kanban.status])
    }
    if (!moved.length) return
    const before = store.undos.length
    busy = true
    try {
      store.transact(() => {
        for (const [id, status] of moved) {
          const reopen = status === 'todo'
          store.update(id, { props: { status, ...(reopen ? { by: null, result: null } : {}) } })
        }
      })
    } finally { busy = false }
    // outside a gesture batch our follow-up is its own history entry: fold it
    // into the change it follows, so one undo takes both back
    if (store.undos.length === before + 1 && before > 0) {
      const ours = store.undos.pop()
      store.undos.push(composeDiff(store.undos.pop(), ours))
    }
  }, { source: 'user' })
}
