import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createExampleServer } from './server.mjs'

let app, url

beforeEach(async () => {
  app = createExampleServer()
  const { port } = await app.listen(0)
  url = `ws://127.0.0.1:${port}/ws`
})
afterEach(() => app.close())

const open = (u) => new Promise((ok, fail) => {
  const ws = new WebSocket(u)
  ws.binaryType = 'arraybuffer'
  ws.onopen = () => ok(ws)
  ws.onerror = fail
})
const next = (ws) => new Promise((ok) => { ws.onmessage = ({ data }) => ok(new Uint8Array(data)) })

describe('relay', () => {
  it('forwards messages to other clients only, including large ones', async () => {
    const [a, b, c] = await Promise.all([open(url), open(url), open(url)])
    let echoed = false
    a.onmessage = () => { echoed = true }
    for (const size of [5, 300, 70000]) {
      const msg = new Uint8Array(size).map((_, i) => i & 255)
      const got = Promise.all([next(b), next(c)])
      a.send(msg)
      for (const m of await got) expect(m).toEqual(msg)
    }
    expect(echoed).toBe(false)
    for (const ws of [a, b, c]) ws.close()
  })

  it('serves the example page', async () => {
    const res = await fetch(url.replace('ws:', 'http:').replace('/ws', '/examples/quickdraw-yjs/'))
    expect(res.status).toBe(200)
  })
})
