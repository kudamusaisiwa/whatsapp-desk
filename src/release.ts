/** Build-time release configuration. The Web Store build is intentionally
 * configured without any Stripe secret; payment verification stays server-side. */
declare const __WHATSAPP_DESK_STORE__: boolean;
declare const __WHATSAPP_DESK_LICENSE_API__: string;

export const STORE_RELEASE =
  typeof __WHATSAPP_DESK_STORE__ === "boolean" &&
  __WHATSAPP_DESK_STORE__;

export const LICENSE_API_BASE_URL =
  typeof __WHATSAPP_DESK_LICENSE_API__ === "string"
    ? __WHATSAPP_DESK_LICENSE_API__.replace(/\/+$/, "")
    : "";

export const TRIAL_DAYS = 7;
