// Renders boards to PNG in a reused headless Chrome, with the core's own
// drawing (exportImage / exportFrame) — so the image is what a browser shows.
//
// Kind to the machine (see chrome.js), and leak-free under reuse:
// - one Chrome per Renderer, launched on first use
// - every render gets its own browser context and page, both disposed after
// - Chrome closes when idle (idleMs) and restarts after maxRenders
// - the page loads its code from disk through DevTools request interception
//   (no local server, no port), and every other request is refused
import { readFile } from 'node:fs/promises'
import { dirname, extname, resolve, sep } from 'node:path'
import { createRequire } from 'node:module'
import type { BoardRecord, Store } from '@quickdrawjs/core'
import { launchChrome, type Chrome } from './chrome.ts'

const ORIGIN = 'https://quickdraw.render'

// the files the page may load: each package's directory, by URL prefix
const require = createRequire(import.meta.url)
const pkgRoot = (spec: string) => dirname(dirname(require.resolve(spec)))
const ROOTS: Record<string, string> = {
  core: pkgRoot('@quickdrawjs/core'),
  frames: pkgRoot('quickdraw-frames'),
  markdown: pkgRoot('quickdraw-markdown'),
  embed: pkgRoot('quickdraw-embed'),
  tickets: pkgRoot('quickdraw-tickets'),
  members: pkgRoot('quickdraw-members'),
  boards: pkgRoot('quickdraw-boards'),
}
const TYPES: Record<string, string> = { '.js': 'text/javascript', '.css': 'text/css', '.html': 'text/html' }

const PAGE = `<!doctype html><html><head><meta charset="utf-8">
<link rel="stylesheet" href="/core/src/quickdraw.css">
<style>html,body{margin:0;width:100%;height:100%}#b{position:fixed;inset:0}</style>
<script type="importmap">{ "imports": { "@quickdrawjs/core": "/core/src/index.js", "quickdraw-frames": "/frames/src/index.js" } }</script>
</head><body><div id="b"></div><script type="module">
import { createQuickdraw } from '@quickdrawjs/core'
import { registerMarkdown } from '/markdown/src/index.js'
import { registerEmbed } from '/embed/src/index.js'
import { registerTicket } from '/tickets/src/index.js'
import { registerMemberCard } from '/members/src/card.js'
import { registerBoardCard } from '/boards/src/index.js'
import { exportFrame } from '/frames/src/index.js'
import { assetImage } from '/core/src/shapes.js'
registerMarkdown(); registerEmbed(); registerTicket(); registerMemberCard(); registerBoardCard() // embeds draw as their placeholders: no iframes here
const { editor } = createQuickdraw({ container: document.getElementById('b'), watermark: false })
window.render = async ({ records, frame, ids, background, scale, theme }) => {
  editor.store.loadSnapshot({ document: { store: Object.fromEntries(records.map((r) => [r.id, r])) } })
  if (theme) editor.setTheme(theme)
  await document.fonts.ready
  // the core's export draws an image only once its own image cache has it (it
  // waits on a copy): on a page that has not drawn the board, fill that first
  const assets = records.filter((r) => r.type === 'image' && r.props?.assetId).map((r) => r.props.assetId)
  for (let i = 0; i < 200 && !assets.every((id) => assetImage(editor.store, id)); i++) await new Promise((r) => setTimeout(r, 25))
  const blob = frame ? await exportFrame(editor, frame, { scale, background })
    : await editor.exportImage({ ids: ids ? new Set(ids) : null, background, scale })
  if (!blob) return null
  const bytes = new Uint8Array(await blob.arrayBuffer())
  let s = ''
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000))
  return btoa(s)
}
window.ready = true
</script></body></html>`

// what the page may load (exported for tests): its own HTML, and files inside the package roots
export async function serve(url: string): Promise<{ body: Buffer, type: string } | null> {
  const path = decodeURIComponent(new URL(url).pathname)
  if (path === '/render.html') return { body: Buffer.from(PAGE), type: TYPES['.html'] }
  const [, prefix, ...rest] = path.split('/')
  const root = ROOTS[prefix]
  if (!root) return null
  const file = resolve(root, rest.join('/'))
  if (!file.startsWith(root + sep) || !TYPES[extname(file)]) return null
  try { return { body: await readFile(file), type: TYPES[extname(file)] } } catch { return null }
}

