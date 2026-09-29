import { describe, it, expect } from 'vitest'
import { Store, pageBounds, hitShape } from '@quickdrawjs/core'
import { scaleShape } from '../../../vendor/quickdraw/packages/core/src/shapes.js'
import { bindFrames } from 'quickdraw-frames'
import {
  createTicket, validateTicket, describeTicket, listTickets, ticketIsFor, ticketWho,
  createKanban, bindKanban, setTicketStatus, placeInColumn, columnOf, kanbanNear,
} from '../src/index.js'

// the core measures frame titles with a canvas: a stand-in, 0.6em a character
globalThis.OffscreenCanvas ??= class {
  getContext() {
    return { font: '16px sans-serif', measureText(t) { return { width: [...t].length * parseFloat(this.font.match(/(\d+)px/)[1]) * 0.6 } } }
  }
}

function board() {
  const store = new Store()
  bindFrames(store)
  bindKanban(store)
  return store
}

describe('tickets', () => {
  it('are todo, for any agent, and grow with their text', () => {
    const store = new Store()
    const id = createTicket(store, { x: 10, y: 20, title: 'Fix the login page', from: 'Yuya' })
    const s = store.get(id)
    expect(s.props).toMatchObject({ status: 'todo', to: null, by: null, result: null, from: 'Yuya', w: 240 })
    expect(validateTicket(s)).toBeNull()
    const b = pageBounds(s)
    expect([b.x, b.y, b.w]).toEqual([10, 20, 240])
    expect(hitShape(s, 100, 30, 0)).toBe(true)
    expect(pageBounds({ ...s, props: { ...s.props, body: 'one\ntwo\nthree' } }).h).toBeGreaterThan(b.h)
    expect(scaleShape(s, 2, 3).props.w).toBe(480)
  })

  it('say who they are with', () => {
    expect(ticketWho({ status: 'todo', to: null })).toBe('any agent')
    expect(ticketWho({ status: 'todo', to: 'Codex' })).toBe('→ Codex')
    expect(ticketWho({ status: 'doing', to: null, by: 'pi' })).toBe('pi')
  })

  it('refuse bad records', () => {
    const store = new Store()
    const s = store.get(createTicket(store, { x: 0, y: 0, title: 'a' }))
    expect(validateTicket({ ...s, props: { ...s.props, status: 'maybe' } })).toBe('bad props.status')
    expect(validateTicket({ ...s, props: { ...s.props, title: 3 } })).toBe('bad props.title')
    expect(validateTicket({ ...s, props: { ...s.props, to: 5 } })).toBe('bad props.to')
    expect(() => createTicket(store, { x: 0, y: 0, status: 'later' })).toThrow(/unknown status/)
  })

  it('are listed oldest first, by status and by whom they are for', async () => {
    const store = new Store()
    const a = createTicket(store, { x: 0, y: 0, title: 'a', to: 'Codex' })
    await new Promise((r) => setTimeout(r, 2))
    const b = createTicket(store, { x: 0, y: 0, title: 'b' })
    await new Promise((r) => setTimeout(r, 2))
    const c = createTicket(store, { x: 0, y: 0, title: 'c', to: 'pi' })
    setTicketStatus(store, b, 'doing', { by: 'pi' })
    expect(listTickets(store).map((s) => s.id)).toEqual([a, b, c])
    expect(listTickets(store, { status: 'todo' }).map((s) => s.id)).toEqual([a, c])
    expect(listTickets(store, { for: 'codex' }).map((s) => s.id)).toEqual([a, b])
    expect(ticketIsFor(store.get(c), 'Codex')).toBe(false)
    expect(describeTicket(store.get(b))).toMatchObject({ id: b, title: 'b', status: 'doing', by: 'pi', to: null })
  })

  it('go back to nobody when reopened', () => {
    const store = new Store()
    const id = createTicket(store, { x: 0, y: 0, title: 'a' })
    setTicketStatus(store, id, 'done', { by: 'pi', result: 'Fixed' })
    expect(store.get(id).props).toMatchObject({ status: 'done', by: 'pi', result: 'Fixed' })
    setTicketStatus(store, id, 'failed')
    expect(store.get(id).props).toMatchObject({ status: 'failed', by: 'pi', result: 'Fixed' }) // kept
    setTicketStatus(store, id, 'todo')
    expect(store.get(id).props).toMatchObject({ status: 'todo', by: null, result: null })
  })
})

