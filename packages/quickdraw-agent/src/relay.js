// A client for the example server's relay (examples/quickdraw-yjs/server.mjs):
// messages are one type byte + payload — 0 = Yjs update, 1 = state vector,
// 2 = presence (JSON). The agent joins like any browser tab: it sends what it
// has, asks for the rest, and shows a cursor while it works.
import * as Y from 'yjs'

const UPDATE = 0, SV = 1, PRESENCE = 2
const pack = (type, data) => { const m = new Uint8Array(data.length + 1); m[0] = type; m.set(data, 1); return m }

// Resolves once the server's state is in ydoc; local updates go out as they happen.
export function connectRelay(ydoc, url, { name = 'Agent', color = '#0c8599', timeout = 10_000 } = {}) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(url)
    ws.binaryType = 'arraybuffer'
    const timer = setTimeout(() => { ws.close(); reject(new Error(`no answer from ${url}`)) }, timeout)
    let ready = false
    const onUpdate = (update, origin) => {
      if (origin !== 'relay' && ws.readyState === WebSocket.OPEN) ws.send(pack(UPDATE, update))
    }
    ws.onerror = () => { if (!ready) { clearTimeout(timer); reject(new Error(`cannot connect to ${url}`)) } }
    ws.onopen = () => {
      ws.send(pack(SV, Y.encodeStateVector(ydoc)))
    }
    ws.onmessage = ({ data }) => {
      const m = new Uint8Array(data)
      if (m[0] !== UPDATE) return
      Y.applyUpdate(ydoc, m.subarray(1), 'relay')
      if (ready) return
      // the server answers the state vector first: from here on we are in sync
      ready = true
      clearTimeout(timer)
      ydoc.on('update', onUpdate)
      const me = { name, color, x: null, y: null }
      const sendPresence = () => { if (ws.readyState === WebSocket.OPEN) ws.send(pack(PRESENCE, new TextEncoder().encode(JSON.stringify(me)))) }
      resolve({
        // shows the agent's cursor at a page point (null hides it)
        cursor(x, y) { Object.assign(me, { x, y }); sendPresence() },
        // waits for pending sends to leave, then disconnects (peers drop the cursor)
        async close() {
          ydoc.off('update', onUpdate)
          for (let i = 0; i < 50 && ws.bufferedAmount > 0; i++) await new Promise((r) => setTimeout(r, 20))
          ws.close()
        },
      })
    }
  })
}
