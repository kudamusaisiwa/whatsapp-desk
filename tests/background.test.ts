import { test } from "node:test";
import assert from "node:assert/strict";
import vm from "node:vm";
import { build } from "esbuild";
import {
  DEFAULT_SETTINGS,
  LEGACY_BUSINESS_INSTRUCTIONS,
  type ChatContext,
} from "../src/types";
const bundled = (
  await build({
    entryPoints: ["src/background.ts"],
    loader: { ".txt": "text" },
    bundle: true,
    write: false,
    format: "iife",
    platform: "browser",
    target: "es2022",
  })
).outputFiles[0].text;
const delay = () => new Promise((r) => setImmediate(r));
function event() {
  const listeners: Function[] = [];
  return {
    listeners,
    addListener(fn: Function) {
      listeners.push(fn);
    },
  };
}
function area(initial: Record<string, any> = {}) {
  const values = structuredClone(initial);
  return {
    values,
    access: "",
    async setAccessLevel(x: any) {
      this.access = x.accessLevel;
    },
    async get(keys: string | string[]) {
      return Object.fromEntries(
        (typeof keys === "string" ? [keys] : keys)
          .filter((k) => k in values)
          .map((k) => [k, structuredClone(values[k])]),
      );
    },
    async set(patch: any) {
      Object.assign(values, structuredClone(patch));
    },
    async remove(keys: string | string[]) {
      for (const k of typeof keys === "string" ? [keys] : keys)
        delete values[k];
    },
  };
}
function context(id = "a"): ChatContext {
  return {
    chatId: "123456@lid",
    name: "Fixture Client",
    isGroup: false,
    messages: [
      {
        id,
        text: "Hi, I want to enquire",
        direction: "in",
        at: Date.now() - 30000,
      },
    ],
    lastIncomingId: id,
    lastIncomingAt: Date.now() - 30000,
    composerEmpty: true,
    atBottom: true,
    observedAt: Date.now(),
  };
}
async function harness(
  initial: Record<string, any> = {},
  sessionInitial: Record<string, any> = {},
  minAlarmDelay = 0,
  bundleSource = bundled,
) {
  const local = area(initial),
    session = area(sessionInitial);
  let clockNow = Date.now();
  class ClockDate extends Date {
    static now() {
      return clockNow;
    }
  }
  let timerId = 0;
  const timers = new Map<number, { at: number; fn: Function }>();
  const scheduled = new Map<string, { when: number }>();
  let current = context();
  const placements: any[] = [];
  const notices: any[] = [];
  const requests: any[] = [];
  let humanOutput = false;
  let inboxAllowed = true;
  let imageOutput = "picture";
  let receiptPatch: Record<string, unknown> = {};
  let mediaImages: any[] = [];
  let replyOutput = "Hi! Which country will the business operate in?";
  let onFetch: (() => void) | null = null;
  let onPlace: ((count: number) => void) | null = null;
  let onRead: (() => Promise<unknown>) | null = null;
  const alarm = event(),
    startup = event(),
    messages = event();
  const chrome = {
    storage: { local, session },
    runtime: {
      id: "fixture",
      getURL: (s: string) => `chrome-extension://fixture/${s}`,
      onMessage: messages,
      onStartup: startup,
      onInstalled: event(),
    },
    alarms: {
      get: async () => ({ name: "whatsapp-follow-ups" }),
      create: async (name: string, info: any) => {
        if (info.when)
          scheduled.set(name, {
            ...info,
            when: Math.max(info.when, clockNow + minAlarmDelay),
          });
      },
      clear: async (name: string) => scheduled.delete(name),
      onAlarm: alarm,
    },
    tabs: {
      query: async () => [{ id: 1, windowId: 1 }],
      sendMessage: async (_id: number, m: any) => {
        if (m.type === "INBOX_CONTROL")
          return { ok: true, allowed: inboxAllowed };
        if (m.type === "READ_CONTEXT") {
          const hook = onRead;
          onRead = null;
          await hook?.();
          return { ok: true, context: structuredClone(current) };
        }
        if (m.type === "READ_IMAGES") {
          return {
            ok: true,
            chatId: current.chatId,
            incomingId: current.lastIncomingId,
            images: mediaImages,
          };
        }
        if (m.type === "PLACE_DRAFT") {
          placements.push({ ...m, at: clockNow });
          if (m.send) {
            const id = `sent-${placements.length}`;
            current.messages.push({
              id,
              text: m.text,
              direction: "out",
              at: clockNow,
            });
            onPlace?.(placements.length);
            return { ok: true, sentMessageId: id };
          }
          onPlace?.(placements.length);
          return { ok: true };
        }
        return { ok: true };
      },
      create: async () => {},
      reload: async () => {},
      update: async () => {},
      onRemoved: event(),
    },
    windows: { update: async () => {} },
    action: { onClicked: event() },
    notifications: {
      create: async (...args: any[]) => {
        notices.push(args);
      },
      onClicked: event(),
    },
  };
  const sandbox = vm.createContext({
    chrome,
    console,
    Date: ClockDate,
    Math: Object.assign(Object.create(Math), { random: () => 0.5 }),
    Promise,
    AbortSignal,
    crypto: globalThis.crypto,
    setTimeout: (fn: Function, ms: number) => {
      const id = ++timerId;
      timers.set(id, { at: clockNow + ms, fn });
      return id;
    },
    clearTimeout: (id: number) => timers.delete(id),
    fetch: async (url: string, options: any) => {
      requests.push({
        url,
        body: options.body ? JSON.parse(options.body) : null,
      });
      onFetch?.();
      return {
        ok: true,
        json: async () =>
          url.endsWith("/models")
            ? {
                data: [
                  { id: "gpt-5-mini" },
                  { id: "gpt-image-1" },
                  { id: "gpt-4.1-mini" },
                  { id: "whisper-1" },
                ],
              }
            : {
                output: [
                  {
                    type: "message",
                    content: [
                      {
                        type: "output_text",
                        text: JSON.stringify({
                          reply: replyOutput,
                          needsHuman: humanOutput,
                          imageReview: imageOutput,
                          receipt:
                            imageOutput === "payment_proof"
                              ? {
                                  amount: 180,
                                  currency: "USD",
                                  recipient: "Your business",
                                  reference: "FIXTURE",
                                  date: "2026-10-24",
                                  expectedAmount: 180,
                                  expectedCurrency: "USD",
                                  expectedRecipient: "Your business",
                                  status: "successful",
                                  ...receiptPatch,
                                }
                              : null,
                          reason: humanOutput
                            ? "Please confirm the details with a colleague."
                            : "",
                          sources: ["doc"],
                        }),
                      },
                    ],
                  },
                ],
              },
      };
    },
  });
  vm.runInContext(bundleSource, sandbox);
  for (let i = 0; i < 10; i++) await delay();
  const panel = {
    id: "fixture",
    url: "chrome-extension://fixture/panel.html?tabId=1",
    frameId: 1,
  };
  const content = {
    id: "fixture",
    url: "https://web.whatsapp.com/",
    frameId: 0,
    tab: { id: 1 },
  };
  async function call(
    type: string,
    payload: any = {},
    sender = panel,
  ): Promise<any> {
    return new Promise((resolve) =>
      messages.listeners[0]({ type, tabId: 1, ...payload }, sender, resolve),
    );
  }
  const flush = async () => {
    for (let i = 0; i < 30; i++) await delay();
  };
  async function advance(ms: number) {
    const target = clockNow + ms;
    for (let steps = 0; steps < 2000; steps++) {
      await flush();
      const nextTimer = [...timers].sort((a, b) => a[1].at - b[1].at)[0];
      const nextAlarm = [...scheduled].sort((a, b) => a[1].when - b[1].when)[0];
      const timerAt = nextTimer?.[1].at ?? Infinity,
        alarmAt = nextAlarm?.[1].when ?? Infinity;
      if (Math.min(timerAt, alarmAt) > target) {
        clockNow = target;
        await flush();
        return;
      }
      clockNow = Math.max(clockNow, Math.min(timerAt, alarmAt));
      if (timerAt <= alarmAt) {
        timers.delete(nextTimer[0]);
        nextTimer[1].fn();
      } else {
        scheduled.delete(nextAlarm[0]);
        for (const fn of alarm.listeners) fn({ name: nextAlarm[0] });
      }
    }
    throw new Error("Virtual timer loop did not settle");
  }
  return {
    local,
    session,
    placements,
    notices,
    requests,
    call,
    panel,
    content,
    alarm,
    startup,
    scheduled,
    advance,
    flush,
    now: () => clockNow,
    setOnPlace: (fn: (count: number) => void) => {
      onPlace = fn;
    },
    setOnRead: (fn: () => Promise<unknown>) => {
      onRead = fn;
    },
    setContext: (c: ChatContext) => {
      current = c;
    },
    setReceiptPatch: (patch: Record<string, unknown>) => {
      receiptPatch = patch;
    },
    setMediaImages: (images: any[], review = "picture") => {
      mediaImages = images;
      imageOutput = review;
    },
    setInboxAllowed: (value: boolean) => {
      inboxAllowed = value;
    },
    setHumanOutput: () => {
      humanOutput = true;
    },
    setReplyOutput: (text: string) => {
      replyOutput = text;
    },
    setOnFetch: (f: () => void) => {
      onFetch = f;
    },
    publish: async (c: ChatContext) => {
      current = c;
      return call("CONTEXT", { context: c }, content);
    },
  };
}
const configured = {
  settings: { ...DEFAULT_SETTINGS },
  apiKey: "sk-fixture-only-never-valid",
  knowledge: [
    {
      id: "doc",
      name: "Registration",
      text: "Ask which country the company will operate in.",
      addedAt: 0,
    },
  ],
};
test("upgrading the original voice removes stock handoffs while retaining saved model and controls", async () => {
  const h = await harness({
    ...configured,
    settings: {
      ...DEFAULT_SETTINGS,
      businessInstructions: LEGACY_BUSINESS_INSTRUCTIONS,
      model: "custom-saved-model",
      autoSend: true,
      autoDraft: false,
    },
  });
  assert.equal(
    h.local.values.settings.businessInstructions,
    DEFAULT_SETTINGS.businessInstructions,
  );
  assert.equal(h.local.values.settings.model, "custom-saved-model");
  assert.equal(h.local.values.settings.autoSend, true);
  assert.equal(h.local.values.settings.autoDraft, false);
  assert.equal(h.local.values.knowledge[0].id, "doc");
  assert.equal(h.local.values.apiKey, configured.apiKey);
});
test("upgrading preserves an owner-written custom business voice", async () => {
  const h = await harness({
    ...configured,
    settings: {
      ...DEFAULT_SETTINGS,
      businessInstructions: "Use a friendly Zimbabwean sales voice.",
    },
  });
  assert.equal(
    h.local.values.settings.businessInstructions,
    "Use a friendly Zimbabwean sales voice.",
  );
});
test("sales policy is sent above historical knowledge and keeps human-review reasons internal", async () => {
  const h = await harness({
    ...configured,
    knowledge: [
      {
        id: "doc",
        name: "Old template",
        text: "Say a colleague will help, subject to bank approval.",
        addedAt: 0,
      },
    ],
  });
  await h.publish(context());
  assert.equal((await h.call("GENERATE")).ok, true);
  const request = h.requests[0].body;
  assert.match(
    request.instructions,
    /Follow the owner's supplied policies/,
  );
  assert.match(request.instructions, /internal reason/);
  assert.match(request.instructions, /Set needsHuman=true when an answer depends/);
  assert.match(request.instructions, /Never promise guarantees/);
  assert.equal(
    JSON.parse(request.input).businessKnowledge[0].title,
    "Old template",
  );
  assert.equal(h.placements[0].send, false);
});
test("API keys are local-only, absent from panel state, and privileged commands reject a content sender", async () => {
  const h = await harness(configured);
  assert.equal(h.local.access, "TRUSTED_CONTEXTS");
  assert.equal(h.session.access, "TRUSTED_CONTEXTS");
  const state = await h.call("GET_STATE");
  assert.equal(state.value.hasKey, true);
  assert.ok(!JSON.stringify(state).includes(configured.apiKey));
  assert.equal((await h.call("GET_STATE", {}, h.content)).ok, false);
  assert.equal(
    (await h.call("SAVE_KEY", { key: "sk-a-malicious-overwrite" }, h.content))
      .ok,
    false,
  );
  assert.equal(h.local.values.apiKey, configured.apiKey);
});
test("manual suggestion places a draft in chat without clicking Send by default", async () => {
  const h = await harness(configured);
  await h.publish(context());
  const result = await h.call("GENERATE");
  assert.equal(result.ok, true);
  assert.equal(h.placements.length, 1);
  assert.equal(h.placements[0].send, false);
  assert.equal(h.requests[0].body.store, false);
  assert.ok(!JSON.stringify(h.requests[0].body).includes(configured.apiKey));
  assert.equal(result.value.sources[0], "doc");
});
test("a chat switch during generation discards the result instead of placing it in the wrong chat", async () => {
  const h = await harness(configured);
  await h.publish(context());
  h.setOnFetch(() => h.setContext({ ...context(), chatId: "other@lid" }));
  const r = await h.call("GENERATE");
  assert.equal(r.ok, false);
  assert.match(r.error, /conversation changed/);
  assert.equal(h.placements.length, 0);
});
test("the generated reply preview and WhatsApp placement share the same spaced layout", async () => {
  const h = await harness(configured);
  await h.publish(context());
  h.setReplyOutput(
    "**Documents**\r\n- Passport\r\n- Email\r\n\r\nWhich country are you based in?",
  );
  const result = await h.call("GENERATE");
  const expected =
    "*Documents*\n- Passport\n- Email\n\nWhich country are you based in?";
  assert.equal(result.ok, true);
  assert.equal(result.value.reply, expected);
  assert.equal(h.placements[0].text, expected);
  assert.equal(h.placements[0].send, false);
});
test("auto-send respects human-review decisions even when the setting is enabled", async () => {
  const h = await harness({
    ...configured,
    settings: { ...DEFAULT_SETTINGS, autoSend: true },
  });
  await h.publish(context());
  h.setHumanOutput();
  const result = await h.call("GENERATE");
  assert.equal(result.ok, true);
  assert.equal(h.placements[0].send, false);
  assert.equal(result.value.needsHuman, true);
});
test("opening old history never answers backlog; new incoming events are deduplicated across repeats", async () => {
  const h = await harness({
    ...configured,
    settings: { ...DEFAULT_SETTINGS, autoDraft: true },
  });
  const first = context("old");
  first.lastIncomingAt = Date.now() - 180000;
  await h.publish(first);
  assert.equal(h.requests.length, 0);
  const next = context("new");
  await h.publish(next);
  await h.publish(next);
  assert.equal(h.requests.length, 0);
  await h.advance(45000);
  assert.equal(h.requests.length, 1);
  assert.equal(h.placements[0].send, false);
});
test("a recent first greeting queues and sends automatically without a button click", async () => {
  for (const emptyBefore of [false, true]) {
    const h = await harness({
      ...configured,
      settings: { ...DEFAULT_SETTINGS, autoDraft: true, autoSend: true },
    });
    if (emptyBefore)
      await h.publish({
        ...context(),
        messages: [],
        lastIncomingId: null,
        lastIncomingAt: null,
      });
    const greeting = context("first-hey");
    greeting.messages[0].text = "Hey";
    h.setReplyOutput(
      "Hello! 👋 Welcome to Your business. How can we help you today?",
    );
    await h.publish(greeting);
    assert.ok(h.scheduled.has("whatsapp-reply:1"));
    const due = h.scheduled.get("whatsapp-reply:1")!.when;
    await h.publish(greeting);
    assert.equal(h.scheduled.get("whatsapp-reply:1")!.when, due);
    await h.advance(30000);
    assert.equal(h.requests.length, 0);
    await h.advance(30000);
    assert.equal(h.requests.length, 1);
    assert.equal(h.placements.length, 1);
    assert.equal(h.placements[0].send, true);
    assert.match(h.requests[0].body.instructions, /A greeting alone/);
    assert.match(
      h.requests[0].body.instructions,
      /Ask how you can help before recommending a service/,
    );
    assert.deepEqual(JSON.parse(h.requests[0].body.input).conversation, [
      { speaker: "customer", text: "Hey" },
    ]);
  }
});
test("first observations ignore answered or already claimed messages and respect controls", async () => {
  for (const mode of [
    "answered",
    "claimed",
    "sent",
    "takeover",
    "off",
    "occupied",
    "history",
  ]) {
    const c = context("unanswered");
    const h = await harness({
      ...configured,
      settings: {
        ...DEFAULT_SETTINGS,
        autoDraft: mode !== "off",
        autoSend: true,
      },
      clients: mode === "takeover" ? { [c.chatId]: { human: true } } : {},
      ledger:
        mode === "claimed"
          ? {
              [`incoming:${c.chatId}:${c.lastIncomingId}`]: {
                status: "claimed",
                at: Date.now(),
              },
            }
          : mode === "sent"
            ? {
                [`send:reply:${c.chatId}:${c.lastIncomingId}:part:1`]: {
                  status: "send-attempt",
                  at: Date.now(),
                },
              }
            : {},
    });
    if (mode === "answered")
      c.messages.push({
        id: "human",
        text: "Hello, how can we help?",
        direction: "out",
        at: Date.now(),
      });
    if (mode === "occupied") c.composerEmpty = false;
    if (mode === "history") c.atBottom = false;
    await h.publish(c);
    await h.advance(60000);
    assert.equal(h.requests.length, 0, mode);
    assert.equal(h.placements.length, 0, mode);
  }
});
test("returning to a recent unanswered chat resumes its pause without duplicate replies", async () => {
  const h = await harness({
    ...configured,
    settings: { ...DEFAULT_SETTINGS, autoDraft: true },
  });
  const c = context("first");
  await h.publish(c);
  await h.publish({
    ...context("old"),
    chatId: "other@lid",
    lastIncomingAt: h.now() - 180000,
  });
  assert.equal(h.scheduled.has("whatsapp-reply:1"), false);
  await h.publish(c);
  await h.advance(45000);
  assert.equal(h.requests.length, 1);
  await h.publish({
    ...context("old"),
    chatId: "other@lid",
    lastIncomingAt: h.now() - 180000,
  });
  await h.publish(c);
  await h.advance(60000);
  assert.equal(h.requests.length, 1);
});
test("automatic sending needs final authorization and durable claims prevent a duplicate attempt", async () => {
  const h = await harness({
    ...configured,
    settings: { ...DEFAULT_SETTINGS, autoSend: true },
  });
  await h.publish(context());
  const payload = {
    chatId: "123456@lid",
    incomingId: "a",
    token: "reply:123456@lid:a",
  };
  const one = await h.call("AUTHORIZE_SEND", payload, h.content);
  const two = await h.call("AUTHORIZE_SEND", payload, h.content);
  assert.equal(one.ok, true);
  assert.equal(two.ok, false);
  assert.match(two.error, /already attempted/);
  await h.call("UPDATE_CLIENT", {
    chatId: "123456@lid",
    patch: { human: true },
  });
  assert.equal(
    (
      await h.call(
        "AUTHORIZE_SEND",
        { ...payload, token: "reply:another" },
        h.content,
      )
    ).ok,
    false,
  );
});
test("a clear question uses the short timer even when Chrome delays alarms, with no duplicate from the fallback", async () => {
  const h = await harness(
    {
      ...configured,
      settings: { ...DEFAULT_SETTINGS, autoDraft: true, autoSend: true },
    },
    {},
    30000,
  );
  const c = context("price");
  c.messages[0].text = "How much is the Solo Director package?";
  h.setReplyOutput("The Solo Director package is R3,000 (US$180).");
  await h.publish(c);
  assert.equal(h.session.values.pendingReplies[1].dueAt - h.now(), 10000);
  assert.equal(h.scheduled.get("whatsapp-reply:1")!.when - h.now(), 30000);
  await h.advance(9000);
  assert.equal(h.requests.length, 0);
  await h.advance(10000);
  assert.equal(h.requests.length, 1);
  assert.equal(h.placements.length, 1);
  assert.equal(h.placements[0].send, true);
  await h.advance(60000);
  assert.equal(h.requests.length, 1);
  assert.equal(h.placements.length, 1);
});
test("an addition after a clear question resets to the longer pause and cancels its short timer", async () => {
  const h = await harness({
    ...configured,
    settings: { ...DEFAULT_SETTINGS, autoDraft: true },
  });
  const c = context("question");
  c.messages[0].text = "How much does it cost?";
  await h.publish(c);
  await h.advance(5000);
  const addition = context("addition");
  addition.messages[0].text = "And I also wanted to ask about";
  addition.messages.unshift(...c.messages);
  await h.publish(addition);
  assert.equal(h.session.values.pendingReplies[1].dueAt - h.now(), 37500);
  await h.advance(10000);
  assert.equal(h.requests.length, 0);
  await h.advance(28000);
  assert.equal(h.requests.length, 1);
  assert.equal(h.placements[0].incomingId, "addition");
});
test("a worker restart restores a remaining short timer", async () => {
  const now = Date.now();
  const h = await harness(
    { ...configured, settings: { ...DEFAULT_SETTINGS, autoDraft: true } },
    {
      pendingReplies: {
        1: {
          tabId: 1,
          chatId: "123456@lid",
          incomingId: "a",
          dueAt: now + 8000,
          outgoingIds: [],
        },
      },
    },
    30000,
  );
  await h.advance(10000);
  assert.equal(h.requests.length, 1);
  await h.advance(60000);
  assert.equal(h.requests.length, 1);
});
test("after the first business welcome, a model's repeated welcome is removed before placement", async () => {
  const h = await harness(configured);
  const c = context("account");
  c.messages = [
    { id: "hey", text: "Hey", direction: "in", at: Date.now() - 60000 },
    {
      id: "welcome",
      text: "Hello! Welcome to Your business. How can we help?",
      direction: "out",
      at: Date.now() - 50000,
    },
    { ...c.messages[0], text: "I want an account" },
  ];
  await h.publish(c);
  const question =
    "Do you need a Personal Non-Resident Account or a Business Account?";
  h.setReplyOutput("Welcome! 👋\n\n" + question);
  const result = await h.call("GENERATE");
  assert.equal(result.ok, true);
  assert.equal(result.value.reply, question);
  assert.equal(h.placements[0].text, question);
  assert.match(
    h.requests[0].body.instructions,
    /Welcome a new customer once/,
  );
  h.setReplyOutput("Welcome! 👋");
  assert.equal((await h.call("GENERATE")).ok, false);
  assert.equal(h.placements.length, 1);
});
test("a burst resets quiet time and drafts once using every message in the burst", async () => {
  const h = await harness({
    ...configured,
    settings: { ...DEFAULT_SETTINGS, autoDraft: true },
  });
  await h.publish(context("old"));
  const first = context("question-1");
  first.messages[0].text = "I need a business account.";
  await h.publish(first);
  const originalDue = h.scheduled.get("whatsapp-reply:1")!.when;
  await h.advance(20000);
  const second = context("question-2");
  second.messages[0].text = "There will be two directors.";
  second.messages.unshift(...first.messages);
  await h.publish(second);
  const due = h.scheduled.get("whatsapp-reply:1")!.when;
  assert.equal(due - originalDue, 20000);
  await h.publish(second);
  assert.equal(h.scheduled.get("whatsapp-reply:1")!.when, due);
  await h.advance(20000);
  assert.equal(h.requests.length, 0);
  await h.advance(18000);
  assert.equal(h.requests.length, 1);
  const conversation = JSON.parse(h.requests[0].body.input).conversation;
  assert.deepEqual(
    conversation.map((m: any) => m.text),
    ["I need a business account.", "There will be two directors."],
  );
  assert.equal(h.placements.length, 1);
  assert.equal(h.placements[0].incomingId, "question-2");
  await h.advance(60000);
  assert.equal(h.requests.length, 1);
});
test("takeover, editing, a human reply, a chat switch or disabling automation cancels the pending answer", async () => {
  for (const action of [
    "takeover",
    "editing",
    "human-reply",
    "switch",
    "off",
  ]) {
    const h = await harness({
      ...configured,
      settings: { ...DEFAULT_SETTINGS, autoDraft: true },
    });
    await h.publish(context("old"));
    const current = context("new");
    await h.publish(current);
    if (action === "takeover")
      await h.call("UPDATE_CLIENT", {
        chatId: current.chatId,
        patch: { human: true },
      });
    if (action === "editing")
      await h.publish({ ...current, composerEmpty: false });
    if (action === "human-reply")
      await h.publish({
        ...current,
        messages: [
          ...current.messages,
          {
            id: "human",
            text: "I am handling this.",
            direction: "out",
            at: h.now(),
          },
        ],
      });
    if (action === "switch")
      await h.publish({
        ...current,
        chatId: "other@lid",
        lastIncomingAt: h.now() - 180000,
      });
    if (action === "off")
      await h.call("SAVE_SETTINGS", { settings: { autoDraft: false } });
    assert.equal(h.scheduled.has("whatsapp-reply:1"), false, action);
    await h.advance(60000);
    assert.equal(h.requests.length, 0, action);
  }
});
test("a worker restart retains quiet time, and repeated alarms cannot duplicate the reply", async () => {
  const now = Date.now();
  const h = await harness(
    { ...configured, settings: { ...DEFAULT_SETTINGS, autoDraft: true } },
    {
      pendingReplies: {
        1: {
          tabId: 1,
          chatId: "123456@lid",
          incomingId: "a",
          dueAt: now + 35000,
          outgoingIds: [],
        },
      },
    },
  );
  h.alarm.listeners[0]({ name: "whatsapp-reply:1" });
  await h.flush();
  assert.equal(h.requests.length, 0);
  await h.advance(36000);
  assert.equal(h.requests.length, 1);
  h.alarm.listeners[0]({ name: "whatsapp-reply:1" });
  await h.flush();
  assert.equal(h.requests.length, 1);
});
test("an expiring old alarm cannot cancel a newly queued customer message", async () => {
  const h = await harness({
    ...configured,
    settings: { ...DEFAULT_SETTINGS, autoDraft: true },
  });
  await h.publish(context("old"));
  await h.publish(context("first"));
  h.setOnRead(() => h.publish(context("second")));
  await h.advance(38000);
  assert.equal(h.requests.length, 0);
  assert.equal(h.session.values.pendingReplies[1].incomingId, "second");
  await h.advance(45000);
  assert.equal(h.requests.length, 1);
  assert.equal(h.placements[0].incomingId, "second");
});
const longReply = [
  "Our company package includes registration and account application assistance. We can use the details you provide to start the process and help you prepare the starting documents.",
  "The starting checklist includes a clear passport scan, your email address, residential address and phone number, plus four proposed company names for the new company name search.",
  "You can send the details using our registration form or in this WhatsApp conversation. Please let us know which option you would prefer so we can help you take the next step.",
].join("\n\n");
test("long automatic replies are paced and split into two verified messages without losing wording", async () => {
  const h = await harness({
    ...configured,
    settings: { ...DEFAULT_SETTINGS, autoSend: true },
  });
  await h.publish(context());
  h.setReplyOutput(longReply);
  const started = h.now(),
    result = h.call("GENERATE");
  await h.flush();
  assert.equal(h.placements.length, 0);
  await h.advance(60000);
  assert.equal((await result).ok, true);
  assert.equal(h.placements.length, 2);
  assert.equal(h.placements.map((m) => m.text).join("\n\n"), longReply);
  assert.ok(h.placements[0].at - started >= 3000);
  assert.ok(h.placements[1].at - h.placements[0].at >= 3000);
  assert.notEqual(h.placements[0].sendToken, h.placements[1].sendToken);
});
test("a new incoming message or takeover between the two parts prevents the remaining send", async () => {
  for (const interrupt of ["incoming", "takeover"]) {
    const h = await harness({
      ...configured,
      settings: { ...DEFAULT_SETTINGS, autoSend: true },
    });
    await h.publish(context());
    h.setReplyOutput(longReply);
    h.setOnPlace((count) => {
      if (count !== 1) return;
      if (interrupt === "incoming") h.setContext(context("new-question"));
      else h.local.values.clients["123456@lid"].human = true;
    });
    const result = h.call("GENERATE");
    await h.flush();
    await h.advance(60000);
    assert.equal((await result).ok, false);
    assert.equal(h.placements.length, 1);
    assert.equal(
      h.session.values["draft:1"].placement,
      "First message sent · remaining reply waiting",
    );
    assert.ok(
      !h.session.values["draft:1"].reply.includes(h.placements[0].text),
    );
  }
});
test("a customer message during the extra length-based pause prevents even the first send", async () => {
  const h = await harness({
    ...configured,
    settings: { ...DEFAULT_SETTINGS, autoSend: true },
  });
  await h.publish(context());
  const result = h.call("GENERATE");
  await h.flush();
  h.setContext(context("one-more-thing"));
  await h.advance(30000);
  assert.equal((await result).ok, false);
  assert.equal(h.placements.length, 0);
});
test("overdue follow-ups become reviewable after restart and never send with auto-send off", async () => {
  const f = {
    id: "follow-1",
    chatId: "123456@lid",
    name: "Fixture Client",
    message: "Checking in.",
    mode: "automatic",
    dueAt: Date.now() - 600000,
    status: "pending",
    createdAt: Date.now() - 1000000,
  };
  const h = await harness({ ...configured, followUps: [f] });
  assert.equal(h.local.values.followUps[0].status, "ready");
  assert.equal(h.placements.length, 0);
  assert.equal(h.notices.length, 1);
  await h.alarm.listeners[0]({ name: "whatsapp-follow-ups" });
  for (let i = 0; i < 10; i++) await delay();
  assert.equal(h.notices.length, 1);
});
test("available-model refresh filters non-text models and never returns a saved key", async () => {
  const h = await harness(configured);
  const r = await h.call("LOAD_MODELS");
  assert.equal(r.ok, true);
  assert.equal(r.value.models.length, 2);
  assert.ok(!JSON.stringify(r).includes(configured.apiKey));
});

