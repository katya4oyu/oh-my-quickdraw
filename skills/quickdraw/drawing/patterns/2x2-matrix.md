# 2x2 matrix

Draw it a unit at a time (`../visual-thinking.md`, Place): each block below is one `apply`, all with the drawing's `origin`; `"@q"` points at what an earlier unit named `q`.

Two axes, four quadrants: sort items by two qualities at once.

```json
{"unit": "the axes", "origin": [0, 0], "items": [
  {"do": "shape", "shape": "rectangle", "color": "green", "w": 320, "h": 200, "at": [0, 0]},
  {"do": "text", "text": "Quick wins", "font_size": 16, "color": "green", "w": 320, "align": "middle", "at": [0, 12]},
  {"do": "shape", "shape": "rectangle", "color": "blue", "w": 320, "h": 200, "at": [340, 0]},
  {"do": "text", "text": "Big bets", "font_size": 16, "color": "blue", "w": 320, "align": "middle", "at": [340, 12]},
  {"do": "shape", "shape": "rectangle", "color": "grey", "w": 320, "h": 200, "at": [0, 220]},
  {"do": "text", "text": "Fill-ins", "font_size": 16, "color": "grey", "w": 320, "align": "middle", "at": [0, 232]},
  {"do": "shape", "shape": "rectangle", "color": "red", "w": 320, "h": 200, "at": [340, 220]},
  {"do": "text", "text": "Money pits", "font_size": 16, "color": "red", "w": 320, "align": "middle", "at": [340, 232]},
  {"do": "text", "text": "← low effort · high effort →", "font_size": 13, "at": [200, 440]},
  {"do": "text", "text": "high impact ↑", "font_size": 16, "at": [-200, 80]},
  {"do": "text", "text": "low impact ↓", "font_size": 16, "at": [-200, 300]}
] }
```

The quadrant's name is a text at its top. Then a unit per item or two as you sort them: short texts (13–16 px) inside the quadrant, below its name. Many items: make the quadrants bigger in the first unit.
