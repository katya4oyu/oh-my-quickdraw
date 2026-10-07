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
| **Evidence** | numbers, quotes, examples behind a claim | a Markdown card (or a short text) beside its claim |

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

Draw only what a picture says better: when a table or a paragraph would say it as well, write that (a Markdown card). Keep one drawing small — about 9 shapes, 12 arrows and 1–2 highlighted (a rule of thumb, not a limit to fill); with more, split it into an overview and its details, side by side.

## 2. Pick a pattern

Look the relation up in `patterns.md` and use its shape and its `apply` skeleton. When nothing fits, a plain row or column of shapes joined by arrows is always readable.

## 3. Place

**Each piece in the element made for it** — chosen by what the piece is for, not by how long it is. Length only tells whether it fits the element you chose; when it does not, cut words, move the detail to a card beside it, or split the drawing, whichever keeps the point.

| Element | For | Holds | Not for |
|---|---|---|---|
| Sticky note | one idea or remark that people will move, sort and group; who wrote it matters | one idea, in a short line | several points or an explanation in one note (split it; detail goes in a card); a fixed label nothing will move |
| Shape | a thing or a concept in a diagram; it means what its arrows and its place say | its name: a keyword | a sentence (the name in the shape, the rest beside it or in a card) |
| Arrow | one relation; its label names the kind ("causes", "yes") | a word or two | a link the layout already shows; two arrows between the same shapes for the same thing |
| Text | the title, headings, a caption on how to read the drawing | a few words | body text (a card) |
| Markdown card | what is read rather than seen: full wording, sources, evidence, steps | paragraphs, lists, tables, links | carrying the point alone (then there is no drawing); far from what it explains — put it beside |
| Link card, embed (`embed URL`) | something outside the board: a page, a video, a design | the URL, with a line beside it on why it is there | a URL typed into a note, a shape or a text |
| Frame | one drawing: one pattern, one point | its title: what the drawing says, not a category | two patterns or two points in one frame |
| Pen | emphasis that stays: a circle, an underline | — | more than one or two places |

**One meaning per look**, kept from the first shape to the last — a reader learns how to read the drawing once:
- In one drawing a colour, a shape and a line style each mean one thing, and one thing always looks the same. Decide them before drawing; say the legend once when it is not obvious.
- Arrows in one drawing mean one kind of relation (order, or cause). Another kind gets another line style, named once.
- Small differences mean nothing: a slightly bigger box or a similar shade reads as the same. Make a difference big, or none.
- Hand-drawn lines (`"dash": "draw"`) are the board's texture, the same everywhere; they mean nothing. Dashed or hatched means only "not decided".
- Near means related: pieces of a group close together, wide gaps between groups.

- **Reading order**: left to right, top to bottom; or from the centre outwards (mind map). The theme is where the eye lands first: top-left, or the centre.
- **Levels of size**, with `text_size` (`--text-size`): the title `xl` (a `text`), headings `l`, the body `m` or `s` (shape labels are `s` unless set). Captions and an arrow's label stay `s`. Notes are big (200 × 200).
- **Colour means something**: the kinds above, at most 3–4 colours in one drawing, the rest black or grey. A shape with no `color` is **blue**: give `"color": "black"` to neutral shapes, or blue reads as an action. Say the legend once when it is not obvious.
- **Fill for weight**: `"fill": "solid"` (a light tint of the colour) for the one or two shapes that matter most; `"fill": "none"` for the rest; `"pattern"` (hatched) for what is out of scope or not yet decided; `dashed` for a proposal or a link that is not certain.
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

Once a drawing is done (not after every step):

1. `omq lint --ids …` (what you just made) and fix what it lists. An overlap you meant (a Venn) can stay.
2. `omq look --frame FRAME_ID` (or `--ids`): a small picture. Go through it with these questions, and fix what fails:
   - Can the theme be read in three seconds?
   - Does the eye know where to start and where to go next?
   - Do any arrows cross each other or run across shapes?
   - Is any text a sentence where a keyword would do?
   - Does any colour, shape or line style mean two things, or one thing look two ways?
   - Take each piece away in your mind: if the point still reads, take it away.
   - Is anything drawn as decided that was not decided?