test("panel state exposes the actual queued deadline and resets or clears it with the conversation", async () => {
  const h = await harness({
    ...configured,
    settings: { ...DEFAULT_SETTINGS, autoDraft: true },
  });
  await h.publish(context("one"));
  const first = (await h.call("GET_STATE")).value.replyTiming;
  assert.equal(first.phase, "quiet");
  assert.equal(first.dueAt, h.session.values.pendingReplies[1].dueAt);
  await h.advance(5000);
  await h.publish(context("two"));
  const second = (await h.call("GET_STATE")).value.replyTiming;
  assert.equal(second.incomingId, "two");
  assert.equal(second.dueAt - first.dueAt, 5000);
  await h.call("UPDATE_CLIENT", {
    chatId: "123456@lid",
    patch: { human: true },
  });
  assert.equal((await h.call("GET_STATE")).value.replyTiming, null);
});
test("panel state changes from preparation countdown to completion and hides stale chat deadlines", async () => {
  const h = await harness({
    ...configured,
    settings: { ...DEFAULT_SETTINGS, autoSend: true },
  });
  await h.publish(context());
  const result = h.call("GENERATE");
  await h.flush();
  const timing = (await h.call("GET_STATE")).value.replyTiming;
  assert.equal(timing.phase, "send");
  assert.ok(timing.dueAt > h.now());
  await h.advance(30000);
  assert.equal((await result).ok, true);
  assert.equal((await h.call("GET_STATE")).value.replyTiming, null);
  h.session.values["replyTiming:1"] = timing;
  await h.publish({ ...context("other"), chatId: "other@lid" });
  assert.equal((await h.call("GET_STATE")).value.replyTiming, null);
});

