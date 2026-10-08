# Decision (issue → options → chosen)

Draw it a unit at a time (`../visual-thinking.md`, Place): each block below is one `apply`, all with the drawing's `origin`; `Q_ID` and the like are the ids an earlier unit's `placed` gave.

The core of most meetings: a question, the options with what each costs, the one chosen. The question on the left, options in a column, the chosen one green, the dropped ones grey, the reason in the label's second line.

```json
{ "unit": "the question", "origin": [0, 0], "items": [
  { "do": "shape", "shape": "diamond", "text": "Onboarding or\nbilling first?", "color": "red", "w": 260, "h": 180, "at": [0, 60], "ref": "q" }
] }
```

```json
{ "unit": "the options", "origin": [0, 0], "items": [
  { "do": "shape", "shape": "rectangle", "text": "Onboarding first\n(2 weeks, fewer tickets)", "color": "black", "w": 260, "h": 90, "at": [380, 0], "ref": "a" },
  { "do": "shape", "shape": "rectangle", "text": "Billing redesign first\n(paying users)", "color": "black", "w": 260, "h": 90, "at": [380, 200], "ref": "b" },
  { "do": "arrow", "from": "Q_ID", "to": "@a" },
  { "do": "arrow", "from": "Q_ID", "to": "@b" }
] }
```

```json
{ "unit": "the one chosen", "items": [
  { "do": "update", "id": "A_ID", "color": "green", "fill": "solid" },
  { "do": "update", "id": "B_ID", "color": "grey" },
  { "do": "frame", "title": "Decided: onboarding first", "around": ["Q_ID", "A_ID", "B_ID"] }
] }
```

The frame's title says the decision, so it reads even from afar. Still open: the question stays red and no option is green.
