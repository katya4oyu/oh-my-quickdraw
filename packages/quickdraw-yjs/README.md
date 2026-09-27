# quickdraw-yjs

Optional Yjs document synchronization for Quickdraw. `yjs` is a peer dependency of this package only; Quickdraw core stays dependency-free.

```js
import * as Y from 'yjs'
import { bindYjs } from 'quickdraw-yjs'

const ydoc = new Y.Doc()
const unbind = bindYjs(board.editor.store, ydoc) // pair ydoc with any Yjs provider
```

- Records are stored whole in `ydoc.getMap('quickdraw')` (override with `{ name }`); concurrent edits to the same record resolve last-writer-wins.
- On bind, an empty shared map is seeded from the store; otherwise the store loads the shared state.
- Local edits, including undo/redo, go to Yjs. Remote changes apply as `'remote'` and stay out of local undo history.

Example: `examples/quickdraw-yjs` — run `npm run examples` at the workspace root, then open the printed URL in two tabs: they sync over a `BroadcastChannel`, no server. Across devices you need a transport; `apps/quickdraw` (`quickdraw serve`) has a dependency-free WebSocket relay at `/ws` that persists the board in SQLite (`node:sqlite`).
