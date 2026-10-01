# quickdraw-tickets

Tickets for agents on a Quickdraw board: a card a person writes ("do this", for an agent or for any), which an agent takes, works on and closes with a line on how it went. A **kanban**, three frames Todo / Doing / Done, keeps them in order: a ticket moves column with its status, and takes the status of the column a person drags it into.

```js
import { bindKanban, bindTicketEditing, createKanban, createTicket, setTicketStatus, listTickets, ticketTools, validateTicket } from 'quickdraw-tickets'
import { bindFrames } from 'quickdraw-frames'

bindFrames(board.editor.store)
bindKanban(board.editor.store)      // dragged into a column, a ticket takes its status
bindTicketEditing(board.editor)     // registers the type; double-click a ticket to edit

const { columns } = createKanban(store, { x: 0, y: 0 })            // { todo, doing, done } frame ids
const id = createTicket(store, { x, y, title: 'Fix the login page', body: 'on Safari', to: 'Codex', from: 'Ann' })
setTicketStatus(store, id, 'doing', { by: 'Codex' })              // in a kanban: to the Doing column
setTicketStatus(store, id, 'done', { result: 'Fixed the cookie' })
listTickets(store, { status: 'todo', for: 'Codex' })              // oldest first: for Codex or any agent

// JSON files: let quickdraw-import accept tickets, checked by this package's validator
openJSON(board.editor, { types: { ticket: validateTicket } })
```

**Needs the `katya4oyu/quickdraw` core** for `registerShapeType`, like `quickdraw-markdown`: on the upstream core `isTicketSupported()` is false and tickets cannot be created or drawn. Every peer registers the type (`bindTicketEditing` or `registerTicket`) before remote tickets arrive. Depends on [`quickdraw-frames`](../quickdraw-frames) for the kanban's columns.

## Record

`{ type: 'ticket', props: { title, body, to, from, status, by, result, created, w } }`

- `to`: the agent it is for, by name; `null` for any agent. `from`: who wrote it.
- `status`: `todo`, `doing`, `done` or `failed`. `by`: who took it. `result`: how it went, in a line.
- `created`: when it was written (ms), for oldest-first order. The height follows the text; resizing changes the width.

A kanban column is a frame with `kanban: { id, status }`; a failed ticket sits in Done, with its own sign.

## Agents

Agents read and move tickets through [`quickdraw-agent`](../quickdraw-agent) (`read_board`, `add_ticket`, `set_ticket_status`) and the `quickdraw` command (`tickets`, `wait --take`, `take`, `done`, `fail`, `watch`: see [`apps/quickdraw`](../../apps/quickdraw)). `setTicketStatus` and `bindKanban` handle local changes only: each peer moves what it changed, and sync carries the result to the rest.

Example: `examples/quickdraw-tickets` (run `npm run examples` at the workspace root).

**Team & tickets**, beside the board: `createTicketBoard({ editor, team, setRole })` is a panel (a card by the rail, a sheet on phones) with the team above — each agent's name, role, what it is doing and the tickets it is on — and every ticket of the board below in Todo / Doing / Done columns, kanban frames or not. Drag a card to another column or pick its status; press it to go to the ticket on the board. `team()` gives the agents (`[{ name, role?, about?, here?, status?, doing? }]`, e.g. from [`quickdraw-members`](../quickdraw-members) and presence); with `setRole(name, role)` a role is edited in place. It watches the tickets; call `refresh()` when the team changes. Pass it to `ticketTools({ board })` for a button on the rail.

Toolbar items: `ticketTools({ agents, me, board })` returns `{ rail, context }` for [`quickdraw-toolbar`](../quickdraw-toolbar): a ticket and a kanban on the rail; edit, status and whom it is for on a selected ticket. `agents()` lists the agents a ticket can be for (`[{ name }]`), `me()` who writes it (`{ name }`).
