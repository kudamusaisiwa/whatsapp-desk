interface Env {
  ASSETS: Fetcher;
  DB: D1Database;
  PUBLIC_BASE_URL: string;
  STORE_URL: string;
  STRIPE_PAYMENT_LINK_ID: string;
  STRIPE_PAYMENT_LINK_URL: string;
  STRIPE_WEBHOOK_SECRET: string;
  LICENSE_TOKEN_SECRET: string;
}

type LicenseStatus = "trial" | "paid" | "expired";
interface InstallationRow {
  installation_id: string;
  status: LicenseStatus;
  trial_ends_at: number;
  paid_at: number | null;
  customer_email: string | null;
  stripe_session_id: string | null;
  created_at: number;
  updated_at: number;
}

const TRIAL_SECONDS = 7 * 24 * 60 * 60;
const MAX_BODY_BYTES = 32_000;
const encoder = new TextEncoder();

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "Content-Type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Cache-Control": "no-store",
};

function json(value: unknown, status = 200, headers: HeadersInit = {}) {
  return new Response(JSON.stringify(value), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      ...cors,
      ...headers,
    },
  });
}

function text(value: string, status = 200, headers: HeadersInit = {}) {
  return new Response(value, {
    status,
    headers: { "Content-Type": "text/plain; charset=utf-8", ...headers },
  });
}

function now() {
  return Math.floor(Date.now() / 1000);
}

function validInstallationId(value: unknown): value is string {
  return typeof value === "string" && /^[a-zA-Z0-9_-]{20,128}$/.test(value);
}

function validEmail(value: unknown): value is string {
  return typeof value === "string" && value.length <= 320 && /.+@.+\..+/.test(value);
}

function base64Url(bytes: ArrayBuffer | Uint8Array) {
  const array = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  let binary = "";
  for (const byte of array) binary += String.fromCharCode(byte);
  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/, "");
}

function fromHex(value: string) {
  const bytes = new Uint8Array(value.length / 2);
  for (let i = 0; i < bytes.length; i++) bytes[i] = Number.parseInt(value.slice(i * 2, i * 2 + 2), 16);
  return bytes;
}

async function hmac(value: string, secret: string) {
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign", "verify"],
  );
  return new Uint8Array(await crypto.subtle.sign("HMAC", key, encoder.encode(value)));
}

async function equalBytes(a: Uint8Array, b: Uint8Array) {
  if (a.length !== b.length) return false;
  let result = 0;
  for (let i = 0; i < a.length; i++) result |= a[i] ^ b[i];
  return result === 0;
}

async function licenseToken(row: InstallationRow, env: Env) {
  const payload = {
    v: 1,
    installationId: row.installation_id,
    status: row.status,
    trialEndsAt: row.trial_ends_at,
    paidAt: row.paid_at,
    issuedAt: now(),
  };
  const encoded = base64Url(encoder.encode(JSON.stringify(payload)));
  const signature = base64Url(await hmac(encoded, env.LICENSE_TOKEN_SECRET));
  return `${encoded}.${signature}`;
}

async function parseJson(request: Request) {
  const contentLength = Number(request.headers.get("content-length") ?? 0);
  if (contentLength > MAX_BODY_BYTES) throw new Error("Request body is too large.");
  const raw = await request.text();
  if (raw.length > MAX_BODY_BYTES) throw new Error("Request body is too large.");
  const value = JSON.parse(raw) as unknown;
  if (!value || typeof value !== "object") throw new Error("Request body must be an object.");
  return value as Record<string, unknown>;
}

async function findOrCreateInstallation(id: string, env: Env) {
  const existing = await env.DB.prepare(
    "SELECT installation_id, status, trial_ends_at, paid_at, customer_email, stripe_session_id, created_at, updated_at FROM installations WHERE installation_id = ?",
  )
    .bind(id)
    .first<InstallationRow>();
  if (existing) return existing;
  const created = now();
  const trialEnds = created + TRIAL_SECONDS;
  await env.DB.prepare(
    "INSERT OR IGNORE INTO installations (installation_id, status, trial_ends_at, paid_at, customer_email, stripe_session_id, created_at, updated_at) VALUES (?, 'trial', ?, NULL, NULL, NULL, ?, ?)",
  )
    .bind(id, trialEnds, created, created)
    .run();
  return (await env.DB.prepare(
    "SELECT installation_id, status, trial_ends_at, paid_at, customer_email, stripe_session_id, created_at, updated_at FROM installations WHERE installation_id = ?",
  )
    .bind(id)
    .first<InstallationRow>())!;
}

async function currentInstallation(id: string, env: Env) {
  const row = await findOrCreateInstallation(id, env);
  if (row.status === "trial" && row.trial_ends_at <= now()) {
    await env.DB.prepare(
      "UPDATE installations SET status = 'expired', updated_at = ? WHERE installation_id = ? AND status = 'trial'",
    )
      .bind(now(), id)
      .run();
    return { ...row, status: "expired" as const };
  }
  return row;
}

