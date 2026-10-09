# quickdraw-groups

Groups for Quickdraw: shapes that are selected and moved as one, built from plain records — no core change, no dependencies beyond `@quickdrawjs/core` (a peer) and `quickdraw-frames`.

```js
import { bindGroups, bindGroupSelection, groupShapes, ungroup, groups } from 'quickdraw-groups'

bindGroups(board.editor.store)       // moving one member moves the rest (any store: agents and the CLI too)
bindGroupSelection(board.editor)     // on a page: a click selects the group; Cmd/Ctrl+G groups, with Shift ungroups
const id = groupShapes(store, ['shape:a', 'shape:b'], { name: 'pair' })
ungroup(store, id)                   // or the id of a member; the shapes stay where they are
groups(store)                        // [{ id, name?, members: [shape ids] }]
```

## Model

- A member carries `groupId` (and `groupName`, when it has one) and its own id as `groupSelf`. A shape is in one group; a group holds shapes, not frames (a frame already holds what is in it), their titles, or arrows' labels.
- A copy keeps these fields under a new id — `groupSelf` no longer matches — and becomes a group of its own, named the same on every page (`group:copy-<its lowest id>`).

## Rules

- `bindGroups` (any store): a member that moved, with the same size and turn, moves the others by as much, unless they moved in the same change (a joint drag, an undo) — one undo step with it. Resizing a member does not move the rest.
- `bindGroupSelection` (a page): selecting a member selects the group, and each group selected whole shows a dashed outline just outside the selection box with a tag naming it ("Group" when it has no name; a long name is cut with …) — only with the select tool, as the selection box. Selecting a member selects the group, so dragging, resizing, deleting and copying act on all of it; shift-click on a selected member takes the whole group off the selection. Cmd/Ctrl+G groups the selection (two shapes or more), Shift+Cmd/Ctrl+G ungroups it.
- A drawing from an SVG (`quickdraw-agent`'s `omq draw`) makes a group of each top-level `<g>` (`group:<frame id>:<its id>`); drawing it again keeps them.

Not done: changing one member of a group without the others (no "enter the group" yet): ungroup first.