test("screenshots are sent as image input, with pixels absent from saved state and keys absent from requests", async () => {
  const h = await harness(configured);
  const c = context("screen");
  c.messages[0].text = "What does this error mean?";
  c.messages[0].images = ["screen:image:0"];
  const pixels = "data:image/jpeg;base64,/9j/AA==";
  h.setMediaImages([{ id: "screen:image:0", dataUrl: pixels }]);
  await h.publish(c);
  const result = await h.call("GENERATE");
  assert.equal(result.ok, true);
  assert.equal(result.value.needsHuman, false);
  const request = h.requests[0].body;
  assert.equal(request.input[0].content[2].image_url, pixels);
  assert.equal(request.input[0].content[2].detail, "high");
  assert.ok(request.text.format.schema.required.includes("imageReview"));
  assert.ok(!JSON.stringify(h.local.values).includes(pixels));
  assert.ok(!JSON.stringify(h.session.values).includes(pixels));
  assert.ok(!JSON.stringify(request).includes(configured.apiKey));
});
test("unavailable or unclear incoming pictures cannot auto-send even if the model requests it", async () => {
  for (const mode of ["missing", "unclear"]) {
    const h = await harness({
      ...configured,
      settings: { ...DEFAULT_SETTINGS, autoSend: true },
    });
    const c = context("photo");
    c.messages[0].images = ["photo:image:0"];
    h.setMediaImages(
      mode === "missing"
        ? []
        : [{ id: "photo:image:0", dataUrl: "data:image/jpeg;base64,/9j/AA==" }],
      mode === "unclear" ? "unclear" : "picture",
    );
    await h.publish(c);
    const result = await h.call("GENERATE");
    assert.equal(result.ok, true);
    assert.equal(result.value.needsHuman, true);
    assert.equal(h.placements[0].send, false);
  }
});
test("readable POPs can be acknowledged while the request explicitly forbids claiming bank verification", async () => {
  const h = await harness(configured);
  const c = context("pop");
  c.messages[0].images = ["pop:image:0"];
  h.setMediaImages(
    [{ id: "pop:image:0", dataUrl: "data:image/jpeg;base64,/9j/AA==" }],
    "payment_proof",
  );
  h.setReplyOutput(
    "Thank you for the receipt. It shows USD 180. Payment is awaiting verification.",
  );
  await h.publish(c);
  const result = await h.call("GENERATE");
  assert.equal(result.ok, true);
  assert.equal(result.value.needsHuman, false);
  assert.match(result.value.reply, /awaiting verification/);
  assert.match(
    h.requests[0].body.instructions,
    /There is no live bank\/payment-verification tool/,
  );
});

