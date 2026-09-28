// Talking with Codex on a board: app-server's realtime conversation
// (`thread/realtime/*`, experimental). A voice model (gpt-live) talks with the
// person and hands what is to be done to a Codex thread, as it hears it; that
// thread's turns run the board tools like any request (./codex.ts).
//
// The sound goes straight between the person's page and OpenAI over WebRTC:
// the page makes the offer, app-server places the call with the person's own
// Codex sign-in and keeps a side channel to it (what is said, the handoffs).
// Only the offer and the answer pass through the board. A conversation is a
// request, with a thread in the panel: what the person said, what was answered,
// and what was done on the board (so it can be undone).
import type { AgentRequest } from 'quickdraw-agent'
import type { BoardAgent } from './board-agent.ts'
import type { AppServer, Codex } from './codex.ts'

type Json = any

export interface VoiceOptions {
  /** the voice model (VOICE_MODEL when not given) */
  model?: string
  /** its voice (`codex app-server`: thread/realtime/listVoices) */
  voice?: string
}

export const VOICE_MODEL = 'gpt-live-1-codex'

// what was selected when the person started talking: likely what they talk about
function about(request: AgentRequest): string {
  const { shapeIds, frameIds } = request.context
  return shapeIds.length
    ? `When the person started talking, this was selected on the board: ${shapeIds.join(', ')}${frameIds.length ? `; of which frames: ${frameIds.join(', ')}` : ''}. "This" or "these" may mean it.`
    : ''
}

/** Lets people talk with the agent: set up after runCodex, on the same app-server. */
export function runVoice(server: AppServer, agent: BoardAgent, codex: Codex, { model = VOICE_MODEL, voice }: VoiceOptions = {}) {
  const threadOf = new Map<string, string>() // request -> Codex thread, while the conversation lasts
  const ended = (requestId: string, reason: string | null) => {
    if (!threadOf.delete(requestId)) return
    agent.voice(requestId, { end: reason })
    agent.emit(requestId, { type: 'done', text: 'The conversation ended.' })
  }

  server.onNotification((method, p) => {
    if (!method.startsWith('thread/realtime/')) return
    const requestId = codex.requestOf(p?.threadId)
    if (!requestId || !threadOf.has(requestId)) return
    if (method === 'thread/realtime/sdp') agent.voice(requestId, { sdp: p.sdp })
    else if (method === 'thread/realtime/item/completed' && p.item?.type === 'transcriptSegment') {
      // what the person said reads as theirs in the thread; what was answered, as the agent's.
      // (A segment of the timeline, not transcript/done: that one does not always come.)
      const text = String(p.item.text ?? '').trim()
      if (text) agent.emit(requestId, { type: p.item.role === 'user' ? 'reply' : 'message', text })
    } else if (method === 'thread/realtime/error') {
      agent.emit(requestId, { type: 'error', message: p.message ?? 'The conversation stopped with an error.' })
      threadOf.delete(requestId)
      agent.voice(requestId, { end: p.message ?? 'error' })
    } else if (method === 'thread/realtime/closed') ended(requestId, p.reason ?? null)
  })

  agent.onVoice = async (request: AgentRequest, sdp: string) => {
    try {
      agent.lookAt(request)
      const threadId = await codex.startThread(request, { voice: true })
      threadOf.set(request.id, threadId)
      await server.request('thread/realtime/start', {
        threadId,
        outputModality: 'audio',
        transport: { type: 'webrtc', sdp },
        version: 'v3',
        model,
        ...(voice ? { voice } : {}),
        includeStartupContext: false, // the board is what matters, and the thread has its tools
        ...(about(request) ? { realtimeStartInstructions: about(request) } : {}),
      } satisfies Json)
    } catch (e) {
      const message = (e as Error).message
      threadOf.delete(request.id)
      agent.voice(request.id, { end: message })
      agent.emit(request.id, { type: 'error', message: `Could not start the conversation: ${message}` })
    }
  }
  agent.onVoiceStop = async (requestId) => {
    const threadId = threadOf.get(requestId)
    if (!threadId) return
    // closed follows; if app-server does not say so, it ends here anyway
    await server.request('thread/realtime/stop', { threadId }).catch(() => ended(requestId, 'requested'))
  }
}
