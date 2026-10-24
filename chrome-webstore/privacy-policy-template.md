# WhatsApp Desk privacy policy — publication copy

**Effective date:** 25 October 2026

WhatsApp Desk is an independent open-source Chrome extension by Kudakwashe
Musasiwa. It is not affiliated with, endorsed by, or produced by Meta or
WhatsApp.

## Data handled

When the user enables the relevant features, WhatsApp Desk handles the visible
WhatsApp Web conversation and contact details, business documents and notes,
loaded images or payment proofs, follow-up records, extension settings, and the
user-supplied OpenAI API key. The key is stored in the local Chrome extension
profile and is not supplied by the developer.

## How data is used and shared

The extension uses this data only to provide its WhatsApp Web reply-assistant,
24-hour response-window and follow-up features. For an AI draft, the selected
business excerpts, visible conversation and selected images are sent directly
from the extension to `api.openai.com` using the user's own key. WhatsApp Desk
does not operate a general-purpose analytics, advertising or data-broker
service. Stripe receives only the information needed to process the optional
one-time license purchase through its hosted Checkout page; payment-card data
is handled by Stripe, not by the extension.

The licensing service receives an installation identifier and license status
needed to provide the seven-day trial and verify the $9.99 purchase. It must
not receive WhatsApp conversations, business documents or the OpenAI key.

## Storage, retention and deletion

Knowledge, notes, follow-ups, settings and the OpenAI key remain in the local
Chrome profile until the user removes them or uninstalls the extension. The
extension requests `store: false` for OpenAI response objects, but OpenAI's own
API policies apply. Users can remove the saved OpenAI key from Settings and
can delete local knowledge and follow-ups from the extension.

## Security

All network requests use HTTPS. The OpenAI key is not independently encrypted
by WhatsApp Desk; anyone with access to the browser profile or extension
developer tools may be able to retrieve it. Users should never put keys in
source code, screenshots, issues or shared files.

## Contact and changes

For privacy questions or deletion requests, open an issue in the public
[WhatsApp Desk support tracker](https://github.com/kudamusasiwa/whatsapp-desk/issues).
Do not include API keys, card details or customer messages in an issue. Update
this policy and the Chrome Web Store privacy declarations when the extension's
data practices change.