test("all-chat handling shares durable reply claims, skips takeover and requires the live navigation token", async () => {
  const h = await harness({
    ...configured,
    settings: {
      ...DEFAULT_SETTINGS,
      allChats: true,
      autoSend: true,
      autoDraft: true,
    },
  });
  const ctx = context();
  await h.publish(ctx);
  assert.equal(h.scheduled.has("whatsapp-reply:1"), false);
  assert.equal(
    (await h.call("INBOX_STATUS", {}, h.content)).value.enabled,
    true,
  );
  const payload = {
    token: "valid-token",
    chatId: ctx.chatId,
    incomingId: ctx.lastIncomingId,
    observedAt: h.now() - 10000,
    dueAt: h.now(),
  };
  const run = h.call("INBOX_RUN", payload, h.content);
  await h.flush();
  await h.advance(30000);
  assert.equal((await run).value.status, "sent");
  assert.equal(h.placements.length, 1);
  assert.equal(h.placements[0].inboxToken, "valid-token");
  // Reopening the same enquiry must not generate or send again.
  h.setContext(ctx);
  await h.call("INBOX_RUN", payload, h.content);
  assert.equal(h.requests.length, 1);
  h.setInboxAllowed(false);
  assert.equal(
    (
      await h.call(
        "INBOX_RUN",
        { ...payload, incomingId: "another" },
        h.content,
      )
    ).ok,
    false,
  );
  const next = context("human-message");
  await h.publish(next);
  await h.call("UPDATE_CLIENT", {
    chatId: next.chatId,
    patch: { human: true },
  });
  h.setInboxAllowed(true);
  const skipped = await h.call(
    "INBOX_RUN",
    { ...payload, incomingId: next.lastIncomingId },
    h.content,
  );
  assert.equal(skipped.value.status, "skipped");
  assert.equal(h.placements.length, 1);
});
test("all-chat sends stop when a human interrupts during model generation", async () => {
  const h = await harness({
    ...configured,
    settings: {
      ...DEFAULT_SETTINGS,
      allChats: true,
      autoSend: true,
      autoDraft: true,
    },
  });
  await h.publish(context());
  await h.call("INBOX_STATUS", {}, h.content);
  h.setOnFetch(() => h.setInboxAllowed(false));
  const result = await h.call(
    "INBOX_RUN",
    {
      token: "token",
      chatId: "123456@lid",
      incomingId: "a",
      observedAt: h.now() - 10000,
      dueAt: h.now(),
    },
    h.content,
  );
  assert.equal(result.value.status, "review");
  assert.equal(h.placements.length, 0);
});
test("the all-chat monitor elects one browser tab, and review drafts are available after switching chats", async () => {
  const h = await harness({
    ...configured,
    settings: {
      ...DEFAULT_SETTINGS,
      allChats: true,
      autoSend: true,
      autoDraft: true,
    },
  });
  await h.publish(context());
  const other = { ...h.content, tab: { id: 2 } };
  assert.equal(
    (await h.call("INBOX_STATUS", {}, h.content)).value.enabled,
    true,
  );
  assert.equal((await h.call("INBOX_STATUS", {}, other)).value.enabled, false);
  h.setHumanOutput();
  const run = h.call(
    "INBOX_RUN",
    {
      token: "token",
      chatId: "123456@lid",
      incomingId: "a",
      observedAt: h.now() - 10000,
      dueAt: h.now(),
    },
    h.content,
  );
  await h.flush();
  await h.advance(30000);
  assert.equal((await run).value.status, "review");
  assert.equal(h.local.values.clients["123456@lid"].human, true);
  await h.publish({ ...context("other"), chatId: "other@lid" });
  await h.publish(context());
  assert.equal((await h.call("GET_STATE")).value.draft.chatId, "123456@lid");
});
test("upgrading enables all-chat scope without changing the owner's auto-send or auto-draft choices", async () => {
  const settings: any = {
    ...DEFAULT_SETTINGS,
    autoSend: true,
    autoDraft: false,
  };
  delete settings.allChats;
  const h = await harness({ ...configured, settings });
  assert.equal(h.local.values.settings.allChats, true);
  assert.equal(h.local.values.settings.autoDraft, false);
  assert.equal(h.local.values.settings.autoSend, true);
});

