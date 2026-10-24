import { APP_NAME } from "./product";
import { composer, readChat, rememberChatIdentity } from "./adapter";
import { InboxMonitor } from "./inbox";
import { capturePhotos } from "./media";
import { windowState } from "./core";
import { draftMatches, messageText } from "./reply";
import type { DateOrder } from "./types";

const HOST_ID = "whatsapp-desk-host";
let order: DateOrder = "DMY";
let last = "";
let writing = false;
let opened = true;
const inbox = new InboxMonitor({
  doc: document,
  context: () => readChat(document, order),
  rpc: async (type, payload = {}) => {
    const result = await chrome.runtime.sendMessage({ type, ...payload });
    if (!result?.ok)
      throw new Error(
        result?.error ?? "Inbox monitor disconnected. Refresh WhatsApp.",
      );
    return result.value;
  },
});
const host = document.createElement("div");
host.id = HOST_ID;
const shadow = host.attachShadow({ mode: "closed" });
const style = document.createElement("style");
style.textContent = `:host{all:initial;position:fixed;inset:0 0 0 auto;width:min(430px,100vw);z-index:2147483000;font-family:system-ui,sans-serif}iframe{border:0;width:100%;height:100%;background:#f6f9f7;box-shadow:-4px 0 32px #102e2515}button{position:fixed;bottom:26px;right:24px;border:1px solid #216d5c;background:#126e5c;color:white;border-radius:18px;padding:15px 20px;font:600 14px system-ui;box-shadow:0 6px 24px #0a332735;cursor:pointer}button:focus-visible{outline:3px solid #92d5c2;outline-offset:3px}`;
const frame = document.createElement("iframe");
frame.title = `${APP_NAME} · WhatsApp client assistant`;
const launcher = document.createElement("button");
launcher.textContent = `✦  ${APP_NAME}`;
launcher.hidden = true;
launcher.onclick = () => toggle();
shadow.append(style, frame, launcher);
const pageStyle = document.createElement("style");
pageStyle.textContent = `@media(min-width:1100px){html.whatsapp-desk-open #app{width:calc(100% - 430px)!important;max-width:none!important;right:auto!important}html.whatsapp-desk-open #app>div{max-width:100%!important}}`;
document.head.append(pageStyle);
document.documentElement.append(host);
document.documentElement.classList.add("whatsapp-desk-open");
function toggle() {
  opened = !opened;
  frame.hidden = !opened;
  launcher.hidden = opened;
  host.style.width = opened ? "min(430px,100vw)" : "0";
  document.documentElement.classList.toggle("whatsapp-desk-open", opened);
}
async function publish() {
  inbox.observeRows();
  if (writing || !chrome.runtime?.id) return;
  const context = readChat(document, order);
  inbox.observeContext(context);
  const signature = JSON.stringify(
    context ? { ...context, observedAt: 0 } : null,
  );
  if (signature === last) return;
  last = signature;
  try {
    await chrome.runtime.sendMessage({ type: "CONTEXT", context });
  } catch {
    launcher.title = "Extension updated. Refresh WhatsApp Web to reconnect.";
  }
}
const nextFrame = () =>
  new Promise<void>((resolve) =>
    requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
  );
