import { test } from "node:test";
import assert from "node:assert/strict";
import { build } from "esbuild";
import { JSDOM } from "jsdom";
import { DEFAULT_SETTINGS, type Client, type DeskState } from "../src/types";

const bundleWith = async (define: Record<string, string> = {}) => (await build({
  entryPoints: ["src/main.tsx"],
  bundle: true, write: false, format: "iife", platform: "browser",
  loader: { ".css": "empty" },
  external: ["pdfjs-dist", "pdfjs-dist/*", "mammoth"],
  plugins: [{ name: "url-suffix", setup(b) { b.onResolve({ filter: /\?url$/ }, (args) => ({ path: args.path, external: true })); } }],
  define: { "process.env.NODE_ENV": '"production"', ...define },
})).outputFiles[0].text;
const bundle = await bundleWith();
const storeBundle = await bundleWith({ __WHATSAPP_DESK_STORE__: "true", __WHATSAPP_DESK_LICENSE_API__: '""' });
const plain = (value: unknown) => JSON.parse(JSON.stringify(value));
const tick = (ms = 40) => new Promise((resolve) => setTimeout(resolve, ms));

const client = (chatId: string, notes: string): Client => ({
  chatId, name: `Customer ${chatId}`, stage: "New lead", notes, human: false,
  lastIncomingAt: null, lastIncomingId: null, lastSeen: Date.now(),
});
const chat = (chatId: string): NonNullable<DeskState["context"]> => ({
  chatId, name: `Customer ${chatId}`, isGroup: false, messages: [], lastIncomingAt: null, lastIncomingId: null,
  composerEmpty: true, atBottom: true, observedAt: Date.now(),
});
function fixtureState(): DeskState {
  return {
    settings: { ...DEFAULT_SETTINGS }, hasKey: true, models: [], knowledge: [{ id: "k1", name: "Doc", text: "text", addedAt: 1 }],
    followUps: [], draft: null, activity: "", replyTiming: null, inbox: null,
    context: chat("A"), clients: { A: client("A", "saved note A"), B: client("B", "saved note B") },
    license: { status: "bypass", installationId: null, trialEndsAt: null, checkedAt: null },
  };
}

function mountPanel(prepare: (fixture: DeskState) => void = () => {}, code: string = bundle) {
  const dom = new JSDOM('<div id="root"></div>', { url: "https://extension.test/panel.html?tabId=1", runScripts: "outside-only", pretendToBeVisual: true });
  const fixture = fixtureState();
  prepare(fixture);
  const requests: any[] = [];
  let storageListener: (() => void) | null = null;
  const handler = (message: any): any => {
    if (message.type === "GET_STATE") return JSON.parse(JSON.stringify(fixture));
    if (message.type === "GENERATE") return { reply: "Suggested reply text.", needsHuman: false, reason: "", sources: [], chatId: fixture.context?.chatId ?? "A", contextName: fixture.context?.name, incomingId: null, createdAt: 1700000000000, placementReason: "panel-only" };
    if (message.type === "UPDATE_CLIENT") { Object.assign(fixture.clients[message.chatId], message.patch); return {}; }
    if (message.type === "SAVE_SETTINGS") { Object.assign(fixture.settings, message.settings); return {}; }
    return {};
  };
  (dom.window as any).chrome = {
    runtime: { id: "fixture", sendMessage: async (message: any) => { requests.push(message); return { ok: true, value: handler(message) }; } },
    storage: { onChanged: { addListener: (fn: () => void) => { storageListener = fn; }, removeListener: () => {} } },
  };
  dom.window.eval(code);
  const doc = dom.window.document;
  const win = dom.window as any;
  const q = <T extends Element = HTMLElement>(selector: string) => doc.querySelector<T>(selector);
  const typeInto = (el: HTMLInputElement | HTMLTextAreaElement, value: string) => {
    const proto = el instanceof win.HTMLTextAreaElement ? win.HTMLTextAreaElement.prototype : win.HTMLInputElement.prototype;
    Object.getOwnPropertyDescriptor(proto, "value")!.set!.call(el, value);
    el.dispatchEvent(new win.Event("input", { bubbles: true }));
  };
  const tab = async (label: string) => {
    [...doc.querySelectorAll<HTMLButtonElement>(".tabs button")].find((b) => b.textContent!.includes(label))!.click();
    await tick();
  };
  const refresh = async () => { storageListener!(); await tick(260); };
  return { dom, doc, fixture, requests, q, typeInto, tab, refresh, close: () => dom.window.close() };
}

