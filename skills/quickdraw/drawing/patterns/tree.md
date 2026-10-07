# Tree (breakdown, why-why, issue tree)

A root, its parts under it, evidence under the parts: each joined to its parent, `below`. Siblings on the same side spread out by themselves (a taken spot moves the next one across).

```json
[
  { "do": "shape", "shape": "rectangle", "text": "Churn is up", "color": "red", "ref": "r" },
  { "do": "shape", "shape": "rectangle", "text": "Price", "color": "black", "from": "@r", "side": "below", "ref": "a" },
  { "do": "shape", "shape": "rectangle", "text": "Onboarding", "color": "black", "from": "@r", "side": "below", "ref": "b" },
  { "do": "shape", "shape": "rectangle", "text": "Bugs", "color": "black", "from": "@r", "side": "below", "ref": "c" },
  { "do": "note", "text": "Plan B costs 2x A", "color": "light-blue", "from": "@a", "side": "below", "line": true }
]
```

Deeper than 3 levels, or many children: grow it sideways (`side: "right"` from the root).
