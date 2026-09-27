# quickdraw-embed

Embeds for Quickdraw: allowed web pages (YouTube, Vimeo, Figma, CodePen, Google Maps embeds) and sandboxed inline HTML, as live iframes over the board. Zero dependencies beyond `@quickdrawjs/core` (a peer).

```js
import { bindEmbeds, createEmbed, validateEmbed } from 'quickdraw-embed'

const embeds = bindEmbeds(board.editor)             // { rules, maxLive } optional
createEmbed(board.editor.store, { x, y, url: 'https://youtu.be/…' })
createEmbed(board.editor.store, { x, y, kind: 'html', html: '<button>hi</button>' })
embeds.run(id)        // run inline HTML (the viewer's choice; there is also a Run button)
embeds.activate(id)   // hand the pointer to the iframe; Escape or a board click takes it back

openJSON(board.editor, { types: { embed: validateEmbed } }) // quickdraw-import
```

**Needs the `katya4oyu/quickdraw` core** for `registerShapeType`. On the upstream core the module loads, `isEmbedSupported()` is false, `createEmbed` throws and `bindEmbeds` does nothing; `resolveEmbedUrl` and `validateEmbed` still work.

## How it works

- **On the canvas**, a registered `embed` shape type draws a placeholder (the site or "HTML"). Embeds select, move, resize, rotate and export (as the placeholder) like any shape.
- **Over the canvas**, `bindEmbeds` lays the iframes between the board and the selection overlay, following the camera, so selection handles stay usable. Iframes sit above other shapes, as in other whiteboards.
- Iframes ignore the pointer until activated (double-click on desktop, `activate()` elsewhere — iOS sends no dblclick).
- Only embeds near the view are mounted, at most `maxLive` (8) at once; the rest stay placeholders.

Record: `{ type: 'embed', props: { kind: 'url' | 'html', url? | html?, w, h, title? } }`.

## Security boundary

A synced or imported record carries a URL or some HTML, never permission: each viewer decides, when rendering, what it may show.

**URLs**
- https only, and only when a rule allows the page; the rule also rewrites it to the provider's embed URL (YouTube goes to `youtube-nocookie.com`). Pass your own `rules` (`[{ name, embed(url: URL) → embed URL | null }]`) to change the list.
- Sandbox `allow-scripts allow-same-origin allow-popups allow-presentation`: no top navigation. A rule that yields the board's own origin is refused, since `allow-same-origin` would let it reach the board.

**Inline HTML**
- Runs only after the viewer presses **Run**, so HTML placed by others never runs by itself.
- Sandbox `allow-scripts` only: an opaque origin with no access to the board, cookies or storage, no forms, popups or top navigation.
- A CSP placed before the HTML allows no network (`default-src 'none'`; inline scripts and styles, `data:`/`blob:` media). The page can only tighten it.
- A sandbox cannot stop a frame from navigating itself, which would reveal the viewer's IP to the target. The first load is the document; any later load stops the embed.
- At most 200,000 characters.

Example: `examples/quickdraw-embed` (run `npm run dev` at the workspace root).
