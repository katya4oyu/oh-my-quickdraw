# Cause chain and loop

Draw it a unit at a time (`../visual-thinking.md`, Place): each block below is one `apply`, all with the drawing's `origin`; `Q_ID` and the like are the ids an earlier unit's `placed` gave.

"A leads to B leads to C"; a loop when C feeds back into A (a vicious or a virtuous circle). Lay the steps on a circle; the arrows go round.

```json
{"unit": "the chain", "origin": [0, 0], "items": [
  {"do": "shape", "shape": "rectangle", "color": "black", "w": 180, "h": 80, "at": [200, 0], "ref": "a"},
  {"do": "text", "text": "More users", "font_size": 16, "color": "black", "w": 180, "align": "middle", "at": [200, 30]},
  {"do": "shape", "shape": "rectangle", "color": "black", "w": 180, "h": 80, "at": [420, 200], "ref": "b"},
  {"do": "text", "text": "More data", "font_size": 16, "color": "black", "w": 180, "align": "middle", "at": [420, 230]},
  {"do": "shape", "shape": "rectangle", "color": "black", "w": 180, "h": 80, "at": [200, 400], "ref": "c"},
  {"do": "text", "text": "Better model", "font_size": 16, "color": "black", "w": 180, "align": "middle", "at": [200, 430]},
  {"do": "arrow", "from": "@a", "to": "@b"},
  {"do": "arrow", "from": "@b", "to": "@c"}
] }
```

```json
{"unit": "the loop closes", "origin": [0, 0], "items": [
  {"do": "shape", "shape": "rectangle", "color": "black", "w": 180, "h": 80, "at": [-20, 200], "ref": "d"},
  {"do": "text", "text": "Better product", "font_size": 16, "color": "black", "w": 180, "align": "middle", "at": [-20, 230]},
  {"do": "arrow", "from": "C_ID", "to": "@d"},
  {"do": "arrow", "from": "@d", "to": "A_ID"},
  {"do": "text", "text": "flywheel", "font_size": 16, "at": [245, 225]}
] }
```

The loop's name in the middle. A chain without a loop: a flow.
