# quickdraw-markdown

Markdown cards for Quickdraw, drawn on the board's canvas through the core's `registerShapeType` — so they stack, select, rotate, export (PNG, frames) and follow the theme like any other shape. Zero dependencies beyond `@quickdrawjs/core` (a peer).

```js
import { bindMarkdownEditing, createMarkdown, editMarkdown, openMarkdownFile, downloadMarkdown, validateMarkdown } from 'quickdraw-markdown'
import { openJSON } from 'quickdraw-import'

bindMarkdownEditing(board.editor)   // registers the type; double-click a card to edit
const id = createMarkdown(board.editor.store, { x, y, w: 360, md: '# Hello' })
editMarkdown(board.editor, id)      // edit from your own UI (touch devices send no dblclick)

openMarkdownFile(board.editor)      // a .md file → a new card, centered and selected
downloadMarkdown(board.editor.store, id) // a card → <first heading>.md

// JSON files: let quickdraw-import accept cards, checked by this package's validator
openJSON(board.editor, { types: { markdown: validateMarkdown } })
```

**Needs the `katya4oyu/quickdraw` core** for `registerShapeType`. On the upstream core the module still loads, but `isMarkdownSupported()` is false: `createMarkdown` and `openMarkdownFile` fail with a clear error, `bindMarkdownEditing` does nothing, and cards already on a board are not drawn (their records stay intact through sync and saves). `parseMarkdown`, `layoutMarkdown` and `validateMarkdown` do not need the hook.

Every peer must register the type (call `bindMarkdownEditing` or `registerMarkdown`) before remote cards arrive; unregistered types are not drawn.

## Record

`{ type: 'markdown', props: { md, w, h?, color? } }`. The height follows the content, up to `h` (`MAX_H`, 480, when not set): a longer card is cut there, fading out, with "… N more lines" (`hiddenLines`). Resizing changes the width (the text reflows) and, from a corner, the top or the bottom, `h`. The whole text is still the card's: editing shows it, and agents read all of it.

## Links

On a selected card, a click on a link opens it in a new tab (`noopener`), and the pointer shows a hand over it; the first click on a card selects it. Only http and https links open. `linkAt(shape, x, y)` finds the link at a point on a card.

## Supported Markdown

- `#`–`######` headings, paragraphs (every newline is a line break), `-`/`*`/`+` and `1.` lists nested by indent, `>` quotes, fenced code, `---` rules
- inline `**bold**`, `*italic*`, `` `code` ``, `[links](url)` (open from a selected card) — one level, no nesting
- no HTML (shown as text), tables or images
- wraps at spaces and between CJK characters

## Editing

A textarea laid over the card, outside the board so the core's shortcuts stay out of the way; it commits on blur, Escape or ⌘/Ctrl+Enter.

Example: `examples/quickdraw-markdown` (run `npm run examples` at the workspace root).

Toolbar items: `markdownTools()` returns `{ rail, context }` for [`quickdraw-toolbar`](../quickdraw-toolbar) — plain objects, no dependency on it.
