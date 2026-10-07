# Timeline

Coordinates are offsets from an origin you pick in free space (`../visual-thinking.md`, Place): add its x and y to every `at`.

Events at points in time, left to right: small dots on a line, the date above, the event below.

```json
[
  { "do": "shape", "shape": "ellipse", "text": "", "color": "blue", "fill": "solid", "w": 24, "h": 24, "at": { "x": 0, "y": 60 }, "ref": "t1" },
  { "do": "shape", "shape": "ellipse", "text": "", "color": "blue", "fill": "solid", "w": 24, "h": 24, "at": { "x": 300, "y": 60 }, "ref": "t2" },
  { "do": "shape", "shape": "ellipse", "text": "", "color": "red", "fill": "solid", "w": 24, "h": 24, "at": { "x": 600, "y": 60 }, "ref": "t3" },
  { "do": "arrow", "from": "@t1", "to": "@t2", "line": true },
  { "do": "arrow", "from": "@t2", "to": "@t3" },
  { "do": "text", "text": "Apr", "at": { "x": -10, "y": 0 }, "ref": "d1" },
  { "do": "text", "text": "Jul", "at": { "x": 290, "y": 0 }, "ref": "d2" },
  { "do": "text", "text": "Oct", "at": { "x": 590, "y": 0 }, "ref": "d3" },
  { "do": "text", "text": "Kickoff", "at": { "x": -20, "y": 110 }, "ref": "e1" },
  { "do": "text", "text": "Beta", "at": { "x": 285, "y": 110 }, "ref": "e2" },
  { "do": "text", "text": "Launch", "at": { "x": 580, "y": 110 }, "ref": "e3" },
  { "do": "frame", "title": "Roadmap", "around": ["@t1", "@t2", "@t3", "@d1", "@d2", "@d3", "@e1", "@e2", "@e3"] }
]
```

Space points by time when the gaps mean something; evenly when only the order does. The point that matters now (today, the deadline) in another colour.
