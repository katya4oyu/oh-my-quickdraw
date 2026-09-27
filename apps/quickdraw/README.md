# quickdraw (app)

The app built from this repository's packages: one `quickdraw` command.

```sh
npm link -w apps/quickdraw        # puts `quickdraw` on your PATH (once)
quickdraw serve                   # http://127.0.0.1:8795/
quickdraw note "Idea" --name Me   # edits that board; `quickdraw help` lists the commands
```

## `quickdraw serve`

`quickdraw serve [--port 8795] [--host 127.0.0.1] [--data ~/.quickdraw]`

- **The page** (`web/index.html`): the board with every package, driven by `quickdraw-toolbar`.
- **The packages it imports**, served from wherever Node resolves them (`/_/<package>/src/…`), so it runs from any directory. Only their `src` is served.
- **A relay** at `/ws` for sync across tabs and devices, with live cursors. The protocol is in [`src/protocol.js`](src/protocol.js), shared by the server, the page and the CLI.
- **Persistence**: the board's Yjs updates in `<data>/board.sqlite` (`node:sqlite`), merged as they pile up. The board comes back when no one else is online.
- **Link previews** at `/preview` for `quickdraw-embed`'s link cards, with SSRF guards (https on 443, public addresses on every redirect hop, timeouts, size caps).

It listens on 127.0.0.1. To reach it from other devices, put something in front, such as `tailscale serve --https=8795 http://127.0.0.1:8795`.

## Board commands

`quickdraw read | export | note | text | shape | markdown | frame | arrow | update | move | arrange | delete | apply | log | undo`, on the board `quickdraw serve` runs here, another one (`--board ws://…/ws` or `$QUICKDRAW_BOARD`), or a JSON file (`--file`). They join the board like a browser tab, as one more peer with a cursor, and print JSON. They are built on [`quickdraw-agent`](../../packages/quickdraw-agent)'s operations.

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

A board from the old example server (`examples/quickdraw-yjs/board.sqlite`) carries over: copy the file to `~/.quickdraw/board.sqlite`.

## Development

The Node side is TypeScript that Node runs as is (type stripping, Node ≥ 23.6): no build, and only erasable syntax (no `enum`, no parameter properties). Node does not strip types under `node_modules`, so the command runs from a checkout or `npm link`, not from a registry install. The page stays plain JavaScript that the browser loads as served.

```sh
npm test -w apps/quickdraw
npm run typecheck -w apps/quickdraw
```
