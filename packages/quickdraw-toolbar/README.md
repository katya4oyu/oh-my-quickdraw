# quickdraw-toolbar

An icon toolbar for Quickdraw extensions, in the core's own look — no core change, no dependencies.

- **The rail**, a vertical pill on the right edge (mirroring the core's action bar on the left): always there, for putting things on the board, plus a menu for board-wide actions.
- **The selection bar**, a small pill floating above the selected shape and following it, with actions for that kind of shape only. It hides while you drag, and clears the core's rotate handle.
- **Tooltips** for every icon button on the board (the core's tools too): its `title`, in a moment with a mouse or pen (the browser's own comes late, or not at all), at once when moving on to the next button, beside a vertical bar and below (or above) a horizontal one. None with touch. `createTooltips(container)` gives them to a board without the toolbar.
- **Labels mode**, for a phone (nothing hovers there): the rail's and the selection bar's buttons show their names all the time — beside the rail, and under each icon on the selection bar (which wraps to fit). `labelsTool()` is a menu entry that turns it on and off ("Show button names"), kept per device; `setLabels(container, on)` sets it from code.

```js
import { createToolbar, MORE_ICON } from 'quickdraw-toolbar'
import { frameTools } from 'quickdraw-frames'
import { markdownTools } from 'quickdraw-markdown'
import { embedTools } from 'quickdraw-embed'
import { importTool } from 'quickdraw-import'
import { exportTool } from 'quickdraw-export'

const frames = frameTools(), cards = markdownTools(), web = embedTools(embeds, { fetchPreview })
createToolbar(board.editor, {
  rail: [...frames.rail, ...cards.rail, ...web.rail, '-',
    { id: 'more', title: 'More', icon: MORE_ICON, menu: [importTool({ types }), exportTool()] }],
  context: [...frames.context, ...cards.context, ...web.context],
})
```

## Items

Plain objects, so extension packages describe their buttons without depending on this package:

```js
{
  id: 'frame-rename', title: 'Rename frame', icon: '<svg …>',
  run({ editor, shape, anchor }) {},     // or menu: [items] | (ctx) => [items]
  available(editor) { return true },     // rail: hide when false (e.g. an unsupported core)
  when(shape, editor) { return true },   // selection bar: show for this selected shape
  checked(ctx) { return false },         // menu entries: a check mark
}
```

`'-'` is a divider. The selection bar shows only when exactly one shape is selected and some item's `when` holds for it.

## Look

It lives inside the core's `.qd-ui` and reuses its classes (`.qd-actions`, `.qd-tool`, `.qd-popover`, `.qd-menu-item`) and theme variables, so it follows light/dark and hides with the core's UI. Move the rail with `--qdx-rail-right`. Icons are drawn on the core's grid (24px, 2px stroke).

Example: `examples/quickdraw-toolbar` (run `npm run examples` at the workspace root); `apps/quickdraw` uses it with every package.
