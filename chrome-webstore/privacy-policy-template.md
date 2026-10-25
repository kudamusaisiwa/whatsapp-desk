# Desk AI for WhatsApp Web privacy policy — publication copy

**Effective date:** 25 October 2026

Desk AI for WhatsApp Web is an independent open-source Chrome extension by
Kudakwashe Musasiwa. It is not affiliated with, endorsed by, or produced by
Meta or WhatsApp.

## Data handled

When the user enables relevant features, Desk AI handles visible WhatsApp Web
conversation and contact details, business documents and notes, loaded images
or payment proofs, follow-ups, settings, call recordings/transcripts and
user-supplied participant/speaker names, and API keys for supported providers:
OpenAI, OpenRouter, Kimi (Moonshot), DeepSeek, Anthropic, Google Gemini and
xAI Grok. Provider keys are kept in the local Chrome extension profile and are
not supplied by the developer.

## How data is used and shared

The extension uses this data for its WhatsApp Web assistant, response-window
and follow-up features. The trusted extension worker sends only the data
required for a task to the provider selected for that task, authenticated with
the user's own key. Drafts can include selected business excerpts, visible
conversation content and selected images. Polishing sends only the selected
operator text. Call summaries send the transcript and configured business,
participant and speaker names. Dictation and call audio are sent only after
the user starts transcription. Provider privacy, retention and usage terms
apply. The extension does not send AI content to the licensing service or
operate general-purpose analytics, advertising or data-broker services.

Optional call recording starts only after the user clicks Record and chooses
the active WhatsApp Web tab with **Share audio** enabled in Chrome's picker. It
records tab audio and the user's microphone for up to 60 minutes and 20 MiB;
video is not recorded and audio is not saved by the extension. The summary
remains editable and is synced only to the original chat with a compare-and-set
check against the current composer. The extension does not send the summary or
any message.

The licensing service receives an installation identifier and license status
needed to provide the seven-day trial and verify the $9.99 purchase. It must
not receive WhatsApp conversations, business documents or provider keys.
Stripe receives only the information needed to process the optional one-time
license purchase through hosted Checkout; payment-card data is handled by
Stripe, not by the extension.

## Storage, retention and deletion

Knowledge, notes, follow-ups, settings and provider keys remain in the local
Chrome profile until the user removes them or uninstalls the extension.
Provider data retention and API policies apply to requests sent to that
provider. Users can remove saved keys in Settings and delete local knowledge
and follow-ups from the extension.

## Security

All network requests use HTTPS. Provider keys are not independently encrypted
by Desk AI for WhatsApp Web; anyone with access to the browser profile or
extension developer tools may be able to retrieve them. Users should never
put keys in source code, screenshots, issues or shared files.

## Contact and changes

For privacy questions or deletion requests, open an issue in the public
[Desk AI for WhatsApp Web support tracker](https://github.com/kudamusaisiwa/whatsapp-desk/issues).
Do not include API keys, card details or customer messages in an issue. Update
this policy and the Chrome Web Store privacy declarations when the extension's
data practices change.
