# Snapshots and the shared screen

When people review an app together they share a screen, and snapshots of it land on the board: frames that `read` shows as `(snapshot of a shared screen; …)`, holding a `(screenshot)`. The notes, pen strokes and arrows people put in a snapshot are their **feedback on the app** — the code in your working directory, not the board.

1. `omq read` to find the snapshots and the notes in them.
2. Look at each one: `omq export --format png --frame FRAME_ID --out snap.png`, then view the PNG — it shows what a circle or an arrow points at, which text cannot.
3. Change the code for each point, then say which points you did and which you did not (and why). Do not "answer" on the board unless asked.

**Watching the shared screen** (joined; only when the person sharing lets agents see it, with *Let AI see* in the shared screen's window): `omq screen` says whether someone shares and lets agents see it. `omq screen --watch` and `wait` then also gives `{"type": "screen", "event": "changed", "change": 0.4, …}` when the screen has changed and settled (and `started`, `stopped`, `allowed`, `disallowed`); only the latest waits. Decide from that whether to look: `omq screen --out screen.jpg` writes the screen as it is now (nothing goes on the board) — then read it as you need. Put a moment on the board for people to write on only when it is worth talking about: `omq snap` (a snapshot frame, as a person's Snapshot). `omq screen --unwatch` stops.
