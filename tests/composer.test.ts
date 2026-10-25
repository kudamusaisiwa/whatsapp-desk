import { test } from "node:test";
import assert from "node:assert/strict";
import { build } from "esbuild";
import { JSDOM } from "jsdom";
const content = (
  await build({
    entryPoints: ["src/content.ts"],
    bundle: true,
    write: false,
    format: "iife",
    target: "es2022",
  })
).outputFiles[0].text;
async function fixture({
  occupied = false,
  allowSend = true,
  newIncoming = false,
  pasteMode = "preserve",
  group = false,
  stale = false,
  latestOutgoing = false,
} = {}) {
  const now = new Date(Date.now() - (stale ? 2 * 24 * 3600000 : 0));
  const timestamp = `[${now.getHours()}:${String(now.getMinutes()).padStart(2, "0")}, ${now.getMonth() + 1}/${now.getDate()}/${now.getFullYear()}] Test: `;
  const dom = new JSDOM(
    `<div id="app"><div id="main"><header><span title="Fixture Client">Fixture Client</span>${group ? '<span data-testid="group-participants">Group</span>' : ""}</header><section id="messages"><div class="message-in" data-id="false_123456@lid_IN"><div data-pre-plain-text="${timestamp}"><span class="selectable-text">Hello</span></div></div>${latestOutgoing ? `<div class="message-out" data-id="true_123456@lid_OUT"><div data-pre-plain-text="${timestamp}"><span class="selectable-text">Thanks</span></div></div>` : ""}</section><footer><div role="textbox" contenteditable="true">${occupied ? "A human is writing" : ""}</div><button aria-label="Send"><span data-icon="send"></span></button></footer></div></div>`,
    {
      url: "https://web.whatsapp.com/",
      runScripts: "outside-only",
      pretendToBeVisual: true,
    },
  );
  Object.defineProperty(dom.window.HTMLElement.prototype, "innerText", {
    get() {
      return this.textContent;
    },
    set(v) {
      this.textContent = v;
    },
  });
  let listener: Function = () => {};
  let sends = 0;
  class Transfer {
    values = new Map<string, string>();
    setData(type: string, value: string) {
      this.values.set(type, value);
    }
    getData(type: string) {
      return this.values.get(type) ?? "";
    }
  }
  (dom.window as any).DataTransfer = Transfer;
  (dom.window as any).ClipboardEvent = class extends dom.window.Event {
    clipboardData: Transfer;
    constructor(type: string, options: any) {
      super(type, options);
      this.clipboardData = options.clipboardData;
    }
  };
  (dom.window as any).chrome = {
    runtime: {
      id: "fixture",
      getURL: (s: string) => `chrome-extension://fixture/${s}`,
      onMessage: {
        addListener: (fn: Function) => {
          listener = fn;
        },
      },
      sendMessage: async (m: any) =>
        m.type === "HELLO"
          ? { ok: true, value: { tabId: 1, dateOrder: "MDY" } }
          : m.type === "AUTHORIZE_SEND"
            ? {
                ok: allowSend,
                value: { allowed: allowSend },
                error: "Automatic sending paused.",
              }
            : { ok: true },
    },
  };
  const input = dom.window.document.querySelector("footer div")!;
  let addedIncoming = false;
  const onInsert = () => {
    if (newIncoming && !addedIncoming) {
      addedIncoming = true;
      dom.window.document
        .querySelector("#messages")!
        .insertAdjacentHTML(
          "beforeend",
          `<div class="message-in" data-id="false_123456@lid_NEW"><div data-pre-plain-text="${timestamp}"><span class="selectable-text">Another question</span></div></div>`,
        );
    }
  };
  input.addEventListener("paste", (event) => {
    if (pasteMode === "ignored") return;
    event.preventDefault();
    const text = (event as any).clipboardData.getData("text/plain");
    input.textContent =
      pasteMode === "flatten"
        ? text.replace(/\s+/g, " ")
        : pasteMode === "native-bullets"
          ? text.replace(/^- /gm, "•  ")
          : pasteMode === "partial"
            ? text.slice(0, 10)
            : text;
    onInsert();
  });
  (dom.window.document as any).execCommand = (
    command: string,
    _ui: boolean,
    text: string,
  ) => {
    if (command === "delete") {
      input.textContent = "";
      return true;
    }
    input.textContent += command === "insertLineBreak" ? "\n" : text;
    onInsert();
    return true;
  };
  dom.window.document
    .querySelector("footer button")!
    .addEventListener("click", () => {
      sends++;
      const row = dom.window.document.createElement("div");
      row.className = "message-out";
      row.dataset.id = `true_123456@lid_OUT${sends}`;
      row.innerHTML = `<div data-pre-plain-text="${timestamp}"><span class="selectable-text"></span></div>`;
      row.querySelector("span")!.textContent = input.textContent;
      dom.window.document.querySelector("#messages")!.append(row);
      input.textContent = "";
    });
  dom.window.eval(content);
  await new Promise((r) => setTimeout(r, 10));
  const place = (patch: any = {}): Promise<any> =>
    new Promise((resolve) =>
      listener(
        {
          type: "PLACE_DRAFT",
          chatId: "123456@lid",
          incomingId: "false_123456@lid_IN",
          text: "A useful reply",
          send: false,
          sendToken: "reply:fixture",
          ...patch,
        },
        { id: "fixture" },
        resolve,
      ),
    );
  const placeMessage = (patch: any = {}, sender: any = {
    id: "fixture",
    url: "chrome-extension://fixture/background.js",
  }): Promise<any> =>
    new Promise((resolve) =>
      listener(
        {
          type: "PLACE_MESSAGE",
          chatId: "123456@lid",
          text: "Dictated message",
          send: true,
          ...patch,
        },
        sender,
        resolve,
      ),
    );
  const syncMessage = (patch: any = {}, sender: any = {
    id: "fixture",
    url: "chrome-extension://fixture/background.js",
  }): Promise<any> =>
    new Promise((resolve) =>
      listener(
        {
          type: "SYNC_MESSAGE",
          chatId: "123456@lid",
          expectedText: "",
          text: "A synchronized message",
          ...patch,
        },
        sender,
        resolve,
      ),
    );
  return { dom, input, place, placeMessage, syncMessage, listener, sends: () => sends };
}
test("the actual content script puts a default suggestion in the composer without a Send click", async () => {
  const f = await fixture();
  try {
    const r = await f.place();
    assert.equal(r.ok, true);
    assert.equal(f.input.textContent, "A useful reply");
    assert.equal(f.sends(), 0);
  } finally {
    f.dom.window.close();
  }
});
test("an occupied human composer is preserved", async () => {
  const f = await fixture({ occupied: true });
  try {
    const r = await f.place();
    assert.equal(r.ok, false);
    assert.equal(f.input.textContent, "A human is writing");
    assert.equal(f.sends(), 0);
  } finally {
    f.dom.window.close();
  }
});
test("a mismatched client or latest message never receives the draft", async () => {
  const f = await fixture();
  try {
    assert.equal((await f.place({ chatId: "other@lid" })).ok, false);
    assert.equal((await f.place({ incomingId: "old" })).ok, false);
    assert.equal(f.input.textContent, "");
  } finally {
    f.dom.window.close();
  }
});
test("revoked automatic-send authorization leaves the draft for a human", async () => {
  const f = await fixture({ allowSend: false });
  try {
    const r = await f.place({ send: true });
    assert.equal(r.ok, false);
    assert.equal(f.input.textContent, "A useful reply");
    assert.equal(f.sends(), 0);
  } finally {
    f.dom.window.close();
  }
});
test("a new customer message during insertion prevents an automatic Send click", async () => {
  const f = await fixture({ newIncoming: true });
  try {
    const r = await f.place({ send: true });
    assert.equal(r.ok, false);
    assert.match(r.error, /new message arrived/);
    assert.equal(f.sends(), 0);
  } finally {
    f.dom.window.close();
  }
});
test("an authorized automatic reply clicks Send once and verifies the outgoing bubble", async () => {
  const f = await fixture();
  try {
    const r = await f.place({ send: true });
    assert.equal(r.ok, true);
    assert.equal(f.sends(), 1);
    assert.equal(f.input.textContent, "");
  } finally {
    f.dom.window.close();
  }
});
test("multiline WhatsApp formatting survives paste without sending", async () => {
  const f = await fixture();
  try {
    const text =
      "Hi! Here is the starting checklist.\n\n*Documents*\n- Valid passport\n- Email address\n\nWould you like help with the form?";
    assert.equal((await f.place({ text })).ok, true);
    assert.equal(f.input.textContent, text);
    assert.equal(f.sends(), 0);
  } finally {
    f.dom.window.close();
  }
});
test("multiline dictation is placed for review and never clicks WhatsApp Send", async () => {
  const f = await fixture();
  try {
    const text = "Hello from voice.\n\nPlease send me the requirements.";
    const result = await f.placeMessage({ text, send: true });
    assert.equal(result.ok, true);
    assert.equal(f.input.textContent, text);
    assert.equal(f.sends(), 0);
  } finally {
    f.dom.window.close();
  }
});
test("dictation refuses a changed target chat and preserves an occupied composer", async () => {
  const switched = await fixture();
  try {
    const result = await switched.placeMessage({ chatId: "other@lid" });
    assert.equal(result.ok, false);
    assert.match(result.error, /conversation changed/);
    assert.equal(switched.input.textContent, "");
    assert.equal(switched.sends(), 0);
  } finally {
    switched.dom.window.close();
  }
  const occupied = await fixture({ occupied: true });
  try {
    const result = await occupied.placeMessage();
    assert.equal(result.ok, false);
    assert.match(result.error, /transcript is still in Desk AI for WhatsApp/);
    assert.equal(occupied.input.textContent, "A human is writing");
    assert.equal(occupied.sends(), 0);
  } finally {
    occupied.dom.window.close();
  }
});
test("dictation permits a matching group, stale chat, and latest business message", async () => {
  for (const options of [
    { group: true },
    { stale: true },
    { latestOutgoing: true },
  ]) {
    const f = await fixture(options);
    try {
      const result = await f.placeMessage({ text: "A dictated note." });
      assert.equal(result.ok, true);
      assert.equal(f.input.textContent, "A dictated note.");
      assert.equal(f.sends(), 0);
    } finally {
      f.dom.window.close();
    }
  }
});
test("a new incoming message during dictation placement does not block the manual text", async () => {
  const f = await fixture({ newIncoming: true });
  try {
    const result = await f.placeMessage({ text: "Please call me back." });
    assert.equal(result.ok, true);
    assert.equal(f.input.textContent, "Please call me back.");
    assert.equal(f.sends(), 0);
  } finally {
    f.dom.window.close();
  }
});
test("content callers cannot forge the background-only manual placement route", async () => {
  const f = await fixture();
  try {
    let response: any;
    const result = f.listener(
      { type: "PLACE_MESSAGE", chatId: "123456@lid", text: "Spoofed" },
      { id: "fixture", url: "https://web.whatsapp.com/" },
      (value: any) => (response = value),
    );
    assert.equal(result, undefined);
    assert.equal(response, undefined);
    assert.equal(f.input.textContent, "");
    assert.equal(f.sends(), 0);
  } finally {
    f.dom.window.close();
  }
});
test("flattened paragraphs block automatic sending even when the words match", async () => {
  const f = await fixture({ pasteMode: "flatten" });
  try {
    const r = await f.place({
      text: "First paragraph.\n\nSecond paragraph.",
      send: true,
    });
    assert.equal(r.ok, false);
    assert.match(r.error, /spacing could not be verified/);
    assert.equal(f.sends(), 0);
  } finally {
    f.dom.window.close();
  }
});
test("an editor without paste support receives explicit line breaks", async () => {
  const f = await fixture({ pasteMode: "ignored" });
  try {
    const text = "Hello.\n\n- Passport\n- Email\n\nThank you.";
    assert.equal((await f.place({ text })).ok, true);
    assert.equal(f.input.textContent, text);
    assert.equal(f.sends(), 0);
  } finally {
    f.dom.window.close();
  }
});
test("a partial paste is left for review without appending another copy", async () => {
  const f = await fixture({ pasteMode: "partial" });
  try {
    const text = "First paragraph.\n\nSecond paragraph.";
    const r = await f.place({ text, send: true });
    assert.equal(r.ok, false);
    assert.equal(f.input.textContent, text.slice(0, 10));
    assert.equal(f.sends(), 0);
  } finally {
    f.dom.window.close();
  }
});
test("native WhatsApp list rendering is accepted without losing paragraph checks", async () => {
  const f = await fixture({ pasteMode: "native-bullets" });
  try {
    const text = "Hello.\n\n*Documents*\n- Passport\n- Email\n\nNext step?";
    assert.equal((await f.place({ text })).ok, true);
    assert.equal(f.input.textContent, text.replace(/^- /gm, "•  "));
    assert.equal(f.sends(), 0);
  } finally {
    f.dom.window.close();
  }
});
test("an authorized formatted reply verifies its native list bubble after one Send click", async () => {
  const f = await fixture({ pasteMode: "native-bullets" });
  try {
    const text = "Hello.\n\n*Documents*\n- Passport\n- Email\n\nNext step?";
    assert.equal((await f.place({ text, send: true })).ok, true);
    assert.equal(f.sends(), 1);
    assert.equal(f.input.textContent, "");
  } finally {
    f.dom.window.close();
  }
});

