# Diagram patterns

Each pattern: what it is for, its shape, and an `apply` skeleton. Coordinates are offsets from an origin you pick in free space (`visual-thinking.md`, Place): add the origin's x and y to every `at`. Replace the labels; keep the geometry, and widen it when labels are longer. After applying: `lint`, `export`, look (`visual-thinking.md`, Check).

## Flow (sequence, with decisions)

Steps in order; a diamond for a choice. No coordinates needed: `arrange` lays them out.

```json
[
  { "do": "shape", "shape": "rectangle", "text": "Sign up", "ref": "a" },
  { "do": "shape", "shape": "rectangle", "text": "Verify email", "ref": "b" },
  { "do": "shape", "shape": "diamond", "text": "Paid?", "ref": "c" },
  { "do": "shape", "shape": "rectangle", "text": "Dashboard", "color": "green", "ref": "d" },
  { "do": "arrange", "ids": ["@a", "@b", "@c", "@d"], "layout": "row", "gap": 80 },
  { "do": "arrow", "from": "@a", "to": "@b" },
  { "do": "arrow", "from": "@b", "to": "@c" },
  { "do": "arrow", "from": "@c", "to": "@d" },
  { "do": "frame", "title": "Onboarding flow", "around": ["@a", "@b", "@c", "@d"] }
]
```

The word on a branch ("yes"): a `text` just above the arrow's middle, added after `arrange` with `at`. More than 5 steps: two rows, or a column.

## Timeline

Events at points in time, left to right: small dots on a line, the date above, the event below.

```json
[
  { "do": "shape", "shape": "ellipse", "text": "", "color": "blue", "fill": "solid", "w": 24, "h": 24, "at": { "x": 0, "y": 60 }, "ref": "t1" },
  { "do": "shape", "shape": "ellipse", "text": "", "color": "blue", "fill": "solid", "w": 24, "h": 24, "at": { "x": 300, "y": 60 }, "ref": "t2" },
  { "do": "shape", "shape": "ellipse", "text": "", "color": "red", "fill": "solid", "w": 24, "h": 24, "at": { "x": 600, "y": 60 }, "ref": "t3" },
  { "do": "arrow", "from": "@t1", "to": "@t2", "line": true },
  { "do": "arrow", "from": "@t2", "to": "@t3" },
  { "do": "text", "text": "Apr", "at": { "x": -10, "y": 0 } },
  { "do": "text", "text": "Jul", "at": { "x": 290, "y": 0 } },
  { "do": "text", "text": "Oct", "at": { "x": 590, "y": 0 } },
  { "do": "text", "text": "Kickoff", "at": { "x": -20, "y": 110 } },
  { "do": "text", "text": "Beta", "at": { "x": 285, "y": 110 } },
  { "do": "text", "text": "Launch", "at": { "x": 580, "y": 110 } }
]
```

Space points by time when the gaps mean something; evenly when only the order does. The point that matters now (today, the deadline) in another colour.

## Journey

A timeline with lanes: the stages across, and rows for what the person does, feels and where it hurts. Build as a bento grid with as many columns as stages (`omq bento --cols 4`), one cell per stage and row, filled with short text; the pain points in red. The row names: a text left of each row.

## Cause chain and loop

"A leads to B leads to C"; a loop when C feeds back into A (a vicious or a virtuous circle). Lay the steps on a circle; the arrows go round.

```json
[
  { "do": "shape", "shape": "rectangle", "text": "More users", "w": 180, "h": 80, "at": { "x": 200, "y": 0 }, "ref": "a" },
  { "do": "shape", "shape": "rectangle", "text": "More data", "w": 180, "h": 80, "at": { "x": 420, "y": 200 }, "ref": "b" },
  { "do": "shape", "shape": "rectangle", "text": "Better model", "w": 180, "h": 80, "at": { "x": 200, "y": 400 }, "ref": "c" },
  { "do": "shape", "shape": "rectangle", "text": "Better product", "w": 180, "h": 80, "at": { "x": -20, "y": 200 }, "ref": "d" },
  { "do": "arrow", "from": "@a", "to": "@b" },
  { "do": "arrow", "from": "@b", "to": "@c" },
  { "do": "arrow", "from": "@c", "to": "@d" },
  { "do": "arrow", "from": "@d", "to": "@a" },
  { "do": "text", "text": "flywheel", "at": { "x": 245, "y": 225 } }
]
```

The loop's name in the middle. A chain without a loop: a flow.

## Tree (breakdown, why-why, issue tree)

A root on top, its parts below, evidence under the parts. Children 300 apart; the root centred over them.

```json
[
  { "do": "shape", "shape": "rectangle", "text": "Churn is up", "color": "red", "w": 200, "h": 80, "at": { "x": 290, "y": 0 }, "ref": "r" },
  { "do": "shape", "shape": "rectangle", "text": "Price", "w": 180, "h": 80, "at": { "x": 0, "y": 180 }, "ref": "a" },
  { "do": "shape", "shape": "rectangle", "text": "Onboarding", "w": 180, "h": 80, "at": { "x": 300, "y": 180 }, "ref": "b" },
  { "do": "shape", "shape": "rectangle", "text": "Bugs", "w": 180, "h": 80, "at": { "x": 600, "y": 180 }, "ref": "c" },
  { "do": "note", "text": "Plan B costs 2x A", "color": "light-blue", "at": { "x": 0, "y": 320 }, "ref": "n1" },
  { "do": "arrow", "from": "@r", "to": "@a" },
  { "do": "arrow", "from": "@r", "to": "@b" },
  { "do": "arrow", "from": "@r", "to": "@c" },
  { "do": "arrow", "from": "@a", "to": "@n1", "line": true }
]
```

