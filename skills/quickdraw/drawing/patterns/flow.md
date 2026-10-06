# Flow (sequence, with decisions)

Coordinates are offsets from an origin you pick in free space (`../visual-thinking.md`, Place): add its x and y to every `at`.

Steps in order; a diamond for a choice. No coordinates needed: `arrange` lays them out.

```json
[
  { "do": "shape", "shape": "rectangle", "text": "Sign up", "color": "black", "ref": "a" },
  { "do": "shape", "shape": "rectangle", "text": "Verify email", "color": "black", "ref": "b" },
  { "do": "shape", "shape": "diamond", "text": "Paid?", "color": "black", "ref": "c" },
  { "do": "shape", "shape": "rectangle", "text": "Dashboard", "color": "green", "ref": "d" },
  { "do": "arrange", "ids": ["@a", "@b", "@c", "@d"], "layout": "row", "gap": 80 },
  { "do": "arrow", "from": "@a", "to": "@b" },
  { "do": "arrow", "from": "@b", "to": "@c" },
  { "do": "arrow", "from": "@c", "to": "@d", "label": "yes" },
  { "do": "frame", "title": "Onboarding flow", "around": ["@a", "@b", "@c", "@d"] }
]
```

The word on a branch ("yes"): the arrow's `"label": "yes"`. More than 5 steps: two rows, or a column.
