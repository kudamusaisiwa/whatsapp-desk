# WhatsApp Desk Cloudflare site

This Worker serves the WhatsApp Desk landing page, the privacy/terms pages,
and the small licensing API used by the Chrome Web Store build. Workers Static
Assets serves `public/`; D1 stores installation and verified-payment state.
Stripe Checkout is hosted by a Payment Link. The Worker only receives signed
webhooks; no Stripe API key or OpenAI secret belongs in the extension ZIP.

## One-time setup

From this folder:

```sh
npm install
npx wrangler login
npx wrangler whoami
npx wrangler d1 create whatsapp-desk-licenses
```

Copy the returned D1 `database_id` into `wrangler.jsonc`. Replace these vars
there before deploying:

- `PUBLIC_BASE_URL` — the final `https://` Worker/site URL;
- `STORE_URL` — the published Chrome Web Store listing URL (the `/install`
  redirect is safe to leave pointed at the Web Store home until publishing);
- `STRIPE_PAYMENT_LINK_ID` — the live Payment Link used for the **$9.99**
  one-time purchase;
- `STRIPE_PAYMENT_LINK_URL` — its public `https://buy.stripe.com/...` URL.

Do not deploy with any `REPLACE_...` value still present. The production
deployment for this repository is currently
`https://whatsapp-desk-license-site.bakani.workers.dev`; its Web Store install
redirect remains pointed at the Web Store home until the listing has a final
URL. The legal pages identify Kudakwashe Musasiwa as seller, link to the public
GitHub support tracker, and state the 14-day refund window; review them before
accepting payments.

Apply the schema remotely:

```sh
npm run d1:migrate:remote
```

Create the two Worker secrets. Use a separate set for test and live
deployments:

```sh
npx wrangler secret put STRIPE_WEBHOOK_SECRET
npx wrangler secret put LICENSE_TOKEN_SECRET
```

Deploy the site and API:

```sh
npm run typecheck
npm run deploy
```

Configure a Stripe webhook at
`https://YOUR_WORKER_DOMAIN/v1/stripe/webhook` for:

- `checkout.session.completed`
- `checkout.session.async_payment_succeeded`

Copy the endpoint signing secret into `STRIPE_WEBHOOK_SECRET`. The Worker
checks the signature, configured Payment Link, amount, currency and payment
status before marking an installation as paid. Stripe may retry events, so the
D1 write is idempotent. The `client_reference_id` URL parameter carries the
installation identifier into the Checkout Session without exposing a Stripe
API key.

After the first successful deployment, set `PUBLIC_BASE_URL` to the exact
Worker URL, create the webhook against that URL, and deploy once more so the
landing-page `/install` redirect and Checkout return URLs are production-safe.

## Local development

Copy `.dev.vars.example` to `.dev.vars`, replace the values with test-mode
credentials, and run:

```sh
npm run d1:migrate:local
npx wrangler dev
```

The local D1 database and `.wrangler/` state are disposable. Do not use live
Stripe keys with local development.

## Extension build

After deployment, build the store ZIP from the repository root:

```sh
cd ../..
WHATSAPP_DESK_LICENSE_API_URL=https://YOUR_WORKER_DOMAIN \
  npm run package:webstore
```

The extension only receives the public Worker URL. The Worker returns Stripe's
hosted Payment Link with a per-installation `client_reference_id`, then the
extension refreshes its license status after the verified webhook marks the
installation paid.
