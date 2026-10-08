# Mind map

Draw it a unit at a time (`../visual-thinking.md`, Place): each block below is one `apply`, all with the drawing's `origin`; `"@q"` points at what an earlier unit named `q`.

One topic in the centre, its parts around it; parts of parts further out.

```json
{"unit": "the topic", "origin": [0, 0], "items": [
  {"do": "shape", "shape": "ellipse", "color": "violet", "fill": "solid", "w": 200, "h": 120, "at": [300, 200], "ref": "c"},
  {"do": "text", "text": "Offsite", "font_size": 16, "color": "violet", "w": 200, "align": "middle", "at": [300, 250]}
] }
```

```json
{"unit": "a branch", "origin": [0, 0], "items": [
  {"do": "shape", "shape": "rectangle", "color": "black", "w": 160, "h": 70, "at": [0, 40], "ref": "a"},
  {"do": "text", "text": "Venue", "font_size": 16, "color": "black", "w": 160, "align": "middle", "at": [0, 64]},
  {"do": "arrow", "from": "@c", "to": "@a", "line": true, "from_at": [323, 215], "to_at": [146, 113]}
] }
```

Then a unit per branch, as it comes up: Agenda at [640, 40], Budget at [0, 410], People at [640, 410]. Up to 6 branches: the corners, then left and right of the centre (y 225). A branch's own items: a column of short texts beyond it, joined with lines.
