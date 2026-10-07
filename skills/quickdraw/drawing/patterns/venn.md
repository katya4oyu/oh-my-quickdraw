# Venn

Coordinates are offsets from an origin you pick in free space (`../visual-thinking.md`, Place): add its x and y to every `at`.

What two (or three) things share. The circles overlap on purpose: lint reports it, leave it.

```json
[
  { "do": "shape", "shape": "ellipse", "text": "", "color": "blue", "w": 320, "h": 320, "at": { "x": 0, "y": 0 } },
  { "do": "shape", "shape": "ellipse", "text": "", "color": "orange", "w": 320, "h": 320, "at": { "x": 200, "y": 0 } },
  { "do": "text", "text": "Design", "at": { "x": 50, "y": 140 } },
  { "do": "text", "text": "Code", "at": { "x": 400, "y": 140 } },
  { "do": "text", "text": "Us", "at": { "x": 240, "y": 140 } }
]
```
