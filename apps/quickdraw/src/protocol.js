// The relay protocol spoken by `quickdraw serve`, the web page and the CLI.
// A binary WebSocket message is one type byte + payload:
//   UPDATE   a Yjs update
//   SV       a Yjs state vector: "send me what I am missing"; answered with an UPDATE
//   PRESENCE JSON (a cursor: { name, color, x, y }); the server adds the sender's
//            `id` and never stores it; a disconnect is relayed as { id, gone: true }
//   AGENT    JSON, agents on the board and requests to them (below)
//
// AGENT messages, `{ kind, … }`:
//   from an agent    join { agent: { id, name, knows, status } }, status { status },
//                    event { event }: progress, message, question, approval, op, done, error
//   from a page      hello (answered with agents and threads), request { request }, reply { requestId, message } (text,
//                    { approval, allow } or { undo: { reverted, skipped } })
//   from the server  agents { agents } (and whenever they change), threads { threads }, joined { id } (to an agent),
//                    thread { thread } (a new one), event { event } (to every page,
//                    the sender too: a person's reply comes back as a `reply` event);
//                    to an agent: request { request }, reply { requestId, message }
// The server stores the threads (not in the board's Yjs document) and knows
// nothing of what an agent runs on.
// Plain JS so the browser can load it as served, without a build.

export const UPDATE = 0
export const SV = 1
export const PRESENCE = 2
export const AGENT = 3

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

/** @param {object} value */
export const packAgent = (value) => pack(AGENT, new TextEncoder().encode(JSON.stringify(value)))

/** @param {Uint8Array} m */
export const unpackAgent = (m) => JSON.parse(new TextDecoder().decode(m.subarray(1)))
