# Chrome Web Store listing copy

Use this copy when creating the Desk AI for WhatsApp Web listing. The privacy and terms
URLs below are served by the deployed Bakani Worker.

## Name

Desk AI for WhatsApp Web

## Short description

Business knowledge, AI reply drafts, call notes, follow-ups and a live 24-hour response timer inside WhatsApp Web.

## Detailed description

Desk AI for WhatsApp Web keeps the useful parts of a customer-support desk beside WhatsApp
Web. Add your own services, prices, policies and FAQs, then draft thoughtful
replies grounded in the information you approve.

Features:

- Live 24-hour response-window timer from the latest customer message.
- WhatsApp Business QR linking through WhatsApp Web — no Meta Business
  Manager or WhatsApp Cloud API setup.
- Business knowledge, local notes, client stages and follow-up reminders.
- Picture and receipt understanding with review safeguards.
- Call and meeting audio recording with transcripts, then a customer-facing
  call summary: a thank-you, what was discussed, next steps and open items.
  Name the company and customer speakers for better results.
- Speech-to-text WhatsApp replies with AI polish — professional, shorter,
  clearer or summarized — reviewed before you press Send.
- A compact panel that keeps the composer, client details and call notes on
  screen without scrolling.
- Human takeover controls and manual review before sending.
- A seven-day trial, then a one-time $9.99 USD unlock through Stripe Checkout.

Bring your own API credentials for OpenAI, OpenRouter, Kimi (Moonshot),
DeepSeek, Anthropic, Google Gemini or xAI Grok. Desk AI for WhatsApp Web does
not include or resell provider usage credits. Credentials and the local
workspace stay in your Chrome profile. For each task, selected conversation
content, business excerpts, images or audio are sent directly from the trusted
extension worker to the provider you selected. Text polishing sends only the
selected operator text; call summaries send transcript text and names you
provide; transcription sends audio after you start it. Provider privacy and
retention terms apply. The extension does not send AI content to the licensing
service. The Chrome Web Store edition keeps automatic sending disabled and
requires you to review and click Send.

Model and task compatibility varies. Image understanding requires a compatible
model. OpenAI, OpenRouter and Google Gemini transcription adapters are
supported in this release; other providers do not support speech transcription
in this version.
Image generation, text-to-speech and Sign in with ChatGPT/ChatGPT-plan usage
are not included. API usage is billed by the applicable provider; OpenAI API
billing is separate from a ChatGPT subscription.

Desk AI for WhatsApp Web is an independent open-source project by Kudakwashe Musasiwa. It
is not affiliated with, endorsed by, or produced by Meta or WhatsApp.

## Privacy practices declaration

- **Single purpose:** help a business draft and manage replies in WhatsApp Web.
- **Data used:** visible WhatsApp conversation/contact details, user-provided
  business documents and notes, selected images, follow-ups, settings,
  optional call recordings and transcripts with user-supplied participant and
  speaker names, and user-provided provider API keys.
- **Data transfer:** selected task data goes directly to the provider selected
  for that task using the user's key. Supported providers are OpenAI,
  OpenRouter, Kimi (Moonshot), DeepSeek, Anthropic, Google Gemini and xAI Grok.
  Stripe receives payment details through hosted
  Checkout. The licensing service receives an installation identifier and
  license status, not conversations, recordings or provider keys.
- **Data sale:** none.
- **Authentication:** no WhatsApp or Meta credentials are collected by the
  extension; WhatsApp Web's own QR linking flow is used.

## Support links

- Privacy policy: `https://whatsapp-desk-license-site.bakani.workers.dev/privacy.html`
- Terms and refunds: `https://whatsapp-desk-license-site.bakani.workers.dev/terms.html`
- Support tracker: `https://github.com/kudamusaisiwa/whatsapp-desk/issues`

## Reviewer test notes

1. Open `https://web.whatsapp.com` and link a test account with WhatsApp's QR
   flow.
2. Load the Web Store ZIP with Chrome's extension test tools.
3. Open Settings, connect the tester's own provider API key, save it, and add a
   small business note or document.
4. Open an individual chat and click **Draft a reply**.
5. Confirm that a draft appears in the WhatsApp composer and that no Send click
   happens automatically.
