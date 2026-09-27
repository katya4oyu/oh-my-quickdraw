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
- `examples/*`: runnable examples, also managed as npm workspaces. Each package has a small example of its own; `examples/demo` puts everything together.

Add a package only when a concrete extension or example is ready to be named; there is no placeholder runtime package.

## Packages

| Package | What it adds | Needs the fork's core? | Other dependencies |
| --- | --- | --- | --- |
| [`quickdraw-yjs`](packages/quickdraw-yjs) | Document sync over Yjs | No — works with upstream `@quickdrawjs/core` | `yjs` (peer) |
| [`quickdraw-export`](packages/quickdraw-export) | Board or selection as a JSON file | No | — |
| [`quickdraw-import`](packages/quickdraw-import) | Validated JSON import | No | — |
| [`quickdraw-frames`](packages/quickdraw-frames) | Frames: membership, aspect ratios, content export | No | — |
| [`quickdraw-markdown`](packages/quickdraw-markdown) | Markdown cards drawn on the canvas | **Yes** — `registerShapeType` ([katya4oyu/quickdraw#2](https://github.com/katya4oyu/quickdraw/pull/2)) | — |
| [`quickdraw-embed`](packages/quickdraw-embed) | Allowed web pages and sandboxed inline HTML as live iframes; link cards with Open Graph previews | **Yes** — `registerShapeType` | — |

"Needs the fork's core" means the package uses an API that only `katya4oyu/quickdraw` has. On the upstream core, `quickdraw-markdown` and `quickdraw-embed` still load: `isMarkdownSupported()` / `isEmbedSupported()` are false, their shapes cannot be created or drawn, and their parsing and validation functions keep working.

## Examples

`npm run dev` starts one server for all examples (static files, plus the Yjs relay with SQLite persistence) and prints their URLs:

| Example | Shows |
| --- | --- |
| `examples/quickdraw-yjs` | Sync across tabs and devices, persistence, live cursors |
| `examples/quickdraw-export` | Export the board or the selection as JSON |
| `examples/quickdraw-import` | Import a JSON file, with validation |
| `examples/quickdraw-frames` | Frames: add, move with members, export as PNG |
| `examples/quickdraw-markdown` | Markdown cards drawn on the canvas, edited in place |
| `examples/quickdraw-embed` | A YouTube (or other allowed) page, a link card, and sandboxed inline HTML; `/preview` proxy for link previews |
| `examples/demo` | All of the above on one synced board |