describe('kanban', () => {
  it('is three columns, marked with their status', () => {
    const store = board()
    const { id, columns } = createKanban(store, { x: 0, y: 0 })
    expect(Object.keys(columns)).toEqual(['todo', 'doing', 'done'])
    expect(store.get(columns.doing).kanban).toEqual({ id, status: 'doing' })
    expect(kanbanNear(store, { x: 0, y: 0, w: 400, h: 400 })).toBe(id)
    expect(kanbanNear(store, { x: 5000, y: 5000, w: 400, h: 400 })).toBeNull()
  })

  it('moves a ticket to its status\'s column, and closes up the one it left', () => {
    const store = board()
    const { columns } = createKanban(store, { x: 0, y: 0 })
    const put = (title) => {
      const id = createTicket(store, { x: 0, y: 0, title, w: 240 })
      const at = placeInColumn(store, columns.todo, pageBounds(store.get(id)).h, { except: id })
      store.update(id, at)
      return id
    }
    const a = put('a'), b = put('b')
    expect(columnOf(store, store.get(b))?.id).toBe(columns.todo)
    const bTop = store.get(b).y
    setTicketStatus(store, a, 'doing', { by: 'Codex' })
    expect(store.get(a).frameId).toBe(columns.doing)
    expect(store.get(a).x).toBe(store.get(columns.doing).x + 20)
    expect(store.get(b).y).toBeLessThan(bTop) // moved up into a's place
    setTicketStatus(store, a, 'failed', { result: 'no access' })
    expect(store.get(a).frameId).toBe(columns.done)
    expect(store.get(a).props.status).toBe('failed')
  })

  it('grows a column to hold its tickets', () => {
    const store = board()
    const { columns } = createKanban(store, { x: 0, y: 0, h: 200 })
    for (let i = 0; i < 4; i++) {
      const id = createTicket(store, { x: 0, y: 0, title: 'ticket ' + i })
      store.update(id, placeInColumn(store, columns.todo, pageBounds(store.get(id)).h, { except: id }))
    }
    const f = store.get(columns.todo)
    const lowest = Math.max(...store.shapes().filter((s) => s.type === 'ticket').map((s) => pageBounds(s).y + pageBounds(s).h))
    expect(f.y + f.props.h).toBeGreaterThanOrEqual(lowest)
    expect(store.shapes().filter((s) => s.type === 'ticket').every((s) => s.frameId === columns.todo)).toBe(true)
  })

  it('gives a ticket dragged into a column that column\'s status, in one undo', () => {
    const store = board()
    const { columns } = createKanban(store, { x: 0, y: 0 })
    const id = createTicket(store, { x: 2000, y: 0, title: 'a' })
    const done = store.get(columns.done)
    store.update(id, { x: done.x + 20, y: done.y + 20 })
    expect(store.get(id).frameId).toBe(columns.done)
    expect(store.get(id).props.status).toBe('done')
    store.update(id, { x: store.get(columns.todo).x + 20 })
    expect(store.get(id).props).toMatchObject({ status: 'todo', by: null })
    store.undo()
    expect(store.get(id).props.status).toBe('done')
    expect(store.get(id).frameId).toBe(columns.done)
  })

  it('leaves a failed ticket in Done alone, and ignores remote changes', () => {
    const store = board()
    const { columns } = createKanban(store, { x: 0, y: 0 })
    const id = createTicket(store, { x: 2000, y: 0, title: 'a', status: 'failed' })
    const done = store.get(columns.done)
    store.update(id, { x: done.x + 20, y: done.y + 20 })
    expect(store.get(id).props.status).toBe('failed')
    const doing = store.get(columns.doing)
    store.put({ ...store.get(id), x: doing.x + 20, frameId: doing.id }, 'remote')
    expect(store.get(id).props.status).toBe('failed')
  })
})
