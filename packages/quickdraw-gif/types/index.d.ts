/** Whether an image source is a GIF (a data URL or a .gif URL). */
export function isGifSrc(src: unknown): boolean
/** The GIF image shapes of a board, each with its source. */
export function gifsOf(store: unknown): [shape: { id: string }, src: string][]
/** Whether something is drawn over a shape; `sorted`: the shapes bottom to top. */
export function coveredIn(sorted: { id: string }[], shape: { id: string }): boolean
/** Plays the GIFs in view (over the canvas, which keeps their first frame); still with reduced motion. */
export function bindGifs(editor: unknown, options?: { max?: number }): { refresh(): void, destroy(): void }
