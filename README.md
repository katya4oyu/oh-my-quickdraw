# Quickdraw Extensions

A private workspace for optional packages and examples that extend [`katya4oyu/quickdraw`](https://github.com/katya4oyu/quickdraw).

## Design boundaries

- Prefer implementing capabilities in this repository when they can sit outside the Quickdraw core. Frames are an example to explore here first.
- Change the forked core only for behavior that should be shared by Quickdraw hosts and genuinely belongs in the core.
- Keep features with unresolved performance or security concerns in extension packages until those concerns are understood.
- Design extensions so they can be implemented with zero external dependencies; do not add dependencies by default.

## Layout

- `vendor/quickdraw/`: pinned Git submodule of the `katya4oyu/quickdraw` fork.
- `packages/*`: reusable extension packages, managed as npm workspaces.
- `examples/*`: one small example per package, also npm workspaces. Static files only: no example needs a server.
- `apps/quickdraw`: the app built from all of this — the `quickdraw` command. `quickdraw serve` serves boards with every package, a relay per board for sync across devices, SQLite persistence and link previews; the other commands list, make, read and edit boards, for people and agents.
- `skills/quickdraw`: the [Agent Skill](skills/quickdraw/SKILL.md) that teaches an agent the `quickdraw` command.

Add a package only when a concrete extension or example is ready to be named; there is no placeholder runtime package.

## Packages

| Package | What it adds | Needs the fork's core? | Other dependencies |
| --- | --- | --- | --- |
| [`quickdraw-yjs`](packages/quickdraw-yjs) | Document sync over Yjs | No — works with upstream `@quickdrawjs/core` | `yjs` (peer) |
| [`quickdraw-export`](packages/quickdraw-export) | Board or selection as a JSON file | No | — |
| [`quickdraw-import`](packages/quickdraw-import) | Validated JSON import | No | — |
| [`quickdraw-frames`](packages/quickdraw-frames) | Frames: membership, aspect ratios, content export | No | — |
| [`quickdraw-markdown`](packages/quickdraw-markdown) | Markdown cards drawn on the canvas | **Yes** — `registerShapeType` ([katya4oyu/quickdraw#2](https://github.com/katya4oyu/quickdraw/pull/2)) | — |
| [`quickdraw-agent`](packages/quickdraw-agent) | What agents can do on a board: reading, undoable operations, and the same as tools for any agent runtime | No (Markdown cards need the fork, like `quickdraw-markdown`) | — |
| [`quickdraw-toolbar`](packages/quickdraw-toolbar) | Icon toolbar: a rail for adding things, a bar over the selection; the packages ship their items | No | — |
| [`quickdraw-embed`](packages/quickdraw-embed) | Allowed web pages and sandboxed inline HTML as live iframes; link cards with Open Graph previews | **Yes** — `registerShapeType` | — |

"Needs the fork's core" means the package uses an API that only `katya4oyu/quickdraw` has. On the upstream core, `quickdraw-markdown` and `quickdraw-embed` still load: `isMarkdownSupported()` / `isEmbedSupported()` are false, their shapes cannot be created or drawn, and their parsing and validation functions keep working.

## Examples

`npm run examples` serves the repository as static files and prints each example's URL:

| Example | Shows |
| --- | --- |
| `examples/quickdraw-yjs` | Sync across tabs (over a `BroadcastChannel`) and live cursors |
| `examples/quickdraw-export` | Export the board or the selection as JSON |
| `examples/quickdraw-import` | Import a JSON file, with validation |
| `examples/quickdraw-frames` | Frames: add, move with members, export as PNG |
| `examples/quickdraw-markdown` | Markdown cards drawn on the canvas, edited in place |
| `examples/quickdraw-embed` | A YouTube (or other allowed) page, a link card (with a made-up preview), and sandboxed inline HTML |
| `examples/quickdraw-agent` | Agent participants, panel and note requests, pinned threads, approvals, and undo |
| `examples/quickdraw-toolbar` | The toolbar with two items of its own |

## App

`npm run dev` runs `quickdraw serve` from [`apps/quickdraw`](apps/quickdraw): boards with every package, synced across devices, kept in `~/.quickdraw`.
