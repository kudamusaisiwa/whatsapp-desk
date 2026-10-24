# Licensing service contract

The Chrome extension cannot contain a Stripe secret key. Deploy this service
separately (for example, as a small serverless API) and store its Stripe key,
webhook signing secret, Price ID and database credentials as server-side
secrets.

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

Create a Stripe Checkout Session on the server with:

- `mode: "payment"`;
- the configured one-time Price representing **999 USD cents**;
- `client_reference_id` and metadata containing the installation ID; and
- a success URL that explains how to activate the purchase.

Return only the Stripe-hosted Checkout URL:

```json
{"url":"https://checkout.stripe.com/..."}
```

### `POST /v1/stripe/webhook`

Verify the `Stripe-Signature` header with the webhook signing secret before
parsing the event. Fulfil only after a verified
`checkout.session.completed` event with the expected Price, amount and
currency. Also handle `checkout.session.async_payment_succeeded` for delayed
payment methods. Make the handler idempotent because Stripe may retry events.

The extension does not need a client-supplied activation code. After Stripe
redirects to the success page, it calls `/v1/license/status` again. The Worker
uses the installation ID stored in D1 and the verified webhook result to return
`status: "paid"`. Never trust a success-page redirect by itself.

## Stripe setup

Create a one-time USD Price for $9.99 in the Stripe Dashboard. Use a restricted
server-side key where possible, keep test/sandbox and live objects separate,
and configure separate test and live webhook endpoints. The Chrome extension
only receives the public licensing API URL and the hosted Checkout URL.
