// The packages' toolbar definitions, checked against what the toolbar expects.
import { describe, it, expect } from 'vitest'
import { Store } from '@quickdrawjs/core'
import { contextItems, railItems } from '../src/layout.js'
import { frameTools, createFrame, bindFrames } from '../../quickdraw-frames/src/index.js'
import { markdownTools, createMarkdown } from '../../quickdraw-markdown/src/index.js'
import { embedTools, createEmbed } from '../../quickdraw-embed/src/index.js'
import { importTool } from '../../quickdraw-import/src/index.js'
import { exportTool } from '../../quickdraw-export/src/index.js'

const embeds = { run() {}, activate() {} }
const sets = { frames: frameTools(), markdown: markdownTools(), embed: embedTools(embeds) }
const all = [
  ...Object.values(sets).flatMap((t) => [...t.rail, ...t.context]),
  importTool(), exportTool(),
]
const flat = (items) => items.flatMap((it) => (it === '-' ? [] : [it, ...flat(Array.isArray(it.menu) ? it.menu : [])]))

// the parts of the Editor the items touch
function editorFor(store, selected) {
  return {
    store, selection: new Set(selected), tool: 'draw',
    viewportPageBounds: () => ({ x: 0, y: 0, w: 1000, h: 800 }),
    setTool(t) { this.tool = t }, setSelection(ids) { this.selection = new Set(ids) },
  }
}

describe('toolbar definitions', () => {
  it('are well formed, with unique ids', () => {
    const items = flat(all)
    for (const it of items) {
      expect(typeof it.id, it.id).toBe('string')
      expect(it.title, it.id).toBeTruthy()
      expect(typeof it.run === 'function' || Array.isArray(it.menu), it.id).toBe(true)
    }
    // buttons on a bar need an icon; entries inside a menu may go without
    for (const it of Object.values(sets).flatMap((t) => [...t.rail, ...t.context])) expect(it.icon, it.id).toMatch(/^<svg /)
    const ids = items.map((it) => it.id)
    expect(new Set(ids).size).toBe(ids.length)
  })

  it('put each selection bar item on its own kind of shape only', () => {
    const store = new Store()
    bindFrames(store)
    const frame = createFrame(store, { x: 0, y: 0, w: 100, h: 100 })
    const card = createMarkdown(store, { x: 500, y: 0 })
    const page = createEmbed(store, { x: 900, y: 0, url: 'https://youtu.be/abc' })
    const html = createEmbed(store, { x: 900, y: 500, kind: 'html', html: '' })
    const context = Object.values(sets).flatMap((t) => t.context)
    const ids = (sel) => contextItems(context, editorFor(store, [sel])).map((it) => it.id)
    expect(ids(frame)).toEqual(['frame-rename', 'frame-aspect', 'frame-title-place', 'frame-export'])
    expect(ids(card)).toEqual(['markdown-edit', 'markdown-save'])
    expect(ids(page)).toEqual(['embed-use', 'embed-thumbnail', 'embed-open'])
    expect(ids(html)).toEqual(['embed-use', 'embed-thumbnail'])
  })

  it('run against the board: a frame at a ratio, then a new ratio for it', () => {
    const store = new Store()
    bindFrames(store)
    const editor = editorFor(store, [])
    const { rail, context } = frameTools()
    rail[0].menu.find((it) => it.title === 'Frame 16:9').run({ editor })
    const [id] = editor.selection
    expect(store.get(id).aspect).toBeCloseTo(16 / 9)
    const square = context.find((it) => it.id === 'frame-aspect').menu.find((it) => it.title === '1:1')
    square.run({ editor, shape: store.get(id) })
    const f = store.get(id)
    expect(f.props.w).toBeCloseTo(f.props.h)
    expect(square.checked({ shape: f })).toBe(true)
  })

  it('leave the HTML entry out when HTML is off', () => {
    const ids = flat(embedTools(embeds, { html: false }).rail).map((it) => it.id)
    expect(ids).not.toContain('embed-html')
    expect(railItems(frameTools().rail, {}).length).toBe(1)
  })
})
