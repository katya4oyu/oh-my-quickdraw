# Flow (sequence, with decisions)

Draw it a unit at a time (`../visual-thinking.md`, Place): each block below is one `apply`, all with the drawing's `origin`; `Q_ID` and the like are the ids an earlier unit's `placed` gave.

Steps in order, 260 apart, centred on one line; a diamond for a choice.

```json
{"unit": "the first steps", "origin": [0, 0], "items": [
  {"do": "shape", "shape": "rectangle", "color": "black", "w": 180, "h": 90, "at": [0, 25], "ref": "a"},
  {"do": "text", "text": "Sign up", "font_size": 16, "color": "black", "w": 180, "align": "middle", "at": [0, 60]},
  {"do": "shape", "shape": "rectangle", "color": "black", "w": 180, "h": 90, "at": [260, 25], "ref": "b"},
  {"do": "text", "text": "Verify email", "font_size": 16, "color": "black", "w": 180, "align": "middle", "at": [260, 60]},
  {"do": "arrow", "from": "@a", "to": "@b"}
] }
```

```json
{"unit": "the choice", "origin": [0, 0], "items": [
  {"do": "shape", "shape": "diamond", "color": "black", "w": 180, "h": 140, "at": [520, 0], "ref": "c"},
  {"do": "text", "text": "Paid?", "font_size": 16, "color": "black", "w": 180, "align": "middle", "at": [520, 60]},
  {"do": "shape", "shape": "rectangle", "color": "green", "w": 180, "h": 90, "at": [780, 25], "ref": "d"},
  {"do": "text", "text": "Dashboard", "font_size": 16, "color": "green", "w": 180, "align": "middle", "at": [780, 60]},
  {"do": "arrow", "from": "B_ID", "to": "@c"},
  {"do": "arrow", "from": "@c", "to": "@d"},
  {"do": "text", "text": "yes", "font_size": 12, "at": [730, 48]}
] }
```

```json
{"unit": "named", "items": [
  {"do": "frame", "title": "Onboarding flow", "around": ["A_ID", "B_ID", "C_ID", "D_ID"]}
] }
```

The word on a branch ("yes"): a 12 px text just above the arrow's middle. More than 5 steps: two rows, or a column.
