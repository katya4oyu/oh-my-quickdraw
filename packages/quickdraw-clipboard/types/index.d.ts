/** A shape's text, as it reads: a note's or a label, a card's Markdown, a ticket's title. */
export function shapeText(shape: { props?: Record<string, unknown> }): string
/** What copying these shapes puts on the clipboard (null for none): the shapes in html (data-quickdraw), their text. */
export function clipboardOf(store: unknown, ids: Iterable<string>, options?: { textOf?: (shape: any) => string }): { html: string, text: string } | null
/** The board payload in what was copied, or null. */
export function payloadIn(html: string | null | undefined, text: string | null | undefined): { quickdraw: 1, shapes: any[], assets?: Record<string, any> } | null
/** Puts a board's shapes in, checked first (quickdraw-import); selects them. */
export function pasteShapes(editor: unknown, data: unknown, options?: { types?: Record<string, (shape: any) => string | null> }): string[]
/** Text pasted from elsewhere, as a note in the middle of the view. */
export function pasteNote(editor: unknown, text: string): string | null
/** Copy and paste for a board through the browser's clipboard events (any browser, plain http too). Returns an unbind. */
export function bindClipboard(editor: unknown, options?: {
  types?: Record<string, (shape: any) => string | null>
  text?: (editor: any, text: string) => unknown
  textOf?: (shape: any) => string
}): () => void
/** Copies a text, with navigator.clipboard or without it (plain http). */
export function copyText(text: string): Promise<boolean>
