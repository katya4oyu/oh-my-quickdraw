# quickdraw-gif

Animated GIFs that move on a Quickdraw board. The core draws images on its canvas, and a canvas shows only a GIF's first frame; so over each GIF in view this lays the GIF itself as an `<img>`, which the browser plays. The canvas keeps the first frame beneath it, so exports, thumbnails and pages without this package still show the GIF, still.

```js
import { bindGifs } from 'quickdraw-gif'
const gifs = bindGifs(editor) // { refresh, destroy }
```

- A GIF with something drawn over it (a note on top, say) keeps still, so what is on top stays on top.
- With reduced motion, GIFs keep still.
- At most `max` (12) GIFs play at once: the topmost in view.
- Getting a GIF onto the board: drop or paste the **file** (the core keeps images up to 2048 px as they are). An image copied from a web page usually reaches the clipboard as a PNG, a still. `quickdraw image party.gif` puts one from the command line.

`isGifSrc`, `gifsOf(store)` and `coveredIn(sorted, shape)` are the pieces it decides with.
