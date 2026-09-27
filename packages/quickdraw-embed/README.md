# quickdraw-embed

Embeds for Quickdraw: allowed web pages (YouTube, Vimeo, Figma, CodePen, Google Maps embeds) and sandboxed inline HTML, as live iframes over the board — and link cards with an Open Graph preview, for any other link and as the fallback when a page is not allowed. Zero dependencies beyond `@quickdrawjs/core` (a peer).

```js
import { bindEmbeds, createEmbed, validateEmbed } from 'quickdraw-embed'

const embeds = bindEmbeds(board.editor)             // { rules, maxLive } optional
createEmbed(board.editor.store, { x, y, url: 'https://youtu.be/…' })
createEmbed(board.editor.store, { x, y, kind: 'html', html: '<button>hi</button>' })
createEmbed(board.editor.store, { x, y, kind: 'link', url, fetchPreview }) // a card, never an iframe
embeds.run(id)        // run inline HTML (the viewer's choice; there is also a Run button)
embeds.activate(id)   // hand the pointer to the iframe; Escape or a board click takes it back
embeds.refresh()      // ask the URL rules again, after the app's allow list changed

openJSON(board.editor, { types: { embed: validateEmbed } }) // quickdraw-import
```

**Needs the `katya4oyu/quickdraw` core** for `registerShapeType`. On the upstream core the module loads, `isEmbedSupported()` is false, `createEmbed` throws and `bindEmbeds` does nothing; `resolveEmbedUrl` and `validateEmbed` still work.

## How it works

- **On the canvas**, a registered `embed` shape type draws a placeholder (the site or "HTML"). Embeds select, move, resize, rotate and export (as the placeholder) like any shape.
- **Over the canvas**, `bindEmbeds` lays the iframes between the board and the selection overlay, following the camera, so selection handles stay usable. Iframes sit above other shapes, as in other whiteboards.
- Iframes ignore the pointer until activated (double-click on desktop, `activate()` elsewhere — iOS sends no dblclick).
- Only embeds near the view are mounted, at most `maxLive` (8) at once; the rest stay placeholders.

Record: `{ type: 'embed', props: { kind: 'url' | 'link' | 'html', url? | html?, w, h, title?, preview? } }`.

## Link cards

A URL's placeholder is a card: its preview image, title, description and site, with an **Open ↗** button (a new tab, `noopener,noreferrer`, http(s) only). It is what a viewer sees when their rules do not allow the page ("Link only"), and all there is for `kind: 'link'`.

- **Fetched once, by the creator, through the app.** Browsers cannot read other sites' HTML (CORS), so `createEmbed` / `addPreview` take the app's `fetchPreview(url) → { title?, description?, siteName?, image?: Blob | data URL }` — a proxy, a desktop shell, anything without CORS. `parseOpenGraph(html, url)` reads the tags for it.
- **Stored in the record** (`props.preview`): text is bounded, the image shrunk to an inline JPEG (≤ 200 KB). Viewers never contact the site, and exporting never taints the canvas.
- Preview text is drawn with `fillText`, never parsed as HTML; `checkPreview` (part of `validateEmbed`) rejects anything but bounded strings and inline raster images.
- `examples/quickdraw-embed/preview-proxy.mjs` is a reference proxy (served at `/preview` by `npm run dev`), with SSRF guards: https on 443 only, public addresses only on every redirect hop, timeouts and size caps.

## Security boundary

A synced or imported record carries a URL or some HTML, never permission: each viewer decides, when rendering, what it may show.

**URLs**
- https only, and only when a rule allows the page; the rule also rewrites it to the provider's embed URL (YouTube goes to `youtube-nocookie.com`).
- The app decides with `rules`: `[{ name, embed(url: URL) → embed URL | null }]`, tried in order. `embed` may be async (return a Promise), so it can consult a file, IndexedDB or any store; the embed shows "Checking…" until it answers, and answers are cached per URL until `refresh()`. A rule that throws or rejects does not allow the URL.

  ```js
  bindEmbeds(editor, { rules: [...DEFAULT_RULES, { name: 'Docs', embed: async (u) => (await allowList()).has(u.hostname) ? u.href : null }] })
  bindEmbeds(editor, { rules: [] }) // no URL embeds at all
  ```
- A URL that is not allowed shows as its link card, marked "Link only": only what was stored when it was created (or just its host). No iframe is created, so the browser never contacts it.
- The check happens only when rendering, for local, synced and imported records alike; `validateEmbed` (for imports) checks just the record's shape.
- Sandbox `allow-scripts allow-same-origin allow-popups allow-presentation`: no top navigation. A rule that yields the board's own origin is refused, since `allow-same-origin` would let it reach the board.

**Inline HTML**
- Runs only after the viewer presses **Run**, so HTML placed by others never runs by itself.
- Sandbox `allow-scripts` only: an opaque origin with no access to the board, cookies or storage, no forms, popups or top navigation.
- A CSP placed before the HTML allows no network (`default-src 'none'`; inline scripts and styles, `data:`/`blob:` media). The page can only tighten it.
- A sandbox cannot stop a frame from navigating itself, which would reveal the viewer's IP to the target. The first load is the document; any later load stops the embed.
- At most 200,000 characters.

Example: `examples/quickdraw-embed` (run `npm run dev` at the workspace root).
