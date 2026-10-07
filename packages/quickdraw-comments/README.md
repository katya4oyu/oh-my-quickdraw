# quickdraw-comments

Comment threads on a Quickdraw board's frames, for what a drawing is meant to say. An agent writes in a frame's thread when it cannot decide something on its own — what to leave out, what to make stand out, what to do when text does not fit the boxes — and says what it did meanwhile; people answer there; and whoever works on that drawing next, a person or an agent, reads the thread first. What was meant and what was agreed stays with the drawing, not in anyone's memory.

The threads are kept in the board's Yjs document (a map named `comments` beside the board's own), not as shapes: they sync, persist and go into the board's versions. One thread per frame, by the frame's id; a comment is `{ id, by, text, at }`.

```js
import { bindComments, createComments, commentTools, commentsText } from 'quickdraw-comments'

const comments = bindComments(ydoc)
comments.add(frameId, 'Left the test-env note out: a fourth cause would not fit. Keep it out?', 'Codex')
comments.list(frameId)   // [{ id, by, text, at }], oldest first
comments.frames()        // the frames that have a thread
comments.remove(frameId, commentId)
comments.onChange(() => render())

commentsText(store, comments)               // the threads as an agent reads them (Markdown), '' when none
commentsText(store, comments, { frames: [frameId] })
```

Text is kept to 2000 characters; a thread goes when its last comment is removed. Threads of frames no longer on the board stay in the document (undo may bring the frame back) and are left out of `commentsText`.

## On the board

`createComments({ editor, comments, me })` puts a marker on the top-right corner of every frame that has a thread (with how many comments) and opens the thread beside it — to the right, else the left, kept on the screen; a sheet along the bottom on a board narrower than 560 px. In the thread you read, reply (⌘/Ctrl+Enter sends) and delete your own comments. `commentTools(view)` gives a selected frame a **Comment** button (for [`quickdraw-toolbar`](../quickdraw-toolbar)), which opens its thread to write the first one. The look follows the core's theme variables; `--qdc-accent` colours the Send button.

`apps/quickdraw` gives agents the threads: `omq read` and `read_board` end with them, `omq comment FRAME_ID "…"` and the `add_comment` tool write one, `omq comments [--frame ID]` lists them.
