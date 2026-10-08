# Pyramid

Draw it a unit at a time (`../visual-thinking.md`, Place): each block below is one `apply`, all with the drawing's `origin`; `"@q"` points at what an earlier unit named `q`.

Levels, the base widest: foundations → goals, many → few.

```json
{"unit": "the base", "origin": [0, 0], "items": [
  {"do": "shape", "shape": "rectangle", "color": "light-blue", "fill": "solid", "w": 600, "h": 70, "at": [0, 160]},
  {"do": "text", "text": "Projects", "font_size": 16, "color": "light-blue", "w": 600, "align": "middle", "at": [0, 184]}
] }
```

```json
{"unit": "what it serves", "origin": [0, 0], "items": [
  {"do": "shape", "shape": "rectangle", "color": "blue", "fill": "solid", "w": 400, "h": 70, "at": [100, 80]},
  {"do": "text", "text": "Strategy", "font_size": 16, "color": "blue", "w": 400, "align": "middle", "at": [100, 104]}
] }
```

```json
{"unit": "the top", "origin": [0, 0], "items": [
  {"do": "shape", "shape": "rectangle", "color": "violet", "fill": "solid", "w": 200, "h": 70, "at": [200, 0]},
  {"do": "text", "text": "Vision", "font_size": 16, "color": "violet", "w": 200, "align": "middle", "at": [200, 24]}
] }
```
