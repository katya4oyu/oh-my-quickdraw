# Tree (breakdown, why-why, issue tree)

Draw it a unit at a time (`../visual-thinking.md`, Place): each block below is one `apply`, all with the drawing's `origin`; `Q_ID` and the like are the ids an earlier unit's `placed` gave.

A root on top, its parts below, evidence under the parts. Children 300 apart; the root centred over them.

```json
{"unit": "the root", "origin": [0, 0], "items": [
  {"do": "shape", "shape": "rectangle", "color": "red", "w": 200, "h": 80, "at": [290, 0], "ref": "r"},
  {"do": "text", "text": "Churn is up", "font_size": 16, "color": "red", "w": 200, "align": "middle", "at": [290, 30]}
] }
```

```json
{"unit": "its parts", "origin": [0, 0], "items": [
  {"do": "shape", "shape": "rectangle", "color": "black", "w": 180, "h": 80, "at": [0, 180], "ref": "a"},
  {"do": "text", "text": "Price", "font_size": 16, "color": "black", "w": 180, "align": "middle", "at": [0, 210]},
  {"do": "shape", "shape": "rectangle", "color": "black", "w": 180, "h": 80, "at": [300, 180], "ref": "b"},
  {"do": "text", "text": "Onboarding", "font_size": 16, "color": "black", "w": 180, "align": "middle", "at": [300, 210]},
  {"do": "shape", "shape": "rectangle", "color": "black", "w": 180, "h": 80, "at": [600, 180], "ref": "c"},
  {"do": "text", "text": "Bugs", "font_size": 16, "color": "black", "w": 180, "align": "middle", "at": [600, 210]},
  {"do": "arrow", "from": "R_ID", "to": "@a"},
  {"do": "arrow", "from": "R_ID", "to": "@b"},
  {"do": "arrow", "from": "R_ID", "to": "@c"}
] }
```

```json
{"unit": "evidence under a part", "origin": [0, 0], "items": [
  {"do": "text", "text": "Plan B costs 2x A", "font_size": 12, "color": "grey", "at": [0, 320], "ref": "n1"},
  {"do": "arrow", "from": "A_ID", "to": "@n1", "line": true}
] }
```

More than 4 children, or deeper than 3 levels: grow sideways instead (root on the left, `layout: column` for each level, arrows to the right).
