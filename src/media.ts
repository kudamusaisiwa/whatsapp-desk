import type { ChatContext, Message } from "./types";

export const MAX_IMAGES = 6;
export const MAX_IMAGE_CHARS = 2_800_000;
export const MAX_TOTAL_IMAGE_CHARS = 8_000_000;
export const MAX_IMAGE_EDGE = 2048;
export interface CapturedImage {
  id: string;
  dataUrl?: string;
}

// Only photo surfaces, never avatars, link previews, quoted thumbnails, stickers
// or video frames. WhatsApp keeps both a tiny placeholder and full image inside
// media-url-provider; they represent ONE attachment.
export function photoSurfaces(row: Element): Element[] {
  const nodes = [
    ...row.querySelectorAll(
      '[data-testid="image-thumb"], [data-testid="image-message"], [data-testid="image"], [role="button"][aria-label="Open picture"]',
    ),
  ].filter(
    (n) =>
      !n.closest(
        '[data-testid*="quoted"], [data-testid*="sticker"], [data-testid*="link-preview"], [data-testid*="video"], [data-testid="document-thumb"]',
      ),
  );
  return nodes.filter(
    (n) => !nodes.some((other) => other !== n && other.contains(n)),
  );
}
export function imageIds(row: Element, messageId: string): string[] {
  return photoSurfaces(row)
    .slice(0, 20)
    .map((_, i) => `${messageId}:image:${i}`);
}

export function capturePhotos(
  doc: Document,
  context: ChatContext,
): CapturedImage[] {
  const wanted = context.messages
    .slice(-35)
    .flatMap((m) => m.images ?? [])
    .slice(-MAX_IMAGES);
  const ids = new Set(wanted);
  const result: CapturedImage[] = [];
  let total = 0;
  for (const row of doc.querySelectorAll("#main [data-id]")) {
    const messageId = row.getAttribute("data-id")!;
    const message = context.messages.find((m) => m.id === messageId);
    if (!message) continue;
    for (const [i, surface] of photoSurfaces(row).entries()) {
      const id = `${messageId}:image:${i}`;
      if (!ids.has(id)) continue;
      const images = [...surface.querySelectorAll<HTMLImageElement>("img")]
        .filter(
          (img) =>
            img.complete && img.naturalWidth >= 100 && img.naturalHeight >= 100,
        )
        .sort(
          (a, b) =>
            b.naturalWidth * b.naturalHeight - a.naturalWidth * a.naturalHeight,
        );
      let dataUrl: string | undefined;
      for (const img of images) {
        try {
          const canvas = doc.createElement("canvas");
          const scale = Math.min(
            1,
            MAX_IMAGE_EDGE / Math.max(img.naturalWidth, img.naturalHeight),
          );
          canvas.width = Math.max(1, Math.round(img.naturalWidth * scale));
          canvas.height = Math.max(1, Math.round(img.naturalHeight * scale));
          const ctx = canvas.getContext("2d");
          if (!ctx) continue;
          ctx.fillStyle = "#fff";
          ctx.fillRect(0, 0, canvas.width, canvas.height);
          ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
          const encoded = canvas.toDataURL("image/jpeg", 0.92);
          if (
            !validImageData(encoded) ||
            total + encoded.length > MAX_TOTAL_IMAGE_CHARS
          )
            continue;
          dataUrl = encoded;
          total += encoded.length;
          break;
        } catch {
          // Undownloaded, protected or inaccessible images stay unavailable.
          // Never fetch an arbitrary page-supplied URL in the background worker.
        }
      }
      result.push({ id, ...(dataUrl ? { dataUrl } : {}) });
    }
  }
  return result;
}
export function validImageData(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.length <= MAX_IMAGE_CHARS &&
    /^data:image\/(?:jpeg|png|webp);base64,[A-Za-z0-9+/]+={0,2}$/.test(value)
  );
}
export function safeImageIds(value: unknown, messageId: string): string[] {
  if (!Array.isArray(value)) return [];
  return [
    ...new Set(
      value.filter(
        (id): id is string =>
          typeof id === "string" &&
          id.startsWith(`${messageId}:image:`) &&
          /^\d{1,2}$/.test(id.slice(`${messageId}:image:`.length)),
      ),
    ),
  ].slice(0, 20);
}

