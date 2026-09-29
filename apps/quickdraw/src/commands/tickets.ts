// Tickets from the command line: an agent lists them, waits for one to be
// put on the board, takes it and closes it. Waiting keeps the board open, as
// a peer, and answers as soon as a ticket for it shows up — from a person's
// page or another agent.
import type { Store } from '@quickdrawjs/core'
import type { Board } from '../board/open.ts'

const { describeTicket, listTickets, isTicket } = await import('quickdraw-tickets')

export type TicketInfo = ReturnType<typeof describeTicket>

/** The oldest ticket still to do that is for this agent (or any), or null. */
export function nextTicket(store: Store, name: string) {
  return listTickets(store, { status: 'todo', for: name })[0] ?? null
}

/** Why this agent may not take a ticket now, or null when it may. */
export function cannotTake(store: Store, id: string, name: string): string | null {
  const s = store.get(id)
  if (!isTicket(s)) return `${id} is not a ticket`
  const p = (s as unknown as { props: { status: string, to: string | null, by: string | null } }).props
  if (p.status !== 'todo') return p.by ? `taken by ${p.by} (${p.status})` : `already ${p.status}`
  if (p.to && p.to.toLowerCase() !== name.toLowerCase()) return `for ${p.to}`
  return null
}

/**
 * Resolves with what `check` finds once it finds something: at once, or when
 * the board changes. null after `timeout` ms (none: no limit), or when `signal`
 * aborts; rejects when the board's connection drops.
 */
export function waitFor<T>(board: Board, check: () => T | null, { timeout, signal }: { timeout?: number, signal?: AbortSignal } = {}): Promise<T | null> {
  return new Promise((resolve, reject) => {
    const now = check()
    if (now != null || signal?.aborted) return resolve(now)
    let timer: ReturnType<typeof setTimeout> | undefined
    const finish = (value: T | null, error?: Error) => {
      off()
      clearTimeout(timer)
      signal?.removeEventListener('abort', onAbort)
      if (error) reject(error); else resolve(value)
    }
    const off = board.store.listen(() => {
      const found = check()
      if (found != null) finish(found)
    })
    const onAbort = () => finish(null)
    signal?.addEventListener('abort', onAbort)
    board.relay?.onClose(() => finish(null, new Error('the board\'s server closed the connection')))
    if (timeout != null) timer = setTimeout(() => finish(null), timeout)
  })
}

export interface TicketEvent { event: 'added' | 'status' | 'changed' | 'removed', ticket: TicketInfo }

/**
 * Calls `emit` for each change to a ticket — added, moved on (status, who has
 * it, its result), its text or whom it is for changed, removed — until
 * `signal` aborts or the connection drops. Moving it about is not a change.
 */
export function watchTickets(board: Board, emit: (e: TicketEvent) => void, { for: name, signal }: { for?: string, signal?: AbortSignal } = {}): Promise<void> {
  const mine = (s: { props: { to?: string | null } }) => name == null || !s.props.to || s.props.to.toLowerCase() === name.toLowerCase()
  return new Promise((resolve, reject) => {
    if (signal?.aborted) return resolve()
    const off = board.store.listen((diff) => {
      for (const rec of Object.values(diff.added)) if (isTicket(rec) && mine(rec as never)) emit({ event: 'added', ticket: describeTicket(rec) })
      for (const [from, to] of Object.values(diff.updated)) {
        if (!isTicket(to) || !(mine(to as never) || mine(from as never))) continue
        const a = (from as { props: Record<string, unknown> }).props, b = (to as { props: Record<string, unknown> }).props
        const moved = ['status', 'by', 'result'].some((k) => a[k] !== b[k])
        const changed = ['title', 'body', 'to'].some((k) => a[k] !== b[k])
        if (moved || changed) emit({ event: moved ? 'status' : 'changed', ticket: describeTicket(to) })
      }
      for (const rec of Object.values(diff.removed)) if (isTicket(rec) && mine(rec as never)) emit({ event: 'removed', ticket: describeTicket(rec) })
    })
    const done = (error?: Error) => { off(); signal?.removeEventListener('abort', onAbort); if (error) reject(error); else resolve() }
    const onAbort = () => done()
    signal?.addEventListener('abort', onAbort)
    board.relay?.onClose(() => done(new Error('the board\'s server closed the connection')))
  })
}
