# quickdraw-export

Board export for Quickdraw beyond the core's PNG export. Zero dependencies.

```js
import { exportJSON, downloadJSON } from 'quickdraw-export'

downloadJSON(board.editor)                                // whole board → quickdraw-<time>.json
downloadJSON(board.editor, { ids: board.editor.selection }) // just the selection
const data = exportJSON(board.editor.store)               // the object, for your own saving
```

The JSON is the payload the core already copies to the clipboard — `{ quickdraw: 1, shapes, assets }` — so a file's contents paste straight into any Quickdraw board. Shapes come out back-to-front, with only the image assets they reference.

Example: `examples/quickdraw-export` (run `npm run dev` at the workspace root).

Toolbar item: `exportTool()` is a menu entry for [`quickdraw-toolbar`](../quickdraw-toolbar) — a plain object, no dependency on it.
