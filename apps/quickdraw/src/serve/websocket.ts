// A minimal RFC 6455 server side: the handshake and unfragmented frames.
import { createHash } from 'node:crypto'
import type { IncomingMessage } from 'node:http'
import type { Duplex } from 'node:stream'

const GUID = '258EAFA5-E914-47DA-95CA-C5AB0DC85B11'

export const BINARY = 2, CLOSE = 8, PING = 9, PONG = 10

export function accept(req: IncomingMessage, socket: Duplex): boolean {
  const key = req.headers['sec-websocket-key']
  if (!key) return false
  const digest = createHash('sha1').update(key + GUID).digest('base64')
  socket.write(`HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: ${digest}\r\n\r\n`)
  return true
}

export function frame(opcode: number, payload: Uint8Array): Buffer {
  const n = payload.length
  let head: Buffer
  if (n < 126) head = Buffer.from([0x80 | opcode, n])
  else if (n < 65536) head = Buffer.from([0x80 | opcode, 126, n >> 8, n & 255])
  else {
    head = Buffer.alloc(10)
    head[0] = 0x80 | opcode
    head[1] = 127
    head.writeBigUInt64BE(BigInt(n), 2)
  }
  return Buffer.concat([head, payload])
}

// pulls complete frames off the front of buf; returns [frames, rest]
export function parse(buf: Buffer): [{ opcode: number, payload: Buffer }[], Buffer] {
  const frames = []
  for (;;) {
    if (buf.length < 2) break
    const opcode = buf[0] & 15
    let len = buf[1] & 127
    let off = 2
    if (len === 126) { if (buf.length < 4) break; len = buf.readUInt16BE(2); off = 4 }
    else if (len === 127) { if (buf.length < 10) break; len = Number(buf.readBigUInt64BE(2)); off = 10 }
    const masked = buf[1] & 128
    const mask = masked ? buf.subarray(off, off + 4) : null
    if (masked) off += 4
    if (buf.length < off + len) break
    const payload = Buffer.from(buf.subarray(off, off + len))
    if (mask) for (let i = 0; i < len; i++) payload[i] ^= mask[i & 3]
    frames.push({ opcode, payload })
    buf = buf.subarray(off + len)
  }
  return [frames, buf]
}
