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
| [`quickdraw-screenshare`](packages/quickdraw-screenshare) | One person shares a screen, everyone watches it live, and snapshots land on the board to write feedback on | No | `quickdraw-frames` |
| [`quickdraw-presence`](packages/quickdraw-presence) | Who is on a board: cursors with names, colours and statuses (an agent's says what it is doing), following someone, arrows at the edge for those out of sight | No | — |
| [`quickdraw-tickets`](packages/quickdraw-tickets) | Tickets people leave for agents, and a kanban (Todo / Doing / Done frames) that follows their status | **Yes** — `registerShapeType` | `quickdraw-frames` |
| [`quickdraw-voice`](packages/quickdraw-voice) | Talk with an agent on a board: a microphone, a WebRTC call straight to a voice model, and a bar with what is said while it works | No | — |

"Needs the fork's core" means the package uses an API that only `katya4oyu/quickdraw` has. On the upstream core, `quickdraw-markdown`, `quickdraw-embed` and `quickdraw-tickets` still load: `isMarkdownSupported()` / `isEmbedSupported()` are false, their shapes cannot be created or drawn, and their parsing and validation functions keep working.

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
| `examples/quickdraw-screenshare` | A presenter and a viewer side by side: share a tab (or a demo app), watch it live, snapshot it onto the board |
| `examples/quickdraw-presence` | Two people side by side and an agent going from note to note: name yourself, follow someone, find them by the arrow at the edge |
| `examples/quickdraw-tickets` | A kanban with tickets: add one from the rail, drag it between columns, and a stand-in agent that takes and finishes them |
| `examples/quickdraw-voice` | The voice bar on a made-up call: calling, what is said as it comes, mute and hang up (no microphone or agent needed) |

## App

`npm run dev` runs `quickdraw serve` from [`apps/quickdraw`](apps/quickdraw): boards with every package, synced across devices, kept in `~/.quickdraw`.
