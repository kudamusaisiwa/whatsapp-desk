# WhatsApp Desk — Chrome Web Store edition

This folder documents the paid Web Store build. The existing `releases/WhatsApp-Desk.zip`
manual-install release is unchanged.

## Commercial model

- Seven-day trial issued by the licensing service.
- One-time **$9.99 USD** unlock through Stripe Checkout.
- The customer supplies their own OpenAI API key. No OpenAI key is included,
  shared or billed by WhatsApp Desk.
- The Worker uses a hosted Stripe Payment Link, so no Stripe API secret is
  needed in the extension or licensing service. The webhook signing secret and
  payment records stay on the licensing service.

Stripe's one-time Checkout mode does not have a subscription trial. The trial
is therefore issued by the licensing service, and the $9.99 payment is a
one-time Checkout Session. A successful browser redirect is not treated as
proof of payment; the extension activates only after the server verifies the
Stripe event and returns an activation token.

## Build

The package command requires the HTTPS URL of the deployed licensing service:

```sh
WHATSAPP_DESK_LICENSE_API_URL=https://licenses.example.com \
  npm run package:webstore
```

The command creates:

- `releases/WhatsApp-Desk-WebStore/` — unpacked store build with
  `manifest.json` at its root;
- `releases/WhatsApp-Desk-WebStore.zip` — ZIP for the Chrome Web Store;
- `releases/WhatsApp-Desk-WebStore.zip.sha256` — integrity checksum; and
- `releases/WhatsApp-Desk-WebStore-audit.json` — package inventory and scan
  summary.

The command fails closed if the license API is missing, not HTTPS, or the
package contains an unexpected file. The package contains no Stripe secret,
OpenAI key, browser profile, customer data or source tree.

## Chrome Web Store upload

Use `releases/WhatsApp-Desk-WebStore.zip` for the Web Store dashboard. Upload
the ZIP itself; do not upload the unpacked directory and do not upload the
manual-install `WhatsApp-Desk.zip`. The unpacked
`releases/WhatsApp-Desk-WebStore/` directory is only for local **Load
unpacked** testing.

In the dashboard, complete the Store Listing, Privacy, Distribution and Test
Instructions sections. Use the deployed privacy-policy URL, state that the
extension is an independent project (not Meta/WhatsApp), explain the
WhatsApp Web host permission and OpenAI data flow, and disclose the external
Stripe checkout/trial. Identify Kudakwashe Musasiwa as the seller. The hosted
privacy and terms pages include the support tracker and 14-day refund policy;
review those pages and the Web Store disclosures together before submitting.
The Web Store edition keeps automatic sending off and requires the user to
review and click Send.

Ready-to-paste listing copy, privacy declarations and reviewer test notes are
in [`store-listing.md`](store-listing.md). The product screenshots and
installation examples are in [`../docs/images/`](../docs/images/).

## Cloudflare licensing service and landing page

The recommended deployment is the Worker project in
[`cloudflare/`](cloudflare/). It serves the public landing page and privacy
pages from Workers Static Assets, exposes the licensing API from the same
Worker, stores installation/payment state in D1, and keeps Stripe credentials
in Worker secrets. Read its README before creating resources.

```sh
cd chrome-webstore/cloudflare
npm install
npx wrangler whoami
```

Create the D1 database, apply `migrations/0001_initial.sql`, set the two
Worker secrets (`STRIPE_WEBHOOK_SECRET` and `LICENSE_TOKEN_SECRET`), then
deploy. Configure the live Payment Link ID and URL as Worker variables. The
Worker URL becomes
`WHATSAPP_DESK_LICENSE_API_URL` for the extension package command.

## Licensing service contract

See [`license-server/README.md`](license-server/README.md). The service must:

1. start or return the installation's seven-day trial;
2. create a Stripe Checkout Session server-side for the configured $9.99
   Price;
3. receive and verify `checkout.session.completed` (and delayed-payment
   success events) through a webhook;
4. mark the installation paid only for a verified payment; and
5. return the current trial/paid status to the extension after checkout.

The extension returns to the landing page after Stripe Checkout; the user
then clicks **Refresh license status** in Settings. Do not replace this with a
client-side Stripe secret or a local “I paid” flag.

## Store review notes

The store listing should state that WhatsApp Desk is an independent project,
not affiliated with Meta or WhatsApp, and that the extension uses WhatsApp
Web's own QR linking flow. The store build should require a human confirmation
for every message send. See the repository's Chrome Web Store checklist before
submitting the package.
