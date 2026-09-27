# quickdraw (app)

The app built from this repository's packages: one `quickdraw` command.

```sh
npm link -w apps/quickdraw        # puts `quickdraw` on your PATH (once)
quickdraw serve                   # http://127.0.0.1:8795/
```

## `quickdraw serve`

`quickdraw serve [--port 8795] [--host 127.0.0.1] [--data ~/.quickdraw]`

- **The page** (`web/index.html`): the board with every package, driven by `quickdraw-toolbar`.
- **The packages it imports**, served from wherever Node resolves them (`/_/<package>/src/…`), so it runs from any directory. Only their `src` is served.
- **A relay** at `/ws` for sync across tabs and devices, with live cursors. The protocol is in [`src/protocol.js`](src/protocol.js), shared by the server, the page and the CLI.
- **Persistence**: the board's Yjs updates in `<data>/board.sqlite` (`node:sqlite`), merged as they pile up. The board comes back when no one else is online.
- **Link previews** at `/preview` for `quickdraw-embed`'s link cards, with SSRF guards (https on 443, public addresses on every redirect hop, timeouts, size caps).

It listens on 127.0.0.1. To reach it from other devices, put something in front, such as `tailscale serve --https=8795 http://127.0.0.1:8795`.

A board from the old example server (`examples/quickdraw-yjs/board.sqlite`) carries over: copy the file to `~/.quickdraw/board.sqlite`.

## Development

The Node side is TypeScript that Node runs as is (type stripping, Node ≥ 23.6): no build, and only erasable syntax (no `enum`, no parameter properties). Node does not strip types under `node_modules`, so the command runs from a checkout or `npm link`, not from a registry install. The page stays plain JavaScript that the browser loads as served.

```sh
npm test -w apps/quickdraw
npm run typecheck -w apps/quickdraw
```
