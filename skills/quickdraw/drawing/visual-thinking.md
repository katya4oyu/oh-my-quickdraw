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

Look the relation up in `patterns.md` and use its shape and its units (`apply` skeletons). When nothing fits, a plain row or column of shapes joined by arrows is always readable.

## 3. Place

- **Reading order**: left to right, top to bottom; or from the centre outwards (mind map). The theme is where the eye lands first: top-left, or the centre.
- **Levels of size**, with `text_size` (`--text-size`): the title `xl` (a `text`), headings `l`, the body `m` or `s` (shape labels are `s` unless set). Captions and an arrow's label stay `s`.
- **Sizes in pixels**, to plan by: `text_size` s m l xl are 20, 26, 36, 48 px. A shape's label is `s` (20 px) unless set, centred, wrapped at the shape's width less 12 on each side, its lines 1.3 × the size apart. A Latin letter is about 0.55 × the size wide, a CJK character about 1 ×: at 20 px a 12-letter name needs about 130 of width plus 24. A note is 200 wide, its words 20 px with 20 of margin; it grows down.
- **Any size, as written**: a `text` takes `font_size` in px (8–160) instead of `text_size`, and `w` to wrap at that width with `align` (start, middle, end) in it. For finer levels than four (a title 34, a box's name 16, its detail 12), or a box with a name and a smaller detail: draw the shape with no label and put the texts in it yourself — the name at the shape's x, `w` its width, `align: middle`, then the detail under it. `placed` gives each text's size, px and lines. Notes are big (200 × 200): use them for items people will move, and small shapes for the rest.
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

Positions, a unit at a time:

1. Pick the drawing's origin in free space — in a joined session your `area`, else to the right of everything (`read --format json` gives positions and sizes). Plan where each part goes from it (the offsets in `patterns.md`), sizes included, from the sizes in pixels above; a diamond or an ellipse about half as wide again as a rectangle for the same label.
2. Draw one unit of thought per `apply` — the question, then its options, then the arrows and what was chosen — all with that `origin`, each item at its planned `at`. The board shows exactly what you wrote.
3. Read the `placed` it prints before the next unit: a label with `fits: false`, a note that grew taller, an item not `inside` its frame. Make room in the next unit, or `update`/`move` it, rather than drawing on and looking later.

## 4. Check

Once a drawing is done (not after every step):

1. `omq lint --ids …` (what you just made) and fix what it lists. An overlap you meant (a Venn) can stay.
2. `omq look --frame FRAME_ID` (or `--ids`): a small picture. Go through it with these questions, and fix what fails:
   - Can the theme be read in three seconds?
   - Does the eye know where to start and where to go next?
   - Do any arrows cross each other or run across shapes?
   - Is any text a sentence where a keyword would do?
   - Does each colour mean one thing?
   - Is anything drawn as decided that was not decided?
