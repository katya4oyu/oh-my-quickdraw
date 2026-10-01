# quickdraw-layouts

Layouts that keep themselves for Quickdraw: an area on the board whose frames stay laid out as they change. The first kind is a **bento grid** — cells of whole units (1 × 1, 2 × 1, 2 × 2…) packed with no gaps; widen, shrink, delete or reorder one and the rest pack again, and the area grows or shrinks to hold them. Built from plain records on [`quickdraw-frames`](../quickdraw-frames), no core change, no dependencies beyond `@quickdrawjs/core` (a peer).

```js
import { bindFrames } from 'quickdraw-frames'
import { bindLayouts, createLayout, addCell, setSpan, setColumns } from 'quickdraw-layouts'

bindFrames(board.editor.store)
bindLayouts(board.editor.store)                          // once, after bindFrames
const area = createLayout(store, { x, y, w: 1200, cols: 4, gap: 24 })
const main = addCell(store, area, { c: 2, r: 2, title: 'Main' })   // a frame
addCell(store, area, { title: 'Notes', auto: true })    // rows follow what is in it
setSpan(store, main, { c: 3 })                           // the others move along
setColumns(store, area, 6)
```

## Model

- An **area** is an unfilled, dashed `geo` rectangle with `isLayout: true`, `frameless: true` (frames never take it in) and `layout: { type: 'bento', cols, gap }`. Its width is fixed: a unit is `(w - 32 - gap × (cols - 1)) / cols`, square. Its height follows its cells.
- A **cell** is a quickdraw-frames frame with `layoutId`, `span: { c, r, auto? }` and `order`. What is in it stays its member (`frameId`), so it moves with the cell. Rows leave room for the cells' titles.
- `packBento(cells, cols)` is the packing alone, pure: each cell in order at the first free spot it fits (CSS Grid's dense flow); wider cells are cut to the grid.

## Rules (`bindLayouts`, local edits only — peers apply their own)

- **Resize a cell**: it snaps to whole units on release, never smaller than what is in it.
- **Drag a cell** onto another's place: it goes there in the order. Dragged out of the area, it is a plain frame again; a frame dropped into an area becomes a cell at its size in units.
- **Delete a cell**: the rest close up.
- **An `auto` cell** grows and shrinks in rows with what is in it.
- **The area**: moving it moves its cells and what is in them; resizing its width changes the unit (contents keep their size); its height always follows its cells; deleting it leaves its cells as plain frames.
- Nothing packs mid-gesture: a drag or resize settles on release, and the follow-up folds into the same undo step. Undo and redo bring back the layout as it was.

## Not covered yet

- Commands and tools for agents, and `lint` / `tidy` knowing areas.
- Copying a whole area (its cells keep pointing at the original).
- Pushing aside what lies outside an area when it grows.
- Nested layouts (a grid inside a cell).

Example: `examples/quickdraw-layouts` (run `npm run examples` at the workspace root).

Toolbar items: `layoutTools()` returns `{ rail, context }` for [`quickdraw-toolbar`](../quickdraw-toolbar) — plain objects, no dependency on it.
