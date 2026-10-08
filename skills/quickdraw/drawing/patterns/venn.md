# Venn

Draw it a unit at a time (`../visual-thinking.md`, Place): each block below is one `apply`, all with the drawing's `origin`; `Q_ID` and the like are the ids an earlier unit's `placed` gave.

What two (or three) things share. The circles overlap on purpose: lint reports it, leave it.

```json
{ "unit": "the two things", "origin": [0, 0], "items": [
  { "do": "shape", "shape": "ellipse", "text": "", "color": "blue", "w": 320, "h": 320, "at": [0, 0] },
  { "do": "shape", "shape": "ellipse", "text": "", "color": "orange", "w": 320, "h": 320, "at": [200, 0] },
  { "do": "text", "text": "Design", "at": [50, 140] },
  { "do": "text", "text": "Code", "at": [400, 140] }
] }
```

```json
{ "unit": "what they share", "origin": [0, 0], "items": [
  { "do": "text", "text": "Us", "at": [240, 140] }
] }
```
