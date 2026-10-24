# Licensing service contract

The Chrome extension cannot contain a Stripe secret key. Deploy this service
separately (for example, as a small serverless API) and keep the webhook
signing secret and database credentials server-side. The recommended
deployment uses a hosted Stripe Payment Link, so it does not need a Stripe API
secret at runtime.

## Required endpoints

### `POST /v1/license/status`

Request:

```json
{"installationId":"<random extension installation id>","token":"<optional prior token>"}
```

On the first request, create a server-side trial record for that installation
and return:

```json
{"status":"trial","trialEndsAt":"2026-11-01T00:00:00Z","token":"<signed token>"}
```

After a verified payment, return `status: "paid"` and a signed token. The
token must be scoped to this product and installation, and must not contain a
Stripe secret or payment-card data.

### `POST /v1/checkout/session`

Request:

```json
{"installationId":"<id>","email":"<optional customer email>"}
```

Return the configured Stripe Payment Link with a `client_reference_id` query
parameter containing the installation ID. The Payment Link is configured for
the one-time **$9.99 USD** Price and redirects to the success page after
payment.

Return only the Stripe-hosted Payment Link URL:

```json
{"url":"https://buy.stripe.com/..."}
```

### `POST /v1/stripe/webhook`

Verify the `Stripe-Signature` header with the webhook signing secret before
parsing the event. Fulfil only after a verified
`checkout.session.completed` event from the configured Payment Link with the
expected amount and currency. Also handle
`checkout.session.async_payment_succeeded` for delayed payment methods. Make
the handler idempotent because Stripe may retry events.

The extension does not need a client-supplied activation code. After Stripe
redirects to the success page, it calls `/v1/license/status` again. The Worker
uses the installation ID stored in D1 and the verified webhook result to return
`status: "paid"`. Never trust a success-page redirect by itself.

## Stripe setup

Create a one-time USD Price for $9.99 and a Payment Link for it in the Stripe
Dashboard (or CLI). Keep test/sandbox and live objects separate and configure
separate test and live webhook endpoints. The Chrome extension only receives
the public licensing API URL and the hosted Payment Link URL.
