# oh-my-quickdraw

Quickdraw, batteries included. A whiteboard that people and AI agents share: the `omq` command serves boards that sync across devices, and agents — Claude Code, Codex, or any that reads skills — join a board, take requests from the people on it, work through its tickets and watch a shared screen, drawing as they go. It is built on [`katya4oyu/quickdraw`](https://github.com/katya4oyu/quickdraw), a fork of the Quickdraw whiteboard, with extension packages for frames, Markdown cards, embeds, presence, screen sharing, tickets and more.

```sh
git clone --recurse-submodules https://github.com/katya4oyu/oh-my-quickdraw.git
cd oh-my-quickdraw && npm install
npm link -w apps/quickdraw        # puts `omq` on your PATH (Node 23.6 or later)
omq skill install           # teaches the agents on this machine the command
omq serve                   # http://127.0.0.1:8795/
```

See [`apps/quickdraw`](apps/quickdraw) for the app, and below for the packages. The packages are not published to npm; use them from a checkout (npm workspaces).

## Design boundaries

- Prefer implementing capabilities in this repository when they can sit outside the Quickdraw core. Frames are an example to explore here first.
- Change the forked core only for behavior that should be shared by Quickdraw hosts and genuinely belongs in the core.
- Keep features with unresolved performance or security concerns in extension packages until those concerns are understood.
- Design extensions so they can be implemented with zero external dependencies; do not add dependencies by default.

## Layout

- `vendor/quickdraw/`: pinned Git submodule of the `katya4oyu/quickdraw` fork.
- `packages/*`: reusable extension packages, managed as npm workspaces.
- `examples/*`: one small example per package, also npm workspaces. Static files only: no example needs a server.
- `apps/quickdraw`: the app built from all of this — the `omq` command (`quickdraw` is another name for it, for now). `omq serve` serves boards with every package, a relay per board for sync across devices, SQLite persistence and link previews; the other commands list, make, read and edit boards, for people and agents.
- `skills/quickdraw`: the [Agent Skill](skills/quickdraw/SKILL.md) that teaches an agent the `omq` command; `omq skill install` puts it where agents look for skills.

Add a package only when a concrete extension or example is ready to be named; there is no placeholder runtime package.

## Packages

| Package | What it adds | Needs the fork's core? | Other dependencies |
| --- | --- | --- | --- |
| [`quickdraw-yjs`](packages/quickdraw-yjs) | Document sync over Yjs | No — works with upstream `@quickdrawjs/core` | `yjs` (peer) |
| [`quickdraw-export`](packages/quickdraw-export) | Board or selection as a JSON file | No | — |
| [`quickdraw-import`](packages/quickdraw-import) | Validated JSON import | No | — |
| [`quickdraw-frames`](packages/quickdraw-frames) | Frames: membership, aspect ratios, content export | No | — |
| [`quickdraw-layouts`](packages/quickdraw-layouts) | Layouts that keep themselves: a bento grid of frames that packs itself again as cells change | No | `quickdraw-frames` |
| [`quickdraw-markdown`](packages/quickdraw-markdown) | Markdown cards drawn on the canvas | **Yes** — `registerShapeType` ([katya4oyu/quickdraw#2](https://github.com/katya4oyu/quickdraw/pull/2)) | — |
| [`quickdraw-agent`](packages/quickdraw-agent) | What agents can do on a board: reading, undoable operations, and the same as tools for any agent runtime | No (Markdown cards need the fork, like `quickdraw-markdown`) | `quickdraw-frames`, `quickdraw-layouts`, `quickdraw-markdown`, `quickdraw-embed`, `quickdraw-tickets`, `quickdraw-boards` |
| [`quickdraw-toolbar`](packages/quickdraw-toolbar) | Icon toolbar: a rail for adding things, a bar over the selection; the packages ship their items | No | — |
| [`quickdraw-embed`](packages/quickdraw-embed) | Allowed web pages and sandboxed inline HTML as live iframes; link cards with Open Graph previews | **Yes** — `registerShapeType` | — |
| [`quickdraw-screenshare`](packages/quickdraw-screenshare) | One person shares a screen, everyone watches it live, and snapshots land on the board to write feedback on | No | `quickdraw-frames` |
| [`quickdraw-presence`](packages/quickdraw-presence) | Who is on a board: cursors with names, colours and statuses (an agent's says what it is doing), following someone, arrows at the edge for those out of sight | No | — |
| [`quickdraw-tickets`](packages/quickdraw-tickets) | Tickets people leave for agents, and a kanban (Todo / Doing / Done frames) that follows their status | **Yes** — `registerShapeType` | `quickdraw-frames` |
| [`quickdraw-members`](packages/quickdraw-members) | The agents of a board and their roles (transcriber, researcher, reviewer…), a table in the board's Yjs document that people and agents both edit, and profile cards on the board that show it | Cards only — `registerShapeType` | `yjs`, `quickdraw-frames` |
| [`quickdraw-gif`](packages/quickdraw-gif) | Animated GIFs that move on the board (the canvas alone shows their first frame) | No | — |
| [`quickdraw-clipboard`](packages/quickdraw-clipboard) | Copy and paste through the browser's clipboard events (any browser, plain http too): shapes, their text out, images, SVG code and text in | No | `quickdraw-import` |
| [`quickdraw-boards`](packages/quickdraw-boards) | A board in a board: a card for another board (its picture, Open), or a live window onto it | **Yes** — `registerShapeType` | — |
| [`quickdraw-voice`](packages/quickdraw-voice) | Talk with an agent on a board: a microphone, a WebRTC call straight to a voice model, and a bar with what is said while it works | No | — |

"Needs the fork's core" means the package uses an API that only `katya4oyu/quickdraw` has. On the upstream core, `quickdraw-markdown`, `quickdraw-embed`, `quickdraw-tickets`, `quickdraw-boards` and `quickdraw-members` still load: their `is…Supported()` checks are false, their shapes cannot be created or drawn, and their parsing and validation functions keep working.

## Examples

`npm run examples` serves the repository as static files and prints each example's URL:

| Example | Shows |
| --- | --- |
| `examples/quickdraw-yjs` | Sync across tabs (over a `BroadcastChannel`) and live cursors |
| `examples/quickdraw-export` | Export the board or the selection as JSON |
| `examples/quickdraw-import` | Import a JSON file, with validation |
| `examples/quickdraw-frames` | Frames: add, move with members, export as PNG |
| `examples/quickdraw-layouts` | A bento grid: resize, reorder, drag out or drop in a cell, change the columns |
| `examples/quickdraw-markdown` | Markdown cards drawn on the canvas, edited in place |
| `examples/quickdraw-embed` | A YouTube (or other allowed) page, a link card (with a made-up preview), and sandboxed inline HTML |
| `examples/quickdraw-agent` | Agent participants, panel and note requests, pinned threads, approvals, and undo |
| `examples/quickdraw-toolbar` | The toolbar with two items of its own |
| `examples/quickdraw-screenshare` | A presenter and a viewer side by side: share a tab (or a demo app), watch it live, snapshot it onto the board |
| `examples/quickdraw-presence` | Two people side by side and an agent going from note to note: name yourself, follow someone, find them by the arrow at the edge |
| `examples/quickdraw-tickets` | A kanban with tickets: add one from the rail, drag it between columns, and a stand-in agent that takes and finishes them |
| `examples/quickdraw-gif` | A GIF that moves, and a note over another that keeps it still |
| `examples/quickdraw-clipboard` | ⌘C / ⌘V on a note, text and SVG code pasted in |
| `examples/quickdraw-voice` | The voice bar on a made-up call: calling, what is said as it comes, mute and hang up (no microphone or agent needed) |

## App

`npm run dev` runs `omq serve` from [`apps/quickdraw`](apps/quickdraw): boards with every package, synced across devices, kept in `~/.quickdraw`.

## License

MIT — see [LICENSE](LICENSE). The Quickdraw core in `vendor/quickdraw` has its own MIT license.
