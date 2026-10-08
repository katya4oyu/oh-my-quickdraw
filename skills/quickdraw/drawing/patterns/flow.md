# Flow (sequence, with decisions)

Draw it a unit at a time (`../visual-thinking.md`, Place): each block below is one `apply`, all with the drawing's `origin`; `Q_ID` and the like are the ids an earlier unit's `placed` gave.

Steps in order, 260 apart, centred on one line; a diamond for a choice.

```json
{ "unit": "the first steps", "origin": [0, 0], "items": [
  { "do": "shape", "shape": "rectangle", "text": "Sign up", "color": "black", "w": 180, "h": 90, "at": [0, 25], "ref": "a" },
  { "do": "shape", "shape": "rectangle", "text": "Verify email", "color": "black", "w": 180, "h": 90, "at": [260, 25], "ref": "b" },
  { "do": "arrow", "from": "@a", "to": "@b" }
] }
```

```json
{ "unit": "the choice", "origin": [0, 0], "items": [
  { "do": "shape", "shape": "diamond", "text": "Paid?", "color": "black", "w": 180, "h": 140, "at": [520, 0], "ref": "c" },
  { "do": "shape", "shape": "rectangle", "text": "Dashboard", "color": "green", "w": 180, "h": 90, "at": [780, 25], "ref": "d" },
  { "do": "arrow", "from": "B_ID", "to": "@c" },
  { "do": "arrow", "from": "@c", "to": "@d", "label": "yes" }
] }
```

```json
{ "unit": "named", "items": [{ "do": "frame", "title": "Onboarding flow", "around": ["A_ID", "B_ID", "C_ID", "D_ID"] }] }
```

The word on a branch ("yes"): the arrow's `"label": "yes"`. More than 5 steps: two rows, or a column.
