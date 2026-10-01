# quickdraw-presence

Who is on a Quickdraw board, drawn over it:

- **Cursors** with each person's name, colour and status. The status (for an agent: what it is doing) is on a line of its own under the name, so a long name never hides it; near the right edge the labels go to the cursor's left.
- **A row at the top** of everyone here. Press yourself to set your name, colour and status; they are kept in this browser. Press someone else to **follow** them, and press them again (or **Stop**) to stop.
- **Following** a person follows their view. Following an agent (or anyone who does not send a view) pans to its cursor whenever it nears the edge of the screen. Moving the view yourself stops following, and so does the person leaving.
- **Arrows at the edge** for those out of sight, pointing the way. Press one to go there.

```js
import { createPresence } from 'quickdraw-presence'

const presence = createPresence({ editor: board.editor, host, defaults: { name: 'Mac' } }) // host: below

presence.me()                        // { name, color, status }
presence.setMe({ status: 'away' })   // as from the row; saved and sent
presence.follow(id)                  // or null
presence.resend()                    // after a reconnect
presence.clear()                     // on a disconnect: everyone else has gone
```

## The host

The package does not know how pages reach each other. The host carries each page's presence, over a relay, a WebRTC data channel or anything else:

```js
const host = {
  send(presence) {},  // yours, whenever it changes: { name, color, status, x, y, view }
                      // (page coordinates; x/y null off the board; view is the part of the page on the screen)
  onMessage(fn) {},   // fn({ id, ...presence }) for someone else, fn({ id, gone: true }) when they leave;
                      // may return an unsubscribe
}
```

The host gives each sender an `id`. An agent says `{ agent: true, agentStatus: 'working' | 'waiting' | 'idle' }` in its presence, and what it is doing just now as `agentActivity` — `thinking`, `reading`, `searching`, `running`, `editing`, `imaging`, `drawing`, `waiting` or `done` — with `agentNote` saying on what (a search, a command). Its cursor then moves a little, with no icons: it mulls in a small circle while thinking, sweeps while reading, glances about while searching, nods while busy, bobs while it waits for you, and hops when done; nothing moves with reduced motion. The label says it too, under the name: "searching the web tldraw pricing" (`presenceParts(p)` gives the name, status and note; `presenceLabel(p)` the same in a line). A page that joins late should hear everyone's latest presence (`apps/quickdraw`'s relay keeps them in memory for that).

`defaults` apply until the person sets their own. `storage` (`{ get(key), set(key, value) }`, localStorage by default) and `key` say where they are kept.

The pure parts are exported too: `edgePoint` (where on the screen's edge to show someone), `fitView` and `centreOn` (cameras for following), `wellInside`, `initials`, `presenceLabel`.
