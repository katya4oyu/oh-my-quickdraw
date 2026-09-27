# quickdraw-import

Board import for Quickdraw. Reads JSON in the core's clipboard format — `{ quickdraw: 1, shapes, assets }` — which is also what `quickdraw-export` writes. Zero dependencies beyond `@quickdrawjs/core` (a peer).

```js
import { openJSON, importJSON, parseJSON } from 'quickdraw-import'

await openJSON(board.editor)          // file picker → import; [] when cancelled
importJSON(board.editor, data)        // an already-parsed object
parseJSON(data)                       // validate only: { shapes, assets } or throws

// shape types from other packages are rejected unless you pass their validator
openJSON(board.editor, { types: { markdown: validateMarkdown } }) // from quickdraw-markdown
```

Imported shapes get fresh ids, stack on top, center in the view, land as one undo step, and end up selected.

## Untrusted files

An imported shape is synced to every peer, so a file is validated as a whole before anything touches the board; one bad shape rejects the file.

- Known shape types only, finite positions, and style values from the core's own `COLOR_IDS`, `SIZE_IDS`, `DASH_IDS`, `FILL_IDS`, `GEO_IDS` and `FONTS`.
- Each type's required geometry must be present and numeric (`pts`, `w`/`h`, `dx`/`dy`, ...).
- Image assets must be inline `data:` PNG, JPEG, GIF or WebP — no remote URLs, no SVG. Unreferenced assets are dropped.
- At most 5000 shapes and 25 MB per file.
- Other shape types only through `types`: `{ [type]: (shape) => error | null }`. They still get the common checks (record shape, finite position, props object); the function checks the props.

Example: `examples/quickdraw-import` (run `npm run examples` at the workspace root).

Toolbar item: `importTool({ types })` is a menu entry for [`quickdraw-toolbar`](../quickdraw-toolbar) — a plain object, no dependency on it.
