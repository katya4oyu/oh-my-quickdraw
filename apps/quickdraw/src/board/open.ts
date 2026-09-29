// Opens a board: live through the relay of `quickdraw serve`, or from a JSON
// file. Either way the result is a core Store bound exactly as a browser's
// is — Yjs sync, frame and kanban rules, Markdown, embed and ticket types —
// so what gets written behaves like any peer's edit.
import { readFile, writeFile } from 'node:fs/promises'
import type { BoardRecord, Store as StoreType } from '@quickdrawjs/core'
import { installMeasure } from 'quickdraw-agent'
import type { Relay } from './relay.ts'

installMeasure() // before the core lays out any text

const { Store } = await import('@quickdrawjs/core')
const { bindFrames } = await import('quickdraw-frames')
const { registerMarkdown } = await import('quickdraw-markdown')
const { registerEmbed } = await import('quickdraw-embed')
const { registerTicket, bindKanban } = await import('quickdraw-tickets')

export interface Board {
  store: StoreType
  cursor(x: number | null, y: number | null): void
  close(): Promise<void>
  /** a live board's connection, for an agent's messages */
  relay?: Relay
}

export type BoardSource = ({ url: string, file?: undefined } | { file: string, url?: undefined }) & { name?: string, color?: string }

export async function openBoard({ url, file, name = 'Agent', color }: BoardSource): Promise<Board> {
  registerMarkdown()
  registerEmbed()
  registerTicket()
  const store = new Store()
  if (url) {
    const Y = await import('yjs')
    const { bindYjs } = await import('quickdraw-yjs')
    const { connectRelay } = await import('./relay.ts')
    const ydoc = new Y.Doc()
    const relay = await connectRelay(ydoc, url, { name, color })
    bindYjs(store, ydoc) // the doc already holds the board: the store loads it
    bindFrames(store)
    bindKanban(store)
    return { store, cursor: relay.cursor, close: relay.close, relay }
  }
  if (!file) throw new Error('open a board with { url } or { file }')
  let data: { document?: { store: Record<string, BoardRecord> }, shapes?: BoardRecord[], assets?: Record<string, BoardRecord> } | null = null
  try { data = JSON.parse(await readFile(file, 'utf8')) } catch (e) { if ((e as NodeJS.ErrnoException).code !== 'ENOENT') throw e }
  const records = data?.document?.store ? Object.values(data.document.store) // a store snapshot
    : data ? [...(data.shapes || []), ...Object.values(data.assets || {})] : [] // quickdraw-export's format
  store.loadSnapshot({ document: { store: Object.fromEntries(records.map((r) => [r.id, r])) } })
  bindFrames(store)
  bindKanban(store)
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
