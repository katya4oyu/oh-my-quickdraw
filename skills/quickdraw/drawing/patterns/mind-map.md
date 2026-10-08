# Mind map

Draw it a unit at a time (`../visual-thinking.md`, Place): each block below is one `apply`, all with the drawing's `origin`; `Q_ID` and the like are the ids an earlier unit's `placed` gave.

One topic in the centre, its parts around it; parts of parts further out.

```json
{ "unit": "the topic", "origin": [0, 0], "items": [
  { "do": "shape", "shape": "ellipse", "text": "Offsite", "color": "violet", "fill": "solid", "w": 200, "h": 120, "at": [300, 200], "ref": "c" }
] }
```

```json
{ "unit": "a branch", "origin": [0, 0], "items": [
  { "do": "shape", "shape": "rectangle", "text": "Venue", "color": "black", "w": 160, "h": 70, "at": [0, 40], "ref": "a" },
  { "do": "arrow", "from": "C_ID", "to": "@a", "line": true }
] }
```

Then a unit per branch, as it comes up: Agenda at [640, 40], Budget at [0, 410], People at [640, 410]. Up to 6 branches: the corners, then left and right of the centre (y 225). A branch's own items: a column of short texts beyond it, joined with lines.
