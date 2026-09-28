# quickdraw-voice

Talk with an agent on a Quickdraw board. A microphone button starts a call. The sound goes straight to a voice model over WebRTC, and the agent works on the board as you talk. While the call is on, a bar over the board says who you talk with and what was last said, with mute and hang up.

```js
import { createVoice, voiceTools } from 'quickdraw-voice'

const voice = createVoice({ editor: board.editor, host })        // host: below
createToolbar(board.editor, { rail: [...voiceTools(voice).rail] }) // quickdraw-toolbar: the microphone

voice.start()     // asks for the microphone, and calls
voice.stop()      // hangs up
voice.talking     // true from calling until it ends
```

`@quickdrawjs/core` is a peer. The package does not depend on `quickdraw-agent`: the agent is whoever the host places the call with.

## The host

The package makes the call; the host decides whom it is with and carries the offer and the answer:

```js
const host = {
  agent: () => ({ id: 'codex', name: 'Codex' }), // who to talk with, or null (none here that talks, or not for this viewer)
  start(agent, sdp) { return id },               // place the call with the WebRTC offer; returns its id
  stop(id) {},                                   // hang up
  onMessage(fn) {},                              // fn({ kind: 'answer', id, sdp }) | fn({ kind: 'end', id, reason? }); may return an unsubscribe
}
```

`apps/quickdraw` places the call as a request to the agent, carrying the offer. The agent gets `codex app-server` to place it with OpenAI (`thread/realtime/start` with a WebRTC transport) and sends the answer back through the relay. From then on, the sound goes only between the browser and OpenAI. What the person says is handed to Codex, which works on the board with its tools. The request's thread in the AI panel keeps what was said and done.

## The call

`openCall({ getUserMedia, Peer })` makes it, as OpenAI's realtime calls expect:

- **The microphone** as an audio track, with echo cancellation, noise suppression and automatic gain. The voice plays through a speaker without hearing itself.
- **A data channel, `oai-events`**, on which the voice model says what it hears and what it says, as it goes. `said(data)` reads it: `{ role: 'user' | 'assistant', text }` for words, and `turn: true` when a new turn starts. The bar shows the last line.
- **One offer** with all its candidates (no trickle), sent once gathering completes (or after 2 s), and one answer.

A dropped connection, a hang-up, or an `end` from the host closes the call and turns the microphone off. `createVoice` takes `rtc: { getUserMedia, Peer }` to use something other than the page's own. The tests do this, in Node.

## The bar

- It sits at the top in the middle of the core's `.qd-ui`, below the row of who is here ([`quickdraw-presence`](../quickdraw-presence)), in the core's theme.
- It shows "Calling …", then "Talking with …" or "Muted · …", with a green dot. The level bars move for you, and turn blue while the voice speaks.
- The last line said reads "You: …" or "Codex: …".
- When a call cannot start (no agent that talks, the microphone not allowed, an error from the agent), the bar says why for a few seconds.
- Keys, paste, wheel and pointer in the bar stay out of the board.

A microphone needs a secure page: https, or `http://localhost`.

Example: `examples/quickdraw-voice`, a made-up call (no microphone, no agent) that shows the bar through a conversation.
