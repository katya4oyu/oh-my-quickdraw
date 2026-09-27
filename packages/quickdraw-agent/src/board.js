// Opens a board for an agent: live through the example server's relay, or
// from a JSON file. Either way the agent gets a core Store bound exactly as a
// browser's is — Yjs sync, frame rules, Markdown and embed types — so what
// it writes behaves like any peer's edit.
import { readFile, writeFile } from 'node:fs/promises'
import { installMeasure } from './measure.js'

installMeasure() // before the core lays out any text

const { Store } = await import('@quickdrawjs/core')
const { bindFrames } = await import('quickdraw-frames')
const { registerMarkdown } = await import('quickdraw-markdown')
const { registerEmbed } = await import('quickdraw-embed')

// { url } (ws://…/ws) or { file } (a board JSON). Resolves to { store, cursor(x, y), close() }.
export async function openBoard({ url, file, name = 'Agent', color } = {}) {
  registerMarkdown()
  registerEmbed()
  const store = new Store()
  if (url) {
    const Y = await import('yjs')
    const { bindYjs } = await import('quickdraw-yjs')
    const { connectRelay } = await import('./relay.js')
    const ydoc = new Y.Doc()
    const relay = await connectRelay(ydoc, url, { name, color })
    bindYjs(store, ydoc) // the doc already holds the board: the store loads it
    bindFrames(store)
    return { store, cursor: relay.cursor, close: relay.close }
  }
  if (file) {
    let data = null
    try { data = JSON.parse(await readFile(file, 'utf8')) } catch (e) { if (e.code !== 'ENOENT') throw e }
    const records = data?.document?.store ? Object.values(data.document.store) // a store snapshot
      : data ? [...(data.shapes || []), ...Object.values(data.assets || {})] : [] // quickdraw-export's format
    store.loadSnapshot({ document: { store: Object.fromEntries(records.map((r) => [r.id, r])) } })
    bindFrames(store)
    return {
      store,
      cursor() {},
      async close() {
        const shapes = store.shapes().filter((s) => s.typeName === 'shape')
        const assets = Object.fromEntries(store.all().filter((r) => r.typeName === 'asset').map((a) => [a.id, a]))
        await writeFile(file, JSON.stringify({ quickdraw: 1, shapes, assets }, null, 2) + '\n')
      },
    }
  }
  throw new Error('open a board with { url } or { file }')
}
