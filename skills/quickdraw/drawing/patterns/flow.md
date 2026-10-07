# Flow (sequence, with decisions)

Steps in order, each joined to the one before; a diamond for a choice, its ways out on two sides.

```json
[
  { "do": "shape", "shape": "rectangle", "text": "Sign up", "color": "black", "ref": "a" },
  { "do": "shape", "shape": "rectangle", "text": "Verify email", "color": "black", "from": "@a", "side": "right", "ref": "b" },
  { "do": "shape", "shape": "diamond", "text": "Paid?", "color": "black", "from": "@b", "side": "right", "ref": "c" },
  { "do": "shape", "shape": "rectangle", "text": "Dashboard", "color": "green", "from": "@c", "side": "right", "label": "yes", "ref": "d" },
  { "do": "shape", "shape": "rectangle", "text": "Trial", "color": "grey", "from": "@c", "side": "below", "label": "no", "ref": "e" },
  { "do": "frame", "title": "Onboarding flow", "around": ["@a", "@b", "@c", "@d", "@e"] }
]
```

More than 5 steps: turn the line (`side: "below"`, then on `"left"`), rather than one long row.
