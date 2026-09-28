import { describe, it, expect } from 'vitest'
import { spawn } from 'node:child_process'
import { existsSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { deflateSync } from 'node:zlib'
import { randomBytes } from 'node:crypto'
import { Store } from '@quickdrawjs/core'
import { bindFrames } from 'quickdraw-frames'
import { installMeasure, runOp } from 'quickdraw-agent'
import { Renderer, serve } from '../src/board/render.ts'
import { findChrome } from '../src/board/chrome.ts'

installMeasure() // Node has no canvas to measure text with
const hasChrome = !!findChrome()
const pngSize = (buf: Buffer) => ({ w: buf.readUInt32BE(16), h: buf.readUInt32BE(20) })
// an opaque PNG of random pixels: it barely compresses, like a photo
function noisyPng(side: number) {
  const crc = (b: Buffer) => { let c = ~0; for (const x of b) { c ^= x; for (let k = 0; k < 8; k++) c = (c >>> 1) ^ (0xedb88320 & -(c & 1)) } return ~c >>> 0 }
  const chunk = (type: string, data: Buffer) => {
    const t = Buffer.concat([Buffer.from(type), data]), out = Buffer.alloc(12 + data.length)
    out.writeUInt32BE(data.length, 0); t.copy(out, 4); out.writeUInt32BE(crc(t), 8 + data.length)
    return out
  }
  const head = Buffer.alloc(13)
  head.writeUInt32BE(side, 0); head.writeUInt32BE(side, 4); head[8] = 8; head[9] = 2 // 8-bit RGB
  const raw = randomBytes((side * 3 + 1) * side)
  for (let y = 0; y < side; y++) raw[y * (side * 3 + 1)] = 0 // no filter
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', head), chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0))])
}
const alive = (pid: number) => { try { process.kill(pid, 0); return true } catch { return false } }

describe('the render page loads only its own files', () => {
  it('serves the page and package files, nothing outside them', async () => {
    expect((await serve('https://quickdraw.render/render.html'))?.type).toBe('text/html')
    expect((await serve('https://quickdraw.render/core/src/index.js'))?.type).toBe('text/javascript')
    expect(await serve('https://quickdraw.render/core/../../../../etc/passwd')).toBeNull()
    expect(await serve('https://quickdraw.render/core/package.json')).toBeNull() // not js/css/html
    expect(await serve('https://quickdraw.render/secret/x.js')).toBeNull()
  })
})

describe.skipIf(!hasChrome)('PNG through a headless Chrome', () => {
  const board = () => {
    const store = new Store()
    bindFrames(store)
    const { result: [frame] } = runOp(store, 'Claude', (ops) => {
      const f = ops.frame('Plan', { aspect: '16:9', at: { x: 0, y: 0 }, w: 320 })
      ops.fit(f, { ids: [ops.note('Hello')] }) // too big for it: shrunk to fit
      return [f]
    })
    return { store, frame }
  }

  it('draws the board and a frame, reusing one Chrome, and leaves nothing behind', async () => {
    const { store, frame } = board()
    const r = new Renderer()
    const whole = (await r.render({ records: store.all(), scale: 1 }))!
    const chrome = r.chrome!
    const pid = chrome.pid
    const cut = (await r.render({ records: store.all(), frame, scale: 1 }))!
    expect(r.chrome).toBe(chrome) // reused
    expect(whole.subarray(1, 4).toString()).toBe('PNG')
    expect(pngSize(cut)).toEqual({ w: 320, h: 180 }) // exactly the frame, at 16:9
    const { browserContextIds } = await chrome.send('Target.getBrowserContexts')
    expect(browserContextIds).toEqual([]) // each render's context was disposed
    const profile = chrome.profile
    await r.close()
    expect(alive(pid)).toBe(false)
    expect(existsSync(profile)).toBe(false)
  }, 30_000)

  it('draws images, not blank space where they are', async () => {
    const store = new Store()
    // a photo-like image, big enough that it takes a while to decode, off the page's view (where it has not drawn it)
    const side = 700
    const png = 'data:image/png;base64,' + noisyPng(side).toString('base64')
    const { result: id } = runOp(store, 'Claude', (ops) => ops.image(png, { w: side, h: side }, { w: 400, at: { x: 5000, y: 5000 } }))
    const r = new Renderer()
    try {
      const out = (await r.render({ records: store.all(), ids: [id as string], background: false, scale: 1 }))!
      // an image not yet loaded is drawn as a plain placeholder, which compresses to almost nothing; random pixels do not
      expect(out.length).toBeGreaterThan(200_000)
    } finally { await r.close() }
  }, 30_000)

  it('does not outlive a process that is killed outright', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'qd-render-'))
    const script = join(dir, 'hang.mjs')
    writeFileSync(script, `
      import { Renderer } from ${JSON.stringify(new URL('../src/board/render.ts', import.meta.url).href)}
      const r = new Renderer({ idleMs: 600000 })
      await r.render({ records: [] }).catch(() => {})
      process.stdout.write(JSON.stringify({ pid: r.chrome.pid, profile: r.chrome.profile }) + '\\n')
      setInterval(() => {}, 1000)`)
    const child = spawn(process.execPath, [script], { stdio: ['ignore', 'pipe', 'inherit'] })
    const { pid } = await new Promise<{ pid: number }>((ok) => child.stdout.once('data', (d) => ok(JSON.parse(d))))
    expect(alive(pid)).toBe(true)
    child.kill('SIGKILL')
    for (let i = 0; i < 40 && alive(pid); i++) await new Promise((r) => setTimeout(r, 100))
    expect(alive(pid)).toBe(false)
  }, 30_000)
})
