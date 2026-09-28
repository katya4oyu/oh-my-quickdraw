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
| `add_note`, `add_text`, `add_shape`, `add_markdown`, `add_frame`, `add_arrow` | Puts one thing on the board, in free space, in a frame (`in`), or `at` a point |
| `update_shape`, `move_shape`, `arrange_shapes` | Changes text or color, moves (a frame brings its members), lays out |
| `delete_shapes` | Only what an agent added |
| `apply_steps` | Several steps as one operation; a step names what it adds (`ref`) and later ones point at it (`"@ref"`) |

A writing tool is one operation and returns `{ op, ids, diff, focus }`: keep `diff` to undo it, show a cursor at `focus`.

## Operations

- **Reading**: `describeBoard` (frames and members, shapes with text and bounds, which shapes arrows connect) and `boardToMarkdown`.
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

The panel sends `{ id, to, text, context: { shapeIds, frameIds, viewport }, anchor }` requests. The panel sits in the core's UI, in its look: a card left of the toolbar's rail on wide screens, a sheet from the bottom on phones; it starts hidden, and the rail's AI button (or `panel.toggle()`) opens it. Each thread gets a pin at the top-right corner of the shape it is about. The view follows what an agent adds for a request asked or opened in this panel, until the person moves the view. While the panel is open, what is selected (any number of shapes and frames) is what a request is about, shown above the input and set aside with its ×; the selection item opens the panel on one shape; a committed note beginning with `@AI` or `@<agent name>` sends its remaining text with that note as context and anchor. Host events populate pinned threads; `op` event diffs are undone newest-first with `undoDiff`, reporting records changed since the operation. The panel reports the result to the host with `reply(requestId, { undo: { reverted, skipped } })`, so the host can persist the cleared diffs and undo result. `panel.destroy()` removes its UI and subscriptions.

An agent that offers models (`models`, with its default `model` and `effort`) gets a model and an effort picker above the input; the choice is remembered per agent on the device and goes with each request as `options: { model, effort }`.

Host shape: `agents()`, `ask(request)`, `reply(requestId, messageOrApprovalOrUndo)`, `threads()`, and `onEvent(fn)`. A participant may say what it runs on — `account` ("ChatGPT Pro") and `limits` (`[{ name, usedPercent, resetsAt? }]`) — which the panel shows with a bar per limit, and the most used beside the model picker; `limitText` and `limitLevel` format them. Optionally `cannotAsk(agent)` says why this viewer may not ask an agent (nor answer its approvals): the panel shows it in place of the input. Optionally `join()` returns `{ text, command }`: how to bring an agent here, shown with a copy button while none has joined. Undo replies carry `{ undo: { reverted: number, skipped: string[] } }`. Events carry `requestId` and use `progress`, `message`, `question`, `approval`, `op`, `done`, or `error` types, `reply` for a person's follow-up (the panel does not add it itself: the host sends it back to every viewer), and `undo` for an undo made here or elsewhere. Host events besides `{ type: 'event', event }`: `{ type: 'agents' }` when the participants change, `{ type: 'threads', threads }` for the stored threads as they are now (after connecting or reconnecting), and `{ type: 'thread', thread }` for one started on another device. `apps/quickdraw`'s board page is a host over its relay.

Example: [`examples/quickdraw-agent`](../../examples/quickdraw-agent).
