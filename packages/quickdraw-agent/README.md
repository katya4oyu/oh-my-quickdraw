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
- **Writing** (`runOp`, `applySteps`): each operation is one store transaction, all or nothing. What an agent adds carries `agent: { name, op }`; it may move and edit anything but delete only what an agent added. Arrows between shapes keep `link: { from, to }` and follow them when they move in a later operation.
- **The diff** compares each record the operation touched, before and after — including what listeners changed in response, such as frame membership — so `undoDiff` reverts the whole operation, and only where nobody has changed things since.
- **Text in Node**: `installMeasure` provides an estimating stand-in for the canvas the core measures text with, so notes and text can be laid out. Browsers draw with real measurements.

Types: [`types/index.d.ts`](types/index.d.ts).
