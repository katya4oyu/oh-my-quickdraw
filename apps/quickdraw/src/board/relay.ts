// Joins a board through the relay of `quickdraw serve` (../protocol.js) like
// any browser tab: it sends what it has, asks for the rest, and shows a cursor
// while it works (a presence saying it is an agent, see quickdraw-presence). An agent also speaks AGENT messages on the same connection.
import * as Y from 'yjs'
import { AGENT, SV, UPDATE, pack, packAgent, packPresence, unpackAgent } from '../protocol.js'

export interface Relay {
  /** shows the cursor at a page point (null hides it) */
  cursor(x: number | null, y: number | null): void
  /** what the agent is doing, on its cursor and in the row of who is here */
  status(status: 'idle' | 'working' | 'waiting'): void
  /** sends an AGENT message (see ../protocol.js) */
  send(message: object): void
  /** AGENT messages from the server; returns a function that stops listening */
  onMessage(fn: (message: any) => void): () => void
  /** called once if the connection drops (not after close()) */
  onClose(fn: () => void): void
  /** waits for pending sends to leave, then disconnects (peers drop the cursor) */
  close(): Promise<void>
}

export interface Presence { name?: string, color?: string }

// Resolves once the server's state is in ydoc; local updates go out as they happen.
export function connectRelay(ydoc: Y.Doc, url: string, { name = 'Agent', color = '#0c8599', timeout = 10_000 }: Presence & { timeout?: number } = {}): Promise<Relay> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(url)
    ws.binaryType = 'arraybuffer'
    const timer = setTimeout(() => { ws.close(); reject(new Error(`no answer from ${url}`)) }, timeout)
    let ready = false, closing = false
    const listeners = new Set<(message: any) => void>()
    let closed: (() => void) | null = null
    ws.onclose = () => { if (ready && !closing) closed?.() }
    const onUpdate = (update: Uint8Array, origin: unknown) => {
      if (origin !== 'relay' && ws.readyState === WebSocket.OPEN) ws.send(pack(UPDATE, update))
    }
    ws.onerror = () => { if (!ready) { clearTimeout(timer); reject(new Error(`cannot connect to ${url}`)) } }
    ws.onopen = () => ws.send(pack(SV, Y.encodeStateVector(ydoc)))
    ws.onmessage = ({ data }) => {
      const m = new Uint8Array(data as ArrayBuffer)
      if (m[0] === AGENT && ready) {
        let message
        try { message = unpackAgent(m) } catch { return }
        for (const fn of listeners) fn(message)
        return
      }
      if (m[0] !== UPDATE) return
      try { Y.applyUpdate(ydoc, m.subarray(1), 'relay') } catch (e) {
        // one that cannot be read (from an older server) must not take the agent down
        if (ready) return void process.stderr.write(`ignored an update that cannot be read: ${(e as Error).message}\n`)
        clearTimeout(timer)
        ws.close()
        return reject(new Error(`the board from ${url} cannot be read: ${(e as Error).message}`))
      }
      if (ready) return
      // the server answers the state vector first: from here on we are in sync
      ready = true
      clearTimeout(timer)
      ydoc.on('update', onUpdate)
      const me: Presence & { x: number | null, y: number | null, agent: true, agentStatus?: string } = { name, color, x: null, y: null, agent: true }
      const sendPresence = () => { if (ws.readyState === WebSocket.OPEN) ws.send(packPresence(me)) }
      sendPresence() // here, before it points at anything
      resolve({
        cursor(x, y) { Object.assign(me, { x, y }); sendPresence() },
        status(agentStatus) { if (me.agentStatus !== agentStatus) { me.agentStatus = agentStatus; sendPresence() } },
        send(message) { if (ws.readyState === WebSocket.OPEN) ws.send(packAgent(message)) },
        onMessage(fn) { listeners.add(fn); return () => listeners.delete(fn) },
        onClose(fn) { closed = fn },
        async close() {
          closing = true
          ydoc.off('update', onUpdate)
          for (let i = 0; i < 50 && ws.bufferedAmount > 0; i++) await new Promise((r) => setTimeout(r, 20))
          ws.close()
        },
      })
    }
  })
}
