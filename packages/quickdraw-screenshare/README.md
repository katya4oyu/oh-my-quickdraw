# quickdraw-screenshare

Screen sharing on a Quickdraw board, for reviewing something together. One person shares a tab or window, and everyone on the board sees it live in a small window over the board. Anyone can take a **snapshot**: that moment lands on the board as a still in a frame of its own, for everyone to draw and write on. What people put on a snapshot is its **feedback**, which an app can hand on (to an agent, say) and mark as sent.

```js
import { createScreenShare, screenShareTools, pendingFeedback, markSent } from 'quickdraw-screenshare'

const share = createScreenShare({ editor: board.editor, host })   // host: below
createToolbar(board.editor, { rail: [{ id: 'more', menu: [...screenShareTools(share).menu] }] }) // quickdraw-toolbar

share.start()      // the browser asks which tab or window; share.stop() ends it
share.snap()       // a snapshot: taken here when sharing, else asked of the sharer
share.letAgents(true) // the sharer lets the board's agents see it (share.agents, share.watching)

pendingFeedback(board.editor.store) // [{ frameId, title, at, by, imageId, shapeIds, key, pending }]
markSent(board.editor.store, ids)   // …until something changes on them again
```

Needs `quickdraw-frames` (a snapshot is a frame) and `@quickdrawjs/core` (a peer).

## The host

The package does not know how pages reach each other. The host carries its messages, over a relay, a WebRTC data channel or anything else:

```js
const host = {
  me: () => ({ name: 'Ann' }),
  send(message) {},        // { kind: 'start', name } | { kind: 'stop' } | { kind: 'snap', by }: to the others ('snap' to the sharer)
  sendFrame(jpeg) {},      // a live frame, a Uint8Array; the host may drop frames
  canSend: () => true,     // optional: false while the last frame is still on its way (e.g. ws.bufferedAmount > 0)
  onMessage(fn) {},        // fn({ kind: 'sharing', sharer: { name } | null, mine })
                           //  | fn({ kind: 'frame', data }) | fn({ kind: 'snap', by }); may return an unsubscribe
}
```

The host decides who is sharing, one at a time. It says so to every page with `sharing`, including to the sharer (`mine: true`). When someone else starts sharing, the page that was sharing stops by itself. Frames are sent only while `canSend()` holds, so a slow connection gets fewer frames, never a backlog.

`apps/quickdraw` hosts it over its relay.

## Live

- **Sharing**: `getDisplayMedia` with the browser tab preferred, and without the board's own tab. Only secure pages can share: `https` or `http://localhost`, on a computer. Everyone else, phones included, can watch.
- **Frames**: JPEG frames, 1280px on the long side at q0.7, at most every 150ms (`live: { maxSide, quality, every }`). That is enough to follow someone using an app; it is not video.
- **The window**: it sits in the core's `.qd-ui` in the core's theme. Move it by its header, widen it by its corner, and fold it away. On a phone, it spans the top of the screen, clear of the core's tools at the bottom. Keys, paste and wheel in it stay out of the board.

## Agents watching

The sharer may let the agents on the board see the screen: **Let AI see** in the window's header (`share.letAgents(on)`, sent as `{ kind: 'agents', allow }`). It is off at each new share. While it is on, everyone's window says so, with the names of the agents watching (the host's `sharing` message carries `agents` and `watching`). What agents do with it is the host's: `apps/quickdraw` tells watching agents when the screen has changed, gives them its latest frame, and lets them ask for a snapshot, which the sharer's page takes for them as for a person.

## Snapshots

- **Taken by the sharer's page**, from its own video at full size: 1920px on the long side at q0.85 (`snapshot: { maxSide, quality }`), whoever pressed the button. The frames sent to watchers are never used for a snapshot.
- **Placed with `placeSnapshot(editor, { src, w, h }, { title, by, at })`**: a frame holding the still (shown at most 720 wide), with room on the right for notes. The first goes in the middle of the view, and each next one to the right of the last. The title is the time and who asked for it.
- **Marked on the frame record**: `snapshot: { at, by, imageId, sent? }`. It is synced, saved and exported with the board, and needs nothing on a server.
- **Feedback**: `snapshotFeedback(store, frameId)` lists the shapes in the frame other than the still and the title: notes, pen strokes, arrows. It also gives a `key` for what they are now. `pending` means there is something that was not sent. `markSent(store, ids)` records the key, so a snapshot comes back into `pendingFeedback` only when its feedback changes.

Example: `examples/quickdraw-screenshare`. It puts two boards side by side, a presenter and a viewer, with the host wired between them. "Share a demo app" works in any browser.
