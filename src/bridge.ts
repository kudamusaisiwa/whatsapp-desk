import { DEFAULT_SETTINGS, type DeskState, type GeneratePayload } from "./types";
export const isExtension =
  typeof chrome !== "undefined" && !!chrome.runtime?.id;
export const tabId = Number(new URLSearchParams(location.search).get("tabId"));
const now = Date.now();
const sample: DeskState = {
  settings: { ...DEFAULT_SETTINGS },
  hasKey: false,
  models: [],
  context: {
    chatId: "demo@c.us",
    name: "Tariro M.",
    isGroup: false,
    composerEmpty: true,
    atBottom: true,
    observedAt: now,
    lastIncomingAt: now - 2.3 * 3600000,
    lastIncomingId: "demo-3",
    messages: [
      {
        id: "demo-1",
        text: "Hi! I saw your advert. Can you help me register a company?",
        direction: "in",
        at: now - 2.4 * 3600000,
      },
      {
        id: "demo-2",
        text: "Hi Tariro, absolutely. What kind of business are you starting?",
        direction: "out",
        at: now - 2.35 * 3600000,
      },
      {
        id: "demo-3",
        text: "A small catering business. What documents will I need?",
        direction: "in",
        at: now - 2.3 * 3600000,
      },
    ],
  },
  clients: {
    "demo@c.us": {
      chatId: "demo@c.us",
      name: "Tariro M.",
      stage: "New lead",
      notes: "Enquired from the company registration advert.",
      human: false,
      lastIncomingAt: now - 2.3 * 3600000,
      lastIncomingId: "demo-3",
      lastSeen: now,
    },
  },
  knowledge: [
    {
      id: "demo-services",
      name: "Services & business registration.md",
      text: "DEMONSTRATION DOCUMENT. Company registration enquiries: ask which country the business will operate in and whether the customer has a preferred business name. A human colleague confirms documents, pricing and timelines.",
      addedAt: now,
    },
    {
      id: "demo-faq",
      name: "Client questions & next steps.txt",
      text: "DEMONSTRATION DOCUMENT. Welcome new enquiries warmly. Ask one useful question at a time. Escalate financial advice, payments, pricing and commitments to a human colleague.",
      addedAt: now,
    },
  ],
  followUps: [],
  draft: null,
  activity: "",
  replyTiming: null,
  inbox: null,
  license: {
    status: "bypass",
    installationId: null,
    trialEndsAt: null,
    checkedAt: null,
  },
};
function demoState(): DeskState {
  try {
    const stored = JSON.parse(
      localStorage.getItem("whatsapp-desk-preview") ?? "null",
    );
    return stored ? { ...sample, ...stored } : structuredClone(sample);
  } catch {
    return structuredClone(sample);
  }
}
export async function rpc<T = any>(
  type: string,
  payload: Record<string, unknown> & Partial<GeneratePayload> = {},
): Promise<T> {
  if (isExtension) {
    let timer: ReturnType<typeof setTimeout> | undefined;
    let r: any;
    try {
      r = await Promise.race([
        chrome.runtime.sendMessage({ type, tabId, ...payload }),
        new Promise((_, reject) => {
          timer = setTimeout(() => reject(new Error("The assistant took too long to respond. Try again.")), type === "CALL_RECORD_START" ? 180000 : type === "CALL_RECORD_STOP" ? 75000 : type === "TRANSCRIBE_CALL" ? 75000 : type === "TRANSCRIBE_AUDIO" ? 55000 : 40000);
        }),
      ]);
    } finally { clearTimeout(timer); }
    if (!r?.ok)
      throw new Error(r?.error ?? "Could not connect. Refresh WhatsApp Web.");
    return r.value;
  }
  const s = demoState();
  if (type === "GET_STATE") return s as T;
  if (["SAVE_KEY", "LOAD_MODELS", "GENERATE", "POLISH_TEXT", "SYNC_MESSAGE", "SUMMARIZE_CALL", "TRANSCRIBE_CALL"].includes(type) || type.startsWith("CALL_RECORD_"))
    throw new Error(
      "This is the design preview. Load the extension in Chrome to connect OpenAI and draft in your real chats.",
    );
  if (type === "SAVE_SETTINGS")
    s.settings = { ...s.settings, ...(payload.settings as object) };
  if (type === "UPDATE_CLIENT") {
    const id = payload.chatId as string;
    s.clients[id] = { ...s.clients[id], ...(payload.patch as object) };
  }
  if (type === "ADD_KNOWLEDGE")
    s.knowledge.push({
      id: crypto.randomUUID(),
      ...(payload.document as any),
      addedAt: Date.now(),
    });
  if (type === "REMOVE_KNOWLEDGE")
    s.knowledge = s.knowledge.filter((d) => d.id !== payload.id);
  if (type === "ADD_FOLLOW_UP")
    s.followUps.push({
      id: crypto.randomUUID(),
      chatId: s.context!.chatId,
      name: s.context!.name,
      message: payload.message as string,
      dueAt: payload.dueAt as number,
      mode: payload.mode as any,
      status: "pending",
      createdAt: Date.now(),
    });
  if (type === "UPDATE_FOLLOW_UP") {
    const f = s.followUps.find((f) => f.id === payload.id);
    if (f) {
      f.status = payload.status as any;
      if (f.status === "pending") f.dueAt = Date.now() + 3600000;
    }
  }
  localStorage.setItem("whatsapp-desk-preview", JSON.stringify(s));
  return {} as T;
}
