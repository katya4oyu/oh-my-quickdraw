import { describe, it, expect } from 'vitest'
import { railItems, contextItems, placeBar, placeTip } from '../src/layout.js'

const item = (id, extra = {}) => ({ id, title: id, icon: '', ...extra })
const editorWith = (shapes, selected = []) => ({
  selection: new Set(selected),
  store: { get: (id) => shapes.find((s) => s.id === id) },
})

describe('railItems', () => {
  it('drops unavailable items and stray dividers', () => {
    const items = ['-', item('a'), '-', '-', item('b', { available: () => false }), '-', item('c'), '-']
    expect(railItems(items, {}).map((it) => it.id ?? it)).toEqual(['a', '-', 'c'])
  })
})

describe('contextItems', () => {
  const frame = { id: 'f', isFrame: true }
  const card = { id: 'm', type: 'markdown' }
  const items = [
    item('rename', { when: (s) => s.isFrame }),
    item('export', { when: (s) => s.isFrame }),
    '-',
    item('edit', { when: (s) => s.type === 'markdown' }),
    item('always'), // no `when`: never on the selection bar
  ]

  it('shows the items for the one selected shape', () => {
    expect(contextItems(items, editorWith([frame, card], ['f'])).map((it) => it.id ?? it)).toEqual(['rename', 'export'])
    expect(contextItems(items, editorWith([frame, card], ['m'])).map((it) => it.id)).toEqual(['edit'])
  })

  it('shows nothing for no selection, several shapes, or a shape no item wants', () => {
    expect(contextItems(items, editorWith([frame, card], []))).toEqual([])
    expect(contextItems(items, editorWith([frame, card], ['f', 'm']))).toEqual([])
    expect(contextItems(items, editorWith([{ id: 'g', type: 'geo' }], ['g']))).toEqual([])
  })
})

describe('placeBar', () => {
  const frame = { w: 400, h: 800 }
  const bar = { w: 100, h: 40 }

  it('centres the bar above the selection, clear of the rotate handle', () => {
    expect(placeBar({ x: 100, y: 300, w: 200, h: 100 }, bar, frame)).toEqual({ left: 150, top: 220, side: 'above' })
  })
  it('goes below when there is no room above', () => {
    expect(placeBar({ x: 100, y: 60, w: 200, h: 100 }, bar, frame)).toMatchObject({ top: 200, side: 'below' })
  })
  it('stays inside the container', () => {
    expect(placeBar({ x: -300, y: 300, w: 100, h: 100 }, bar, frame).left).toBe(8)
    expect(placeBar({ x: 390, y: 300, w: 200, h: 100 }, bar, frame).left).toBe(292)
    expect(placeBar({ x: 0, y: -500, w: 100, h: 2000 }, bar, frame).top).toBe(752) // a huge selection: pinned inside
  })
})

describe('placeTip', () => {
  const frame = { w: 1000, h: 600 }
  const tip = { w: 80, h: 24 }

  it('goes beside a button in a vertical bar, towards the middle', () => {
    expect(placeTip({ x: 950, y: 100, w: 36, h: 36 }, { vertical: true }, tip, frame)).toEqual({ left: 862, top: 106, side: 'left' }) // the rail
    expect(placeTip({ x: 10, y: 100, w: 36, h: 36 }, { vertical: true }, tip, frame)).toEqual({ left: 54, top: 106, side: 'right' }) // the core's tools
  })
  it('goes below a button in a horizontal bar, above when there is no room', () => {
    expect(placeTip({ x: 300, y: 20, w: 36, h: 36 }, { vertical: false }, tip, frame)).toEqual({ left: 278, top: 64, side: 'below' })
    expect(placeTip({ x: 300, y: 550, w: 36, h: 36 }, { vertical: false }, tip, frame)).toMatchObject({ top: 518, side: 'above' })
  })
  it('stays inside the container', () => {
    expect(placeTip({ x: 0, y: 20, w: 36, h: 36 }, { vertical: false }, tip, frame).left).toBe(4)
    expect(placeTip({ x: 980, y: 20, w: 20, h: 36 }, { vertical: false }, tip, frame).left).toBe(916)
  })
})
