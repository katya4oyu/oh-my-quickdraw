# Tree (breakdown, why-why, issue tree)

Coordinates are offsets from an origin you pick in free space (`../visual-thinking.md`, Place): add its x and y to every `at`.

A root on top, its parts below, evidence under the parts. Children 300 apart; the root centred over them.

```json
[
  { "do": "shape", "shape": "rectangle", "text": "Churn is up", "color": "red", "w": 200, "h": 80, "at": { "x": 290, "y": 0 }, "ref": "r" },
  { "do": "shape", "shape": "rectangle", "text": "Price", "color": "black", "w": 180, "h": 80, "at": { "x": 0, "y": 180 }, "ref": "a" },
  { "do": "shape", "shape": "rectangle", "text": "Onboarding", "color": "black", "w": 180, "h": 80, "at": { "x": 300, "y": 180 }, "ref": "b" },
  { "do": "shape", "shape": "rectangle", "text": "Bugs", "color": "black", "w": 180, "h": 80, "at": { "x": 600, "y": 180 }, "ref": "c" },
  { "do": "text", "text": "Plan B costs 2x A", "text_size": "s", "color": "grey", "at": { "x": 0, "y": 320 }, "ref": "n1" },
  { "do": "arrow", "from": "@r", "to": "@a" },
  { "do": "arrow", "from": "@r", "to": "@b" },
  { "do": "arrow", "from": "@r", "to": "@c" },
  { "do": "arrow", "from": "@a", "to": "@n1", "line": true }
]
```

More than 4 children, or deeper than 3 levels: grow sideways instead (root on the left, `layout: column` for each level, arrows to the right).
