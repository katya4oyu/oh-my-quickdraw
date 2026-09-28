import { describe, expect, it } from 'vitest'
import { openCall, said } from '../src/call.js'

// a microphone and a peer connection, as far as a call uses them
function fakeRtc({ gathers = true, denied = false } = {}) {
  const log = []
  const track = { kind: 'audio', enabled: true, stopped: false, stop() { this.stopped = true } }
  const mic = { getAudioTracks: () => [track], getTracks: () => [track] }
  class Peer {
    constructor() { this.iceGatheringState = 'new'; this.channels = []; Peer.last = this }
    addTrack(t) { log.push(['track', t.kind]) }
    createDataChannel(label) { const ch = { label }; this.channels.push(ch); return ch }
    async createOffer() { return { type: 'offer', sdp: 'v=offer' } }
    async setLocalDescription(d) {
      this.localDescription = d
      if (gathers) setTimeout(() => { this.iceGatheringState = 'complete'; this.onicegatheringstatechange?.() }, 5)
    }
    async setRemoteDescription(d) { log.push(['answer', d.type, d.sdp]) }
    close() { log.push(['close']) }
  }
  return {
    log, track, Peer,
    rtc: {
      Peer,
      gatherMs: 50,
      getUserMedia: async (c) => { log.push(['mic', c.audio.echoCancellation]); if (denied) throw Object.assign(new Error('no'), { name: 'NotAllowedError' }); return mic },
    },
  }
}

describe('a call to the voice model', () => {
  it('offers the microphone and an events channel, takes the answer, and hangs up with the microphone off', async () => {
    const f = fakeRtc()
    const call = await openCall(f.rtc)
    expect(call.offer).toBe('v=offer')
    expect(f.Peer.last.channels.map((c) => c.label)).toEqual(['oai-events'])
    await call.answer('v=answer')
    expect(f.log).toEqual([['mic', true], ['track', 'audio'], ['answer', 'answer', 'v=answer']])

    call.mute(true)
    expect(call.muted).toBe(true)
    expect(f.track.enabled).toBe(false)

    const heard = []
    call.onSaid((s) => heard.push(s))
    f.Peer.last.channels[0].onmessage({ data: JSON.stringify({ type: 'input_transcript.added', item: { text: ' Hi' } }) })
    f.Peer.last.channels[0].onmessage({ data: 'not json' })
    expect(heard).toEqual([{ role: 'user', text: ' Hi' }])

    let closed = 0
    call.onClosed(() => closed++)
    call.close()
    call.close()
    expect(closed).toBe(1)
    expect(f.track.stopped).toBe(true)
    expect(f.log.at(-1)).toEqual(['close'])
  })

  it('sends the offer after a moment when its candidates keep coming', async () => {
    const f = fakeRtc({ gathers: false })
    const call = await openCall(f.rtc)
    expect(call.offer).toBe('v=offer')
  })

  it('gives up without a microphone', async () => {
    const f = fakeRtc({ denied: true })
    await expect(openCall(f.rtc)).rejects.toMatchObject({ name: 'NotAllowedError' })
  })

  it('reads what is said on the events channel: the words as they come, and new turns', () => {
    expect(said(JSON.stringify({ type: 'turn.created', turn: { role: 'assistant', transcript: '' } }))).toEqual({ role: 'assistant', text: '', turn: true })
    expect(said(JSON.stringify({ type: 'output_transcript.added', item: { text: ' Done' } }))).toEqual({ role: 'assistant', text: ' Done' })
    expect(said(JSON.stringify({ type: 'session.started' }))).toBeNull()
    expect(said('{')).toBeNull()
  })
})
