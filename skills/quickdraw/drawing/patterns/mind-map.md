# Mind map

Coordinates are offsets from an origin you pick in free space (`../visual-thinking.md`, Place): add its x and y to every `at`.

One topic in the centre, its parts around it; parts of parts further out.

```json
[
  { "do": "shape", "shape": "ellipse", "text": "Offsite", "color": "violet", "fill": "solid", "w": 200, "h": 120, "at": { "x": 300, "y": 200 }, "ref": "c" },
  { "do": "shape", "shape": "rectangle", "text": "Venue", "color": "black", "w": 160, "h": 70, "at": { "x": 0, "y": 40 }, "ref": "a" },
  { "do": "shape", "shape": "rectangle", "text": "Agenda", "color": "black", "w": 160, "h": 70, "at": { "x": 640, "y": 40 }, "ref": "b" },
  { "do": "shape", "shape": "rectangle", "text": "Budget", "color": "black", "w": 160, "h": 70, "at": { "x": 0, "y": 410 }, "ref": "d" },
  { "do": "shape", "shape": "rectangle", "text": "People", "color": "black", "w": 160, "h": 70, "at": { "x": 640, "y": 410 }, "ref": "e" },
  { "do": "arrow", "from": "@c", "to": "@a", "line": true },
  { "do": "arrow", "from": "@c", "to": "@b", "line": true },
  { "do": "arrow", "from": "@c", "to": "@d", "line": true },
  { "do": "arrow", "from": "@c", "to": "@e", "line": true }
]
```

Up to 6 branches: the corners, then left and right of the centre (y 225). A branch's own items: a column of short texts beyond it, joined with lines.
