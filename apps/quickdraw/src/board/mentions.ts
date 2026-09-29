// Notes an operation wrote that start with "@" (@AI, @Claude…): a page makes
// such a note a request when a person writes it; for what an agent or a
// command writes, the writer tells the server, which makes it a request when
// the one who started the writer started that agent too (serve's `mention`).
import type { BoardRecord, Diff } from '@quickdrawjs/core'
import type { Relay } from './relay.ts'

type Note = { id: string, type?: string, x: number, y: number, props?: { text?: unknown } }
const mention = (r: BoardRecord | undefined) => {
  const n = r as Note | undefined
  return n?.type === 'note' && typeof n.props?.text === 'string' && /^\s*@\S/.test(n.props.text) ? n : null
}

/** The notes a diff added, or whose text it changed, that start with "@". */
export function mentionsIn(diff: Diff): { id: string, text: string, x: number, y: number }[] {
  const out = []
  for (const r of Object.values(diff.added)) { const n = mention(r); if (n) out.push(n) }
  for (const [from, to] of Object.values(diff.updated)) {
    const n = mention(to)
    if (n && (from as Note).props?.text !== n.props!.text) out.push(n)
  }
  return out.map((n) => ({ id: n.id, text: String(n.props!.text).trim(), x: n.x, y: n.y }))
}

export function announceMentions(relay: Relay | undefined, diff: Diff) {
  if (relay) for (const note of mentionsIn(diff)) relay.send({ kind: 'mention', note })
}
