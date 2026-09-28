// A call to a voice model over WebRTC, as OpenAI's realtime calls take it: the
// microphone as an audio track, a data channel for what is said ("oai-events"),
// and one offer and one answer, carried by whoever places the call (the host).
// Nothing here knows the board; the browser's WebRTC and microphone come in as
// `rtc`, so it runs (and is tested) without a browser too.

/**
 * @param {{
 *   getUserMedia: (c: MediaStreamConstraints) => Promise<MediaStream>,
 *   Peer: typeof RTCPeerConnection,
 *   gatherMs?: number,
 * }} rtc
 */
export async function openCall({ getUserMedia, Peer, gatherMs = 2000 }) {
  const mic = await getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true } })
  const pc = new Peer()
  const listeners = { audio: new Set(), said: new Set(), closed: new Set() }
  const fire = (kind, v) => { for (const fn of listeners[kind]) fn(v) }
  let closed = false
  try {
    for (const track of mic.getAudioTracks()) pc.addTrack(track, mic)
    pc.ontrack = (e) => fire('audio', e.streams?.[0] ?? new MediaStream([e.track]))
    const events = pc.createDataChannel('oai-events')
    events.onmessage = (e) => { const s = said(e.data); if (s) fire('said', s) }
    pc.onconnectionstatechange = () => { if (pc.connectionState === 'failed' || pc.connectionState === 'closed') close() }
    await pc.setLocalDescription(await pc.createOffer())
    // the whole offer at once (no trickle): wait for its candidates, a moment at most
    await new Promise((done) => {
      if (pc.iceGatheringState === 'complete') return done()
      const t = setTimeout(done, gatherMs)
      pc.onicegatheringstatechange = () => { if (pc.iceGatheringState === 'complete') { clearTimeout(t); done() } }
    })
  } catch (e) {
    for (const t of mic.getTracks()) t.stop()
    pc.close()
    throw e
  }

  function close() {
    if (closed) return
    closed = true
    for (const t of mic.getTracks()) t.stop()
    pc.close()
    fire('closed')
  }

  return {
    /** the offer, for the host to send */
    offer: pc.localDescription.sdp,
    mic,
    /** the answer, from the host */
    answer: (sdp) => pc.setRemoteDescription({ type: 'answer', sdp }),
    get muted() { return mic.getAudioTracks().every((t) => !t.enabled) },
    mute(on) { for (const t of mic.getAudioTracks()) t.enabled = !on },
    /** the voice's audio, to play */
    onAudio: (fn) => { listeners.audio.add(fn); return () => listeners.audio.delete(fn) },
    /** a piece of what is said: { role: 'user' | 'assistant', text, turn? } — a new turn starts a new line */
    onSaid: (fn) => { listeners.said.add(fn); return () => listeners.said.delete(fn) },
    onClosed: (fn) => { listeners.closed.add(fn); return () => listeners.closed.delete(fn) },
    get closed() { return closed },
    close,
  }
}

/**
 * What an event on the data channel says, if anything: the words of the person
 * or the voice as they come, and when a new turn starts.
 * @returns {{ role: 'user' | 'assistant', text: string, turn?: boolean } | null}
 */
export function said(data) {
  let e
  try { e = JSON.parse(data) } catch { return null }
  if (e?.type === 'turn.created' && (e.turn?.role === 'user' || e.turn?.role === 'assistant')) return { role: e.turn.role, text: '', turn: true }
  if (e?.type === 'input_transcript.added' && typeof e.item?.text === 'string') return { role: 'user', text: e.item.text }
  if (e?.type === 'output_transcript.added' && typeof e.item?.text === 'string') return { role: 'assistant', text: e.item.text }
  return null
}