async function createCheckout(body: Record<string, unknown>, env: Env) {
  const installationId = body.installationId;
  if (!validInstallationId(installationId)) throw new Error("Invalid installation identifier.");
  const row = await currentInstallation(installationId, env);
  if (row.status === "paid") return { url: `${env.PUBLIC_BASE_URL}/success.html?already_paid=1` };
  let checkoutUrl: URL;
  try {
    checkoutUrl = new URL(env.STRIPE_PAYMENT_LINK_URL);
  } catch {
    throw new Error("Stripe Payment Link is not configured.");
  }
  if (checkoutUrl.protocol !== "https:" || checkoutUrl.hostname !== "buy.stripe.com")
    throw new Error("Stripe Payment Link is not configured.");
  checkoutUrl.searchParams.set("client_reference_id", installationId);
  const email = validEmail(body.email) ? body.email : null;
  if (email) checkoutUrl.searchParams.set("prefilled_email", email);
  return { url: checkoutUrl.toString() };
}

function signatureParts(value: string) {
  const timestampPart = value.match(/(?:^|,)t=(\d+)/)?.[1];
  const signatures = [...value.matchAll(/(?:^|,)v1=([a-f0-9]+)/g)].map((match) => match[1]);
  return { timestamp: timestampPart ? Number(timestampPart) : 0, signatures };
}

async function verifyStripeSignature(raw: string, header: string, secret: string) {
  const { timestamp, signatures } = signatureParts(header);
  if (!timestamp || !signatures.length || Math.abs(now() - timestamp) > 300) return false;
  const expected = await hmac(`${timestamp}.${raw}`, secret);
  for (const signature of signatures) {
    if (/^[a-f0-9]{64}$/.test(signature) && (await equalBytes(expected, fromHex(signature)))) return true;
  }
  return false;
}

async function fulfilCheckout(session: Record<string, unknown>, env: Env) {
  const installationId =
    typeof session.client_reference_id === "string"
      ? session.client_reference_id
      : typeof (session.metadata as Record<string, unknown> | undefined)?.installation_id === "string"
        ? ((session.metadata as Record<string, unknown>).installation_id as string)
        : "";
  if (!validInstallationId(installationId)) throw new Error("Checkout is missing its installation identifier.");
  if (session.payment_status !== "paid") return false;
  if (session.currency !== "usd" || session.amount_total !== 999)
    throw new Error("Checkout amount or currency did not match the configured product.");
  if (session.payment_link !== env.STRIPE_PAYMENT_LINK_ID)
    throw new Error("Checkout did not use the configured Stripe Payment Link.");
  const sessionId = typeof session.id === "string" ? session.id : "";
  if (!sessionId) throw new Error("Checkout is missing its session identifier.");
  const customerDetails = session.customer_details as Record<string, unknown> | undefined;
  const email = typeof customerDetails?.email === "string" ? customerDetails.email.slice(0, 320) : null;
  const current = now();
  await env.DB.prepare(
    "INSERT INTO installations (installation_id, status, trial_ends_at, paid_at, customer_email, stripe_session_id, created_at, updated_at) VALUES (?, 'paid', ?, ?, ?, ?, ?, ?) ON CONFLICT(installation_id) DO UPDATE SET status = 'paid', paid_at = excluded.paid_at, customer_email = COALESCE(excluded.customer_email, installations.customer_email), stripe_session_id = excluded.stripe_session_id, updated_at = excluded.updated_at",
  )
    .bind(installationId, current, current, email, sessionId, current, current)
    .run();
  return true;
}

async function api(request: Request, env: Env) {
  if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: cors });
  if (request.method !== "POST") return json({ message: "Use POST." }, 405);
  const pathname = new URL(request.url).pathname;
  try {
    if (pathname === "/v1/license/status") {
      const body = await parseJson(request);
      if (!validInstallationId(body.installationId)) return json({ message: "Invalid installation identifier." }, 400);
      const row = await currentInstallation(body.installationId, env);
      const token = await licenseToken(row, env);
      return json({
        status: row.status,
        trialEndsAt: new Date(row.trial_ends_at * 1000).toISOString(),
        token,
      });
    }
    if (pathname === "/v1/checkout/session") return json(await createCheckout(await parseJson(request), env));
    return json({ message: "Not found." }, 404);
  } catch (error) {
    return json({ message: error instanceof Error ? error.message : "Request failed." }, 400);
  }
}

async function webhook(request: Request, env: Env) {
  if (request.method !== "POST") return text("Method not allowed", 405);
  const raw = await request.text();
  const signature = request.headers.get("Stripe-Signature") ?? "";
  if (!(await verifyStripeSignature(raw, signature, env.STRIPE_WEBHOOK_SECRET))) return text("Invalid signature", 400);
  try {
    const event = JSON.parse(raw) as { type?: string; data?: { object?: Record<string, unknown> } };
    if (event.type === "checkout.session.completed" || event.type === "checkout.session.async_payment_succeeded") {
      await fulfilCheckout(event.data?.object ?? {}, env);
    }
    return text("ok");
  } catch (error) {
    return text(error instanceof Error ? error.message : "Webhook processing failed.", 400);
  }
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    if (url.pathname === "/install") {
      if (!env.STORE_URL || env.STORE_URL.includes("REPLACE_AFTER")) return Response.redirect("https://chromewebstore.google.com/", 302);
      return Response.redirect(env.STORE_URL, 302);
    }
    if (url.pathname === "/v1/stripe/webhook") return webhook(request, env);
    if (url.pathname.startsWith("/v1/")) return api(request, env);
    return env.ASSETS.fetch(request);
  },
};