test("the installed content path reads the matching chat picture on demand and rejects another chat", async () => {
  const f = await fixture();
  try {
    const row = f.dom.window.document.querySelector("#messages [data-id]")!;
    row.insertAdjacentHTML(
      "beforeend",
      '<div data-testid="image-thumb"><div data-testid="media-url-provider"><img id="loaded-picture"></div></div>',
    );
    const img = f.dom.window.document.getElementById("loaded-picture")!;
    Object.defineProperties(img, {
      complete: { value: true },
      naturalWidth: { value: 1000 },
      naturalHeight: { value: 1600 },
    });
    f.dom.window.HTMLCanvasElement.prototype.getContext = (() => ({
      fillRect() {},
      drawImage() {},
    })) as any;
    f.dom.window.HTMLCanvasElement.prototype.toDataURL = () =>
      "data:image/jpeg;base64,/9j/AA==";
    const result = await f.place({ type: "READ_IMAGES" });
    assert.equal(result.ok, true);
    assert.deepEqual(JSON.parse(JSON.stringify(result.images)), [
      {
        id: "false_123456@lid_IN:image:0",
        dataUrl: "data:image/jpeg;base64,/9j/AA==",
      },
    ]);
    assert.equal(
      (await f.place({ type: "READ_IMAGES", chatId: "wrong@lid" })).ok,
      false,
    );
    assert.equal(f.input.textContent, "");
    assert.equal(f.sends(), 0);
  } finally {
    f.dom.window.close();
  }
});

