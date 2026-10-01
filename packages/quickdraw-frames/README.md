# quickdraw-frames

Excalidraw-style frames for Quickdraw — frames nest — built from plain records — no core change, no dependencies beyond `@quickdrawjs/core` (a peer).

```js
import { bindFrames, createFrame, frameShapeIds, freeSpot } from 'quickdraw-frames'

bindFrames(board.editor.store)                        // once, before editing
const id = createFrame(board.editor.store, { x, y, w, h, title: 'Plan' })
renameFrame(board.editor.store, id, 'Ideas')          // frameTitle(store, id) reads it back
const png = await board.editor.exportImage({ ids: frameShapeIds(board.editor.store, id) })
const at = freeSpot(board.editor.store, 800, 500, { x, y })  // room for a new frame (and its title) by x, y, clear of what is there
```

## Model

- A frame is a `geo` rectangle with `isFrame: true` — solid grey outline, no fill, sent to the back. Being unfilled, it is picked by its edge; clicks inside reach its members.
- Its title is a `text` shape with id `<frameId>-title`, placed above the top-left corner — or just inside it when the frame has `titleInside` (`createFrame({ titleInside: true })`, `setTitleInside(store, id, true)`, **Title inside** on the selection bar), handy for a frame in a frame or one with something just above it. Above is the default: the whole frame is left to what is in it (a slide, a snapshot). `titleSpot(frame)` says where it goes.
- Members (the title included) carry `frameId`.
- **Frames nest.** A frame (or a `quickdraw-layouts` area) wholly inside another frame is its member; anything else belongs to the innermost frame holding its centre. A frame in a frame stays above it. Moving a frame moves what is in it and what is in the frames in it; deleting one hands its members to the frame around it; copying one alone copies the frames in it too. `frameShapeIds` and `exportFrame` take in the frames inside; `inFrame(store, shape, frameId)` says whether a shape is in a frame at any depth, `parentFrame(store, frame)` gives the frame a frame is in.
- A frame keeps its own id in `frameKey`, and its title is marked `isFrameTitle`. Copies — the core's duplicate, paste, or `quickdraw-import` — keep these fields under new ids, which is how a copy is recognized.

## Rules (`bindFrames`, local edits only — peers apply their own)

- A shape added or moved with its center inside a frame joins it (topmost frame wins); moved out, it leaves. A shape marked `frameless: true` never joins one.
- Moving a frame moves its members, except those moved in the same change. The follow-up folds into the same undo step, including for keyboard nudges.
- Resizing a frame re-checks membership.
- Deleting a frame deletes its title and releases its members.
- A copied frame goes to the back and gets its own title. Copied alone, it also gets copies of the original's members; copied together with members (or imported), it adopts those instead.
- Frames made before `frameKey` existed are not recognized when copied; recreate them to get this.

## Not covered

- No clipping, and a frame looks like a plain rectangle: both would need a core drawing hook.

Example: `examples/quickdraw-frames` (run `npm run examples` at the workspace root).

Toolbar items: `frameTools()` returns `{ rail, context }` for [`quickdraw-toolbar`](../quickdraw-toolbar) — plain objects, no dependency on it.
