# Cause chain and loop

"A leads to B leads to C"; a loop when C feeds back into A (a vicious or a virtuous circle). Each step joined to the one before, turning a corner each time; the last arrow closes the loop.

```json
[
  { "do": "shape", "shape": "rectangle", "text": "More users", "color": "black", "ref": "a" },
  { "do": "shape", "shape": "rectangle", "text": "More data", "color": "black", "from": "@a", "side": "right", "ref": "b" },
  { "do": "shape", "shape": "rectangle", "text": "Better model", "color": "black", "from": "@b", "side": "below", "ref": "c" },
  { "do": "shape", "shape": "rectangle", "text": "Better product", "color": "black", "from": "@c", "side": "left", "ref": "d" },
  { "do": "arrow", "from": "@d", "to": "@a" },
  { "do": "frame", "title": "Flywheel", "around": ["@a", "@b", "@c", "@d"] }
]
```

A chain without a loop: a flow.
