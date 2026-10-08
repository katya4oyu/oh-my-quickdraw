# Timeline

Draw it a unit at a time (`../visual-thinking.md`, Place): each block below is one `apply`, all with the drawing's `origin`; `Q_ID` and the like are the ids an earlier unit's `placed` gave.

Events at points in time, left to right: small dots on a line, the date above, the event below.

```json
{"unit": "the first event", "origin": [0, 0], "items": [
  {"do": "shape", "shape": "ellipse", "color": "blue", "fill": "solid", "w": 24, "h": 24, "at": [0, 60], "ref": "t1"},
  {"do": "text", "text": "Apr", "font_size": 16, "at": [-10, 0]},
  {"do": "text", "text": "Kickoff", "font_size": 16, "at": [-20, 110]}
] }
```

```json
{"unit": "the next event", "origin": [0, 0], "items": [
  {"do": "shape", "shape": "ellipse", "color": "blue", "fill": "solid", "w": 24, "h": 24, "at": [300, 60], "ref": "t2"},
  {"do": "arrow", "from": "T1_ID", "to": "@t2", "line": true},
  {"do": "text", "text": "Jul", "font_size": 16, "at": [290, 0]},
  {"do": "text", "text": "Beta", "font_size": 16, "at": [285, 110]}
] }
```

Then each event the same way, 300 further on (the one that matters now, like Launch at [600, 60], red, an arrow into it), and last a unit with only `frame` `around` them all ("Roadmap"). Space points by time when the gaps mean something; evenly when only the order does. The point that matters now (today, the deadline) in another colour.
