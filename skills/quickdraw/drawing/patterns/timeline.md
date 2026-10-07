# Timeline

Events in order, left to right: a frame that lines them up in a row, each event a short label with its date on the first line. The point that matters now (today, the deadline) in another colour.

```json
[
  { "do": "frame", "title": "Roadmap", "arrange": "row", "gap": 60, "ref": "t" },
  { "do": "shape", "shape": "rectangle", "text": "Apr\nKickoff", "color": "blue", "in": "@t", "ref": "a" },
  { "do": "shape", "shape": "rectangle", "text": "Jul\nBeta", "color": "blue", "in": "@t", "ref": "b" },
  { "do": "shape", "shape": "rectangle", "text": "Oct\nLaunch", "color": "red", "fill": "solid", "in": "@t", "ref": "c" },
  { "do": "arrow", "from": "@a", "to": "@b" },
  { "do": "arrow", "from": "@b", "to": "@c" }
]
```

When the gaps in time mean something, place by hand (`at`) instead.
