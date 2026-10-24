import { normalText, composer } from "./adapter";
import { quietDelay } from "./pacing";
import type { ChatContext, InboxItem, InboxState } from "./types";

export interface InboxRow {
  key: string;
  name: string;
  preview: string;
  fingerprint: string;
  previewExact?: boolean;
  unread: boolean;
  recent: boolean;
  node: HTMLElement;
}
// Use the actual sidebar row, not a contact-name search, when opening a new
// enquiry. Ambiguous rows are excluded rather than merging namesakes.
export function readInbox(doc: Document, now = Date.now()): InboxRow[] {
  const nodes = [
    ...doc.querySelectorAll<HTMLElement>(
      '#pane-side [role="row"], #pane-side [role="listitem"]',
    ),
  ].filter(
    (node, _, all) =>
      !all.some((parent) => parent !== node && parent.contains(node)),
  );
  const rows = nodes.flatMap((node): InboxRow[] => {
    const title = node.querySelector<HTMLElement>("span[title]");
    const name = normalText(title?.getAttribute("title") ?? "");
    if (!name) return [];
    const text = normalText(node.innerText ?? node.textContent ?? "");
    const labels = [node, ...node.querySelectorAll<HTMLElement>("[aria-label]")]
      .map((n) => n.getAttribute("aria-label") ?? "")
      .join(" ");
    const unread =
      /\b\d+ unread messages?\b|\bunread messages?\b/i.test(labels) ||
      !!node.querySelector(
        '[data-testid="icon-unread-count"], [data-testid="unread-count"], [data-icon="unread-count"]',
      );
    const secondary =
      node.querySelector<HTMLElement>('[data-testid="cell-frame-secondary"]') ??
      [...node.querySelectorAll<HTMLElement>("span[title]")].find(
        (n) => n !== title,
      );
    const preview = normalText(
      secondary?.getAttribute("title") ??
        secondary?.innerText ??
        text
          .replace(name, "")
          .replace(/\b\d{1,2}:\d{2}(?:\s*[ap]m)?\b/i, "")
          .replace(/\b\d+ unread messages?\b/i, ""),
    );
    const match = text.match(/\b(\d{1,2}):(\d{2})(?:\s*([ap]m))?\b/i);
    let recent = false;
    if (match && !/yesterday|\d{1,2}[/.]\d{1,2}[/.]\d{2,4}/i.test(text)) {
      const at = new Date(now);
      let hour = +match[1];
      if (match[3])
        hour = (hour % 12) + (match[3].toLowerCase() === "pm" ? 12 : 0);
      at.setHours(hour, +match[2], 0, 0);
      recent = now - +at >= -60000 && now - +at < 120000;
    }
    const stableId =
      node.getAttribute("data-jid") ?? node.getAttribute("data-id");
    return [
      {
        key: stableId ? `peer:${stableId}` : `name:${name}`,
        name,
        preview,
        fingerprint: text + "|" + labels,
        previewExact:
          !!secondary &&
          !/^(photo|image|video|document|sticker|voice message|audio|picture)$/i.test(
            preview,
          ),
        unread,
        recent,
        node,
      },
    ];
  });
  return rows.filter(
    (row) => rows.filter((other) => other.key === row.key).length === 1,
  );
}

