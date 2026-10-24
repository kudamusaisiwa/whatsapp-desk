# Chrome Web Store listing copy

Use this copy when creating the Desk AI for WhatsApp Web listing. The privacy and terms
URLs below are served by the deployed Bakani Worker.

## Name

Desk AI for WhatsApp Web

## Short description

Business knowledge, AI reply drafts, follow-ups and a live 24-hour response timer inside WhatsApp Web.

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
- Human takeover controls and manual review before sending.
- A seven-day trial, then a one-time $9.99 USD unlock through Stripe Checkout.

Bring your own OpenAI API key. Desk AI for WhatsApp Web does not include or resell OpenAI
credits. The key and local workspace stay in your Chrome profile; selected
conversation content, business excerpts and images are sent directly to
OpenAI only when you request a draft. The Chrome Web Store edition keeps
automatic sending disabled and requires you to review and click Send.

Desk AI for WhatsApp Web is an independent open-source project by Kudakwashe Musasiwa. It
is not affiliated with, endorsed by, or produced by Meta or WhatsApp.

## Privacy practices declaration

- **Single purpose:** help a business draft and manage replies in WhatsApp Web.
- **Data used:** visible WhatsApp conversation/contact details, user-provided
  business documents and notes, selected images, follow-ups, settings, and the
  user-provided OpenAI API key.
- **Data transfer:** selected draft context goes directly to `api.openai.com`
  using the user's key. Stripe receives payment details through hosted
  Checkout. The licensing service receives an installation identifier and
  license status, not conversations or the OpenAI key.
- **Data sale:** none.
- **Authentication:** no WhatsApp or Meta credentials are collected by the
  extension; WhatsApp Web's own QR linking flow is used.

## Support links

- Privacy policy: `https://whatsapp-desk-license-site.bakani.workers.dev/privacy.html`
- Terms and refunds: `https://whatsapp-desk-license-site.bakani.workers.dev/terms.html`
- Support tracker: `https://github.com/kudamusasiwa/whatsapp-desk/issues`

## Reviewer test notes

1. Open `https://web.whatsapp.com` and link a test account with WhatsApp's QR
   flow.
2. Load the Web Store ZIP with Chrome's extension test tools.
3. Open Settings, enter the tester's own OpenAI API key, save it, and add a
   small business note or document.
4. Open an individual chat and click **Draft a reply**.
5. Confirm that a draft appears in the WhatsApp composer and that no Send click
   happens automatically.