test("a mismatched receipt stays unsent even when the model sets needsHuman=false and auto-send is on", async () => {
  const h = await harness({
    ...configured,
    settings: { ...DEFAULT_SETTINGS, autoSend: true },
  });
  const c = context("mismatch");
  c.messages[0].images = ["mismatch:image:0"];
  h.setMediaImages(
    [{ id: "mismatch:image:0", dataUrl: "data:image/jpeg;base64,/9j/AA==" }],
    "payment_proof",
  );
  h.setReceiptPatch({ amount: 10, recipient: "Different recipient" });
  h.setReplyOutput(
    "Thank you for sending the receipt. Do you have the receipt for Your business?",
  );
  await h.publish(c);
  const result = await h.call("GENERATE");
  assert.equal(result.ok, true);
  assert.equal(result.value.needsHuman, true);
  assert.match(result.value.reason, /recipient differs/);
  assert.match(result.value.reason, /amount or currency differs/);
  assert.equal(h.placements[0].send, false);
});

test("fresh installation starts empty, requires the owner's key, and uses their business context", async () => {
  const h = await harness({}, {}, 0, bundled);
  const first = JSON.parse(JSON.stringify((await h.call("GET_STATE")).value));
  assert.equal(first.hasKey, false);
  assert.deepEqual(first.knowledge, []);
  assert.deepEqual(first.clients, {});
  assert.deepEqual(first.followUps, []);
  assert.equal(first.settings.businessName, "Your business");
  assert.equal(first.settings.autoSend, false);
  assert.equal(first.settings.autoDraft, false);
  assert.equal(first.settings.allChats, false);
  assert.equal(h.local.access, "TRUSTED_CONTEXTS");
  await h.publish(context());
  assert.equal((await h.call("GENERATE")).ok, false);
  assert.equal(h.requests.length, 0);
  assert.equal((await h.call("SAVE_KEY", { key: configured.apiKey })).ok, true);
  await h.call("SAVE_SETTINGS", {
    settings: { ...first.settings, businessName: "Example Bakery" },
  });
  await h.call("ADD_KNOWLEDGE", {
    document: { name: "Bakery prices", text: "Our bread costs $2." },
  });
  assert.equal((await h.call("GENERATE")).ok, true);
  const request = h.requests.at(-1).body;
  assert.match(request.instructions, /Example Bakery/);
  assert.doesNotMatch(request.instructions, /Solo Director|FNB|SARS/);
  assert.ok(!JSON.stringify(request).includes(configured.apiKey));
  const state = (await h.call("GET_STATE")).value;
  assert.equal(state.hasKey, true);
  assert.ok(!JSON.stringify(state).includes(configured.apiKey));
  assert.equal(h.placements.at(-1).send, false);
  await h.call("SAVE_KEY", { key: "" });
  assert.equal((await h.call("GET_STATE")).value.hasKey, false);
});