type RPC = (type: string, payload?: Record<string, unknown>) => Promise<any>;
interface Dependencies {
  doc: Document;
  context: () => ChatContext | null;
  rpc: RPC;
  now?: () => number;
  random?: () => number;
  sleep?: (ms: number) => Promise<void>;
}
export class InboxMonitor {
  private items = new Map<string, InboxItem>();
  private seenRows = new Map<string, string>();
  private seenIncoming = new Map<string, string>();
  private retryAfter = new Map<string, number>();
  private enabled = false;
  private humanChats = new Set<string>();
  private lastHumanAt = 0;
  private running: string | null = null;
  private openingKey: string | null = null;
  private interrupted = false;
  private ticking = false;
  private status = "Connecting inbox monitor…";
  private saving: Promise<unknown> = Promise.resolve();
  private now: () => number;
  private random: () => number;
  private sleep: (ms: number) => Promise<void>;
  constructor(private deps: Dependencies) {
    this.now = deps.now ?? Date.now;
    this.random = deps.random ?? Math.random;
    this.sleep = deps.sleep ?? ((ms) => new Promise((r) => setTimeout(r, ms)));
    const human = (event: Event) => {
      if (event.isTrusted) this.pauseForHuman();
    };
    for (const type of ["pointerdown", "keydown", "input", "wheel"])
      deps.doc.addEventListener(type, human, { capture: true, passive: true });
  }
  restore(state?: InboxState) {
    for (const item of state?.items ?? []) {
      // An interrupted send is never replayed automatically.
      const restored = {
        ...item,
        status: item.status === "replying" ? ("review" as const) : item.status,
      };
      this.items.set(item.key, restored);
      if (item.chatId && item.incomingId)
        this.seenIncoming.set(item.chatId, item.incomingId);
    }
  }
  pauseForHuman() {
    this.lastHumanAt = this.now();
    if (this.running) this.interrupted = true;
  }
  canSend(token: string) {
    return this.enabled && this.running === token && !this.interrupted;
  }
  snapshot(): InboxState {
    return {
      enabled: this.enabled,
      status: this.status,
      busyKey: this.openingKey,
      items: [...this.items.values()].slice(-100),
      updatedAt: this.now(),
      observedChats: this.seenRows.size,
    };
  }
  private save() {
    this.saving = this.saving
      .catch(() => {})
      .then(() => this.deps.rpc("INBOX_SYNC", { state: this.snapshot() }))
      .catch(() => {});
  }
  private enqueue(
    row: Pick<
      InboxRow,
      "key" | "name" | "preview" | "fingerprint" | "previewExact"
    >,
    context?: ChatContext,
  ) {
    const old = this.items.get(row.key);
    if (context?.chatId && this.humanChats.has(context.chatId)) return;
    this.items.set(row.key, {
      key: row.key,
      name: row.name,
      preview: row.preview.slice(0, 500),
      fingerprint: row.fingerprint,
      previewExact: row.previewExact,
      observedAt: this.now(),
      dueAt: this.now() + quietDelay(row.preview, this.random),
      status: "waiting",
      chatId: context?.chatId ?? old?.chatId,
      incomingId: context?.lastIncomingId ?? undefined,
    });
    this.save();
  }
  private currentRow(
    context: ChatContext,
    rows = readInbox(this.deps.doc, this.now()),
  ) {
    return (
      rows.find((r) => r.key === `peer:${context.chatId}`) ??
      rows.find(
        (r) =>
          r.node.getAttribute("aria-selected") === "true" &&
          r.name === context.name,
      ) ??
      (rows.filter((r) => r.name === context.name).length === 1
        ? rows.find((r) => r.name === context.name)
        : undefined)
    );
  }
  observeRows() {
    if (!this.enabled) return;
    const rows = readInbox(this.deps.doc, this.now());
    for (const row of rows) {
      const previous = this.seenRows.get(row.key);
      this.seenRows.set(row.key, row.fingerprint);
      if (
        row.unread &&
        row.fingerprint !== previous &&
        (previous !== undefined || row.recent)
      ) {
        const context = this.deps.context();
        if (context && this.currentRow(context, rows)?.key === row.key)
          continue; // Full message IDs are used for the selected chat.
        this.enqueue(row);
      }
    }
  }
  observeContext(context: ChatContext | null) {
    if (!this.enabled || !context?.lastIncomingId) return;
    const previous = this.seenIncoming.get(context.chatId);
    this.seenIncoming.set(context.chatId, context.lastIncomingId);
    if (
      previous === context.lastIncomingId ||
      context.isGroup ||
      context.messages.at(-1)?.direction !== "in" ||
      !context.lastIncomingAt ||
      this.now() - context.lastIncomingAt > 120000 ||
      this.humanChats.has(context.chatId)
    )
      return;
    const row = this.currentRow(context);
    if (
      this.openingKey &&
      this.items.get(this.openingKey)?.name === context.name &&
      !this.items.get(this.openingKey)?.incomingId
    ) {
      const item = this.items.get(this.openingKey)!;
      const actual = normalText(
        context.messages.find((m) => m.id === context.lastIncomingId)?.text ??
          "",
      );
      const snippet = normalText(item.preview).replace(/(?:…|\.\.\.)$/, "");
      if (item.previewExact && snippet && !actual.startsWith(snippet)) {
        this.enqueue(
          {
            key: item.key,
            name: context.name,
            preview: actual,
            fingerprint: `incoming:${context.lastIncomingId}`,
          },
          context,
        );
        return;
      }
      item.chatId = context.chatId;
      item.incomingId = context.lastIncomingId;
      return;
    }
    const text =
      context.messages.find((m) => m.id === context.lastIncomingId)?.text ?? "";
    this.enqueue(
      {
        key: row?.key ?? `chat:${context.chatId}`,
        name: context.name,
        preview: text,
        fingerprint: `incoming:${context.lastIncomingId}`,
      },
      context,
    );
  }
  private idle() {
    return (
      this.now() - this.lastHumanAt >= 10000 &&
      !normalText(
        composer(this.deps.doc)?.innerText ??
          composer(this.deps.doc)?.textContent ??
          "",
      )
    );
  }
  private async open(
    row: InboxRow,
    expectedChatId?: string,
  ): Promise<ChatContext> {
    const before = this.deps.context();
    const peer = /^peer:(.+@(?:lid|c\.us|g\.us|s\.whatsapp\.net))$/.exec(
      row.key,
    )?.[1];
    let verified: string | null = null;
    (row.node.querySelector<HTMLElement>("span[title]") ?? row.node).click();
    for (let i = 0; i < 40; i++) {
      await this.sleep(150);
      if (this.interrupted) throw new Error("Paused for a human.");
      const context = this.deps.context();
      if (
        context &&
        context.name === row.name &&
        (!expectedChatId || context.chatId === expectedChatId) &&
        (!peer || context.chatId === peer) &&
        (expectedChatId || peer || !before || context.chatId !== before.chatId)
      ) {
        if (verified === context.chatId) return context;
        verified = context.chatId;
      } else verified = null;
    }
    throw new Error("Could not verify this chat. Open it for human review.");
  }
  async tick() {
    if (this.ticking) return;
    this.ticking = true;
    try {
      const control = await this.deps.rpc("INBOX_STATUS");
      this.enabled = !!control.enabled;
      this.humanChats = new Set(control.humanChats ?? []);
      if (!this.enabled) {
        for (const [key, item] of this.items)
          if (item.status === "waiting") this.items.delete(key);
        this.status = control.reason ?? "Inbox monitoring paused";
        this.save();
        return;
      }
      this.observeRows();
      this.observeContext(this.deps.context());
      if (this.running) return;
      if (!this.idle()) {
        this.status = `Waiting while you work · ${this.seenRows.size} chats observed`;
        this.save();
        return;
      }
      const item = [...this.items.values()]
        .filter(
          (i) =>
            i.status === "waiting" &&
            this.now() >= (this.retryAfter.get(i.key) ?? 0),
        )
        .sort((a, b) => a.dueAt - b.dueAt)[0];
      if (!item || item.dueAt > this.now()) {
        this.status = `Watching your inbox · ${this.seenRows.size} chats observed`;
        this.save();
        return;
      }
      const original = this.deps.context();
      const originalRow = original && this.currentRow(original);
      const row = readInbox(this.deps.doc, this.now()).find(
        (r) => r.key === item.key,
      );
      if (this.items.get(item.key) !== item || item.dueAt > this.now()) return;
      if (!row && (!item.chatId || original?.chatId !== item.chatId)) {
        // Wait for the row to appear naturally. Monitoring must never scroll
        // the chat list or switch the user's filter to hunt for a queued chat.
        this.retryAfter.set(item.key, this.now() + 10000);
        this.status = `Waiting for ${item.name} in the inbox`;
        this.save();
        return;
      }
      const token = crypto.randomUUID();
      this.running = token;
      this.interrupted = false;
      this.openingKey = item.key;
      item.status = "replying";
      this.status = `Replying to ${item.name}`;
      this.save();
      try {
        const ctx =
          item.chatId && original?.chatId === item.chatId
            ? original
            : await this.open(row!, item.chatId);
        this.observeContext(ctx);
        if (ctx.isGroup || this.humanChats.has(ctx.chatId)) {
          item.status = "skipped";
          item.detail = ctx.isGroup
            ? "Group chat requires human review."
            : "A human is handling this chat.";
          return;
        }
        item.chatId = ctx.chatId;
        item.incomingId = ctx.lastIncomingId ?? undefined;
        // A new message during navigation gets its own full quiet period.
        if (this.items.get(item.key) !== item) return;
        const outcome = await this.deps.rpc("INBOX_RUN", {
          token,
          chatId: ctx.chatId,
          incomingId: ctx.lastIncomingId,
          observedAt: item.observedAt,
          dueAt: item.dueAt,
        });
        if (this.items.get(item.key) === item) {
          item.status = outcome.status;
          item.detail = outcome.detail;
        }
      } catch (e) {
        if (this.items.get(item.key) === item) {
          item.status = "review";
          item.detail = (e as Error).message;
        }
      } finally {
        // Restore only if the user has not clicked or typed in the meantime.
        if (
          !this.interrupted &&
          original &&
          originalRow &&
          this.deps.context()?.chatId !== original.chatId
        ) {
          const fresh = readInbox(this.deps.doc, this.now()).find(
            (r) => r.key === originalRow.key,
          );
          if (fresh) await this.open(fresh, original.chatId).catch(() => {});
        }
        this.running = null;
        this.openingKey = null;
        this.status = `Watching your inbox · ${this.seenRows.size} chats observed`;
        this.save();
      }
    } catch (e) {
      this.status = (e as Error).message;
      this.save();
    } finally {
      this.ticking = false;
    }
  }
}
