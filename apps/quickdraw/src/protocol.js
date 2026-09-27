// The relay protocol spoken by `quickdraw serve`, the web page and the CLI.
// A binary WebSocket message is one type byte + payload:
//   UPDATE   a Yjs update
//   SV       a Yjs state vector: "send me what I am missing"; answered with an UPDATE
//   PRESENCE JSON (a cursor: { name, color, x, y }); the server adds the sender's
//            `id` and never stores it; a disconnect is relayed as { id, gone: true }
// Plain JS so the browser can load it as served, without a build.

export const UPDATE = 0
export const SV = 1
export const PRESENCE = 2

/** @param {number} type @param {Uint8Array} data */
export function pack(type, data) {
  const m = new Uint8Array(data.length + 1)
  m[0] = type
  m.set(data, 1)
  return m
}

/** @param {object} value */
export const packPresence = (value) => pack(PRESENCE, new TextEncoder().encode(JSON.stringify(value)))

/** @param {Uint8Array} m */
export const unpackPresence = (m) => JSON.parse(new TextDecoder().decode(m.subarray(1)))