test("the typed question and suggestion survive visiting another tab", async () => {
  const p = mountPanel();
  try {
    await tick(80);
    const input = p.q<HTMLTextAreaElement>("#assistant-instruction")!;
    p.typeInto(input, "What documents does she need?"); await tick();
    p.q<HTMLButtonElement>(".draft-button")!.click(); await tick(80);
    assert.match(p.q(".assistant-result")!.textContent!, /Suggested reply text\./);
    await p.tab("Follow-ups");
    assert.equal(p.q(".assistant-panel")!.hasAttribute("hidden"), true);
    assert.ok(p.q(".followup-form, .page-title"));
    await p.tab("Assistant");
    assert.equal(p.q(".assistant-panel")!.hasAttribute("hidden"), false);
    assert.equal(p.q("#assistant-instruction"), input, "the composer is not remounted");
    assert.equal(input.value, "What documents does she need?");
    assert.match(p.q(".assistant-result")!.textContent!, /Suggested reply text\./);
  } finally { p.close(); }
});

test("the typed question survives a chat opening", async () => {
  const p = mountPanel((fixture) => { fixture.context = null; });
  try {
    await tick(80);
    assert.ok(p.q(".no-chat-hint"));
    const input = p.q<HTMLTextAreaElement>("#assistant-instruction")!;
    p.typeInto(input, "Draft something for the next chat"); await tick();
    p.fixture.context = chat("A");
    await p.refresh();
    assert.ok(p.q(".client-bar"));
    assert.equal(p.q(".no-chat-hint"), null);
    assert.equal(p.q("#assistant-instruction"), input);
    assert.equal(input.value, "Draft something for the next chat");
  } finally { p.close(); }
});

test("an unsaved client note is saved to its own chat when another chat opens", async () => {
  const p = mountPanel();
  try {
    await tick(80);
    p.q<HTMLButtonElement>(".note-toggle")!.click(); await tick();
    const note = () => p.q<HTMLTextAreaElement>("textarea[aria-label='Client note']")!;
    assert.equal(note().value, "saved note A");
    p.typeInto(note(), "edited note for A"); await tick();
    assert.equal(p.requests.filter((r) => r.type === "UPDATE_CLIENT").length, 0, "autosave waits for a pause");
    p.fixture.context = chat("B");
    await p.refresh();
    const saved = p.requests.filter((r) => r.type === "UPDATE_CLIENT");
    assert.equal(saved.length, 1);
    assert.equal(saved[0].chatId, "A");
    assert.deepEqual(plain(saved[0].patch), { notes: "edited note for A" });
    assert.equal(p.fixture.clients.A.notes, "edited note for A");
    assert.equal(note().value, "saved note B");
  } finally { p.close(); }
});

test("a refresh while typing a client note never clobbers the typing, and the pause autosaves it", async () => {
  const p = mountPanel();
  try {
    await tick(80);
    p.q<HTMLButtonElement>(".note-toggle")!.click(); await tick();
    const note = () => p.q<HTMLTextAreaElement>("textarea[aria-label='Client note']")!;
    p.typeInto(note(), "typed locally"); await tick();
    p.fixture.clients.A.notes = "value from elsewhere";
    await p.refresh();
    assert.equal(note().value, "typed locally");
    await tick(900);
    const saved = p.requests.filter((r) => r.type === "UPDATE_CLIENT");
    assert.equal(saved.at(-1).chatId, "A");
    assert.deepEqual(plain(saved.at(-1).patch), { notes: "typed locally" });
    assert.match(p.q(".note-status")!.textContent!, /Saved/);
  } finally { p.close(); }
});

const choose = (win: any, select: HTMLSelectElement, value: string) => {
  select.value = value;
  select.dispatchEvent(new win.Event("change", { bubbles: true }));
};

