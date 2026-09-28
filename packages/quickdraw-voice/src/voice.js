// Talking with an agent on a board: a microphone button, and while you talk a
// small bar over the board with who you talk with, what was last said, how
// loud, mute and hang up. The call goes straight to the voice model (./call.js);
// the host places it with an agent and carries the offer and the answer.
//
// The host:
//   host.agent()                 who to talk with: { id, name } | null (none here that talks, or not for you)
//   host.start(agent, sdp)       places the call with the offer; returns its id (a request id, say)
//   host.stop(id)                hangs up
//   host.onMessage(fn)           { kind: 'answer', id, sdp } | { kind: 'end', id, reason? }
import { openCall } from './call.js'

const svg = (inner) => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${inner}</svg>`
export const VOICE_ICONS = {
  mic: svg('<rect x="9" y="3" width="6" height="11" rx="3"/><path d="M5 11a7 7 0 0 0 14 0"/><path d="M12 18v3"/>'),
  muted: svg('<path d="m3 3 18 18"/><path d="M9 9v2a3 3 0 0 0 5.1 2.1M15 9.3V6a3 3 0 0 0-5.7-1.3"/><path d="M5 11a7 7 0 0 0 11.5 5.3M19 11a7 7 0 0 1-.6 2.8"/><path d="M12 18v3"/>'),
  end: svg('<path d="M3 15.5c5-4.5 13-4.5 18 0l-2 2.5-3.5-1.5v-2.5a10 10 0 0 0-7 0V16.5L5 18z"/>'),
}

// below the row of who is here (quickdraw-presence), at the top in the middle
const STYLE = `
.qdv{position:absolute;box-sizing:border-box;left:50%;top:calc(58px + env(safe-area-inset-top));transform:translateX(-50%);display:flex;align-items:center;gap:8px;
  max-width:min(560px,calc(100% - 24px));padding:6px 6px 6px 12px;border-radius:999px;pointer-events:auto;z-index:1;
  background:var(--qd-pop-bg);border:1px solid var(--qd-border);box-shadow:var(--qd-pop-shadow);color:var(--qd-ink-strong);
  font:13px/1.4 system-ui,-apple-system,sans-serif}
