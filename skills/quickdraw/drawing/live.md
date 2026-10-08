# Live: drawing a meeting as it goes

You are on the board while people talk (`join`), and turn what comes in into a picture that grows with the meeting: a graphic recording. Read `visual-thinking.md` first.

What reaches you: requests and replies from `wait`, the notes people write (`changes`, `wait`'s `changes`), and the person who started you when they talk with you directly (typing, or a voice call). That is your transcript; you hear nothing else. When you are asked to record and little comes in, say so in the thread (`say`) and ask what to capture.

## 1. Lay out the canvas once

Before the first item, mark out one area and split it, so everything later has a place:

```sh
omq area 2400 1400 --title "Meeting · 2026-10-06"
```

```
┌───────────────────────────── title band: theme, date, who ─────────────────────────────┐
│ flow: topics left → right, one column per topic                     │ decided          │
│                                                                     │ open questions   │
│                                                                     │ actions (who/when)│
└─────────────────────────────────────────────────────────────────────┴──────────────────┘
```

- Title band: a small SVG — the theme (34 px), the date and the people under it (14 px). A working title until the theme is clear; then change the SVG and draw it again (`omq svg title.svg --replace FRAME_ID`).
- Flow: the conversation in order. A bento grid with a column per topic works well (`omq bento --cols 4`), or frames in a row.
- The right column: three frames — **Decided** (green), **Open** (red), **Actions** (blue, "who: what, by when"). These are what people look for after the meeting; collect them here as they happen, wherever they were said.

## 2. Add as it happens

For each thing that comes in:

1. Sort it (`visual-thinking.md`, Think): which kind, which topic.
2. A new topic: a new column or frame in the flow, its title a keyword.
3. Put it in its topic as a keyword: a note people can move, or a line in the topic's SVG — keep one SVG per topic and draw it again with `--replace` as the topic grows (only what is new is drawn). Evidence or a quote next to it, a speaker's figure when who said it matters.
4. A decision, an open question or an action: also in its column on the right.
5. When a relation shows (this causes that, these two conflict), draw it: an arrow in the topic's SVG, or redraw the topic as its pattern (`patterns.md`) once enough of it is there.

Keep up rather than perfect: a keyword now beats a polished drawing after the topic has moved on. Add, do not rewrite: people are reading as you go. Mark what changed meaning (a `pen points` line through it, another colour) rather than deleting it.

## 3. Close

When the meeting ends, or when asked:

1. Fill the title band: the theme in one line, and the **three points** to remember.
2. Check that every decision and action is in the right column, with who and when.
3. `omq look` at the area (`visual-thinking.md`, Check), and `omq lint` it for the notes and frames.
4. `finish` with what is on the board, and say where the decisions and actions are.
