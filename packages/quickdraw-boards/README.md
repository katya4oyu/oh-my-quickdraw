# quickdraw-boards

A board in a board. A **board card** is a shape for another board: its title, a picture of it and an **Open** button — or, made **live**, a window onto it that shows it as it is now, as people draw on it (read only; double-click it to pan and zoom inside, a click elsewhere or Esc gives it back).

```js
import { bindBoardCards, boardCardTools, createBoardCard, registerBoardCard, validateBoardCard } from 'quickdraw-boards'

const host = {
  boards: async () => [{ id, title, thumbnailAt }],          // the boards a card may show (asked again every minute)
  thumbnail: (id, at) => `/api/boards/${id}/thumbnail?at=${at}`, // a board's picture (null for none)
  view: (id) => `/b/${id}/view`,                              // a page that shows the board, read only (the live window)
  open: (id) => { location.href = `/b/${id}` },
  current: thisBoardId,                                       // not offered as a card of itself
}
bindBoardCards(editor, host)             // pictures, Open buttons, live windows (at most 4 at once)
const tools = boardCardTools(host)       // the rail's "A board in this board" menu; Live view / Open on a card
```

Record: `{ type: 'boardcard', props: { board, title, w, h, live } }` (`title` as it was when the card was made; the host's, when it knows the board). It needs the fork's `registerShapeType`; `validateBoardCard` is for `quickdraw-import`.

A live window is the host's own read-only page in an iframe (scripts and its own origin, for its connection; no forms, popups or top navigation). Cards inside a live window stay pictures, so boards that show each other never nest windows without end.

`apps/quickdraw` serves that page at `/b/ID/view` (no tools, no presence: it only listens, and keeps the whole board in view until someone pans or zooms in it), and gives agents `omq board-card ID [--live]` and the `board` step.
