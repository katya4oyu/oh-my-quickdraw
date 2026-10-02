// The boards a board shows (quickdraw-boards' cards), for an agent reading it:
// each one's title, its frames and how much is in them — enough to know what
// is there without going to read it (omq read --board ID does that).
// Read now, one level deep (the cards on those boards are not followed).
import { describeBoard } from 'quickdraw-agent'
import { listBoards } from '../commands/boards.ts'
import { serverOfBoard } from './link-preview.ts'
import { openBoard, type Board } from './open.ts'

const TYPE = 'boardcard'
type Card = { type?: string, props: { board: string, title: string, live?: boolean } }

// another board's relay URL, beside this one's (ws://host/ws/ID)
const relayOf = (url: string, id: string) => url.replace(/\/ws\/[^/?#]+/, `/ws/${encodeURIComponent(id)}`)

function within<T>(p: Promise<T>, ms: number): Promise<T> {
  return Promise.race([p, new Promise<T>((_, no) => setTimeout(() => no(new Error('timed out')), ms))])
}

/** What another board holds, in a line: its frames (and what is in each), and what is outside them. */
export function boardSummary(board: Board): string {
  const { frames, items } = describeBoard(board.store as never)
  const top = frames.filter((f) => !f.frame || !frames.some((g) => g.id === f.frame))
  const count = (f: { members: string[] }) => f.members.length
  const parts = top.slice(0, 8).map((f) => `${f.title || 'Frame'} (${count(f) ? `${count(f)} in it` : 'empty'})`)
  if (top.length > 8) parts.push(`and ${top.length - 8} more`)
  const loose = items.filter((it) => !it.frame).length
  const out = [parts.length ? `frames: ${parts.join(', ')}` : 'no frames', loose ? `${loose} shape${loose === 1 ? '' : 's'} outside frames` : '']
  return frames.length || items.length ? out.filter(Boolean).join('; ') : 'empty'
}

/** The boards on a live board's cards, as a Markdown section ('' when there are none). */
export async function linkedBoardsText(board: Board, { max = 6, timeout = 4000 } = {}): Promise<string> {
  if (!board.url) return ''
  const self = board.url.match(/\/ws\/([^/?#]+)/)?.[1]
  const cards = new Map<string, Card>()
  for (const s of board.store.shapes() as unknown as Card[]) if (s.type === TYPE && s.props.board !== self && !cards.has(s.props.board)) cards.set(s.props.board, s)
  if (!cards.size) return ''
  const known = await listBoards(serverOfBoard(board.url)).catch(() => null)
  const lines = await Promise.all([...cards.values()].slice(0, max).map(async (c) => {
    const id = c.props.board
    const info = known?.find((b) => b.id === id)
    const head = `- ${info?.title ?? c.props.title} (board ${id}${c.props.live ? ', live' : ''})`
    if (known && !info) return `${head}: not on the server now (archived, or gone)`
    try {
      const other = await within(openBoard({ url: relayOf(board.url!, id), name: 'Reader' }), timeout)
      try { return `${head}: ${boardSummary(other)}` } finally { await other.close() }
    } catch { return `${head}: could not read it now` }
  }))
  if (cards.size > max) lines.push(`- and ${cards.size - max} more`)
  return ['## Boards on this board (board cards: another board, shown here; read one with omq read --board ID)', '', ...lines].join('\n')
}
