# Flow (sequence, with decisions)

Draw it a unit at a time (`../visual-thinking.md`, Place): each block below is one `apply`, all with the drawing's `origin`; `"@q"` points at what an earlier unit named `q`.

Steps in order, 260 apart, centred on one line; a diamond for a choice.

```json
{"unit": "the first steps", "origin": [0, 0], "items": [
  {"do": "shape", "shape": "rectangle", "color": "black", "w": 180, "h": 90, "at": [0, 25], "ref": "a"},
  {"do": "text", "text": "Sign up", "font_size": 16, "color": "black", "w": 180, "align": "middle", "at": [0, 60]},
  {"do": "shape", "shape": "rectangle", "color": "black", "w": 180, "h": 90, "at": [260, 25], "ref": "b"},
  {"do": "text", "text": "Verify email", "font_size": 16, "color": "black", "w": 180, "align": "middle", "at": [260, 60]},
  {"do": "arrow", "from": "@a", "to": "@b", "from_at": [186, 70], "to_at": [254, 70]}
] }
```

```json
{"unit": "the choice", "origin": [0, 0], "items": [
  {"do": "shape", "shape": "diamond", "color": "black", "w": 180, "h": 140, "at": [520, 0], "ref": "c"},
  {"do": "text", "text": "Paid?", "font_size": 16, "color": "black", "w": 180, "align": "middle", "at": [520, 60]},
  {"do": "shape", "shape": "rectangle", "color": "green", "w": 180, "h": 90, "at": [780, 25], "ref": "d"},
  {"do": "text", "text": "Dashboard", "font_size": 16, "color": "green", "w": 180, "align": "middle", "at": [780, 60]},
  {"do": "arrow", "from": "@b", "to": "@c", "from_at": [446, 70], "to_at": [514, 70]},
  {"do": "arrow", "from": "@c", "to": "@d", "from_at": [706, 70], "to_at": [774, 70]},
  {"do": "text", "text": "yes", "font_size": 12, "at": [730, 48]}
] }
```

```json
{"unit": "named", "items": [
  {"do": "frame", "title": "Onboarding flow", "around": ["@a", "@b", "@c", "@d"]}
] }
```

The word on a branch ("yes"): a 12 px text just above the arrow's middle. More than 5 steps: two rows, or a column.
