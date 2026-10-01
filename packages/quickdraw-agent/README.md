# quickdraw-agent

What agents can do on a Quickdraw board, over a core `Store`: read it, change it in undoable operations, and the same as tools for any agent runtime. It runs in browsers and in Node, and knows nothing about servers, transports or which AI is calling. No core change; no dependencies beyond the other packages here.

The `quickdraw` command ([`apps/quickdraw`](../../apps/quickdraw)) and its [Agent Skill](../../skills/quickdraw/SKILL.md) are built on it.

```js
import { BOARD_TOOLS, runOp, undoDiff, installMeasure } from 'quickdraw-agent'

installMeasure() // in Node only: the core measures text with a canvas

const addNote = BOARD_TOOLS.find((t) => t.name === 'add_note')
const { op, ids, diff } = addNote.run(store, { text: 'Idea', color: 'yellow' }, { name: 'Codex' })
undoDiff(store, diff) // later: reverts what nobody changed since
```

## Tools

`BOARD_TOOLS`: `{ name, description, inputSchema, run(store, args, { name }) }`, the input schema being a JSON Schema. Hand them to any runtime that takes tools.

| Tool | Does |
| --- | --- |
| `read_board` | The board as a Markdown outline (frames, shapes, connections, with ids), or as data |
| `check_board` | Layout problems in a frame, some shapes, or the work area (by default): to call once a piece of work is done; with `fix`, it fixes what needs no judgement first |
| `add_note`, `add_text`, `add_shape`, `add_markdown`, `add_embed`, `add_frame`, `add_arrow` | Puts one thing on the board, in free space, in a frame (`in`), or `at` a point |
| `add_bento`, `set_span`, `set_columns` | A bento grid ([`quickdraw-layouts`](../quickdraw-layouts)): frames (cells, `add_frame` with `in` the grid and `span`) that pack themselves; a full cell grows a row when something is put `in` it, and the cells after it move along |
| `update_shape`, `move_shape`, `arrange_shapes` | Changes text or color, moves (a frame brings its members), lays out |
| `delete_shapes` | Only what an agent added |
| `apply_steps` | Several steps as one operation; a step names what it adds (`ref`) and later ones point at it (`"@ref"`) |

A writing tool is one operation and returns `{ op, ids, diff, focus }`: keep `diff` to undo it, show a cursor at `focus`.

## Operations

