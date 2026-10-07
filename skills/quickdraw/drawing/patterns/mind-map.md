# Mind map

One topic in the centre, its parts around it, each joined to it on a side; parts of parts further out, joined to theirs.

```json
[
  { "do": "shape", "shape": "ellipse", "text": "Offsite", "color": "violet", "fill": "solid", "w": 200, "h": 120, "ref": "c" },
  { "do": "shape", "shape": "rectangle", "text": "Venue", "color": "black", "from": "@c", "side": "left", "line": true },
  { "do": "shape", "shape": "rectangle", "text": "Agenda", "color": "black", "from": "@c", "side": "right", "line": true },
  { "do": "shape", "shape": "rectangle", "text": "Budget", "color": "black", "from": "@c", "side": "below", "line": true },
  { "do": "shape", "shape": "rectangle", "text": "People", "color": "black", "from": "@c", "side": "above", "line": true }
]
```

More than four branches: two on a side (the second moves across by itself).
