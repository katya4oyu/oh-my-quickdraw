# 2x2 matrix

Draw it a unit at a time (`../visual-thinking.md`, Place): each block below is one `apply`, all with the drawing's `origin`; `Q_ID` and the like are the ids an earlier unit's `placed` gave.

Two axes, four quadrants: sort items by two qualities at once.

```json
{ "unit": "the axes", "origin": [0, 0], "items": [
  { "do": "shape", "shape": "rectangle", "text": "Quick wins", "color": "green", "w": 320, "h": 200, "at": [0, 0] },
  { "do": "shape", "shape": "rectangle", "text": "Big bets", "color": "blue", "w": 320, "h": 200, "at": [340, 0] },
  { "do": "shape", "shape": "rectangle", "text": "Fill-ins", "color": "grey", "w": 320, "h": 200, "at": [0, 220] },
  { "do": "shape", "shape": "rectangle", "text": "Money pits", "color": "red", "w": 320, "h": 200, "at": [340, 220] },
  { "do": "text", "text": "← low effort · high effort →", "text_size": "s", "at": [200, 440] },
  { "do": "text", "text": "high impact ↑", "at": [-200, 80] },
  { "do": "text", "text": "low impact ↓", "at": [-200, 300] }
] }
```

The quadrant's name is its label; then a unit per item or two as you sort them, going in as notes or short texts placed inside the quadrant (`at`), not `in` (the quadrants are shapes, not frames). Many items: make the quadrants frames (`frame --size 320x200 --at …`) and put the items `--in` them.
