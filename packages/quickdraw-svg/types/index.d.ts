export type PenColor = 'black' | 'grey' | 'light-violet' | 'violet' | 'blue' | 'light-blue' | 'yellow' | 'orange' | 'green' | 'light-green' | 'light-red' | 'red'

/** A pen stroke along an element's outline (or an arrowhead), in the SVG's coordinates. */
export interface SvgStroke { kind: 'stroke', el: string, tag: string, unit: number, sig: string, points: [number, number][], color: PenColor, size: 's' | 'm' | 'l' | 'xl' }
/** A line of words where the SVG put it: `at` is its top-left. */
export interface SvgText { kind: 'text', el: string, tag: 'text', unit: number, sig: string, text: string, at: [number, number], fontSize: number, color: PenColor, w?: number, align?: 'middle' | 'end' }

export interface SvgDrawing {
  w: number
  h: number
  /** its <title> */
  title: string
  /** drawn on dark paper (its light ink is drawn as the board's black) */
  dark: boolean
  /** the units, in order: a top-level <g>, a box and what is in it, a run of loose words or lines (named by their first element) */
  units: string[]
  parts: (SvgStroke | SvgText)[]
  /** what could not be carried, and how often */
  dropped: Record<string, number>
  /** what reads badly once drawn: words past their box, words on words, a line through words */
  hits: string[]
}

export function readSvg(source: string): SvgDrawing
/** What each element is, in a few words (a box, an arrow, words "…"), by its el. */
export function svgElements(source: string): Record<string, string>
export function parseXml(source: string): { tag: string, attrs: Record<string, string>, children: unknown[] } | null
export function textWidth(text: string, px: number): number
