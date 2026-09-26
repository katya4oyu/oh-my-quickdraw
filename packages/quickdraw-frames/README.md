# quickdraw-frames

Excalidraw-style frames for Quickdraw (one level, no nesting), built from plain records — no core change, no dependencies beyond `@quickdrawjs/core` (a peer).

```js
import { bindFrames, createFrame, frameShapeIds } from 'quickdraw-frames'

bindFrames(board.editor.store)                        // once, before editing
const id = createFrame(board.editor.store, { x, y, w, h, title: 'Plan' })
const png = await board.editor.exportImage({ ids: frameShapeIds(board.editor.store, id) })
```

## Model

- A frame is a `geo` rectangle with `isFrame: true` — solid grey outline, no fill, sent to the back. Being unfilled, it is picked by its edge; clicks inside reach its members.
- Its title is a `text` shape with id `<frameId>-title`, placed above the top-left corner.
- Members (the title included) carry `frameId`.

## Rules (`bindFrames`, local edits only — peers apply their own)

- A shape added or moved with its center inside a frame joins it (topmost frame wins); moved out, it leaves.
- Moving a frame moves its members, except those moved in the same change. The follow-up folds into the same undo step, including for keyboard nudges.
- Resizing a frame re-checks membership.
- Deleting a frame deletes its title and releases its members.

## Not covered

- No clipping, and a frame looks like a plain rectangle: both would need a core drawing hook.
- `quickdraw-import` gives imported shapes fresh ids without remapping `frameId`, so an imported frame loses its title link; its members rejoin by position when moved.
