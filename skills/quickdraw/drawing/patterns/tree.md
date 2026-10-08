# Tree (breakdown, why-why, issue tree)

Draw it a unit at a time (`../visual-thinking.md`, Place): each block below is one `apply`, all with the drawing's `origin`; `Q_ID` and the like are the ids an earlier unit's `placed` gave.

A root on top, its parts below, evidence under the parts. Children 300 apart; the root centred over them.

```json
{ "unit": "the root", "origin": [0, 0], "items": [
  { "do": "shape", "shape": "rectangle", "text": "Churn is up", "color": "red", "w": 200, "h": 80, "at": [290, 0], "ref": "r" }
] }
```

```json
{ "unit": "its parts", "origin": [0, 0], "items": [
  { "do": "shape", "shape": "rectangle", "text": "Price", "color": "black", "w": 180, "h": 80, "at": [0, 180], "ref": "a" },
  { "do": "shape", "shape": "rectangle", "text": "Onboarding", "color": "black", "w": 180, "h": 80, "at": [300, 180], "ref": "b" },
  { "do": "shape", "shape": "rectangle", "text": "Bugs", "color": "black", "w": 180, "h": 80, "at": [600, 180], "ref": "c" },
  { "do": "arrow", "from": "R_ID", "to": "@a" },
  { "do": "arrow", "from": "R_ID", "to": "@b" },
  { "do": "arrow", "from": "R_ID", "to": "@c" }
] }
```

```json
{ "unit": "evidence under a part", "origin": [0, 0], "items": [
  { "do": "note", "text": "Plan B costs 2x A", "color": "light-blue", "at": [0, 320], "ref": "n1" },
  { "do": "arrow", "from": "A_ID", "to": "@n1", "line": true }
] }
```

More than 4 children, or deeper than 3 levels: grow sideways instead (root on the left, `layout: column` for each level, arrows to the right).
