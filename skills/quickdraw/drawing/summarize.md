# Summarize: a board from material

You are given material — meeting notes, a chat log, a document, a codebase, research findings — and asked to put it on the board as one readable picture. Read `visual-thinking.md` first.

## 1. Read it all, then decide the structure

1. Read all the material before drawing anything.
2. Sort it (`visual-thinking.md`, Think): the theme, then claims, issues, decisions, open points, actions, evidence.
3. Decide the **one message**: what someone should take away if they look for ten seconds. Write it as a sentence for yourself; it becomes the conclusion.
4. Pick the main relation and its pattern (`patterns.md`), and the 2–5 parts the picture has. The step is done when you can name each part and the pattern it uses.

## 2. Lay out the parts

Decide where each part goes before filling any of them:

- A title: the theme as a `text` with `text_size: xl`, and the one message under it as a `text` (`m`).
- The parts: a frame that lines them up (`arrange: "row"`, or `"grid"`), and a frame in it per part — a diagram built inside with `from`/`side`, or a list with `arrange: "column"` (decisions, open points, actions). Each part goes after the last; nothing needs a position.
- A conclusion at the end of the reading order: decisions, open points and next actions.

## 3. Fill

Fill one part at a time, each with its pattern, as one `apply`. Keywords on the board; the material's full wording, when people will want it, in a Markdown card at the side (or a link card to the source). Fix the `problems` a command's result lists before the next part; look at the whole once at the end.

## 4. Finish

Look once (`omq look`) as someone who never saw the material: title → parts → conclusion (`visual-thinking.md`, Check). Then tell the person what you put where, in a few lines.
