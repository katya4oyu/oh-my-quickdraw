# Summarize: a board from material

You are given material — meeting notes, a chat log, a document, a codebase, research findings — and asked to put it on the board as one readable picture. Read `visual-thinking.md` first.

## 1. Read it all, then decide the structure

1. Read all the material before drawing anything.
2. Sort it (`visual-thinking.md`, Think): the theme, then claims, issues, decisions, open points, actions, evidence.
3. Decide the **one message**: what someone should take away if they look for ten seconds. Write it as a sentence for yourself; it becomes the conclusion.
4. Pick the main relation and its pattern (`patterns.md`), and the 2–5 parts the picture has. The step is done when you can name each part and the pattern it uses.

## 2. Lay out the parts

Decide where each part goes before filling any of them:

- A title: the theme in 34 px and the one message under it in 18 px, as a small SVG of its own (`omq svg`) at the top.
- The parts: an SVG per part, in reading order (each is its own frame, its own size; `--at` beside the last), or a bento grid (`omq bento`, one cell per part, the main part with more span) when parts are lists of notes that will grow. Line the frames up with `tidy FRAME,FRAME,…` (or `arrange`).
- A conclusion at the end of the reading order: decisions, open points and next actions.

## 3. Fill

Fill one part at a time, each with its pattern: one SVG, a unit of thought per `<g>`, so the part is drawn as people watch (joined: write the next part while it is drawn). Keywords on the board; the material's full wording, when people will want it, in a Markdown card at the side (or a link card to the source). Fix each part's `hits` before the next; look at the whole once at the end (`omq look`).

## 4. Finish

Re-read the board as someone who never saw the material: title → parts → conclusion. Fix what the Check questions catch. Then tell the person what you put where, in a few lines.
