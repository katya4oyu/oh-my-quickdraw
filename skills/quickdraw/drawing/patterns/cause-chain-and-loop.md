# Cause chain and loop

Coordinates are offsets from an origin you pick in free space (`../visual-thinking.md`, Place): add its x and y to every `at`.

"A leads to B leads to C"; a loop when C feeds back into A (a vicious or a virtuous circle). Lay the steps on a circle; the arrows go round.

```json
[
  { "do": "shape", "shape": "rectangle", "text": "More users", "color": "black", "w": 180, "h": 80, "at": { "x": 200, "y": 0 }, "ref": "a" },
  { "do": "shape", "shape": "rectangle", "text": "More data", "color": "black", "w": 180, "h": 80, "at": { "x": 420, "y": 200 }, "ref": "b" },
  { "do": "shape", "shape": "rectangle", "text": "Better model", "color": "black", "w": 180, "h": 80, "at": { "x": 200, "y": 400 }, "ref": "c" },
  { "do": "shape", "shape": "rectangle", "text": "Better product", "color": "black", "w": 180, "h": 80, "at": { "x": -20, "y": 200 }, "ref": "d" },
  { "do": "arrow", "from": "@a", "to": "@b" },
  { "do": "arrow", "from": "@b", "to": "@c" },
  { "do": "arrow", "from": "@c", "to": "@d" },
  { "do": "arrow", "from": "@d", "to": "@a" },
  { "do": "text", "text": "flywheel", "at": { "x": 245, "y": 225 } }
]
```

The loop's name in the middle. A chain without a loop: a flow.