More than 4 children, or deeper than 3 levels: grow sideways instead (root on the left, `layout: column` for each level, arrows to the right).

## 2x2 matrix

Two axes, four quadrants: sort items by two qualities at once.

```json
[
  { "do": "shape", "shape": "rectangle", "text": "Quick wins", "color": "green", "w": 320, "h": 200, "at": { "x": 0, "y": 0 } },
  { "do": "shape", "shape": "rectangle", "text": "Big bets", "color": "blue", "w": 320, "h": 200, "at": { "x": 340, "y": 0 } },
  { "do": "shape", "shape": "rectangle", "text": "Fill-ins", "color": "grey", "w": 320, "h": 200, "at": { "x": 0, "y": 220 } },
  { "do": "shape", "shape": "rectangle", "text": "Money pits", "color": "red", "w": 320, "h": 200, "at": { "x": 340, "y": 220 } },
  { "do": "text", "text": "← low effort · high effort →", "at": { "x": 180, "y": 440 } },
  { "do": "text", "text": "high impact ↑", "at": { "x": -200, "y": 80 } },
  { "do": "text", "text": "low impact ↓", "at": { "x": -200, "y": 300 } }
]
```

The quadrant's name is its label; the items go in as notes or short texts placed inside the quadrant (`at`), not `in` (the quadrants are shapes, not frames). Many items: make the quadrants frames (`frame --size 320x200 --at …`) and put the items `--in` them.

## Comparison table and pros / cons

Options side by side over the same points. A bento grid with one column per option plus one for the point names reads as a table:

```sh
omq bento --cols 3 --width 900            # points | option A | option B
omq frame "Point" --in GRID --auto        # then one cell per point and option, row by row
```

or, for a few rows, a `markdown` card with a table. Pros / cons: two columns (green: for, red: against), one keyword per line, and the conclusion under both. The winner of each row: `pen circle` on it.

## Venn

What two (or three) things share. The circles overlap on purpose: lint reports it, leave it.

```json
[
  { "do": "shape", "shape": "ellipse", "text": "", "color": "blue", "w": 320, "h": 320, "at": { "x": 0, "y": 0 } },
  { "do": "shape", "shape": "ellipse", "text": "", "color": "orange", "w": 320, "h": 320, "at": { "x": 200, "y": 0 } },
  { "do": "text", "text": "Design", "at": { "x": 50, "y": 140 } },
  { "do": "text", "text": "Code", "at": { "x": 400, "y": 140 } },
  { "do": "text", "text": "Us", "at": { "x": 240, "y": 140 } }
]
```

## Mind map

One topic in the centre, its parts around it; parts of parts further out.

```json
[
  { "do": "shape", "shape": "ellipse", "text": "Offsite", "color": "violet", "fill": "solid", "w": 200, "h": 120, "at": { "x": 300, "y": 200 }, "ref": "c" },
  { "do": "shape", "shape": "rectangle", "text": "Venue", "w": 160, "h": 70, "at": { "x": 0, "y": 40 }, "ref": "a" },
  { "do": "shape", "shape": "rectangle", "text": "Agenda", "w": 160, "h": 70, "at": { "x": 640, "y": 40 }, "ref": "b" },
  { "do": "shape", "shape": "rectangle", "text": "Budget", "w": 160, "h": 70, "at": { "x": 0, "y": 410 }, "ref": "d" },
  { "do": "shape", "shape": "rectangle", "text": "People", "w": 160, "h": 70, "at": { "x": 640, "y": 410 }, "ref": "e" },
  { "do": "arrow", "from": "@c", "to": "@a", "line": true },
  { "do": "arrow", "from": "@c", "to": "@b", "line": true },
  { "do": "arrow", "from": "@c", "to": "@d", "line": true },
  { "do": "arrow", "from": "@c", "to": "@e", "line": true }
]
```

Up to 6 branches: the corners, then left and right of the centre (y 225). A branch's own items: a column of short texts beyond it, joined with lines.

## Pyramid

Levels, the base widest: foundations → goals, many → few.

```json
[
  { "do": "shape", "shape": "rectangle", "text": "Vision", "color": "violet", "fill": "solid", "w": 200, "h": 70, "at": { "x": 200, "y": 0 } },
  { "do": "shape", "shape": "rectangle", "text": "Strategy", "color": "blue", "fill": "solid", "w": 400, "h": 70, "at": { "x": 100, "y": 80 } },
  { "do": "shape", "shape": "rectangle", "text": "Projects", "color": "light-blue", "fill": "solid", "w": 600, "h": 70, "at": { "x": 0, "y": 160 } }
]
```

## Affinity groups

Many loose items sorted into groups, each with a heading that says what the group means. See `tidy.md` for the steps; the layout:

```json
[
  { "do": "arrange", "ids": ["NOTE1", "NOTE2", "NOTE3"], "layout": "grid", "cols": 2, "gap": 24 },
  { "do": "frame", "title": "Onboarding is slow", "around": ["NOTE1", "NOTE2", "NOTE3"], "ref": "g1" },
  { "do": "arrange", "ids": ["NOTE4", "NOTE5"], "layout": "grid", "cols": 2, "gap": 24 },
  { "do": "frame", "title": "Pricing is unclear", "around": ["NOTE4", "NOTE5"] }
]
```

Then line the frames up in a **second** operation: `omq arrange G1,G2 --layout row --gap 80` (or `tidy G1,G2`). A frame made in an `apply` takes in its contents only once that operation ends, so arranging it in the same `apply` leaves them behind.

A frame's title is the group's meaning ("Onboarding is slow"), not its category ("Onboarding"). Relations between groups: arrows between the frames.
