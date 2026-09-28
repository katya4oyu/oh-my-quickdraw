# quickdraw (app)

The app built from this repository's packages: one `quickdraw` command.

```sh
npm link -w apps/quickdraw        # puts `quickdraw` on your PATH (once)
quickdraw serve                   # http://127.0.0.1:8795/ lists the boards
quickdraw new "Sprint 12"         # a board; prints its id and URL
quickdraw note "Idea" --board ID  # edits it; `quickdraw help` lists the commands
```

## `quickdraw serve`

`quickdraw serve [--port 8795] [--host 127.0.0.1] [--data ~/.quickdraw]`

- **Boards**: `/` lists them and makes new ones; `/b/<id>` is a board, with every package, driven by `quickdraw-toolbar`. `GET /api/boards` lists them, `POST /api/boards` (JSON `{ title }`) makes one. A board is only ever made on purpose: an unknown id is refused, never created.
- **The packages it imports**, served from wherever Node resolves them (`/_/<package>/src/…`), so it runs from any directory. Only their `src` is served.
- **A relay per board** at `/ws/<id>` for sync across tabs and devices, with live cursors. The protocol is in [`src/protocol.js`](src/protocol.js), shared by the server, the page and the CLI.
- **Agents on a board**, through the same relay: an agent joins with a name and what it knows, and the page's AI panel ([`quickdraw-agent`](../../packages/quickdraw-agent)) lists it and sends it requests. The server passes requests to the agent they are addressed to, and the agent's events (progress, messages, approvals, operations with their diffs) to every page; a person's replies and approvals go back to the agent. It keeps each request's thread, so a page that reloads — or another device — sees it as it was, including what was undone. An agent that leaves ends what it was doing with an error in the thread. It does not know or start what an agent runs on.
- **Persistence**: the boards and their Yjs updates in `<data>/boards.sqlite` (`node:sqlite`), merged per board as they pile up, and the agents' threads beside them (not in the board's document). A board comes back when no one else is online.
- **Link previews** at `/preview` for `quickdraw-embed`'s link cards, with SSRF guards (https on 443, public addresses on every redirect hop, timeouts, size caps).

It listens on 127.0.0.1. To reach it from other devices, put something in front, such as `tailscale serve --https=8795 http://127.0.0.1:8795`.

## Board commands

`quickdraw boards | new | read | export | note | text | shape | markdown | frame | arrow | update | move | arrange | delete | apply | log | undo`. They join a board like a browser tab, as one more peer with a cursor, and print JSON.

- **Which board**: `--board` takes an id, the page URL (`https://host/b/<id>`, as the browser shows it) or the relay URL (`ws://host/ws/<id>`); or `$QUICKDRAW_BOARD`; or `--file` for a JSON file. Ids are looked up on `--server` / `$QUICKDRAW_SERVER`, by default this machine's `quickdraw serve`. Without a board, the server's only board is used; with several, the command fails and lists them — it never makes one up. They are built on [`quickdraw-agent`](../../packages/quickdraw-agent)'s operations.

- **Undo**: each operation's diff goes to `.quickdraw/log.jsonl` in the working directory (or `$QUICKDRAW_LOG`); `undo` reverts what nobody changed since and reports the rest.
- **PNG** (`export --format png`): drawn by the core itself in a headless Chrome already on the machine — see below.

Agents learn the commands from the [Agent Skill](../../skills/quickdraw/SKILL.md): link or copy `skills/quickdraw` into the agent's skills folder (for Claude Code, `.claude/skills/quickdraw`).

### PNG export and the machine it runs on

- **Out of sight**: `--headless=new`, no window, focus, mouse or keyboard; on macOS it registers as a background-only app (not in the Dock or ⌘Tab).
- **Separate from the user's Chrome**: a throwaway profile (removed after), no extensions, sync, background networking or keychain.
- **No ports**: driven over a pipe (`--remote-debugging-pipe`); the page's code is served from disk through DevTools request interception, and every other request is refused.
- **Reused, without leaks**: one Chrome per `Renderer`; each render gets its own browser context and page, disposed afterwards; Chrome closes after 30 s idle and restarts every 100 renders. A command reuses it for every image it writes (e.g. `--frame all`) and closes it at the end.
- **Never outlives its process**: Chrome runs in its own process group, and a one-line shell watchdog ends it and removes its profile if the Node process dies without cleaning up (SIGKILL, SIGINT, SIGTERM). Stale profiles older than a day are swept on the next launch.
- **Smaller**: no GPU process, one renderer process, background features off.

## Moving from the old example server

A board from the old example server (`examples/quickdraw-yjs/board.sqlite`) carries over: copy the file to `~/.quickdraw/board.sqlite`. The next `quickdraw serve` takes it in as a board called "Board" and renames the file to `board.sqlite.imported`.

## Development

The Node side is TypeScript that Node runs as is (type stripping, Node ≥ 23.6): no build, and only erasable syntax (no `enum`, no parameter properties). Node does not strip types under `node_modules`, so the command runs from a checkout or `npm link`, not from a registry install. The page stays plain JavaScript that the browser loads as served.

```sh
npm test -w apps/quickdraw
npm run typecheck -w apps/quickdraw
```
