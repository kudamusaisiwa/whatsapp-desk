import { imageIds } from "./media";
import {
  latestIncoming,
  parseWhatsAppTimestamp,
  peerFromMessageId,
} from "./core";
import type { ChatContext, DateOrder, Message } from "./types";

// Current WhatsApp builds expose bare message IDs. Anchor identities to those
// unique IDs, never to a display name, so identically named clients stay apart.
const registries = new WeakMap<Document, Map<string, string>>();
export function rememberChatIdentity(
  doc: Document,
  chatId: string,
  ids: string[],
) {
  let registry = registries.get(doc);
  if (!registry) {
    registry = new Map();
    registries.set(doc, registry);
  }
  for (const id of ids) registry.set(id, chatId);
}
export function composer(root: ParentNode = document): HTMLElement | null {
  const node = root.querySelector<HTMLElement>(
    '#main footer [contenteditable="true"][role="textbox"], #main footer [contenteditable="true"][data-lexical-editor="true"], #main [data-testid="conversation-compose-box-input"]',
  );
  return node?.matches('[contenteditable="true"]')
    ? node
    : (node?.querySelector('[contenteditable="true"]') ?? null);
}
export function normalText(text: string) {
  return (text ?? "")
    .replace(/\u00a0/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}
export function readChat(
  doc: Document = document,
  order: DateOrder = "DMY",
): ChatContext | null {
  const main = doc.querySelector("#main");
  if (!main) return null;
  const rows = [...main.querySelectorAll<HTMLElement>("[data-id]")].filter(
    (row) =>
      row.matches("[data-pre-plain-text]") ||
      row.querySelector("[data-pre-plain-text]") ||
      row.matches('[data-testid^="conv-msg-"]') ||
      row.querySelector('[data-testid="msg-container"]') ||
      peerFromMessageId(row.dataset.id ?? ""),
  );
  const tail = rows.at(-1);
  if (!tail) return null;
  const peer = peerFromMessageId(tail.dataset.id!);
  const known = new Set(
    rows
      .map((r) => registries.get(doc)?.get(r.dataset.id!))
      .filter((id): id is string => !!id),
  );
  if (!peer && known.size > 1) return null;
  const chatId = peer ?? [...known][0] ?? `thread:${rows[0].dataset.id}`;
  rememberChatIdentity(
    doc,
    chatId,
    rows.map((r) => r.dataset.id!),
  );
  const title =
    main.querySelector<HTMLElement>(
      'header [data-testid="conversation-info-header-chat-title-name"]',
    ) ??
    main.querySelector<HTMLElement>(
      'header [data-testid="conversation-info-header-chat-title"], header span[title], header [title]',
    );
  const name =
    title?.textContent?.trim() ||
    title?.getAttribute("title") ||
    "Client conversation";
  const messages: Message[] = [];
  let direction: "in" | "out" | null = null;
  for (const row of rows) {
    const rowPeer = peerFromMessageId(row.dataset.id!);
    if (peer && rowPeer && rowPeer !== peer) continue;
    if (
      row.closest(".message-out") ||
      row.querySelector(
        '.message-out,[data-testid="tail-out"],[data-icon="tail-out"]',
      ) ||
      row.dataset.id?.startsWith("true_")
    )
      direction = "out";
    else if (
      row.closest(".message-in") ||
      row.querySelector(
        '.message-in,[data-testid="tail-in"],[data-icon="tail-in"]',
      ) ||
      row.dataset.id?.startsWith("false_")
    )
      direction = "in";
    // A continuation inherits its group's direction; skip unknown leading rows.
    if (!direction) continue;
    const copy = row.matches("[data-pre-plain-text]")
      ? row
      : row.querySelector<HTMLElement>("[data-pre-plain-text]");
    const selector = '.selectable-text,[data-testid="selectable-text"]';
    const nodes = [...(copy ?? row).querySelectorAll<HTMLElement>(selector)];
    const text = nodes
      .filter((n) => !nodes.some((other) => other !== n && other.contains(n)))
      .map((n) => n.innerText ?? n.textContent ?? "")
      .join("\n")
      .trim();
    const images = imageIds(row, row.dataset.id!);
    messages.push({
      id: row.dataset.id!,
      text:
        text ||
        (images.length
          ? "[Picture attached]"
          : "[Media or non-text message — human review may be needed]"),
      ...(images.length ? { images } : {}),
      direction,
      at:
        parseWhatsAppTimestamp(
          copy?.getAttribute("data-pre-plain-text") ?? "",
          order,
        ) ?? mediaTimestamp(row, main, order),
    });
  }
  if (!messages.length) return null;
  let atBottom = true;
  let ancestor = tail.parentElement;
  while (ancestor && ancestor !== main.parentElement) {
    if (
      ancestor.clientHeight > 0 &&
      ancestor.scrollHeight > ancestor.clientHeight + 40 &&
      ["auto", "scroll"].includes(
        doc.defaultView!.getComputedStyle(ancestor).overflowY,
      )
    ) {
      atBottom =
        ancestor.scrollHeight - ancestor.scrollTop - ancestor.clientHeight <
        180;
      break;
    }
    ancestor = ancestor.parentElement;
  }
  const isGroup =
    chatId.endsWith("@g.us") ||
    !!main.querySelector(
      'header [data-testid*="group"],header [data-icon="default-group"],[data-testid="msg-author"],[data-testid="author"],[data-testid="group-participants"]',
    );
  return {
    chatId,
    name,
    isGroup,
    messages: messages.slice(-40),
    ...latestIncoming(messages),
    composerEmpty: !normalText(
      composer(doc)?.innerText ?? composer(doc)?.textContent ?? "",
    ),
    atBottom,
    observedAt: Date.now(),
  };
}

// Photo-only bubbles expose a time in msg-meta and a separate date divider.
// Use those visible values only; an absent/unknown day stays unknown.
function mediaTimestamp(
  row: Element,
  main: Element,
  order: DateOrder,
): number | null {
  const time = row
    .querySelector('[data-testid="msg-meta"]')
    ?.textContent?.match(/\b(\d{1,2}:\d{2}(?:\s*[AP]M)?)\b/i)?.[1];
  if (!time) return null;
  let date: string | null = null;
  for (const node of main.querySelectorAll(
    'span[dir="auto"], [data-testid="date"]',
  )) {
    if (
      node.closest("[data-id],header,footer") ||
      node.children.length ||
      !(node.compareDocumentPosition(row) & 4)
    )
      continue;
    const label = normalText(node.textContent ?? "");
    // Any date divider replaces the previous one, including unsupported labels.
    if (
      !/^(today|yesterday|monday|tuesday|wednesday|thursday|friday|saturday|sunday|\d{1,4}[/.\-]\d{1,2}[/.\-]\d{1,4}|\d{1,2} [a-z]+ \d{4}|[a-z]+ \d{1,2},? \d{4})$/i.test(
        label,
      )
    )
      continue;
    date = null;
    if (/^(today|yesterday)$/i.test(label)) {
      const d = new Date();
      if (/^yesterday$/i.test(label)) d.setDate(d.getDate() - 1);
      date = `${d.getFullYear()}/${d.getMonth() + 1}/${d.getDate()}`;
    } else if (/^\d{1,4}[/.\-]\d{1,2}[/.\-]\d{1,4}$/.test(label)) date = label;
    else if (/\d{4}$/.test(label)) {
      const d = new Date(label);
      if (Number.isFinite(+d))
        date = `${d.getFullYear()}/${d.getMonth() + 1}/${d.getDate()}`;
    }
  }
  return date ? parseWhatsAppTimestamp(`[${time}, ${date}]`, order) : null;
}