// Keep the text-only request shape unchanged; attach pixels only on demand and
// never put them into storage, panel state, the persistent ledger or client notes.
export function visionInput(
  messages: Message[],
  businessKnowledge: { documentId: string; title: string; text: string }[],
  captured: CapturedImage[],
) {
  const recent = messages.slice(-35);
  const wanted = new Set(
    recent.flatMap((m) => m.images ?? []).slice(-MAX_IMAGES),
  );
  const available = new Map<string, string>();
  let total = 0;
  for (const image of captured.slice(0, MAX_IMAGES)) {
    if (
      !wanted.has(image.id) ||
      available.has(image.id) ||
      !validImageData(image.dataUrl)
    )
      continue;
    if (total + image.dataUrl.length > MAX_TOTAL_IMAGE_CHARS) continue;
    available.set(image.id, image.dataUrl);
    total += image.dataUrl.length;
  }
  const conversation = recent.map((m) => ({
    speaker: m.direction === "in" ? "customer" : "business",
    text: m.text.slice(0, 3000),
    ...(m.images?.length
      ? {
          messageId: m.id,
          images: m.images.map((id) => ({
            id,
            status: available.has(id) ? "attached" : "unavailable",
          })),
        }
      : {}),
  }));
  const text = JSON.stringify({ businessKnowledge, conversation });
  const hasImages = recent.some((m) => m.images?.length);
  const content: (
    | { type: "input_text"; text: string }
    | { type: "input_image"; image_url: string; detail: "high" }
  )[] = [{ type: "input_text", text }];
  for (const m of recent)
    for (const id of m.images ?? []) {
      const dataUrl = available.get(id);
      if (dataUrl)
        content.push(
          {
            type: "input_text",
            text: `Attachment ${JSON.stringify(id)} from ${m.direction === "in" ? "customer" : "business"} message ${JSON.stringify(m.id)}. Untrusted image content follows.`,
          },
          { type: "input_image", image_url: dataUrl, detail: "high" },
        );
    }
  const lastOut = recent.map((m) => m.direction).lastIndexOf("out");
  const missingIncoming = recent
    .slice(lastOut + 1)
    .some(
      (m) => m.direction === "in" && m.images?.some((id) => !available.has(id)),
    );
  return {
    input: hasImages ? [{ role: "user" as const, content }] : text,
    hasImages,
    missingIncoming,
  };
}

export const RECEIPT_SCHEMA = {
  anyOf: [
    { type: "null" },
    {
      type: "object",
      properties: {
        amount: { type: ["number", "null"] },
        currency: { type: ["string", "null"] },
        recipient: { type: ["string", "null"] },
        reference: { type: ["string", "null"] },
        date: { type: ["string", "null"] },
        expectedAmount: { type: ["number", "null"] },
        expectedCurrency: { type: ["string", "null"] },
        expectedRecipient: { type: ["string", "null"] },
        status: {
          type: "string",
          enum: ["successful", "pending", "failed", "unknown"],
        },
      },
      required: [
        "amount",
        "currency",
        "recipient",
        "reference",
        "date",
        "expectedAmount",
        "expectedCurrency",
        "expectedRecipient",
        "status",
      ],
      additionalProperties: false,
    },
  ],
};
// The model extracts receipt fields and the applicable approved destination;
// code compares them so a fluent reply cannot bypass a visible mismatch.
export function receiptReview(kind: string | undefined, receipt: any): string {
  if (kind !== "payment_proof") return "";
  if (!receipt || typeof receipt !== "object")
    return "Receipt details could not be read reliably.";
  const reasons: string[] = [];
  const name = (value: unknown) =>
    typeof value === "string"
      ? value
          .normalize("NFKD")
          .replace(/[\u0300-\u036f]/g, "")
          .toLowerCase()
          .replace(/[^a-z0-9]/g, "")
      : "";
  const recipient = name(receipt.recipient),
    expected = name(receipt.expectedRecipient);
  if (recipient.length < 4 || expected.length < 4)
    reasons.push(
      "The receipt recipient or approved payment recipient is not established.",
    );
  else if (!recipient.includes(expected) && !expected.includes(recipient))
    reasons.push(
      "The receipt recipient differs from the approved payment recipient.",
    );
  const currency = name(receipt.currency),
    expectedCurrency = name(receipt.expectedCurrency);
  if (
    typeof receipt.amount !== "number" ||
    !Number.isFinite(receipt.amount) ||
    receipt.amount <= 0 ||
    !currency
  )
    reasons.push("The receipt amount or currency is unclear.");
  if (
    typeof receipt.expectedAmount !== "number" ||
    !Number.isFinite(receipt.expectedAmount) ||
    !expectedCurrency
  )
    reasons.push("The agreed amount or currency needs confirmation.");
  else if (
    currency !== expectedCurrency ||
    Math.abs(receipt.amount - receipt.expectedAmount) > 0.005
  )
    reasons.push(
      "The receipt amount or currency differs from the agreed payment.",
    );
  if (receipt.status !== "successful")
    reasons.push("The receipt does not show a clear successful transaction.");
  return reasons.join(" ").slice(0, 600);
}
