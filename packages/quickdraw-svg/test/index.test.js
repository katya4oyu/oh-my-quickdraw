import { describe, expect, it } from 'vitest'
import { readSvg, svgElements } from '../src/index.js'

const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 400 200" width="400" height="200">
  <title>Two boxes</title>
  <defs>
    <marker id="a" markerWidth="10" markerHeight="10"><path d="M0 0L10 5L0 10Z"/></marker>
    <style>.box { fill: #eef2ff; stroke: #4263eb; stroke-width: 2 } .name { font-size: 16px; fill: #1d1d1d }</style>
  </defs>
  <rect width="400" height="200" fill="#ffffff"/>
  <rect id="left" class="box" x="20" y="40" width="120" height="80" rx="10"/>
  <text class="name" x="80" y="85" text-anchor="middle">Page</text>
  <rect class="box" x="260" y="40" width="120" height="80"/>
  <text class="name" x="280" y="70">Relay<tspan x="280" dy="20">and more</tspan></text>
  <path d="M140 80 H260" stroke="#e03131" stroke-width="3" marker-end="url(#a)"/>
  <circle cx="390" cy="10" r="40" fill="#000" opacity=".2"/>
</svg>`

describe('readSvg', () => {
  const d = readSvg(svg)
  it('reads its size and title', () => {
    expect([d.w, d.h, d.title]).toEqual([400, 200, 'Two boxes'])
  })
  it('draws in document order, a box and what is in it as one unit', () => {
    expect(d.parts.map((p) => p.el)).toEqual(['left', 'text1', 'rect3', 'text2', 'text2', 'path1', 'path1'])
    expect(d.parts.map((p) => p.unit)).toEqual([0, 0, 1, 1, 1, 2, 2])
  })
  it('keeps the page out, and fills: a box is its outline in its stroke colour', () => {
    const box = d.parts[0]
    expect(box).toMatchObject({ kind: 'stroke', tag: 'rect', color: 'blue', size: 'm' })
    const xs = box.points.map((p) => p[0]), ys = box.points.map((p) => p[1])
    expect([Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)]).toEqual([20, 140, 40, 120])
  })
  it('puts words where they were, centred ones with their width', () => {
    const page = d.parts[1]
    expect(page).toMatchObject({ kind: 'text', text: 'Page', fontSize: 16, color: 'black', align: 'middle' })
    expect(page.at[0] + page.w / 2).toBeCloseTo(80, 0)
    expect(d.parts.filter((p) => p.el === 'text2').map((p) => [p.text, p.at[1]])).toEqual([['Relay', 53.2], ['and more', 73.2]])
  })
  it('gives a line with a marker its arrowhead', () => {
    const [line, headStroke] = d.parts.filter((p) => p.el === 'path1')
    expect(line).toMatchObject({ tag: 'arrow', color: 'red', size: 'm' })
    expect(headStroke.points[1]).toEqual([260, 80])
  })
  it('lists what it could not carry', () => {
    expect(d.dropped).toEqual({ 'faint element (opacity under 0.5)': 1 })
  })
  it('says what each element is', () => {
    expect(svgElements(svg)).toMatchObject({ left: 'a box', text1: 'words "Page"', path1: 'an arrow' })
  })
})

describe('dark paper', () => {
  it('draws its light ink as black, and boxes with only a fill as grey outlines', () => {
    const d = readSvg(`<svg viewBox="0 0 100 100"><rect width="100" height="100" fill="#101b31"/><rect x="10" y="10" width="50" height="30" fill="#1e3348"/><text x="12" y="30" fill="#f1f5f9" font-size="12">Hi</text></svg>`)
    expect(d.dark).toBe(true)
    expect(d.parts.map((p) => [p.kind, p.color])).toEqual([['stroke', 'grey'], ['text', 'black']])
  })
})

describe('hits', () => {
  it('says what will read badly once drawn: words past their box, words on words, a line through words', () => {
    const d = readSvg(`<svg viewBox="0 0 400 200">
      <rect x="10" y="10" width="80" height="40" fill="none" stroke="#000"/><text x="20" y="35" font-size="16">A long name here</text>
      <text x="200" y="100" font-size="16">One</text><text x="205" y="104" font-size="16">Two</text>
      <line x1="150" y1="150" x2="350" y2="150" stroke="#000"/><text x="230" y="155" font-size="14">across</text></svg>`)
    expect(d.hits).toEqual([
      'words "A long name here" (text1) run past the edge of rect1 by 73 px',
      'words "One" (text2) on words "Two" (text3)',
      'a line (line1) through words "across" (text4)',
    ])
  })
})