test("Settings saves only the changed provider route, never stale automation values", async () => {
  const p = mountPanel();
  try {
    await tick(80);
    await p.tab("Settings");
    assert.equal(p.q(".settings-savebar"), null);
    choose(p.dom.window, p.q<HTMLSelectElement>("select[aria-label='Assistant replies model']")!, "gpt-4.1-mini");
    await tick();
    p.fixture.settings.autoSend = true;
    await p.refresh();
    assert.equal(p.q<HTMLSelectElement>("select[aria-label='Assistant replies model']")!.value, "gpt-4.1-mini");
    p.q<HTMLButtonElement>(".settings-savebar button[type='submit']")!.click();
    await tick(80);
    const saves = p.requests.filter((r) => r.type === "SAVE_SETTINGS");
    assert.equal(saves.length, 1);
    assert.deepEqual(plain(saves[0].settings), { aiRoutes: { text: { provider: "openai", model: "gpt-4.1-mini" } }, model: "gpt-4.1-mini" });
    assert.equal(p.fixture.settings.autoSend, true);
    assert.equal(p.q(".settings-savebar"), null);
  } finally { p.close(); }
});

test("a custom model ID is entered for its task and saved with that route", async () => {
  const p = mountPanel();
  try {
    await tick(80);
    await p.tab("Settings");
    assert.equal(p.q("input[aria-label='Assistant replies custom model ID']"), null);
    choose(p.dom.window, p.q<HTMLSelectElement>("select[aria-label='Assistant replies model']")!, "__custom__");
    await tick();
    const custom = () => p.q<HTMLInputElement>("input[aria-label='Assistant replies custom model ID']")!;
    assert.equal(custom().value, DEFAULT_SETTINGS.model);
    assert.equal(custom().required, true);
    p.typeInto(custom(), "");
    await tick();
    p.q<HTMLButtonElement>(".settings-savebar button[type='submit']")!.click();
    await tick(80);
    assert.equal(p.requests.filter((r) => r.type === "SAVE_SETTINGS").length, 0, "an empty model cannot be saved");
    assert.equal(custom().closest("details")!.hasAttribute("open"), true, "the invalid field's section opens");
    p.typeInto(custom(), "my-model-x");
    await tick();
    p.q<HTMLButtonElement>(".settings-savebar button[type='submit']")!.click();
    await tick(80);
    const saves = p.requests.filter((r) => r.type === "SAVE_SETTINGS");
    assert.equal(saves.length, 1);
    assert.deepEqual(plain(saves[0].settings), { aiRoutes: { text: { provider: "openai", model: "my-model-x" } }, model: "my-model-x" });
  } finally { p.close(); }
});

test("provider credentials are selected independently, never prefilled, and clear only the selected provider", async () => {
  const p = mountPanel((fixture) => {
    fixture.providerStatus = { openai: true, gemini: true, anthropic: false };
  });
  try {
    await tick(80);
    await p.tab("Settings");
    const provider = p.q<HTMLSelectElement>("select[aria-label='Credential provider']")!;
    choose(p.dom.window, provider, "gemini");
    const key = p.q<HTMLInputElement>("input[aria-label='Google Gemini API key']")!;
    assert.equal(key.value, "", "stored credentials are never put back in the field");
    p.typeInto(key, "gemini-test-key");
    p.q<HTMLButtonElement>("button.primary-button.full-button")!.click();
    await tick(80);
    const save = p.requests.find((r) => r.type === "SAVE_KEY");
    assert.deepEqual(plain({ provider: save.provider, key: save.key }), { provider: "gemini", key: "gemini-test-key" });
    assert.ok(p.requests.some((r) => r.type === "LOAD_MODELS" && r.provider === "gemini"));
    assert.equal(p.q<HTMLInputElement>("input[aria-label='Google Gemini API key']")!.value, "");
    p.q<HTMLButtonElement>("button.danger")!.click();
    await tick(80);
    const clears = p.requests.filter((r) => r.type === "SAVE_KEY");
    assert.deepEqual(plain({ type: clears.at(-1).type, provider: clears.at(-1).provider, key: clears.at(-1).key }), { type: "SAVE_KEY", provider: "gemini", key: "" });
    assert.equal(clears.some((r) => r.provider === "openai" && r.key === ""), false);
  } finally { p.close(); }
});

