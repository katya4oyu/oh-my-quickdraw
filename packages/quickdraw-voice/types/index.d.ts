import type { Editor } from '@quickdrawjs/core'

/** Who to talk with. */
export interface VoiceAgent { id: string, name: string }

/** Messages from the host about the call it placed (`id`: what `start` returned). */
export type VoiceIn =
  | { kind: 'answer', id: string, sdp: string }
  | { kind: 'end', id: string, reason?: string | null }

export interface VoiceHost {
  /** who to talk with: null when there is no agent here that talks (or not for this viewer) */
  agent(): VoiceAgent | null
  /** places the call with the WebRTC offer; returns its id */
  start(agent: VoiceAgent, sdp: string): string | Promise<string>
  /** hangs up */
  stop(id: string): void
  onMessage(fn: (message: VoiceIn) => void): void | (() => void)
}

/** The browser's WebRTC and microphone (by default, the page's own). */
export interface VoiceRtc {
  getUserMedia(constraints: MediaStreamConstraints): Promise<MediaStream>
  Peer: typeof RTCPeerConnection
  /** how long to wait for the offer's candidates, ms */
  gatherMs?: number
}

export interface Voice {
  readonly talking: boolean
  /** who is being talked with, while talking */
  readonly with: VoiceAgent | null
  /** this browser can talk */
  readonly available: boolean
  start(): Promise<void>
  stop(): void
  onChange(fn: () => void): () => void
  destroy(): void
}

export function createVoice(opts: { editor: Editor, container?: HTMLElement, host: VoiceHost, rtc?: VoiceRtc }): Voice
/** quickdraw-toolbar items: a microphone on the rail */
export function voiceTools(voice: Voice): { rail: object[] }
export const VOICE_ICONS: { mic: string, muted: string, end: string }

export interface Said { role: 'user' | 'assistant', text: string, turn?: boolean }
export interface Call {
  readonly offer: string
  readonly mic: MediaStream
  answer(sdp: string): Promise<void>
  readonly muted: boolean
  mute(on: boolean): void
  onAudio(fn: (stream: MediaStream) => void): () => void
  onSaid(fn: (said: Said) => void): () => void
  onClosed(fn: () => void): () => void
  readonly closed: boolean
  close(): void
}
/** A WebRTC call to a voice model: the microphone, the "oai-events" data channel, and the offer to send. */
export function openCall(rtc: VoiceRtc): Promise<Call>
/** What an event on the data channel says: words of the person or the voice, or a new turn. */
export function said(data: string): Said | null
