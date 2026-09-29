// Toolbar items for tickets, as plain objects (the shape quickdraw-toolbar
// takes; nothing here depends on it): a ticket and a kanban from the rail;
// edit, status and who it is for on a selected ticket.
// agents(): the agents on the board ([{ name }]), to address a ticket to one;
// me(): who is writing ({ name }), recorded as the ticket's `from`.
import { pageBounds } from '@quickdrawjs/core'
import { freeSpot } from 'quickdraw-frames'
import { createTicket, editTicket, isTicket, isTicketSupported, STATUSES } from './index.js'
import { createKanban, kanbanColumn, kanbanNear, placeInColumn, setTicketStatus } from './kanban.js'

const svg = (inner) => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${inner}</svg>`
export const TICKET_ICONS = {
  ticket: svg('<path d="M4 7a2 2 0 0 1 2-2h12a2 2 0 0 1 2 2v2a3 3 0 0 0 0 6v2a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2v-2a3 3 0 0 0 0-6z"/><path d="M9 10h6"/><path d="M9 14h4"/>'),
  kanban: svg('<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M9 4v16"/><path d="M15 4v16"/><path d="M5.5 8h1.5"/><path d="M11.5 8h1"/><path d="M11.5 11h1"/><path d="M17 8h1.5"/>'),
  edit: svg('<path d="M4 20h4L19 9a2.8 2.8 0 0 0-4-4L4 16z"/><path d="m13.5 6.5 4 4"/>'),
  status: svg('<circle cx="12" cy="12" r="8"/><path d="M12 4a8 8 0 0 1 0 16z" fill="currentColor"/>'),
  assign: svg('<circle cx="10" cy="8" r="3.5"/><path d="M3.5 19a6.5 6.5 0 0 1 11.5-4"/><path d="M15 17h6"/><path d="m18 14 3 3-3 3"/>'),
}

const STATUS_TITLES = { todo: 'Todo', doing: 'Doing', done: 'Done', failed: 'Failed' }

// Brings a page rect into view when it is not all there (a kanban is wider
// than a phone): centred, zoomed out only as far as it takes.
function show(editor, r) {
  const v = editor.viewportPageBounds()
  if (r.x >= v.x && r.y >= v.y && r.x + r.w <= v.x + v.w && r.y + r.h <= v.y + v.h) return
  const { w, h } = editor.viewSize()
  const z = Math.min(editor.camera.z, (w * 0.8) / r.w, (h * 0.8) / r.h) // clear of the toolbars
  editor.setCamera({ z, x: w / 2 / z - (r.x + r.w / 2), y: h / 2 / z - (r.y + r.h / 2) }, { animate: 250 })
}

// a new ticket: in the Todo column of a kanban in view, else in the middle of the view
function addTicket(editor, from) {
  const v = editor.viewportPageBounds()
  const kanban = kanbanNear(editor.store, v)
  const col = kanban && kanbanColumn(editor.store, kanban, 'todo')
  let id
  editor.store.transact(() => {
    const w = col ? col.props.w - 40 : Math.min(240, v.w * 0.8)
    id = createTicket(editor.store, { x: 0, y: 0, w, from })
    const h = pageBounds(editor.store.get(id)).h
    const at = col ? placeInColumn(editor.store, col.id, h, { except: id }) : { x: v.x + (v.w - w) / 2, y: v.y + v.h * 0.3 }
    editor.store.update(id, { x: at.x, y: at.y })
  })
  show(editor, pageBounds(editor.store.get(id)))
  editor.setTool('select')
  editor.setSelection([id])
  editTicket(editor, id).then((t) => { if (t && !t.title && !t.body) editor.store.remove([id]) }) // left empty: not a ticket
}

function addKanban(editor) {
  const v = editor.viewportPageBounds()
  const w = 280 * 3 + 48 * 2, h = 520
  const at = freeSpot(editor.store, w, h, { x: v.x + (v.w - w) / 2, y: v.y + 60 })
  const { columns } = createKanban(editor.store, at)
  show(editor, { x: at.x, y: at.y - 40, w, h: h + 40 }) // with the titles
  editor.setTool('select')
  editor.setSelection([columns.todo])
}

export function ticketTools({ agents = () => [], me = () => null } = {}) {
  const available = isTicketSupported
  return {
    rail: [
      { id: 'ticket', title: 'Ticket for an agent', icon: TICKET_ICONS.ticket, available, run: ({ editor }) => addTicket(editor, me()?.name) },
      { id: 'kanban', title: 'Kanban', icon: TICKET_ICONS.kanban, available, run: ({ editor }) => addKanban(editor) },
    ],
    context: [
      { id: 'ticket-edit', title: 'Edit ticket', icon: TICKET_ICONS.edit, when: isTicket, run: ({ editor, shape }) => editTicket(editor, shape.id) },
      {
        id: 'ticket-status', title: 'Status', icon: TICKET_ICONS.status, when: isTicket,
        menu: STATUSES.map((status) => ({
          id: 'ticket-status-' + status, title: STATUS_TITLES[status],
          checked: ({ shape }) => shape.props.status === status,
          run: ({ editor, shape }) => setTicketStatus(editor.store, shape.id, status),
        })),
      },
      {
        id: 'ticket-to', title: 'For', icon: TICKET_ICONS.assign, when: isTicket,
        menu: ({ shape }) => {
          const names = [...new Set([...agents().map((a) => a.name), shape.props.to].filter(Boolean))]
          return [null, ...names].map((name) => ({
            id: 'ticket-to-' + (name ?? '*'), title: name ?? 'Any agent',
            checked: ({ shape: s }) => (s.props.to ?? null) === name,
            run: ({ editor, shape: s }) => editor.store.update(s.id, { props: { to: name } }),
          }))
        },
      },
    ],
  }
}
