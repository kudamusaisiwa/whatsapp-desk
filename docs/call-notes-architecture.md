# WhatsApp Web call notes

## Workflow

The operator selects Record call in Desk AI while the participant’s WhatsApp chat is selected. Chrome opens its normal tab sharing picker; the operator selects the WhatsApp call tab and enables Share audio. A separate microphone stream captures the local speaker. An AudioContext mixes those sources into an audio-only MediaRecorder output. No helper window, background auto-recording, browser speech recognition, video recording, or automatic WhatsApp send is used.

Stop recording releases the extension’s streams, sends the mixed recording to OpenAI Whisper with the configured API key, and displays the transcript. Write call summary creates a customer-facing WhatsApp message from the business to the participant: a thank-you, what was discussed, agreed next steps and anything still to confirm. The message remains editable and is placed into the original participant’s WhatsApp composer only when its prior text matches the extension’s last synchronized draft. The operator presses WhatsApp Send.

## Boundaries

- Capture starts only from an explicit operator click and the browser sharing choice. Both microphone and remote audio tracks must be present; microphone-only success is not accepted.
- Source IDs and audio stay in memory. Video may be required by Chrome to acquire the selected source, but only mixed audio reaches MediaRecorder or OpenAI.
- Maximum recording duration is one hour, target bitrate 32 kbps, and audio payload limit 20 MiB. Dictation retains its existing shorter bounds.
- Background code owns API keys, validates panel callers, obtains a one-use source ID limited to the consumer WhatsApp tab, and relays token-bound recording controls. Content code owns media streams, mixing and cleanup.
- Recording stays bound to the chat selected at start, even if the operator changes chats. Recording may continue while another Desk section is displayed. Closing the page or cancelling releases streams.
- Summaries send OpenAI only the transcript, the configured business name, the participant's name and any speaker names the operator enters (also sent to Whisper as a transcription hint). Names are labels, never instructions. The app adds the greeting, headings and closing. The model must not invent decisions, commitments, owners or deadlines. No operational action is executed by summarization.
- Independent WhatsApp edits, changed chats and failed requests preserve drafts. Existing staff, license and automation rules remain intact.

Reference: https://developer.chrome.com/docs/extensions/reference/api/desktopCapture
