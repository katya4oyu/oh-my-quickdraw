# Visual thinking: from material to a picture

What every drawing on the board goes through, whatever the occasion: **think → pick a pattern → place → check**. The occasion files (`live.md`, `summarize.md`, `tidy.md`, `thinking-partner.md`) say when each step happens; this file says how.

A drawing is done when someone who missed the conversation can read its point from the board alone.

## 1. Think: what is there to draw

Sort the material before drawing anything. Each piece is one of:

| Kind | What it is | Drawn as |
|---|---|---|
| **Theme** | what this is about, in a few words | the title (one per drawing) |
| **Claim** | something someone holds to be true | a shape or a short text |
| **Issue** | a point under discussion, a question | red / light-red |
| **Decision** | agreed | green |
| **Open** | not decided yet, a guess, a proposal | grey, or hatched (`"fill": "pattern"`), with "?" |
| **Action** | someone does something by some time | blue, with who and when |
| **Evidence** | numbers, quotes, examples behind a claim | a note or Markdown card beside its claim |

Then find the **relation** that holds the pieces together. It decides the pattern:

| Relation | Signs in the material | Pattern (`patterns.md`) |
|---|---|---|
| sequence | "then", "after", steps, stages | flow, timeline, journey |
| cause | "because", "so", "leads to" | cause chain, loop |
| breakdown | "consists of", "kinds of", "why → why" | tree |
| two axes | "high/low", "fast but costly" | 2x2 |
| comparison | options, A vs B over several points | comparison table, pros/cons |
| overlap | "both", "shared", "only in" | Venn |
| around one topic | a topic with loosely related parts | mind map |
| levels | foundation → top, general → specific | pyramid |
| many loose items | ideas, feedback, sticky notes | affinity groups |

Mixed material has several relations: pick the one that carries the theme for the main drawing, and give the others their own small drawings beside it. One frame holds one pattern.

Keep only what serves the theme. Words on the board are **keywords**: a noun phrase or a short verb phrase (2–6 words), not sentences. Full wording, when it matters, goes in a Markdown card.

## 2. Pick a pattern

Look the relation up in `patterns.md` and use its shape and its `apply` skeleton. When nothing fits, a plain row or column of shapes joined by arrows is always readable.

## 3. Place

- **Reading order**: left to right, top to bottom; or from the centre outwards (mind map). The theme is where the eye lands first: top-left, or the centre.
- **Levels of size**, with `text_size` (`--text-size`): the title `xl` (a `text`), headings `l`, the body `m` or `s` (shape labels are `s` unless set). Captions and an arrow's label stay `s`. Notes are big (200 × 200): use them for items people will move, and small shapes for the rest.
- **Colour means something**: the kinds above, at most 3–4 colours in one drawing, the rest black or grey. A shape with no `color` is **blue**: give `"color": "black"` to neutral shapes, or blue reads as an action. Say the legend once when it is not obvious.
- **Fill for weight**: `"fill": "solid"` (a light tint of the colour) for the one or two shapes that matter most; `"fill": "none"` for the rest; `"pattern"` (hatched) for what is out of scope or not yet decided. Hand-drawn outlines (`"dash": "draw"`) by default; `dashed` for a proposal or a link that is not certain.
- **Space**: 60–80 between shapes in a drawing, more between drawings. Crowding reads as noise: make room, or split into another frame.
- **Group** what belongs together: a frame around it (`frame --around`), or a bento cell.
- **Graphic-recording touches**, with what there is:
  - a speaker or a role: a small SVG figure (`image person.svg --width 60`), next to what they said
  - emphasis that stays: `pen circle ID`, `pen underline ID`
  - a quote or an idea: a `cloud` shape; a highlight: a `star`
  - the word on an arrow ("causes", "yes"): the arrow's `label` (it follows the arrow); arrows that would cross: `bend` one round the other
  - an icon: write a small SVG (strokes only, `stroke-width` 4–6, round caps, black) and put it with `image`

Positions: `apply` steps take `at: {x, y}` in board coordinates. Pick an origin in free space first — in a joined session your `area`, else to the right of everything (`read --format json` gives positions and sizes) — and add it to the offsets in `patterns.md`.

## 4. Check

What you write is checked as you write it: a drawing command's result lists what it fixed by itself (`"fixed"`) and what is left for you (`"problems"`) — fix those before going on. No separate `lint` is needed after each step.

Once a drawing is done (not after every step), look at it: `omq look --frame FRAME_ID` (or `--ids`), a small picture. Go through it with these questions, and fix what fails:

- Can the theme be read in three seconds?
- Does the eye know where to start and where to go next?
- Do any arrows cross each other or run across shapes?
- Is any text a sentence where a keyword would do?
- Does each colour mean one thing?
- Is anything drawn as decided that was not decided?
