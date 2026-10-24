import type { LicenseState } from "./types";
import {
  LICENSE_API_BASE_URL,
  STORE_RELEASE,
} from "./release";

const INSTALLATION_KEY = "whatsappDeskInstallationId";
const LICENSE_KEY = "whatsappDeskLicense";
const CACHE_MS = 60_000;
const REQUEST_TIMEOUT_MS = 8_000;

interface StoredLicense extends LicenseState {
  token?: string;
}

let cached: { state: LicenseState; at: number } | null = null;

function publicState(stored: StoredLicense): LicenseState {
  const expired =
    stored.status === "trial" &&
    typeof stored.trialEndsAt === "number" &&
    stored.trialEndsAt <= Date.now();
  return {
    status: expired ? "expired" : stored.status,
    installationId: stored.installationId,
    trialEndsAt: stored.trialEndsAt ?? null,
    checkedAt: stored.checkedAt ?? null,
    message: stored.message,
  };
}

async function installationId(): Promise<string> {
  const old = await chrome.storage.local.get(INSTALLATION_KEY);
  const current = old[INSTALLATION_KEY];
  if (typeof current === "string" && current.length >= 20) return current;
  const next = crypto.randomUUID();
  await chrome.storage.local.set({ [INSTALLATION_KEY]: next });
  return next;
}

async function storedLicense(id: string): Promise<StoredLicense> {
  const saved = (await chrome.storage.local.get(LICENSE_KEY))[LICENSE_KEY];
  if (!saved || typeof saved !== "object")
    return {
      status: "offline",
      installationId: id,
      trialEndsAt: null,
      checkedAt: null,
    };
  const record = saved as Record<string, unknown>;
  return {
    status: record.status as LicenseState["status"],
    installationId: id,
    trialEndsAt:
      typeof record.trialEndsAt === "number" ? record.trialEndsAt : null,
    checkedAt: typeof record.checkedAt === "number" ? record.checkedAt : null,
    message: typeof record.message === "string" ? record.message : undefined,
    token: typeof record.token === "string" ? record.token : undefined,
  };
}

function timestamp(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value !== "string") return null;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function normalizeRemote(
  payload: Record<string, unknown>,
  id: string,
  old: StoredLicense,
): StoredLicense {
  const rawStatus = String(payload.status ?? "offline");
  const status: LicenseState["status"] =
    rawStatus === "paid" || rawStatus === "active"
      ? "paid"
      : rawStatus === "trial"
        ? "trial"
        : rawStatus === "expired"
          ? "expired"
          : "offline";
  const remoteToken =
    typeof payload.token === "string" && payload.token.length
      ? payload.token
      : old.token;
  return {
    status,
    installationId: id,
    trialEndsAt: timestamp(payload.trialEndsAt ?? payload.trial_ends_at),
    checkedAt: Date.now(),
    message:
      typeof payload.message === "string" ? payload.message.slice(0, 300) : undefined,
    ...(remoteToken ? { token: remoteToken } : {}),
  };
}

async function request(path: string, body: Record<string, unknown>) {
  if (!LICENSE_API_BASE_URL)
    throw new Error("Store licensing is not configured for this build.");
  const response = await fetch(`${LICENSE_API_BASE_URL}${path}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json",
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });
  let payload: Record<string, unknown> = {};
  try {
    payload = (await response.json()) as Record<string, unknown>;
  } catch {
    // The status below is enough to produce a safe user-facing error.
  }
  if (!response.ok)
    throw new Error(
      typeof payload.message === "string"
        ? payload.message.slice(0, 300)
        : `Licensing service unavailable (${response.status}).`,
    );
  return payload;
}

export async function getLicenseState(force = false): Promise<LicenseState> {
  if (!STORE_RELEASE)
    return {
      status: "bypass",
      installationId: null,
      trialEndsAt: null,
      checkedAt: null,
    };

  const id = await installationId();
  if (cached && !force && Date.now() - cached.at < CACHE_MS)
    return cached.state;
  const old = await storedLicense(id);
  if (!LICENSE_API_BASE_URL) {
    const state: LicenseState = {
      status: "unconfigured",
      installationId: id,
      trialEndsAt: old.trialEndsAt ?? null,
      checkedAt: Date.now(),
      message: "Store licensing is not configured for this build.",
    };
    cached = { state, at: Date.now() };
    return state;
  }

  try {
    const remote = await request("/v1/license/status", {
      installationId: id,
      token: old.token ?? null,
    });
    const next = normalizeRemote(remote, id, old);
    await chrome.storage.local.set({ [LICENSE_KEY]: next });
    const state = publicState(next);
    cached = { state, at: Date.now() };
    return state;
  } catch (error) {
    const fallback = publicState({
      ...old,
      message:
        old.status === "trial" || old.status === "paid"
          ? "Could not refresh licensing; using the last verified status."
          : error instanceof Error
            ? error.message
            : "Could not reach the licensing service.",
    });
    cached = { state: fallback, at: Date.now() };
    return fallback;
  }
}

export function hasLicenseAccess(state: LicenseState) {
  return ["bypass", "trial", "paid"].includes(state.status);
}

export async function assertLicenseAccess() {
  const state = await getLicenseState();
  if (hasLicenseAccess(state)) return state;
  if (state.status === "expired")
    throw new Error("Your 7-day trial has ended. Unlock WhatsApp Desk for $9.99.");
  if (state.status === "unconfigured")
    throw new Error("Store licensing is not configured for this build.");
  throw new Error("Connect to the licensing service before drafting replies.");
}

export async function startCheckout(email?: string) {
  const id = await installationId();
  const payload = await request("/v1/checkout/session", {
    installationId: id,
    ...(email?.trim() ? { email: email.trim().slice(0, 320) } : {}),
  });
  const url = typeof payload.url === "string" ? payload.url : "";
  if (!/^https:\/\//i.test(url))
    throw new Error("The licensing service returned an invalid checkout URL.");
  return { url };
}