async function place(m: any) {
  if (m.inboxToken && !inbox.canSend(m.inboxToken))
    throw new Error("Inbox reply paused for a human.");
  if (writing) throw new Error("A reply is already being placed. Please wait.");
  const before = readChat(document, order);
  if (
    !before ||
    before.chatId !== m.chatId ||
    before.lastIncomingId !== m.incomingId
  )
    throw new Error(
      "The client or latest message changed. Generate a fresh reply.",
    );
  if (before.isGroup) throw new Error("Group chats require manual handling.");
  const input = composer();
  if (!input)
    throw new Error(
      "WhatsApp’s message box was not found. Refresh the page and try again.",
    );
  if (!before.composerEmpty)
    throw new Error(
      "Your existing message has been kept. Send or clear it before inserting a draft.",
    );
  if (typeof m.text !== "string" || !m.text.trim() || m.text.length > 8000)
    throw new Error("The draft is empty or too long.");
  if (m.send && (!before.atBottom || !windowState(before.lastIncomingAt).open))
    throw new Error(
      "Automatic sending needs the latest messages and an open response window.",
    );
  writing = true;
  let sentMessageId: string | undefined;
  try {
    input.focus();
    const selection = window.getSelection();
    const range = document.createRange();
    range.selectNodeContents(input);
    range.collapse(false);
    selection?.removeAllRanges();
    selection?.addRange(range);
    // Let WhatsApp's editor handle plain-text paste so it creates its own
    // paragraph/line-break nodes. Bulk insertText can flatten a multiline draft.
    const clipboard = new DataTransfer();
    clipboard.setData("text/plain", m.text);
    const paste = new ClipboardEvent("paste", {
      bubbles: true,
      cancelable: true,
      clipboardData: clipboard,
    });
    input.dispatchEvent(paste);
    await nextFrame();
    // Older editors may not implement a paste handler. Only fall back when
    // nothing was inserted, never append a second copy to a partial result.
    if (!messageText(input.innerText) && !paste.defaultPrevented) {
      const lines = m.text.replace(/\r\n?/g, "\n").split("\n");
      for (let i = 0; i < lines.length; i++) {
        if (i && !document.execCommand("insertLineBreak", false))
          throw new Error("WhatsApp did not accept the draft's line breaks.");
        if (lines[i] && !document.execCommand("insertText", false, lines[i]))
          throw new Error("WhatsApp did not accept the draft text.");
      }
    }
    await nextFrame();
    if (!draftMatches(input.innerText, m.text))
      throw new Error(
        "The draft's text or spacing could not be verified in WhatsApp. Review it before sending.",
      );
    const after = readChat(document, order);
    if (
      !after ||
      after.chatId !== m.chatId ||
      after.lastIncomingId !== m.incomingId
    )
      throw new Error(
        "A new message arrived. The draft is waiting for human review.",
      );
    if (m.send) {
      const authorization = await chrome.runtime.sendMessage({
        type: "AUTHORIZE_SEND",
        chatId: m.chatId,
        incomingId: m.incomingId,
        token: m.sendToken,
        ...(m.inboxToken ? { inboxToken: m.inboxToken } : {}),
      });
      if (!authorization?.ok || !authorization.value?.allowed)
        throw new Error(
          authorization?.error ??
            "Automatic sending paused. Review the draft in WhatsApp.",
        );
      const final = readChat(document, order);
      if (
        !final ||
        final.chatId !== m.chatId ||
        final.lastIncomingId !== m.incomingId ||
        !draftMatches(input.innerText, m.text)
      )
        throw new Error(
          "The conversation changed. The draft needs human review.",
        );
      const button =
        document
          .querySelector<HTMLElement>(
            '#main footer button [data-icon="send"], #main footer [data-testid="send"]',
          )
          ?.closest<HTMLElement>('button,[role="button"]') ??
        document.querySelector<HTMLElement>(
          '#main footer button[aria-label="Send"], #main footer [data-testid="compose-btn-send"]',
        );
      if (!button)
        throw new Error(
          "The Send button was not found. The draft is waiting for human review.",
        );
      if (m.inboxToken && !inbox.canSend(m.inboxToken))
        throw new Error("Inbox reply paused for a human.");
      // One click only. If confirmation is uncertain, the caller must not retry the send.
      button.click();
      const deadline = Date.now() + 7000;
      let verified = false;
      while (Date.now() < deadline) {
        await new Promise((r) => setTimeout(r, 200));
        const c = readChat(document, order);
        if (!c || c.chatId !== m.chatId) break;
        const sent = c.messages.find(
          (x) =>
            x.direction === "out" &&
            draftMatches(x.text, m.text) &&
            !before.messages.some((p) => p.id === x.id),
        );
        if (sent) {
          sentMessageId = sent.id;
          verified = true;
          break;
        }
      }
      if (!verified)
        throw new Error(
          "Send was clicked but delivery could not be confirmed. Check the chat before sending again.",
        );
    }
    return { ok: true, ...(sentMessageId ? { sentMessageId } : {}) };
  } finally {
    writing = false;
    void publish();
  }
}
async function openClient(m: any) {
  const ctx = readChat(document, order);
  if (ctx?.chatId === m.chatId) return { ok: true };
  const titles = [
    ...document.querySelectorAll<HTMLElement>(
      '#pane-side [role="row"] span[title], #pane-side [role="listitem"] span[title]',
    ),
  ].filter((e) => e.getAttribute("title") === m.name);
  if (titles.length !== 1)
    throw new Error(
      `Find ${m.name} in WhatsApp and open the conversation first.`,
    );
  titles[0].click();
  for (let i = 0; i < 20; i++) {
    await new Promise((r) => setTimeout(r, 150));
    if (readChat(document, order)?.chatId === m.chatId) {
      void publish();
      return { ok: true };
    }
  }
  throw new Error(
    "Open the matching client conversation in WhatsApp before placing the follow-up.",
  );
}
chrome.runtime.onMessage.addListener((m, sender, respond) => {
  if (sender.id !== chrome.runtime.id) return;
  if (m.type === "INBOX_CONTROL") {
    respond({ ok: true, allowed: inbox.canSend(m.token) });
    return;
  }
  if (m.type === "INBOX_PAUSE") {
    inbox.pauseForHuman();
    respond({ ok: true });
    return;
  }
  if (m.type === "READ_IMAGES") {
    try {
      const context = readChat(document, order);
      if (
        !context ||
        context.chatId !== m.chatId ||
        context.lastIncomingId !== m.incomingId
      )
        throw new Error(
          "The conversation changed before reading the pictures. Draft again.",
        );
      respond({
        ok: true,
        chatId: context.chatId,
        incomingId: context.lastIncomingId,
        images: capturePhotos(document, context),
      });
    } catch (e) {
      respond({
        ok: false,
        error: e instanceof Error ? e.message : "Pictures could not be read.",
      });
    }
    return;
  }
  if (m.type === "READ_CONTEXT") {
    respond({ ok: true, context: readChat(document, order) });
    return;
  }
  if (m.type === "TOGGLE_PANEL") {
    toggle();
    respond({ ok: true });
    return;
  }
  if (m.type === "DATE_ORDER") {
    order = m.order;
    last = "";
    void publish();
    respond({ ok: true });
    return;
  }
  if (m.type === "PLACE_DRAFT" || m.type === "OPEN_CLIENT") {
    (m.type === "PLACE_DRAFT" ? place(m) : openClient(m))
      .then(respond)
      .catch((e) => respond({ ok: false, error: e.message }));
    return true;
  }
});
void chrome.runtime.sendMessage({ type: "HELLO" }).then((r) => {
  if (!r?.ok) return;
  order = r.value.dateOrder;
  inbox.restore(r.value.inbox);
  void inbox.tick();
  for (const anchor of r.value.anchors ?? [])
    rememberChatIdentity(document, anchor.chatId, anchor.messageIds);
  frame.src = chrome.runtime.getURL(`panel.html?tabId=${r.value.tabId}`);
  void publish();
});
let debounce: ReturnType<typeof setTimeout>;
new MutationObserver((records) => {
  if (records.every((r) => host.contains(r.target))) return;
  clearTimeout(debounce);
  debounce = setTimeout(() => void publish(), 300);
}).observe(document.body, {
  childList: true,
  subtree: true,
  characterData: true,
  attributes: true,
  attributeFilter: ["src", "data-id", "data-pre-plain-text"],
});
setInterval(() => {
  void publish();
  void inbox.tick();
}, 2500);
