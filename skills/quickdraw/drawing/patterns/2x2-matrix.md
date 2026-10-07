# 2x2 matrix

Coordinates are offsets from an origin you pick in free space (`../visual-thinking.md`, Place): add its x and y to every `at`.

Two axes, four quadrants: sort items by two qualities at once.

```json
[
  { "do": "shape", "shape": "rectangle", "text": "Quick wins", "color": "green", "w": 320, "h": 200, "at": { "x": 0, "y": 0 } },
  { "do": "shape", "shape": "rectangle", "text": "Big bets", "color": "blue", "w": 320, "h": 200, "at": { "x": 340, "y": 0 } },
  { "do": "shape", "shape": "rectangle", "text": "Fill-ins", "color": "grey", "w": 320, "h": 200, "at": { "x": 0, "y": 220 } },
  { "do": "shape", "shape": "rectangle", "text": "Money pits", "color": "red", "w": 320, "h": 200, "at": { "x": 340, "y": 220 } },
  { "do": "text", "text": "← low effort · high effort →", "text_size": "s", "at": { "x": 200, "y": 440 } },
  { "do": "text", "text": "high impact ↑", "at": { "x": -200, "y": 80 } },
  { "do": "text", "text": "low impact ↓", "at": { "x": -200, "y": 300 } }
]
```

The quadrant's name is its label; the items go in as notes or short texts placed inside the quadrant (`at`), not `in` (the quadrants are shapes, not frames). Many items: make the quadrants frames (`frame --size 320x200 --at …`) and put the items `--in` them.