export interface RenderOptions {
  /** the board's records (store.all()) */
  records: BoardRecord[]
  /** a frame's contents only */
  frame?: string
  /** these shapes only */
  ids?: string[]
  background?: boolean
  scale?: number
  theme?: 'light' | 'dark'
}

export class Renderer {
  idleMs: number
  maxRenders: number
  chromePath?: string
  chrome: Chrome | null = null
  renders = 0
  queue: Promise<unknown> = Promise.resolve()
  idle: NodeJS.Timeout | undefined

  constructor({ idleMs = 30_000, maxRenders = 100, chromePath }: { idleMs?: number, maxRenders?: number, chromePath?: string } = {}) {
    this.idleMs = idleMs
    this.maxRenders = maxRenders
    this.chromePath = chromePath
  }

  // one render at a time; each in its own context, disposed afterwards
  render(opts: RenderOptions): Promise<Buffer | null> {
    const run = this.queue.then(() => this.#render(opts))
    this.queue = run.catch(() => {})
    return run
  }

  async #render({ records, frame, ids, background = true, scale = 2, theme = 'light' }: RenderOptions): Promise<Buffer | null> {
    clearTimeout(this.idle)
    if (this.chrome && (this.chrome.closed || this.renders >= this.maxRenders)) await this.#shutdown()
    if (!this.chrome) { this.chrome = await launchChrome({ path: this.chromePath }); this.renders = 0 }
    const chrome = this.chrome
    this.renders++
    const { browserContextId } = await chrome.send('Target.createBrowserContext', { disposeOnDetach: true })
    let targetId: string | undefined
    try {
      ;({ targetId } = await chrome.send('Target.createTarget', { url: 'about:blank', browserContextId, width: 1280, height: 800 }))
      const { sessionId } = await chrome.send('Target.attachToTarget', { targetId, flatten: true })
      const off = chrome.on('Fetch.requestPaused', async ({ requestId, request }: { requestId: string, request: { url: string } }, sid) => {
        if (sid !== sessionId) return
        const hit = request.url.startsWith(ORIGIN + '/') ? await serve(request.url) : null
        const reply = hit
          ? chrome.send('Fetch.fulfillRequest', { requestId, responseCode: 200, responseHeaders: [{ name: 'Content-Type', value: hit.type }], body: hit.body.toString('base64') }, sessionId)
          : chrome.send('Fetch.failRequest', { requestId, errorReason: 'BlockedByClient' }, sessionId) // nothing else leaves the page
        reply.catch(() => {})
      })
      try {
        await chrome.send('Fetch.enable', { patterns: [{ urlPattern: '*' }] }, sessionId)
        await chrome.send('Page.navigate', { url: ORIGIN + '/render.html' }, sessionId)
        const evaluate = async (expression: string) => {
          const r = await chrome.send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true }, sessionId)
          if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description ?? r.exceptionDetails.text)
          return r.result.value
        }
        for (let i = 0; !(await evaluate('window.ready === true')); i++) {
          if (i > 200) throw new Error('the render page did not load')
          await new Promise((r) => setTimeout(r, 25))
        }
        const b64 = await evaluate(`render(${JSON.stringify({ records, frame, ids, background, scale, theme })})`)
        return b64 ? Buffer.from(b64, 'base64') : null
      } finally { off() }
    } finally {
      if (targetId) await chrome.send('Target.closeTarget', { targetId }).catch(() => {})
      await chrome.send('Target.disposeBrowserContext', { browserContextId }).catch(() => {})
      this.idle = setTimeout(() => this.close(), this.idleMs)
      this.idle.unref() // idling never keeps the process alive; exiting kills Chrome
    }
  }

  async #shutdown() {
    const c = this.chrome
    this.chrome = null
    await c?.close()
  }

  // closes Chrome now (it relaunches on the next render)
  close(): Promise<void> {
    clearTimeout(this.idle)
    const run = this.queue.then(() => this.#shutdown())
    this.queue = run.catch(() => {})
    return run
  }
}

// PNG bytes for a store: the whole board, some shapes (ids), or a frame's contents
export async function renderPng(store: Store, opts: Omit<RenderOptions, 'records'> = {}, renderer?: Renderer) {
  const own = !renderer
  renderer ??= new Renderer()
  try {
    return await renderer.render({ ...opts, records: store.all() })
  } finally {
    if (own) await renderer.close()
  }
}