- **Checking** (`lintBoard(store, { frame | ids | area })`, `lintText`): what reads badly once drawn — shapes on top of each other (a heading over a frame's title too), an arrow across a shape it does not connect, what sticks out of its frame or lies across a frame's edge, frames on top of each other. Pen marks and pictures may sit on anything; text inside a box reads as its label. Narrowed to what was just made, it still counts what else is there as what that runs into; a problem names who made each shape, so an agent moves its own. Agents draw first and fix after, rather than working out every position first. `fixLayout(store, name, scope)` (`fixText`) fixes, as one operation on what agents made, what needs no judgement: a shape grows for its label; frames and shapes on top of each other are pushed apart (the way that lands on nothing, sticks out of its frame least, moves least; a frame crowded with an agent's shapes is laid out afresh as the grid that suits its shape); what hangs over a frame's edge is brought in with `fit` when it belongs there (mostly in it, or lined up with what is), else moved clear. An arrow across a shape is left for the agent.
- **Reading**: `describeBoard` (frames and members, shapes with text and bounds, which shapes arrows connect) and `boardToMarkdown`. A snapshot of a shared screen ([`quickdraw-screenshare`](../quickdraw-screenshare)) reads as one: its frame carries `snapshot: { at, by }`, its still reads as `(screenshot)`.
- **A work area**: `applySteps(store, name, steps, { area })` puts what has no place in `area` (`{ x, y, w, h }`), clear of what is there; when it is full the area grows downwards, and the operation returns it as `area`. `freeSpot(store, w, h, prefer)` finds room for one. The panel draws a thread's area (an `area` event) while it is under way: moved by its label and resized by its corner, which it sends as `host.reply(requestId, { area })` (`dragArea` is the arithmetic). Before asking, the person can drag out where it should work (`markedArea`); the request carries it as `context.area`. The area's label has **Stop** (`host.reply(id, { stop: true })`) and shows the approval it waits on (`pendingApproval`).
- **Embeds**: an `embed` step (`{ do: 'embed', url | html, link?, title?, preview? }`) puts a [`quickdraw-embed`](../quickdraw-embed) page, link card or inline HTML. `preview` is a link card's title and picture, which the runtime fetches first (a page cannot: CORS); a plain `http://` link is always a card.
- **Images**: an `image` step (`{ do: 'image', src: 'data:image/…', natural: { w, h }, w?, at?, in? }`) adds the image's asset and its shape; a runtime that reads files turns a file into that step.
- **Writing** (`runOp`, `applySteps`): each operation is one store transaction, all or nothing. What an agent adds carries `agent: { name, op }`; it may move and edit anything but delete only what an agent added. Arrows between shapes keep `link: { from, to }` and follow them when they move in a later operation.
- **The diff** compares each record the operation touched, before and after — including what listeners changed in response, such as frame membership — so `undoDiff` reverts the whole operation, and only where nobody has changed things since.
- **Text in Node**: `installMeasure` provides an estimating stand-in for the canvas the core measures text with, so notes and text can be laid out. Browsers draw with real measurements.

Types: [`types/index.d.ts`](types/index.d.ts).

## Agent panel

`createAgentPanel` adds the human side of agents to an editor. The host injects participants, request/reply transport, events and stored threads; this package does not choose a runtime or persist anything.

```js
import { createAgentPanel, agentTools } from 'quickdraw-agent'
import { createToolbar } from 'quickdraw-toolbar'

const panel = createAgentPanel({ editor, host })
const ai = agentTools(panel)
createToolbar(editor, { rail: [...ai.rail], context: [...ai.context] })
```

The panel sends `{ id, to, text, context: { shapeIds, frameIds, viewport }, anchor }` requests. The panel sits in the core's UI, in its look: a card left of the toolbar's rail on wide screens, a sheet from the bottom on phones; it starts hidden, and the rail's AI button (or `panel.toggle()`) opens it. Each thread gets a pin at the top-right corner of the shape it is about. The view follows what an agent adds for a request asked or opened in this panel, until the person moves the view. While the panel is open, what is selected (any number of shapes and frames) is what a request is about, shown above the input and set aside with its ×; the selection item opens the panel on one shape; a committed note beginning with `@AI` or `@<agent name>` sends its remaining text with that note as context and anchor. While a note is written, `@` at its start lists the agents this person may ask (narrowed by what follows; ↑↓, Enter or Tab, a click; Esc closes it) and writes the picked one's full name, so nobody has to type "Claude · my-repo" exactly (`bindMentionPicker` does it; the panel binds it itself). Host events populate pinned threads; `op` event diffs are undone newest-first with `undoDiff`, reporting records changed since the operation. The panel reports the result to the host with `reply(requestId, { undo: { reverted, skipped } })`, so the host can persist the cleared diffs and undo result. `panel.destroy()` removes its UI and subscriptions.

An agent that offers models (`models`, with its default `model` and `effort`) gets a model and an effort picker above the input, and one that talks and offers `voices` (with its `defaultVoice`) a voice picker; the choice is remembered per agent on the device and goes with each request as `options: { model, effort, voice }` (`panel.optionsFor(agentId)` gives it, for a call started elsewhere, like quickdraw-voice's microphone).

Host shape: `agents()`, `ask(request)`, `reply(requestId, messageOrApprovalOrUndo)`, `threads()`, and `onEvent(fn)`. A participant may say what it runs on — `account` ("ChatGPT Pro") and `limits` (`[{ name, usedPercent, resetsAt? }]`) — which the panel shows with a bar per limit, and the most used beside the model picker; `limitText` and `limitLevel` format them. Optionally `feedback()` returns `[{ id, label, count }]`: feedback the next new request carries (snapshots written on, say), shown as chips above the input, each set aside with its ×; their ids go in the request's `context.feedback` (`feedbackToSend` is the rule). Optionally `cannotAsk(agent)` says why this viewer may not ask an agent (nor answer its approvals): the panel shows it in place of the input. Optionally `join()` returns `{ text, command }`: how to bring an agent here, shown with a copy button while none has joined. Undo replies carry `{ undo: { reverted: number, skipped: string[] } }`. Events carry `requestId` and use `progress`, `message`, `question`, `approval`, `op`, `done`, or `error` types, `reply` for a person's follow-up (the panel does not add it itself: the host sends it back to every viewer), and `undo` for an undo made here or elsewhere. Host events besides `{ type: 'event', event }`: `{ type: 'agents' }` when the participants change, `{ type: 'threads', threads }` for the stored threads as they are now (after connecting or reconnecting), and `{ type: 'thread', thread }` for one started on another device. `apps/quickdraw`'s board page is a host over its relay.

Example: [`examples/quickdraw-agent`](../../examples/quickdraw-agent).

## Arrows that follow

An arrow between two shapes keeps them as `link: { from, to }` (an agent's always does) and is drawn again, edge to edge, when either moves or changes size; an agent's operations do it for their own. On a page, `bindArrows(editor)` does it for people too: a shape dragged or resized takes its arrows along at once; an arrow drawn (or its end dragged) so that both ends land on shapes is linked to them once let go, and dragged off one is linked no more; a shape removed leaves its arrows, unlinked. Each page handles its own people's edits. `arrowEnds(store, arrow)` and `arrowRoute(store, arrow)` are the pieces.