test("voice dictation is enabled when its selected STT provider is ready even if text is not", async () => {
  const p = mountPanel((fixture) => {
    fixture.hasKey = false;
    fixture.providerStatus = { openai: true, openrouter: false };
    fixture.settings.aiRoutes = {
      text: { provider: "openrouter", model: "custom/chat-model" },
      stt: { provider: "openai", model: "whisper-1" },
    };
  });
  try {
    await tick(80);
    const mic = p.q<HTMLButtonElement>(".speech-input__toggle")!;
    assert.equal(mic.disabled, false, "the text provider status does not gate STT");
  } finally { p.close(); }
});

test("each automation chip saves only its own setting", async () => {
  const p = mountPanel();
  try {
    await tick(80);
    for (const [name, field] of [["Auto-draft new messages", "autoDraft"], ["Auto-send replies", "autoSend"], ["Reply across all chats", "allChats"]] as const) {
      const chip = () => p.q<HTMLButtonElement>(`.automation-chip[aria-label='${name}']`)!;
      assert.equal(chip().getAttribute("role"), "switch");
      assert.equal(chip().getAttribute("aria-checked"), "false");
      chip().click(); await tick(80);
      assert.deepEqual(plain(p.requests.filter((r) => r.type === "SAVE_SETTINGS").at(-1).settings), { [field]: true });
      assert.equal(chip().getAttribute("aria-checked"), "true");
    }
    assert.equal(p.requests.filter((r) => r.type === "SAVE_SETTINGS").length, 3);
    assert.ok(p.q(".queue-toggle"), "all-chats mode shows the queue row");
  } finally { p.close(); }
});

test("the store build requires manual sending: the chip is disabled and never saves", async () => {
  const p = mountPanel((fixture) => {
    fixture.license = { status: "trial", installationId: "install-1", trialEndsAt: Date.now() + 3 * 86400000, checkedAt: Date.now() };
  }, storeBundle);
  try {
    await tick(80);
    const chip = p.q<HTMLButtonElement>(".automation-chip[aria-label='Manual sending is required']")!;
    assert.ok(chip, "the Auto-send chip is renamed");
    assert.equal(chip.disabled, true);
    assert.equal(chip.getAttribute("aria-checked"), "false");
    assert.match(chip.textContent!, /Manual send/);
    assert.equal(chip.title, "Review every draft in WhatsApp and click Send yourself.");
    assert.equal(p.q(".automation-chip[aria-label='Auto-send replies']"), null);
    chip.click(); await tick(80);
    assert.equal(p.requests.filter((r) => r.type === "SAVE_SETTINGS").length, 0);
    assert.ok(p.q(".license-banner"), "the trial banner sits between the tabs and the panel");
    await p.tab("Settings");
    const toggle = p.q<HTMLButtonElement>("button[role='switch'][aria-label='Manual sending is required']")!;
    assert.equal(toggle.disabled, true);
    assert.ok(p.q(".license-card"));
  } finally { p.close(); }
});


test("picture routes select a compatible default while other task edits stay scoped", async () => {
  const p = mountPanel();
  try {
    await tick(80);
    await p.tab("Settings");
    choose(p.dom.window, p.q<HTMLSelectElement>("select[aria-label='Pictures and POPs provider']")!, "deepseek");
    await tick();
    const models = p.q<HTMLSelectElement>("select[aria-label='Pictures and POPs model']")!;
    assert.equal(models.value, "deepseek-flash");
    assert.equal([...models.options].some((option) => option.value === "deepseek-v4-pro"), false);
    p.q<HTMLButtonElement>(".settings-savebar button[type='submit']")!.click();
    await tick(80);
    const save = p.requests.find((request) => request.type === "SAVE_SETTINGS");
    assert.deepEqual(plain(save.settings), { aiRoutes: { vision: { provider: "deepseek", model: "deepseek-flash" } } });
  } finally { p.close(); }
});
