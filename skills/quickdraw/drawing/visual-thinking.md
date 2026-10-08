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
| **Open** | not decided yet, a guess, a proposal | grey, or a dashed outline (`stroke-dasharray`), with "?" |
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

Look the relation up in `patterns.md` and use its shape and its units (SVG skeletons, a `<g>` per unit). When nothing fits, a plain row or column of boxes joined by arrows is always readable.

## 3. Place

- **Reading order**: left to right, top to bottom; or from the centre outwards (mind map). The theme is where the eye lands first: top-left, or the centre.
- **Levels of size**, as numbers (`font-size`, px): the title 34, headings 22, a box's name 16, details, captions and the word on an arrow 12–13. A few levels, used the same way throughout. Notes are big (200 × 200, words 20 px): use them for items people will move, and boxes with texts for the rest.
- **Colour means something**: the kinds above, at most 3–4 colours in one drawing, the rest black (`#1d1d1d`) or grey (`#9fa8b2`): blue reads as an action. Say the legend once when it is not obvious.
- **Weight with the line**, as on a whiteboard (there are no fills): a bolder outline (`stroke-width` 5) for the one or two shapes that matter most, 3 for the rest; a dashed outline (`stroke-dasharray="8 6"`) for a proposal, what is out of scope or not certain.
- **Space**: 60–80 between shapes in a drawing, more between drawings. Crowding reads as noise: make room, or split into another frame.
- **Group** what belongs together: one SVG (its frame), or a box drawn round a part of it.
- **Graphic-recording touches**, with what there is:
  - a speaker or a role: a small SVG figure (`image person.svg --width 60`), next to what they said
  - emphasis that stays: `pen circle ID`, `pen underline ID`
  - a quote or an idea: a cloud (a `path` of `Q` curves: arcs are drawn straight); a highlight: a star (`polygon`)
  - the word on an arrow ("causes", "yes"): a `text` (12–13 px) by its middle; arrows that would cross: curve one round the other (a `path` with `Q`)
  - an icon or a small figure: draw it in the SVG with a few strokes

Positions, as numbers:

1. Plan the drawing in its own coordinates (the SVG's `viewBox`): where each part goes (the offsets in `patterns.md`), sizes included — each box big enough for its words (`SKILL.md`, Drawing: a letter's width), a diamond or an ellipse about half as wide again as a box for the same words.
2. Write it as one SVG, a unit of thought per `<g>` in reading order — the question, then its options, then the arrows and what was chosen — and draw it with `omq svg` (in a joined session it goes in your `area`, else in free space; `--at X,Y` puts it elsewhere). People see it drawn a unit at a time.
3. Read the `hits` it prints (words past their box, words on words, a line through words) and fix the SVG: `omq svg FILE --replace FRAME_ID` redraws only what changed.

## 4. Check

Once a drawing is done (not after every step):

1. `hits` (from `omq svg`) are fixed. An overlap you meant (a Venn) can stay.
2. `omq look --frame FRAME_ID`: a small picture of it as drawn. Go through it with these questions, and fix what fails:
   - Can the theme be read in three seconds?
   - Does the eye know where to start and where to go next?
   - Do any arrows cross each other or run across shapes?
   - Is any text a sentence where a keyword would do?
   - Does each colour mean one thing?
   - Is anything drawn as decided that was not decided?
