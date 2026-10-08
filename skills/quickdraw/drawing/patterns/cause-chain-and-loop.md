# Cause chain and loop

Draw it a unit at a time (`../visual-thinking.md`, Place): each block below is one `apply`, all with the drawing's `origin`; `Q_ID` and the like are the ids an earlier unit's `placed` gave.

"A leads to B leads to C"; a loop when C feeds back into A (a vicious or a virtuous circle). Lay the steps on a circle; the arrows go round.

```json
{ "unit": "the chain", "origin": [0, 0], "items": [
  { "do": "shape", "shape": "rectangle", "text": "More users", "color": "black", "w": 180, "h": 80, "at": [200, 0], "ref": "a" },
  { "do": "shape", "shape": "rectangle", "text": "More data", "color": "black", "w": 180, "h": 80, "at": [420, 200], "ref": "b" },
  { "do": "shape", "shape": "rectangle", "text": "Better model", "color": "black", "w": 180, "h": 80, "at": [200, 400], "ref": "c" },
  { "do": "arrow", "from": "@a", "to": "@b" },
  { "do": "arrow", "from": "@b", "to": "@c" }
] }
```

```json
{ "unit": "the loop closes", "origin": [0, 0], "items": [
  { "do": "shape", "shape": "rectangle", "text": "Better product", "color": "black", "w": 180, "h": 80, "at": [-20, 200], "ref": "d" },
  { "do": "arrow", "from": "C_ID", "to": "@d" },
  { "do": "arrow", "from": "@d", "to": "A_ID" },
  { "do": "text", "text": "flywheel", "at": [245, 225] }
] }
```

The loop's name in the middle. A chain without a loop: a flow.
