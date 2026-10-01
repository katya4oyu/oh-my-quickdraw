// The team on a board, for an agent: the agents there and in the members
// table (quickdraw-members), each with its role, whether it is here, and the
// tickets it is working on. Agents read it to do what their role is for, hand
// the rest to the one whose role fits, and not do what another already does.
import { listTickets } from 'quickdraw-tickets'
import type { Board } from './open.ts'

export interface Mate {
  name: string
  you?: true
  role?: string
  about?: string
  /** who set its role */
  set_by?: string
  /** its pet's name, when it has one */
  pet?: string
  here: boolean
  /** what it is doing just now, when here */
  doing?: string
  working_on: { id: string, title: string }[]
}

const same = (a: string, b: string) => a.toLowerCase() === b.toLowerCase()

export function teamOf(board: Board, me?: string): Mate[] {
  const members = board.members?.list() ?? []
  const peers = [...(board.relay?.peers().values() ?? [])].filter((p) => p.agent && p.name)
  const names: string[] = []
  for (const n of [...(me ? [me] : []), ...peers.map((p) => p.name!), ...members.map((m) => m.name)]) if (!names.some((x) => same(x, n))) names.push(n)
  const doing = listTickets(board.store as never, { status: 'doing' }) as { id: string, props: { by?: string, title: string } }[]
  return names.map((name) => {
    const m = members.find((x) => same(x.name, name))
    const p = peers.find((x) => same(x.name!, name))
    const here = !!p || (!!me && same(me, name))
    return {
      name, ...(me && same(me, name) ? { you: true as const } : {}),
      ...(m?.role ? { role: m.role } : {}), ...(m?.about ? { about: m.about } : {}), ...(m?.by ? { set_by: m.by } : {}),
      ...((m?.avatar as { name?: string } | null)?.name ? { pet: (m!.avatar as { name: string }).name } : {}),
      here,
      ...(p?.agentActivity ? { doing: p.agentActivity + (p.agentNote ? ': ' + p.agentNote : '') } : {}),
      working_on: doing.filter((t) => t.props.by && same(t.props.by, name)).map((t) => ({ id: t.id, title: t.props.title })),
    }
  })
}

/** The team as lines of Markdown, for what an agent reads of the board. */
export function teamText(team: Mate[]): string {
  if (team.length <= 1 && !team.some((m) => m.role)) return ''
  const line = (m: Mate) => {
    const role = m.role ? `role: ${m.role}${m.about ? ` (${m.about})` : ''}${m.set_by ? `, set by ${m.set_by}` : ''}` : 'no role yet'
    const work = m.working_on.length ? ` — working on ${m.working_on.map((t) => `"${t.title}" (${t.id})`).join(', ')}` : ''
    return `- ${m.name}${m.you ? ' (you)' : ''} — ${role}${m.here ? '' : ' — not on the board now'}${work}`
  }
  return ['## Team: the agents of this board, their roles and what they work on', '', ...team.map(line)].join('\n')
}
