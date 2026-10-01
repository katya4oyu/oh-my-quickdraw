# quickdraw-clipboard

Copy and paste on a Quickdraw board through the browser's own clipboard events: no permission prompt, any browser, and plain http too — where `navigator.clipboard`, which the core's ⌘C / ⌘V use, does not exist (a board opened as `http://192.168.…`, say).

```js
import { bindClipboard } from 'quickdraw-clipboard'
bindClipboard(editor, { types: { markdown: validateMarkdown } }) // returns an unbind
```

- **⌘C / ⌘X / ⌘V** on the board are taken before the core sees them, and the focus goes for a moment to a hidden textarea (some browsers send copy, cut and paste events only to something editable). The core is not changed.
- **Copy / cut**: the shapes for a board (their JSON, base64, in `text/html` as `data-quickdraw`) and their text for anywhere else (`text/plain`: notes, labels, cards, tickets; shapes with no text put their JSON there instead).
- **Paste**: images (the core's `importImageBlobs`), a board's shapes (checked by [`quickdraw-import`](../quickdraw-import) first; `types` for other packages' shapes, as it takes them), SVG code (as an image), and any other text as a note (`text(editor, text)` to make it something else). A paste that comes as an event of its own (a phone, a menu) is handled the same way.
- `copyText(text)` copies a text with or without `navigator.clipboard`.

A phone's own "Paste" menu on a page that is not https or localhost cannot read the clipboard; a keyboard can.

The pieces: `clipboardOf(store, ids)`, `payloadIn(html, text)`, `pasteShapes(editor, data, { types })`, `pasteNote(editor, text)`, `shapeText(shape)`. Example: `examples/quickdraw-clipboard`.
