// The relay protocol spoken by `quickdraw serve`, the web page and the CLI.
// A binary WebSocket message is one type byte + payload:
//   UPDATE   a Yjs update
//   SV       a Yjs state vector: "send me what I am missing"; answered with an UPDATE
//   PRESENCE JSON, who someone is and where (quickdraw-presence's: { name, color, status?, x, y,
//            view?, agent?, agentStatus?, agentActivity?, agentNote? }); the server adds the sender's `id`, keeps each
//            one's latest in memory only (sent to a page when it connects), never stores
//            it; a disconnect is relayed as { id, gone: true }
//   AGENT    JSON, agents on the board and requests to them (below)
//   SHARE    JSON, screen sharing (quickdraw-screenshare's messages): from a page
//            start { name }, stop, snap { by }, agents { allow } (the sharer: agents may see it); from the
//            server sharing { sharer: { name } | null, mine, agents, watching: [agent names] } (to each
//            page, and on hello), snap { by } (to the sharer)
//   LIVE     a JPEG frame of the shared screen, from the sharer to the others;
//            dropped for a peer that is behind, never stored
//
// AGENT messages, `{ kind, … }`:
//   from an agent    join { agent: { id, name, knows, status } }, status { status },
//                    account { account?, limits?: [{ name, usedPercent, resetsAt? }] } (what it runs on, for the panel),
//                    event { event }: progress, message, question, approval, op, done, error
//   from anyone      mention { note: { id, text, x, y } }: a note it wrote that starts with @; a request to the agent it
//                    names if the one who started the sender started that agent too (or it takes requests from
//                    anyone), with `from`: the sender's name
//   from a page      share { agent, with: 'owner' | 'all' | presence ids } (from the agent's owner only: who else may ask it)
//   the shared screen, between an agent and the server (only while the sharer lets agents see it):
//                    watch-screen { on } (answered with screen { event: 'state', … }); screen-frame { id }
//                    (answered with screen-frame { id, jpeg (base64), at, sharer } or { id, error });
//                    snap { id } (asked of the sharer's page, taken for the agent; answered with snap { id,
//                    sharer } or { id, error }); to watching agents: screen { event: started | stopped |
//                    allowed | disallowed | changed, sharing, sharer?, allowed?, change?, at? }
//   from a page      hello (answered with agents and threads), request { request }, reply { requestId, message } (text,
//                    { approval, allow } or { undo: { reverted, skipped } })
//   from the server  you { local } (to a page: on the computer serving, which agents take requests from
//                    unless started with --allow-remote; request and reply carry `local` to the agent too),
//                    agents { agents } (and whenever they change), threads { threads }, joined { id } (to an agent),
//                    thread { thread } (a new one), event { event } (to every page,
//                    the sender too: a person's reply comes back as a `reply` event);
//                    to an agent: request { request }, reply { requestId, message }
//   voice            talking with an agent that says `voice: true` when it joins: a page sends
//                    request { request, sdp } (its WebRTC offer; the agent gets it with the request),
//                    then voice { requestId, stop: true } to hang up; the agent answers
//                    voice { requestId, sdp } and, when it ends, voice { requestId, end: reason | null },
//                    and in the thread a `reply` event for what the person said. Voice messages go
//                    between that page and that agent only, and are not stored.
// The server stores the threads (not in the board's Yjs document) and knows
// nothing of what an agent runs on.
// Plain JS so the browser can load it as served, without a build.

export const UPDATE = 0
export const SV = 1
export const PRESENCE = 2
export const AGENT = 3
export const SHARE = 4
export const LIVE = 5

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

/** @param {object} value */
export const packShare = (value) => pack(SHARE, new TextEncoder().encode(JSON.stringify(value)))

/** @param {Uint8Array} m */
export const unpackShare = (m) => JSON.parse(new TextDecoder().decode(m.subarray(1)))