@media (max-width:640px){.qdv{max-width:calc(100% - 16px)}}
.qdv[hidden]{display:none!important}
.qdv-dot{width:8px;height:8px;border-radius:50%;background:#30a46c;flex:none}
.qdv.connecting .qdv-dot{background:#f5a524;animation:qdv-pulse 1s ease-in-out infinite}
.qdv.muted .qdv-dot{background:var(--qd-ink-soft,#999)}
@keyframes qdv-pulse{50%{opacity:.35}}
@media (prefers-reduced-motion:reduce){.qdv .qdv-dot{animation:none}}
.qdv-text{flex:1;min-width:0;display:flex;flex-direction:column}
.qdv-who{font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.qdv-said{font-size:12px;color:var(--qd-ink-soft,#666);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;direction:rtl;text-align:left}
.qdv-said bdi{direction:ltr}
.qdv-said:empty{display:none}
.qdv-level{display:flex;align-items:center;gap:2px;height:20px;flex:none}
.qdv-level i{display:block;width:3px;height:4px;border-radius:2px;background:currentColor;opacity:.8;transition:height .08s}
.qdv-level.them{color:#2f6fed}
.qdv-btn{all:unset;box-sizing:border-box;display:grid;place-items:center;width:32px;height:32px;border-radius:999px;cursor:pointer;flex:none}
.qdv-btn:hover{background:var(--qd-hover)}
.qdv-btn:focus-visible{outline:2px solid #2f6fed}
.qdv-btn svg{width:18px;height:18px}
.qdv-btn.end{background:#e5484d;color:#fff}
.qdv-btn.end:hover{background:#cd2b31}
`
function injectStyle() {
  if (document.getElementById('qd-voice-style')) return
  document.head.append(Object.assign(document.createElement('style'), { id: 'qd-voice-style', textContent: STYLE }))
}
const el = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e }

/** A microphone to talk with an agent on the board; the host places the call (see above). */
export function createVoice({ editor, container = editor.container, host, rtc }) {
  if (!host || !['agent', 'start', 'stop', 'onMessage'].every((k) => typeof host[k] === 'function')) {
    throw new TypeError('createVoice requires host agent, start, stop and onMessage functions')
  }
  rtc ??= typeof navigator !== 'undefined' && navigator.mediaDevices?.getUserMedia
    ? { getUserMedia: (c) => navigator.mediaDevices.getUserMedia(c), Peer: globalThis.RTCPeerConnection }
    : null
  injectStyle()
  const listeners = new Set()
  let call = null, id = null, who = null, state = 'off' // off | connecting | on
  let lines = [] // what was said, the last few turns: { role, text }
  let hideTimer = 0, meters = null

  const bar = el('section', 'qdv')
  bar.hidden = true
  bar.setAttribute('aria-label', 'Voice conversation')
  bar.setAttribute('aria-live', 'polite')
  const dot = el('span', 'qdv-dot')
  const text = el('div', 'qdv-text')
  const whoEl = el('span', 'qdv-who')
  const saidEl = el('span', 'qdv-said')
  text.append(whoEl, saidEl)
  const level = el('span', 'qdv-level')
  const bars = Array.from({ length: 5 }, () => el('i'))
  level.append(...bars)
  level.setAttribute('aria-hidden', 'true')
  const muteBtn = el('button', 'qdv-btn')
  muteBtn.type = 'button'
  const endBtn = el('button', 'qdv-btn end')
  endBtn.type = 'button'
  endBtn.title = 'Hang up'
  endBtn.setAttribute('aria-label', 'Hang up')
  endBtn.innerHTML = VOICE_ICONS.end
  const audio = el('audio')
  audio.autoplay = true
  bar.append(dot, text, level, muteBtn, endBtn, audio)
  ;(container.querySelector('.qd-ui') || container).append(bar)
  for (const type of ['keydown', 'keyup', 'paste', 'wheel', 'pointerdown']) bar.addEventListener(type, (e) => e.stopPropagation())
  muteBtn.onclick = () => { call?.mute(!call.muted); render() }
  endBtn.onclick = () => voice.stop()

  function render() {
    clearTimeout(hideTimer)
    bar.hidden = state === 'off' && !whoEl.textContent
    bar.classList.toggle('connecting', state === 'connecting')
    bar.classList.toggle('muted', !!call?.muted)
    muteBtn.hidden = endBtn.hidden = level.hidden = state === 'off'
    const muted = !!call?.muted
    muteBtn.innerHTML = muted ? VOICE_ICONS.muted : VOICE_ICONS.mic
    muteBtn.title = muted ? 'Unmute' : 'Mute'
    muteBtn.setAttribute('aria-label', muteBtn.title)
    if (state === 'connecting') whoEl.textContent = `Calling ${who?.name ?? ''}…`
    else if (state === 'on') whoEl.textContent = muted ? `Muted · ${who?.name ?? ''}` : `Talking with ${who?.name ?? ''}`
    const last = lines.findLast((l) => l.text.trim()) // a turn just begun has no words yet
    saidEl.replaceChildren(...(last ? [el('bdi', '', `${last.role === 'user' ? 'You' : who?.name ?? 'AI'}: ${last.text.trim()}`)] : []))
    for (const fn of listeners) fn()
  }
  // a word of why, shown a moment after the call (or instead of it)
  function notice(message) {
    state = 'off'
    lines = []
    whoEl.textContent = message
    render()
    hideTimer = setTimeout(() => { whoEl.textContent = ''; render() }, 5000)
  }

  // how loud: the person, or the voice while it speaks
  function meter(stream) {
    const ctx = new AudioContext()
    const an = ctx.createAnalyser()
    an.fftSize = 256
    ctx.createMediaStreamSource(stream).connect(an)
    return { ctx, an, buf: new Uint8Array(an.fftSize) }
  }
  const loud = (m) => {
    if (!m) return 0
    m.an.getByteTimeDomainData(m.buf)
    let sum = 0
    for (const v of m.buf) sum += ((v - 128) / 128) ** 2
    return Math.min(1, Math.sqrt(sum / m.buf.length) * 4)
  }
  function animate() {
    if (!meters) return
    const me = call?.muted ? 0 : loud(meters.me), them = loud(meters.them)
    const v = Math.max(me, them)
    level.classList.toggle('them', them > me)
    bars.forEach((b, i) => { b.style.height = `${4 + Math.round(v * 16 * (1 - Math.abs(i - 2) / 3))}px` })
    requestAnimationFrame(animate)
  }

  function ended(reason) {
    const was = call
    call = null
    id = null
    if (meters) { meters.me?.ctx.close(); meters.them?.ctx.close(); meters = null }
    audio.srcObject = null
    was?.close()
    if (reason && reason !== 'requested') notice(reason)
    else { state = 'off'; lines = []; whoEl.textContent = ''; render() }
  }

  const off = host.onMessage((m) => {
    if (!id || m.id !== id) return
    if (m.kind === 'answer') {
      call.answer(m.sdp).then(() => { state = 'on'; render() }, (e) => { host.stop(id); ended(`Could not connect: ${e.message}`) })
    } else if (m.kind === 'end') ended(m.reason)
  })

  const voice = {
    get talking() { return state !== 'off' },
    get with() { return state === 'off' ? null : who },
    get available() { return !!rtc },
    async start() {
      if (state !== 'off') return
      if (!rtc) return notice('This browser cannot talk (no microphone access).')
      const agent = host.agent()
      if (!agent) return notice('No AI here to talk with. Run quickdraw agent codex for this board.')
      who = agent
      state = 'connecting'
      lines = []
      render()
      let c
      try { c = await openCall(rtc) } catch (e) {
        return notice(e?.name === 'NotAllowedError' ? 'The microphone is not allowed for this page.' : `Could not use the microphone: ${e.message}`)
      }
      if (state !== 'connecting') return c.close() // hung up meanwhile
      call = c
      c.onAudio((stream) => {
        audio.srcObject = stream
        audio.play?.().catch(() => {})
        try { if (meters) meters.them = meter(stream) } catch {}
      })
      c.onSaid((s) => {
        if (s.turn || lines.at(-1)?.role !== s.role) lines = [...lines.slice(-4), { role: s.role, text: '' }]
        lines.at(-1).text += s.text
        render()
      })
      c.onClosed(() => { if (call === c) { host.stop(id); ended('The call dropped.') } })
      try { meters = { me: meter(c.mic) }; requestAnimationFrame(animate) } catch { meters = null }
      id = await host.start(agent, c.offer)
    },
    stop() {
      if (state === 'off') return
      if (id) host.stop(id)
      ended()
    },
    onChange(fn) { listeners.add(fn); return () => listeners.delete(fn) },
    destroy() {
      voice.stop()
      off?.()
      bar.remove()
    },
  }
  return voice
}

/** quickdraw-toolbar items: a microphone on the rail */
export function voiceTools(voice) {
  return {
    rail: [{
      id: 'voice', title: 'Talk with AI', icon: VOICE_ICONS.mic,
      available: () => voice.available,
      run: () => (voice.talking ? voice.stop() : voice.start()),
    }],
  }
}