test("SYNC_MESSAGE fills and replaces only the expected composer text without sending", async () => {
  const f = await fixture();
  try {
    const first = await f.syncMessage({ text: "First line.\n\nSecond line?" });
    assert.equal(first.ok, true);
    assert.equal(first.synced, true);
    assert.equal(first.text, "First line.\n\nSecond line?");
    assert.equal(f.input.textContent, "First line.\n\nSecond line?");
    const replaced = await f.syncMessage({ expectedText: "First line.\n\nSecond line?", text: "Polished transcript." });
    assert.equal(replaced.ok, true);
    assert.equal(f.input.textContent, "Polished transcript.");
    assert.equal(f.sends(), 0);
  } finally { f.dom.window.close(); }
});

test("SYNC_MESSAGE refuses human edits and only clears text that matches its compare value", async () => {
  const f = await fixture({ occupied: true });
  try {
    const conflict = await f.syncMessage({ expectedText: "Managed draft", text: "" });
    assert.equal(conflict.ok, false);
    assert.match(conflict.error, /message changed/);
    assert.equal(f.input.textContent, "A human is writing");
    const clear = await f.syncMessage({ expectedText: "A human is writing", text: "" });
    assert.equal(clear.ok, true);
    assert.equal(f.input.textContent, "");
    assert.equal(f.sends(), 0);
  } finally { f.dom.window.close(); }
});

test("SYNC_MESSAGE never retries partial paste and rejects wrong chats or senders", async () => {
  const f = await fixture({ pasteMode: "partial" });
  try {
    const result = await f.syncMessage({ text: "First line.\n\nSecond line." });
    assert.equal(result.ok, false);
    assert.match(result.error, /part of the message/);
    assert.equal(f.input.textContent, "First line");
    assert.equal(f.sends(), 0);
    const wrongChat = await f.syncMessage({ chatId: "other@lid", text: "Nope" });
    assert.equal(wrongChat.ok, false);
    assert.match(wrongChat.error, /conversation changed/);
    let spoofResponded = false;
    const spoofReturn = f.listener({ type: "SYNC_MESSAGE", chatId: "123456@lid", expectedText: "", text: "Spoof" }, { id: "fixture", url: "https://example.test/" }, () => { spoofResponded = true; });
    assert.equal(spoofReturn, undefined);
    assert.equal(spoofResponded, false);
    assert.equal(f.sends(), 0);
  } finally { f.dom.window.close(); }
});
