import { APP_NAME } from "./product";
import {
  DEFAULT_SETTINGS,
  LEGACY_BUSINESS_INSTRUCTIONS,
  type ChatContext,
  type Client,
  type DeskState,
  type Draft,
  type FollowUp,
  type Knowledge,
  type Settings,
  type PendingReply,
  type ReplyTiming,
  type InboxState,
  type GeneratePayload,
} from "./types";
import {
  safeImageIds,
  visionInput,
  receiptReview,
  RECEIPT_SCHEMA,
  type CapturedImage,
} from "./media";
import { automationBlock, selectKnowledge } from "./core";
import {
  CALL_SUMMARY_FORMAT,
  CALL_SUMMARY_INSTRUCTIONS,
  callParticipants,
  callSpeakers,
  callSummaryInput,
  formatCallDate,
  renderCallSummary,
  whisperCallPrompt,
} from "./call-summary";
import { formatReply, removeRepeatedOpening } from "./reply";
import { replyInstructions } from "./instructions";
import {
  isDefinitiveQuestion,
  quietDelay,
  replyDelay,
  replyParts,
} from "./pacing";
import {
  assertLicenseAccess,
  getLicenseState,
  hasLicenseAccess,
  startCheckout,
} from "./license";
import { STORE_RELEASE } from "./release";
import { transcribeAudio } from "./transcription";
import {
  defaultRoutes,
  normalizeRoutes,
  invalidRouteTasks,
  providerEndpoint,
  providerHeaders,
  providerModels,
  providerRequest,
  providerText,
  routeSupports,
  PROVIDERS,
  type AiRoute,
  type AiTask,
  type ProviderId,
} from "./providers";

let writeQueue: Promise<unknown> = Promise.resolve();
function mutate<T>(fn: () => Promise<T>): Promise<T> {
  const next = writeQueue.then(fn, fn);
  writeQueue = next.catch(() => {});
  return next;
}
const ready = (async () => {
  await chrome.storage.local.setAccessLevel({
    accessLevel: "TRUSTED_CONTEXTS",
  });
  await chrome.storage.session.setAccessLevel({
    accessLevel: "TRUSTED_CONTEXTS",
  });
  const old = await chrome.storage.local.get([
    "settings",
    "knowledge",
    "apiKey",
    "providerKeys",
  ]);
  const settings = {
    ...DEFAULT_SETTINGS,
    ...((old.settings as Partial<Settings>) ?? {}),
  };
  const oldSettings = (old.settings ?? {}) as Partial<Settings> & { aiRoutes?: unknown };
  settings.aiRoutes = normalizeRoutes(oldSettings.aiRoutes, settings.model);
  if (
    old.settings &&
    typeof (old.settings as Partial<Settings>).allChats !== "boolean"
  )
    settings.allChats = true;
  if (settings.businessInstructions === LEGACY_BUSINESS_INSTRUCTIONS)
    settings.businessInstructions = DEFAULT_SETTINGS.businessInstructions;
  // The Chrome Web Store edition must keep sending human-confirmed. Drafting
  // remains available, but automatic sends are disabled for policy safety.
  if (STORE_RELEASE) settings.autoSend = false;
  await chrome.storage.local.set({
    settings,
    ...(old.apiKey && !(old.providerKeys as any)?.openai
      ? { providerKeys: { ...((old.providerKeys as Record<string, string>) ?? {}), openai: old.apiKey } }
      : {}),
  });
})();
const safeError = (e: unknown) =>
  e instanceof Error ? e.message : "Something went wrong. Please try again.";
async function boundedMessage(tabId: number, message: Record<string, unknown>, timeoutMs: number, timeoutMessage: string) {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      chrome.tabs.sendMessage(tabId, message),
      new Promise((_, reject) => { timer = setTimeout(() => reject(new Error(timeoutMessage)), timeoutMs); }),
    ]);
  } finally { clearTimeout(timer); }
}
async function data() {
  await ready;
  const d = await chrome.storage.local.get([
    "settings",
    "knowledge",
    "clients",
    "followUps",
    "models",
    "apiKey",
    "ledger",
    "providerKeys",
    "providerModels",
  ]);
  const settings = d.settings as Settings & { aiRoutes?: unknown };
  const aiRoutes = normalizeRoutes(settings.aiRoutes, settings.model);
  const providerKeys = { ...((d.providerKeys ?? {}) as Partial<Record<ProviderId, string>>) };
  if (d.apiKey && !providerKeys.openai) providerKeys.openai = d.apiKey as string;
  const selectedProvider = aiRoutes.text.provider;
  return {
    settings: { ...settings, aiRoutes } as Settings,
    knowledge: (d.knowledge ?? []) as Knowledge[],
    clients: (d.clients ?? {}) as Record<string, Client>,
    followUps: (d.followUps ?? []) as FollowUp[],
    models: ((d.providerModels as any)?.[selectedProvider] ?? d.models ?? []) as string[],
    apiKey: (d.apiKey ?? "") as string,
    providerKeys,
    providerModels: (d.providerModels ?? {}) as Partial<Record<ProviderId, string[]>>,
    ledger: (d.ledger ?? {}) as Record<string, { status: string; at: number }>,
  };
}
function taskRoute(d: Awaited<ReturnType<typeof data>>, task: AiTask): AiRoute {
  return (d.settings as Settings & { aiRoutes?: Record<AiTask, AiRoute> }).aiRoutes![task];
}
function taskKey(d: Awaited<ReturnType<typeof data>>, task: AiTask): string {
  return d.providerKeys[taskRoute(d, task).provider] ?? "";
}
function requireTaskKey(d: Awaited<ReturnType<typeof data>>, task: AiTask): AiRoute {
  const route = taskRoute(d, task);
  if (!routeSupports(route, task)) throw new Error(`The selected ${PROVIDERS.find((p) => p.id === route.provider)?.label} model does not support this task. Choose another model in Settings.`);
  if (!taskKey(d, task)) throw new Error(`Add a ${PROVIDERS.find((p) => p.id === route.provider)?.label} API key in Settings to use ${task === "text" ? "the assistant" : task === "vision" ? "picture replies" : task === "polish" ? "text polishing" : task === "summary" ? "call summaries" : task === "stt" ? "voice input" : "call transcription"}.`);
  return route;
}
async function requestAI(task: AiTask, body: unknown, dataSnapshot?: Awaited<ReturnType<typeof data>>): Promise<string> {
  const d = dataSnapshot ?? await data();
  const route = requireTaskKey(d, task);
  const endpoint = providerEndpoint(route.provider, route.model);
  const requestBody = providerRequest(route.provider, route.model, body, task);
  let response: Response;
  try {
    response = await fetch(endpoint.url, {
      method: "POST",
      headers: providerHeaders(route.provider, taskKey(d, task)),
      body: JSON.stringify(requestBody),
      signal: AbortSignal.timeout(25000),
    });
  } catch (e) {
    throw new Error(e instanceof Error && e.name === "TimeoutError"
      ? `${PROVIDERS.find((p) => p.id === route.provider)?.label} took too long. Try again or choose a faster model.`
      : `${PROVIDERS.find((p) => p.id === route.provider)?.label} could not be reached. Check your connection and try again.`);
  }
  if (!response.ok) {
    const label = PROVIDERS.find((p) => p.id === route.provider)?.label ?? route.provider;
    const messages: Record<number, string> = {
      400: `This ${label} model could not process the request. Check that it supports the selected task and choose another model in Settings.`,
      401: `The ${label} key was not accepted. Check the key in Settings.`,
      403: `This ${label} account does not have access to the selected model.`,
      404: `The selected ${label} model is unavailable. Refresh the model list in Settings.`,
      429: `${label} usage or rate limit reached. Check billing or try again shortly.`,
    };
    throw new Error(messages[response.status] ?? `${label} is temporarily unavailable (${response.status}). Try again shortly.`);
  }
  let result: any;
  try { result = await response.json(); }
  catch { throw new Error(`${PROVIDERS.find((p) => p.id === route.provider)?.label} returned an invalid response. Try again.`); }
  return providerText(route.provider, result);
}
const sessionKey = (tabId: number) => `context:${tabId}`;
async function contextFor(tabId: number): Promise<ChatContext | null> {
  const s = await chrome.storage.session.get(sessionKey(tabId));
  return (s[sessionKey(tabId)] as ChatContext) ?? null;
}
async function setActivity(
  tabId: number,
  activity: string,
  timing: ReplyTiming | null = null,
) {
  await chrome.storage.session.set({
    [`activity:${tabId}`]: activity,
    [`replyTiming:${tabId}`]: timing,
  });
}
async function freshContext(tabId: number): Promise<ChatContext | null> {
  try {
    const r = await chrome.tabs.sendMessage(tabId, { type: "READ_CONTEXT" });
    return r?.ok ? r.context : null;
  } catch {
    return null;
  }
}
const replyAlarm = (tabId: number) => `whatsapp-reply:${tabId}`;
const replyTimers = new Map<number, ReturnType<typeof setTimeout>>();
function clearReplyTimer(tabId: number) {
  clearTimeout(replyTimers.get(tabId));
  replyTimers.delete(tabId);
}
async function armReply(job: PendingReply) {
  clearReplyTimer(job.tabId);
  // Alarms are the durable fallback. A short timer handles waits below the
  // packaged Chrome alarm minimum while the worker is still awake.
  await chrome.alarms.create(replyAlarm(job.tabId), { when: job.dueAt });
  const remaining = job.dueAt - Date.now();
  if (remaining < 30000) {
    const timer = setTimeout(
      () => {
        if (replyTimers.get(job.tabId) !== timer) return;
        replyTimers.delete(job.tabId);
        void runPending(job.tabId).catch((e) =>
          setActivity(job.tabId, safeError(e)),
        );
      },
      Math.max(0, remaining),
    );
    replyTimers.set(job.tabId, timer);
  }
}
function incomingText(context: ChatContext): string {
  return (
    context.messages.find((m) => m.id === context.lastIncomingId)?.text ?? ""
  );
}
async function pendingReplies(): Promise<Record<string, PendingReply>> {
  return (
    ((await chrome.storage.session.get("pendingReplies"))
      .pendingReplies as Record<string, PendingReply>) ?? {}
  );
}
async function cancelPending(tabId: number, expected?: PendingReply) {
  await mutate(async () => {
    const jobs = await pendingReplies();
    if (
      expected &&
      (jobs[tabId]?.incomingId !== expected.incomingId ||
        jobs[tabId]?.dueAt !== expected.dueAt)
    )
      return;
    const existed = !!jobs[tabId];
    clearReplyTimer(tabId);
    delete jobs[tabId];
    await chrome.storage.session.set({ pendingReplies: jobs });
    await chrome.alarms.clear(replyAlarm(tabId));
    if (existed) await setActivity(tabId, "Automatic reply paused.");
  });
}
async function queueReply(context: ChatContext, tabId: number) {
  const text = incomingText(context);
  const delay = quietDelay(text);
  await mutate(async () => {
    const jobs = await pendingReplies();
    jobs[tabId] = {
      tabId,
      chatId: context.chatId,
      incomingId: context.lastIncomingId!,
      dueAt: Date.now() + delay,
      outgoingIds: context.messages
        .filter((m) => m.direction === "out")
        .map((m) => m.id),
    };
    await chrome.storage.session.set({ pendingReplies: jobs });
    await armReply(jobs[tabId]);
  });
  await setActivity(
    tabId,
    isDefinitiveQuestion(text)
      ? "Clear question · waiting 8–12 seconds for any additions…"
      : "Waiting 30–45 seconds after the customer’s last message…",
  );
}
async function runPending(tabId: number) {
  const job = (await pendingReplies())[tabId];
  if (!job) return;
  if (!hasLicenseAccess(await getLicenseState())) {
    await cancelPending(tabId, job);
    return;
  }
  if (Date.now() - job.dueAt > 120000) {
    await cancelPending(tabId, job);
    return;
  }
  if (Date.now() < job.dueAt) {
    await armReply(job);
    return;
  }
  const ctx = await freshContext(tabId),
    d = await data();
  if (
    !ctx ||
    ctx.chatId !== job.chatId ||
    ctx.lastIncomingId !== job.incomingId ||
    !d.settings.autoDraft ||
    (d.settings.allChats && d.settings.autoSend) ||
    automationBlock(ctx, d.clients[job.chatId]?.human ?? false) ||
    ctx.messages.some(
      (m) => m.direction === "out" && !job.outgoingIds.includes(m.id),
    )
  ) {
    await cancelPending(tabId, job);
    return;
  }
  const claimed = await mutate(async () => {
    const jobs = await pendingReplies(),
      latest = jobs[tabId],
      x = await data();
    if (
      !latest ||
      latest.incomingId !== job.incomingId ||
      latest.dueAt !== job.dueAt
    )
      return false;
    delete jobs[tabId];
    clearReplyTimer(tabId);
    await chrome.alarms.clear(replyAlarm(tabId));
    await chrome.storage.session.set({ pendingReplies: jobs });
    const key = `incoming:${job.chatId}:${job.incomingId}`;
    if (x.ledger[key]) return false;
    x.ledger = Object.fromEntries(
      Object.entries(x.ledger)
        .filter(([, v]) => Date.now() - v.at < 7 * 86400000)
        .slice(-1000),
    );
    x.ledger[key] = { status: "claimed", at: Date.now() };
    await chrome.storage.local.set({ ledger: x.ledger });
    return true;
  });
  if (!claimed) return;
  try {
    await generate(tabId, true, job.incomingId);
  } catch (e) {
    if (!(await pendingReplies())[tabId])
      await setActivity(tabId, safeError(e));
  }
}
async function waitToSend(
  tabId: number,
  original: ChatContext,
  text: string,
  automatic: boolean,
  allowedOutgoing: Set<string>,
  inboxToken?: string,
) {
  const duration = replyDelay(
      text,
      Math.random,
      isDefinitiveQuestion(incomingText(original)),
    ),
    due = Date.now() + duration;
  await setActivity(tabId, "Preparing the reply…", {
    chatId: original.chatId,
    incomingId: original.lastIncomingId,
    dueAt: due,
    phase: "send",
  });
  do {
    if (inboxToken) await assertInboxControl(tabId, inboxToken);
    const current = await freshContext(tabId),
      d = await data();
    if (
      !current ||
      current.chatId !== original.chatId ||
      current.lastIncomingId !== original.lastIncomingId ||
      !d.settings.autoSend ||
      (automatic && !d.settings.autoDraft) ||
      automationBlock(current, d.clients[original.chatId]?.human ?? false) ||
      current.messages.some(
        (m) => m.direction === "out" && !allowedOutgoing.has(m.id),
      )
    )
      throw new Error(
        "The conversation or reply controls changed. Automatic sending paused.",
      );
    if (Date.now() >= due) return;
    await new Promise((resolve) =>
      setTimeout(resolve, Math.min(1000, due - Date.now())),
    );
  } while (true);
}
const POLISH_STYLES = ["professional", "shorten", "clarify", "summarize"] as const;
type PolishStyle = (typeof POLISH_STYLES)[number];
const POLISH_GUIDANCE: Record<PolishStyle, string> = {
  professional: "Make the wording polished, courteous and professional while retaining the original level of detail.",
  shorten: "Make the wording more concise while retaining all material information and the original intent.",
  clarify: "Make the wording clearer and easier to understand without adding explanations or facts.",
  summarize: "Summarize the supplied text faithfully, preserving its key points and any questions or requests.",
};
const CALL_TRANSCRIPT_MAX_CHARS = 100_000;
const CALL_TRANSCRIPTION_AUDIO_MAX_BYTES = 20 * 1024 * 1024;
const MAX_DICTATION_AUDIO_BYTES = 10 * 1024 * 1024;
async function summarizeCall(
  text: string,
  meta: { name?: unknown; startedAt?: unknown; speakers?: unknown },
): Promise<{ text: string }> {
  if (!text.trim() || text.length > CALL_TRANSCRIPT_MAX_CHARS)
    throw new Error("The call transcript must contain 1 to 100,000 characters.");
  const d = await data();
  requireTaskKey(d, "summary");
  const participants = callParticipants({
    businessName: d.settings.businessName,
    customerName: meta.name,
  });
  const speakers = callSpeakers(meta.speakers);
  const response = await requestAI("summary", {
    model: d.settings.model,
    store: false,
    instructions: CALL_SUMMARY_INSTRUCTIONS,
    input: [
      {
        role: "user",
        content: [
          { type: "input_text", text: callSummaryInput(text, participants, speakers) },
        ],
      },
    ],
    max_output_tokens: 4000,
    text: { format: CALL_SUMMARY_FORMAT },
  }, d);
  let raw: unknown;
  try { raw = JSON.parse(response); }
  catch { throw new Error("The selected model returned an invalid call summary. Try again."); }
  return {
    text: renderCallSummary(
      raw,
      participants,
      formatCallDate(meta.startedAt, d.settings.dateOrder),
      speakers,
    ),
  };
}
async function polishText(text: string, style: PolishStyle): Promise<{ text: string }> {
  if (!text.trim() || text.length > 5000)
    throw new Error("Enter text with 1 to 5,000 characters to polish.");
  if (!POLISH_STYLES.includes(style)) throw new Error("Choose a valid polish style.");
  const d = await data();
  requireTaskKey(d, "polish");
  const response = await requestAI("polish", {
    model: d.settings.model,
    store: false,
    instructions: `You edit only the operator-provided text. ${POLISH_GUIDANCE[style]} Preserve meaning and every stated fact, amount, name, date, commitment, question, request and negation. Do not invent or imply services, legal, tax, payment, approval or business claims. Do not answer the text or add context. Return only the edited text in the required JSON object.`,
    input: [{ role: "user", content: [{ type: "input_text", text }] }],
    max_output_tokens: 6000,
    text: { format: { type: "json_schema", name: "polished_text", strict: true, schema: { type: "object", properties: { text: { type: "string" } }, required: ["text"], additionalProperties: false } } },
  }, d);
  let result: unknown;
  try { result = JSON.parse(response).text; }
  catch { throw new Error("The selected model returned an invalid text edit. Try again."); }
  if (typeof result !== "string" || !result.trim() || result.length > 5000)
    throw new Error("The selected model returned text outside the 5,000 character limit. Try again.");
  return { text: result };
}
interface CallCaptureSession {
  sessionId: string;
  chatId: string;
  name: string;
  startedAt: number;
  createdAt?: number;
  phase: "choosing" | "recording";
  durationMs?: number;
  bytes?: number;
  hasMicrophone?: boolean;
  hasCallAudio?: boolean;
}
const callCaptureKey = (tabId: number) => `callCapture:${tabId}`;
async function readCallCapture(tabId: number): Promise<CallCaptureSession | null> {
  const result = await chrome.storage.session.get(callCaptureKey(tabId));
  return (result[callCaptureKey(tabId)] as CallCaptureSession | undefined) ?? null;
}
async function removeCallCapture(tabId: number, sessionId: string) {
  await mutate(async () => {
    const current = await readCallCapture(tabId);
    if (current?.sessionId === sessionId)
      await chrome.storage.session.remove(callCaptureKey(tabId));
  });
}
async function releaseStaleCallCapture(tabId: number, existing: CallCaptureSession) {
  if (existing.phase === "choosing") {
    const age = Date.now() - (existing.createdAt ?? existing.startedAt);
    if (age < 150_000)
      throw new Error("A call recording picker is already open for this WhatsApp tab.");
  } else {
    let status: any;
    try {
      status = await boundedMessage(
        tabId,
        { type: "CALL_RECORD_STATUS", sessionId: existing.sessionId },
        8000,
        "The call recorder did not respond while checking its session.",
      );
    } catch {
      // A reloaded content script has no in-memory session; a later START is
      // still protected by the content recorder's active-session check.
      status = null;
    }
    const currentStatus = status?.ok ? status.value : null;
    const hasMatchingRecorder =
      currentStatus?.sessionId === existing.sessionId &&
      ["requesting", "recording", "stopping"].includes(currentStatus.phase);
    if (hasMatchingRecorder)
      throw new Error("A call recording is already active in this WhatsApp tab.");
  }
  await mutate(async () => {
    const latest = await readCallCapture(tabId);
    if (latest?.sessionId === existing.sessionId)
      await chrome.storage.session.remove(callCaptureKey(tabId));
  });
}
async function chooseCallCapture(targetTab: chrome.tabs.Tab): Promise<string> {
  let requestId: number | undefined;
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      if (requestId !== undefined)
        chrome.desktopCapture.cancelChooseDesktopMedia(requestId);
      reject(new Error("The call capture picker timed out. Start recording again."));
    }, 120_000);
    try {
      requestId = chrome.desktopCapture.chooseDesktopMedia(
        ["tab", "audio"],
        targetTab,
        (streamId, options) => {
          clearTimeout(timeout);
          if (!streamId) {
            reject(new Error("Call recording was cancelled in the capture picker."));
            return;
          }
          if (!options?.canRequestAudioTrack) {
            reject(new Error("Select a tab and enable Share audio to record both sides of the call."));
            return;
          }
          resolve(streamId);
        },
      );
    } catch (error) {
      clearTimeout(timeout);
      reject(error);
    }
  });
}
async function startCallCapture(tabId: number, chatId: unknown) {
  if (typeof chatId !== "string" || !chatId || chatId.length > 150)
    throw new Error("Open the WhatsApp conversation for the call first.");
  const context = await freshContext(tabId);
  if (!context || context.chatId !== chatId)
    throw new Error("The selected WhatsApp conversation changed. Select it again before recording.");
  const targetTab = await chrome.tabs.get(tabId);
  if (!targetTab.url?.startsWith("https://web.whatsapp.com/"))
    throw new Error("Open this call in a secure WhatsApp Web tab before recording.");
  const session: CallCaptureSession = {
    sessionId: crypto.randomUUID(),
    chatId,
    name: context.name.slice(0, 150),
    startedAt: Date.now(),
    createdAt: Date.now(),
    phase: "choosing",
  };
  const existing = await readCallCapture(tabId);
  if (existing) await releaseStaleCallCapture(tabId, existing);
  await mutate(async () => {
    if (await readCallCapture(tabId))
      throw new Error("A call recording is already active in this WhatsApp tab.");
    await chrome.storage.session.set({ [callCaptureKey(tabId)]: session });
  });
  let startAttempted = false;
  try {
    const streamId = await chooseCallCapture(targetTab);
    startAttempted = true;
    const result = await boundedMessage(
      tabId,
      {
        type: "CALL_RECORD_START",
        sessionId: session.sessionId,
        streamId,
        chatId: session.chatId,
        name: session.name,
      },
      30000,
      "Call recording did not start. Check WhatsApp and try again.",
    );
    if (!result?.ok) throw new Error(result?.error ?? "Call recording could not start.");
    const status = result.value;
    if (
      status?.phase !== "recording" ||
      status.hasCallAudio !== true ||
      status.hasMicrophone !== true ||
      typeof status.startedAt !== "number"
    )
      throw new Error("Both WhatsApp call audio and microphone audio must be active before recording.");
    session.phase = "recording";
    session.startedAt = status.startedAt;
    session.durationMs = status.durationMs;
    session.bytes = status.bytes;
    session.hasCallAudio = status.hasCallAudio;
    session.hasMicrophone = status.hasMicrophone;
    await chrome.storage.session.set({ [callCaptureKey(tabId)]: session });
    return {
      sessionId: session.sessionId,
      chatId: session.chatId,
      name: session.name,
      startedAt: status.startedAt,
      durationMs: status.durationMs,
      bytes: status.bytes,
      hasCallAudio: status.hasCallAudio,
      hasMicrophone: status.hasMicrophone,
      phase: status.phase,
    };
  } catch (error) {
    if (startAttempted)
      await chrome.tabs.sendMessage(tabId, {
        type: "CALL_RECORD_CANCEL",
        sessionId: session.sessionId,
      }).catch(() => {});
    await removeCallCapture(tabId, session.sessionId);
    throw error;
  }
}
async function relayCallCapture(tabId: number, type: "CALL_RECORD_STATUS" | "CALL_RECORD_STOP" | "CALL_RECORD_CANCEL", sessionId: unknown) {
  if (typeof sessionId !== "string" || !sessionId)
    throw new Error("The call recording session is invalid.");
  const session = await readCallCapture(tabId);
  if (!session || session.sessionId !== sessionId)
    throw new Error("This call recording session has ended. Start a new recording.");
  const result = await boundedMessage(
    tabId,
    { type, sessionId },
    type === "CALL_RECORD_STOP" ? 60000 : 8000,
    type === "CALL_RECORD_STOP"
      ? "Call recording did not finish in time. Check WhatsApp before retrying."
      : "The call recorder did not respond. Refresh WhatsApp and try again.",
  );
  if (!result?.ok) throw new Error(result?.error ?? "The call recording action could not be completed.");
  if (type === "CALL_RECORD_STOP" || type === "CALL_RECORD_CANCEL")
    await removeCallCapture(tabId, sessionId);
  const value = result.value ?? result;
  if (type === "CALL_RECORD_STOP")
    return {
      ...value,
      startedAt: session.startedAt,
      hasCallAudio: session.hasCallAudio === true,
      hasMicrophone: session.hasMicrophone === true,
      phase: "stopped",
    };
  return value;
}
interface InboxLease {
  tabId: number;
  at: number;
  busyUntil: number;
}
const activeGenerations = new Set<number>();
const activePanelGenerations = new Set<string>();
const contextEpochByTab = new Map<number, number>();
async function assertInboxControl(tabId: number, token: string) {
  const d = await data();
  const lease = (await chrome.storage.session.get("inboxLease")).inboxLease as
    InboxLease | undefined;
  const control = await chrome.tabs.sendMessage(tabId, {
    type: "INBOX_CONTROL",
    token,
  });
  if (
    !d.settings.allChats ||
    !d.settings.autoDraft ||
    !d.settings.autoSend ||
    lease?.tabId !== tabId ||
    !control?.ok ||
    !control.allowed
  )
    throw new Error("Inbox reply paused for a human or changed controls.");
}
async function saveDraft(tabId: number, draft: Draft) {
  await mutate(async () => {
    const s = await chrome.storage.session.get("chatDrafts");
    const drafts = (s.chatDrafts ?? {}) as Record<string, Draft>;
    drafts[draft.chatId] = draft;
    const recent = Object.fromEntries(
      Object.entries(drafts)
        .sort((a, b) => b[1].createdAt - a[1].createdAt)
        .slice(0, 100),
    );
    await chrome.storage.session.set({
      [`draft:${tabId}`]: draft,
      chatDrafts: recent,
    });
  });
}
async function savePanelDraft(tabId: number, draft: Draft) {
  // Manual assistance is ephemeral panel state. It must not become a chat draft.
  await chrome.storage.session.set({ [`draft:${tabId}`]: draft });
}
async function generate(
  tabId: number,
  automatic = false,
  expectedIncomingId?: string,
  inboxToken?: string,
  manual: GeneratePayload = {},
): Promise<Draft> {
  const panelKey = `${tabId}:${contextEpochByTab.get(tabId) ?? 0}`;
  const isPanel = manual.assistOnly === true;
  if (isPanel) {
    if (activePanelGenerations.has(panelKey))
      throw new Error("A reply is already being prepared. Please wait.");
    activePanelGenerations.add(panelKey);
  } else {
    if (activeGenerations.has(tabId))
      throw new Error("A reply is already being prepared. Please wait.");
    activeGenerations.add(tabId);
  }
  try {
    return await generateReply(
      tabId,
      automatic,
      expectedIncomingId,
      inboxToken,
      manual,
    );
  } finally {
    if (isPanel) activePanelGenerations.delete(panelKey);
    else activeGenerations.delete(tabId);
  }
}
async function generateReply(
  tabId: number,
  automatic = false,
  expectedIncomingId?: string,
  inboxToken?: string,
  manual: GeneratePayload = {},
): Promise<Draft> {
  if (inboxToken) await assertInboxControl(tabId, inboxToken);
  const startContextEpoch = contextEpochByTab.get(tabId) ?? 0;
  const observedContext = await freshContext(tabId);
  if (manual.assistOnly === true && Object.hasOwn(manual, "expectedChatId") &&
      (observedContext?.chatId ?? null) !== manual.expectedChatId)
    throw new Error("The WhatsApp customer changed. Enter your instruction again for the selected customer.");
  const d = await data();
  const instruction =
    typeof manual.instruction === "string"
      ? manual.instruction.trim().slice(0, 5000)
      : "";
  if (manual.instruction !== undefined && typeof manual.instruction !== "string")
    throw new Error("Enter a text instruction for manual assistance.");
  if (typeof manual.instruction === "string" && manual.instruction.length > 5000)
    throw new Error("Manual instructions must be 5,000 characters or fewer.");
  const assistOnly = manual.assistOnly === true;
  const manualTask =
    instruction ||
    (assistOnly
      ? observedContext?.messages.length
        ? "Suggest a helpful reply to this conversation."
        : "What can you help me with using the approved business information?"
      : "Draft a helpful reply to the current conversation.");
  const context: ChatContext = observedContext ?? {
    chatId: "",
    name: "General assistance",
    isGroup: false,
    messages: [],
    lastIncomingAt: null,
    lastIncomingId: null,
    composerEmpty: true,
    atBottom: true,
    observedAt: Date.now(),
  };
  if (!assistOnly && (!context.chatId || !context.messages.length))
    throw new Error("Open a client conversation with visible messages first.");
  if (expectedIncomingId && context.lastIncomingId !== expectedIncomingId)
    throw new Error(
      "The customer is still adding messages. Waiting for the latest message.",
    );
  const allowedOutgoing = new Set(
    context.messages.filter((m) => m.direction === "out").map((m) => m.id),
  );
  if (!assistOnly && automatic && context.isGroup)
    throw new Error(
      "Choose an individual client conversation. Group replies are not supported.",
    );
  if (automatic && !d.knowledge.length)
    throw new Error(
      "Add your business knowledge first so replies use your information.",
    );
  if (automatic) {
    const reason = automationBlock(
      context,
      d.clients[context.chatId]?.human ?? false,
    );
    if (reason) throw new Error(reason);
  }
  if (automatic && !context.composerEmpty)
    throw new Error(
      "Your chat box already contains a message. Send or clear it before drafting.",
    );
  await setActivity(tabId, "Reading the conversation and business knowledge…");
  const chunks = selectKnowledge(
    d.knowledge,
    context.messages
      .slice(-5)
      .map((m) => m.text)
      .concat(manualTask ? [manualTask] : [])
      .join("\n"),
  );
  let captured: CapturedImage[] = [];
  if (context.messages.slice(-35).some((m) => m.images?.length)) {
    await setActivity(
      tabId,
      "Reading pictures, screenshots and business knowledge…",
    );
    const media = await chrome.tabs.sendMessage(tabId, {
      type: "READ_IMAGES",
      chatId: context.chatId,
      incomingId: context.lastIncomingId,
    });
    if (
      !media?.ok ||
      media.chatId !== context.chatId ||
      media.incomingId !== context.lastIncomingId ||
      !Array.isArray(media.images)
    )
      throw new Error(
        media?.error ??
          "The pictures could not be read. Refresh WhatsApp Web and draft again.",
      );
    captured = media.images;
  }
  const vision = visionInput(
    context.messages,
    chunks.map((c) => ({
      documentId: c.id,
      title: c.name,
      text: c.text,
    })),
    captured,
  );
  const task = vision.hasImages ? "vision" : "text";
  requireTaskKey(d, task);
  const response = await requestAI(task, {
    store: false,
    instructions: replyInstructions(d.settings, automatic ? "" : manualTask, assistOnly),
    input: vision.input,
    max_output_tokens: 2500,
    text: {
      format: {
        type: "json_schema",
        name: "client_reply",
        strict: true,
        schema: {
          type: "object",
          properties: {
            reply: { type: "string" },
            needsHuman: { type: "boolean" },
            reason: { type: "string" },
            sources: { type: "array", items: { type: "string" } },
            ...(vision.hasImages
              ? {
                  receipt: RECEIPT_SCHEMA,
                  imageReview: {
                    type: "string",
                    enum: ["picture", "payment_proof", "unclear"],
                  },
                }
              : {}),
          },
          required: [
            "reply",
            "needsHuman",
            "reason",
            "sources",
            ...(vision.hasImages ? ["imageReview", "receipt"] : []),
          ],
          additionalProperties: false,
        },
      },
    },
  }, d);
  let output: any;
  try {
    output = JSON.parse(response);
  } catch {
    throw new Error(
      "The model did not return a complete reply. Try again or choose another model.",
    );
  }
  if (
    typeof output.reply !== "string" ||
    !output.reply.trim() ||
    output.reply.length > 8000 ||
    typeof output.needsHuman !== "boolean" ||
    (vision.hasImages &&
      !["picture", "payment_proof", "unclear"].includes(output.imageReview))
  )
    throw new Error("The model returned an invalid reply. Please try again.");
  const receiptReason = receiptReview(output.imageReview, output.receipt);
  const draft: Draft = {
    reply: assistOnly
      ? output.reply.trim()
      : formatReply(
          removeRepeatedOpening(
            output.reply,
            context.messages.some((m) => m.direction === "out"),
            d.settings.businessName,
          ),
        ),
    needsHuman:
      output.needsHuman ||
      vision.missingIncoming ||
      output.imageReview === "unclear" ||
      !!receiptReason,
    reason: vision.missingIncoming
      ? "An incoming picture is unavailable or exceeds the image limit. Open/download it in WhatsApp and draft again, or review the reply."
      : output.imageReview === "unclear"
        ? "The image has unclear or conflicting details. Review the reply before sending."
        : receiptReason || String(output.reason ?? "").slice(0, 600),
    sources: (Array.isArray(output.sources) ? output.sources : []).filter(
      (id: string) => d.knowledge.some((k) => k.id === id),
    ),
    chatId: context.chatId,
    incomingId: context.lastIncomingId,
    createdAt: Date.now(),
  };
  if (!draft.reply.trim())
    throw new Error(
      "The model repeated a greeting without answering. Please draft again.",
    );
  const current = assistOnly ? null : await freshContext(tabId);
  const conversationStillMatches =
    !!current &&
    current.chatId === context.chatId &&
    current.lastIncomingId === context.lastIncomingId &&
    !current.messages.some(
      (m) => m.direction === "out" && !allowedOutgoing.has(m.id),
    );
  if (automatic && !conversationStillMatches)
    throw new Error(
      "The conversation changed while drafting. Generate a fresh reply.",
    );
  const latest = await data();
  if (
    automatic &&
    (!latest.settings.autoDraft || latest.clients[current!.chatId]?.human)
  )
    throw new Error("Automatic drafting paused. A human can draft when ready.");
  const panelOnly =
    assistOnly ||
    !conversationStillMatches ||
    !current ||
    !context.chatId ||
    current.isGroup ||
    !current.composerEmpty ||
    !current.atBottom ||
    !current.lastIncomingId ||
    !current.lastIncomingAt ||
    Date.now() - current.lastIncomingAt >= 24 * 60 * 60 * 1000 ||
    !!latest.clients[context.chatId]?.human;
  if (panelOnly) {
    draft.contextName = observedContext?.name ?? "General assistance";
    draft.placement = "Suggestion kept in Desk for review";
    draft.placementReason = "panel-only";
    if (assistOnly) {
      const latestContext = await freshContext(tabId);
      if ((contextEpochByTab.get(tabId) ?? 0) !== startContextEpoch ||
          (Object.hasOwn(manual, "expectedChatId") && (latestContext?.chatId ?? null) !== manual.expectedChatId))
        throw new Error("The WhatsApp customer changed. Enter your instruction again for the selected customer.");
      return draft;
    }
    await savePanelDraft(tabId, draft);
    await setActivity(tabId, draft.placement);
    return draft;
  }
  const send =
    automatic &&
    latest.settings.autoSend &&
    !draft.needsHuman &&
    !!current &&
    !automationBlock(
      current,
      latest.clients[current.chatId]?.human ?? false,
    );
  const fullReply = draft.reply;
  const parts = send ? replyParts(fullReply) : [fullReply];
  draft.contextName = current?.name ?? context.name;
  draft.placementReason = send ? "automatic-send" : "chat-draft";
  await saveDraft(tabId, draft);
  for (let i = 0; i < parts.length; i++) {
    if (send)
      await waitToSend(
        tabId,
        context,
        parts[i],
        automatic,
        allowedOutgoing,
        inboxToken,
      );
    if (inboxToken) await assertInboxControl(tabId, inboxToken);
    const result = await chrome.tabs.sendMessage(tabId, {
      type: "PLACE_DRAFT",
      chatId: context.chatId,
      incomingId: context.lastIncomingId,
      text: parts[i],
      send,
      sendToken: `reply:${context.chatId}:${context.lastIncomingId}:part:${i + 1}`,
      ...(inboxToken ? { inboxToken } : {}),
    });
    if (!result?.ok)
      throw new Error(
        result?.error ??
          "Could not place the reply in WhatsApp. Refresh WhatsApp Web and try again.",
      );
    if (send && i < parts.length - 1) {
      draft.reply = parts.slice(i + 1).join("\n\n");
      draft.placement = "First message sent · remaining reply waiting";
      await saveDraft(tabId, draft);
      if (!result.sentMessageId)
        throw new Error(
          "First message sent. Check WhatsApp before placing the remaining reply.",
        );
      allowedOutgoing.add(result.sentMessageId);
    }
  }
  draft.reply = fullReply;
  draft.placement = send
    ? parts.length === 2
      ? "Sent automatically · 2 messages"
      : "Sent automatically"
    : draft.needsHuman
      ? "In chat · human review needed"
      : "In chat · ready for your review";
  draft.placementReason = send ? "automatic-send" : "chat-draft";
  await saveDraft(tabId, draft);
  await setActivity(tabId, draft.placement);
  return draft;
}
async function recordContext(raw: ChatContext | null, tabId: number) {
  const prev = await contextFor(tabId);
  const known = raw?.chatId ? (await data()).clients[raw.chatId] : null;
  let c: ChatContext | null = null;
  if (
    raw &&
    typeof raw.chatId === "string" &&
    raw.chatId.length < 150 &&
    Array.isArray(raw.messages)
  ) {
    c = {
      chatId: raw.chatId,
      name: String(raw.name).slice(0, 150),
      isGroup: !!raw.isGroup,
      messages: raw.messages.slice(-40).map((m) => ({
        id: String(m.id).slice(0, 300),
        text: String(m.text).slice(0, 5000),
        direction: m.direction === "out" ? "out" : "in",
        ...(safeImageIds(m.images, String(m.id).slice(0, 300)).length
          ? { images: safeImageIds(m.images, String(m.id).slice(0, 300)) }
          : {}),
        at: typeof m.at === "number" ? m.at : null,
      })),
      lastIncomingAt:
        typeof raw.lastIncomingAt === "number" &&
        raw.lastIncomingAt <= Date.now() + 60000
          ? raw.lastIncomingAt
          : null,
      lastIncomingId: raw.lastIncomingId
        ? String(raw.lastIncomingId).slice(0, 300)
        : null,
      composerEmpty: !!raw.composerEmpty,
      atBottom: !!raw.atBottom,
      observedAt: Date.now(),
    };
  }
  if ((prev?.chatId ?? null) !== (c?.chatId ?? null)) {
    contextEpochByTab.set(tabId, (contextEpochByTab.get(tabId) ?? 0) + 1);
    await chrome.storage.session.remove(`draft:${tabId}`);
    await setActivity(tabId, "");
  }
  await chrome.storage.session.set({ [sessionKey(tabId)]: c });
  if (!c) {
    await cancelPending(tabId);
    return;
  }
  const context = c;
  const pending = (await pendingReplies())[tabId];
  if (
    pending &&
    (context.chatId !== pending.chatId ||
      !context.composerEmpty ||
      !context.atBottom ||
      context.messages.some(
        (m) => m.direction === "out" && !pending.outgoingIds.includes(m.id),
      ))
  )
    await cancelPending(tabId);
  await mutate(async () => {
    const d = await data();
    const old = d.clients[context.chatId];
    const newer =
      !!context.lastIncomingAt &&
      (!old?.lastIncomingAt ||
        context.lastIncomingAt > old.lastIncomingAt ||
        (context.lastIncomingAt === old.lastIncomingAt && context.atBottom));
    d.clients[context.chatId] = {
      chatId: context.chatId,
      name: context.name,
      stage: old?.stage ?? "New lead",
      notes: old?.notes ?? "",
      human: old?.human ?? false,
      lastIncomingAt: newer
        ? context.lastIncomingAt
        : (old?.lastIncomingAt ?? null),
      lastIncomingId: newer
        ? context.lastIncomingId
        : (old?.lastIncomingId ?? null),
      lastSeen: Date.now(),
      messageIds: [
        ...new Set([
          ...(old?.messageIds ?? []),
          ...context.messages.map((m) => m.id),
        ]),
      ].slice(-200),
    };
    await chrome.storage.local.set({ clients: d.clients });
  });
  // A recent unanswered first message is eligible even without a previous
  // incoming bubble. Old history, answered messages and claimed replies are not.
  const recent =
    !!context.lastIncomingAt && Date.now() - context.lastIncomingAt < 120000;
  const firstObservation =
    prev?.chatId !== context.chatId || !prev.lastIncomingId;
  const newIncoming =
    prev?.chatId === context.chatId &&
    !!prev.lastIncomingId &&
    prev.lastIncomingId !== context.lastIncomingId &&
    context.lastIncomingId !== known?.lastIncomingId &&
    !!prev.lastIncomingAt &&
    context.lastIncomingAt! >= prev.lastIncomingAt &&
    context.lastIncomingAt! >= (known?.lastIncomingAt ?? 0);
  if (
    !context.lastIncomingId ||
    !recent ||
    context.messages.at(-1)?.direction !== "in" ||
    (!firstObservation && !newIncoming)
  )
    return;
  const d = await data();
  if (
    !d.settings.autoDraft ||
    (d.settings.allChats && d.settings.autoSend) ||
    !!d.ledger[`incoming:${context.chatId}:${context.lastIncomingId}`] ||
    !!d.ledger[
      `send:reply:${context.chatId}:${context.lastIncomingId}:part:1`
    ] ||
    !taskKey(d, "text") ||
    !d.knowledge.length ||
    automationBlock(context, d.clients[context.chatId]?.human ?? false)
  )
    return;
  await queueReply(context, tabId);
}
async function ensureAlarm() {
  if (!(await chrome.alarms.get("whatsapp-follow-ups")))
    await chrome.alarms.create("whatsapp-follow-ups", { periodInMinutes: 1 });
}
async function sweep() {
  await ready;
  const license = await getLicenseState();
  const due = await mutate(async () => {
    const d = await data();
    const due = d.followUps.filter(
      (f) => f.status === "pending" && f.dueAt <= Date.now(),
    );
    for (const f of due) {
      f.status = "ready";
      f.detail = "Ready for your review";
    }
    for (const f of d.followUps.filter((f) => f.status === "sending")) {
      f.status = "ready";
      f.detail =
        "Delivery was interrupted. Check WhatsApp before sending again.";
    }
    if (
      due.length ||
      d.followUps.some((f) => f.detail?.includes("interrupted"))
    )
      await chrome.storage.local.set({ followUps: d.followUps });
    return due;
  });
  for (const item of due) {
    const d = await data();
    if (
      license.status !== "expired" &&
      license.status !== "offline" &&
      license.status !== "unconfigured" &&
      item.mode === "automatic" &&
      d.settings.autoSend
    ) {
      const tabs = await chrome.tabs.query({
        url: "https://web.whatsapp.com/*",
      });
      for (const tab of tabs) {
        if (!tab.id) continue;
        const ctx = await freshContext(tab.id);
        if (
          ctx?.chatId !== item.chatId ||
          automationBlock(ctx, d.clients[item.chatId]?.human ?? false)
        )
          continue;
        await mutate(async () => {
          const x = await data();
          const f = x.followUps.find((f) => f.id === item.id);
          if (f) f.status = "sending";
          await chrome.storage.local.set({ followUps: x.followUps });
        });
        try {
          const result = await chrome.tabs.sendMessage(tab.id, {
            type: "PLACE_DRAFT",
            chatId: item.chatId,
            incomingId: ctx.lastIncomingId,
            text: item.message,
            send: true,
            sendToken: `followup:${item.id}`,
          });
          if (result?.ok)
            await updateFollowUp(item.id, "completed", "Sent automatically");
          else
            await updateFollowUp(
              item.id,
              "ready",
              result?.error ?? "Review before sending",
            );
        } catch {
          await updateFollowUp(
            item.id,
            "ready",
            "Check WhatsApp before sending again.",
          );
        }
        break;
      }
    }
    const latest = await data();
    if (latest.followUps.find((f) => f.id === item.id)?.status === "completed")
      continue;
    await chrome.notifications
      .create(`follow:${item.id}`, {
        type: "basic",
        iconUrl: "icons/128.png",
        title: `Follow up with ${item.name}`,
        message:
          `Your saved message is ready in ${APP_NAME}. Open WhatsApp Web to review it.`,
      })
      .catch(() => {});
  }
}
async function updateFollowUp(
  id: string,
  status: FollowUp["status"],
  detail?: string,
) {
  return mutate(async () => {
    const d = await data();
    const f = d.followUps.find((f) => f.id === id);
    if (f) {
      f.status = status;
      f.detail = detail;
      await chrome.storage.local.set({ followUps: d.followUps });
    }
  });
}
async function handle(m: any, sender: chrome.runtime.MessageSender) {
  await ready;
  if (sender.id !== chrome.runtime.id)
    throw new Error("Unrecognized extension sender.");
  const panel = sender.url?.startsWith(chrome.runtime.getURL("panel.html"));
  const content =
    sender.url?.startsWith("https://web.whatsapp.com/") &&
    sender.frameId === 0 &&
    !!sender.tab?.id;
  if (m.type === "HELLO" && content) {
    const d = await data();
    return {
      tabId: sender.tab!.id,
      dateOrder: d.settings.dateOrder,
      inbox:
        (await chrome.storage.session.get(`inbox:${sender.tab!.id}`))[
          `inbox:${sender.tab!.id}`
        ] ?? null,
      anchors: Object.values(d.clients).map((c) => ({
        chatId: c.chatId,
        messageIds: c.messageIds ?? [],
      })),
    };
  }
  if (m.type === "INBOX_STATUS" && content) {
    const d = await data(),
      tab = sender.tab!.id!;
    const configured =
      d.settings.allChats &&
      d.settings.autoDraft &&
      d.settings.autoSend &&
      !!taskKey(d, "text") &&
      !!d.knowledge.length;
    if (!configured)
      return {
        enabled: false,
        reason: !d.settings.allChats
          ? "All-chat monitoring is off"
          : "Enable Auto-send and Draft as messages arrive to monitor your inbox",
      };
    const owns = await mutate(async () => {
      const lease = (await chrome.storage.session.get("inboxLease"))
        .inboxLease as InboxLease | undefined;
      if (
        lease &&
        lease.tabId !== tab &&
        (lease.busyUntil > Date.now() || Date.now() - lease.at < 15000)
      )
        return false;
      await chrome.storage.session.set({
        inboxLease: {
          tabId: tab,
          at: Date.now(),
          busyUntil: lease?.tabId === tab ? (lease.busyUntil ?? 0) : 0,
        },
      });
      return true;
    });
    return {
      enabled: owns,
      reason: owns ? "" : "Inbox monitoring is active in another WhatsApp tab",
      humanChats: Object.values(d.clients)
        .filter((c) => c.human)
        .map((c) => c.chatId),
    };
  }
  if (m.type === "INBOX_SYNC" && content) {
    const state = m.state as InboxState;
    if (
      !state ||
      !Array.isArray(state.items) ||
      state.items.length > 100 ||
      typeof state.status !== "string"
    )
      throw new Error("Invalid inbox state.");
    const clean: InboxState = {
      enabled: !!state.enabled,
      status: state.status.slice(0, 300),
      busyKey:
        typeof state.busyKey === "string" ? state.busyKey.slice(0, 300) : null,
      updatedAt: Date.now(),
      observedChats: Math.max(0, Number(state.observedChats) || 0),
      items: state.items
        .filter(
          (i) =>
            i &&
            typeof i.key === "string" &&
            typeof i.name === "string" &&
            Number.isFinite(i.dueAt) &&
            Number.isFinite(i.observedAt) &&
            ["waiting", "replying", "review", "sent", "skipped"].includes(
              i.status,
            ),
        )
        .map((i) => ({
          ...i,
          key: i.key.slice(0, 300),
          name: i.name.slice(0, 150),
          preview: String(i.preview ?? "").slice(0, 500),
          fingerprint: String(i.fingerprint ?? "").slice(0, 2000),
          detail: String(i.detail ?? "").slice(0, 600),
        })),
    };
    await chrome.storage.session.set({ [`inbox:${sender.tab!.id}`]: clean });
    return {};
  }
  if (m.type === "INBOX_RUN" && content) {
    const tab = sender.tab!.id!,
      token = String(m.token ?? "");
    if (
      !token ||
      token.length > 100 ||
      !Number.isFinite(m.dueAt) ||
      !Number.isFinite(m.observedAt) ||
      m.dueAt - m.observedAt < 8000 ||
      m.dueAt - m.observedAt > 45000 ||
      Date.now() < m.dueAt
    )
      throw new Error("The customer's quiet period is still running.");
    await assertInboxControl(tab, token);
    const ctx = await freshContext(tab),
      d = await data();
    if (
      !ctx ||
      ctx.chatId !== m.chatId ||
      ctx.lastIncomingId !== m.incomingId ||
      ctx.messages.at(-1)?.direction !== "in" ||
      !ctx.lastIncomingAt ||
      ctx.lastIncomingAt < m.observedAt - 120000
    )
      return {
        status: "skipped",
        detail:
          "The chat changed, was already answered, or was not a new enquiry.",
      };
    const reason = automationBlock(ctx, d.clients[ctx.chatId]?.human ?? false);
    if (reason) return { status: "skipped", detail: reason };
    if (activeGenerations.has(tab))
      throw new Error("Another reply is already being prepared.");
    await recordContext(ctx, tab);
    await cancelPending(tab);
    const claimed = await mutate(async () => {
      const x = await data(),
        key = `incoming:${ctx.chatId}:${ctx.lastIncomingId}`;
      if (
        x.ledger[key] ||
        x.ledger[`send:reply:${ctx.chatId}:${ctx.lastIncomingId}:part:1`]
      )
        return false;
      x.ledger[key] = { status: "claimed", at: Date.now() };
      x.ledger = Object.fromEntries(
        Object.entries(x.ledger)
          .filter(([, v]) => Date.now() - v.at < 7 * 86400000)
          .slice(-1000),
      );
      await chrome.storage.local.set({ ledger: x.ledger });
      await chrome.storage.session.set({
        inboxLease: {
          tabId: tab,
          at: Date.now(),
          busyUntil: Date.now() + 180000,
        },
      });
      return true;
    });
    if (!claimed)
      return {
        status: "skipped",
        detail: "This incoming message was already handled or claimed.",
      };
    try {
      const draft = await generate(tab, true, ctx.lastIncomingId!, token);
      if (draft.needsHuman)
        await mutate(async () => {
          const x = await data();
          if (x.clients[ctx.chatId]) x.clients[ctx.chatId].human = true;
          await chrome.storage.local.set({ clients: x.clients });
        });
      return {
        status: draft.placement?.startsWith("Sent automatically")
          ? "sent"
          : "review",
        detail: draft.needsHuman
          ? draft.reason || "A human should review this reply."
          : draft.placement,
      };
    } catch (e) {
      await setActivity(tab, safeError(e));
      return { status: "review", detail: safeError(e) };
    } finally {
      await mutate(async () => {
        const lease = (await chrome.storage.session.get("inboxLease"))
          .inboxLease as InboxLease | undefined;
        if (lease?.tabId === tab)
          await chrome.storage.session.set({
            inboxLease: { tabId: tab, at: Date.now(), busyUntil: 0 },
          });
      });
    }
  }
  if (m.type === "CONTEXT" && content) {
    await recordContext(m.context, sender.tab!.id!);
    return {};
  }
  if (m.type === "AUTHORIZE_SEND" && content) {
    if (STORE_RELEASE)
      throw new Error(
        "The Chrome Web Store edition requires a human to review and send replies.",
      );
    await assertLicenseAccess();
    if (m.inboxToken) await assertInboxControl(sender.tab!.id!, m.inboxToken);
    const ctx = await freshContext(sender.tab!.id!);
    const d = await data();
    if (
      !d.settings.autoSend ||
      !ctx ||
      ctx.chatId !== m.chatId ||
      ctx.lastIncomingId !== m.incomingId ||
      automationBlock(
        { ...ctx, composerEmpty: true },
        d.clients[ctx.chatId]?.human ?? false,
      )
    )
      throw new Error(
        "Automatic sending paused. Review the draft in WhatsApp.",
      );
    if (
      typeof m.token !== "string" ||
      m.token.length > 500 ||
      (!m.token.startsWith("reply:") && !m.token.startsWith("followup:"))
    )
      throw new Error("A send identifier is required.");
    const claimed = await mutate(async () => {
      const latest = await data();
      const key = `send:${m.token}`;
      if (latest.ledger[key]) return false;
      latest.ledger[key] = { status: "send-attempt", at: Date.now() };
      await chrome.storage.local.set({ ledger: latest.ledger });
      return true;
    });
    if (!claimed)
      throw new Error(
        "Automatic sending was already attempted for this message. Check WhatsApp before sending manually.",
      );
    return { allowed: true };
  }
  if (!panel) throw new Error(`This action is available only inside ${APP_NAME}.`);
  const tabId = Number(m.tabId);
  switch (m.type) {
    case "GET_STATE": {
      const d = await data();
      const s = await chrome.storage.session.get([
        `draft:${tabId}`,
        `activity:${tabId}`,
        `replyTiming:${tabId}`,
        "pendingReplies",
        `inbox:${tabId}`,
        "chatDrafts",
      ]);
      const context = await contextFor(tabId);
      const pending = (
        s.pendingReplies as Record<string, PendingReply> | undefined
      )?.[tabId];
      const inbox = (s[`inbox:${tabId}`] as InboxState) ?? null;
      const license = await getLicenseState();
      const queued = inbox?.items.find(
        (i) =>
          i.status === "waiting" &&
          i.chatId === context?.chatId &&
          i.incomingId === context?.lastIncomingId,
      );
      const timing: ReplyTiming | null = pending
        ? {
            chatId: pending.chatId,
            incomingId: pending.incomingId,
            dueAt: pending.dueAt,
            phase: "quiet",
          }
        : queued
          ? {
              chatId: queued.chatId!,
              incomingId: queued.incomingId!,
              dueAt: queued.dueAt,
              phase: "quiet",
            }
          : ((s[`replyTiming:${tabId}`] as ReplyTiming) ?? null);
      const visibleTiming =
        timing &&
        context &&
        timing.chatId === context.chatId &&
        timing.incomingId === context.lastIncomingId &&
        !automationBlock(context, d.clients[context.chatId]?.human ?? false) &&
        (timing.phase === "quiet" ? d.settings.autoDraft : d.settings.autoSend)
          ? timing
          : null;
      return {
        settings: d.settings,
        knowledge: d.knowledge,
        clients: d.clients,
        followUps: d.followUps,
        models: d.models,
        hasKey: !!taskKey(d, "text"),
        providerStatus: Object.fromEntries(PROVIDERS.map((p) => [p.id, !!d.providerKeys[p.id]])),
        providerModels: d.providerModels,
        context,
        draft:
          (context
            ? (s.chatDrafts as Record<string, Draft> | undefined)?.[
                context.chatId
              ]
            : null) ??
          (s[`draft:${tabId}`] as Draft) ??
          null,
        activity: (s[`activity:${tabId}`] as string) ?? "",
        replyTiming: visibleTiming,
        inbox,
        license,
      } satisfies DeskState;
    }
    case "START_CHECKOUT": {
      const result = await startCheckout(
        typeof m.email === "string" ? m.email : undefined,
      );
      await chrome.tabs.create({ url: result.url });
      return result;
    }
    case "REFRESH_LICENSE": {
      return await getLicenseState(true);
    }
    case "SAVE_SETTINGS": {
      await mutate(async () => {
        const d = await data();
        const p = m.settings ?? {};
        const existingRoutes = { ...((d.settings as Settings & { aiRoutes?: Record<AiTask, AiRoute> }).aiRoutes ?? defaultRoutes(d.settings.model)) };
        const proposedRoutes = p.aiRoutes && typeof p.aiRoutes === "object" ? { ...existingRoutes, ...p.aiRoutes } : p.aiRoutes;
        const invalidRoutes = invalidRouteTasks(proposedRoutes);
        if (invalidRoutes.length) throw new Error(`Choose a supported provider and model for ${invalidRoutes.join(", ")}.`);
        const s: Settings = {
          businessName: String(p.businessName ?? d.settings.businessName).slice(
            0,
            150,
          ),
          businessInstructions: String(
            p.businessInstructions ?? d.settings.businessInstructions,
          ).slice(0, 6000),
          model: String(p.model ?? d.settings.model).slice(0, 150),
          aiRoutes: normalizeRoutes(proposedRoutes ?? (() => {
            const current = existingRoutes;
            if (p.model !== undefined && current.text.provider === "openai") current.text = { provider: "openai", model: String(p.model).slice(0, 150) };
            return current;
          })(), String(p.model ?? d.settings.model)),
          autoSend:
            STORE_RELEASE
              ? false
              : typeof p.autoSend === "boolean"
                ? p.autoSend
                : d.settings.autoSend,
          autoDraft:
            typeof p.autoDraft === "boolean"
              ? p.autoDraft
              : d.settings.autoDraft,
          allChats:
            typeof p.allChats === "boolean" ? p.allChats : d.settings.allChats,
          dateOrder:
            p.dateOrder === "MDY"
              ? "MDY"
              : p.dateOrder === "DMY"
                ? "DMY"
                : d.settings.dateOrder,
        };
        s.model = normalizeRoutes(s.aiRoutes, s.model).text.model;
        await chrome.storage.local.set({ settings: s });
        const tabs = await chrome.tabs.query({
          url: "https://web.whatsapp.com/*",
        });
        await Promise.allSettled(
          tabs
            .filter((t) => t.id)
            .map((t) =>
              chrome.tabs.sendMessage(t.id!, {
                type: "DATE_ORDER",
                order: s.dateOrder,
              }),
            ),
        );
      });
      if (m.settings?.autoDraft === false)
        for (const job of Object.values(await pendingReplies()))
          await cancelPending(job.tabId);
      return {};
    }
    case "SAVE_KEY": {
      const key = String(m.key ?? "").trim();
      const provider: ProviderId = (m.provider === undefined ? "openai" : m.provider) as ProviderId;
      if (!PROVIDERS.some((p) => p.id === provider)) throw new Error("Choose a supported AI provider.");
      if (key && (!/^[A-Za-z0-9._-]{12,300}$/.test(key) || (provider === "openai" && !/^sk-[\w-]{12,}$/.test(key))))
        throw new Error(provider === "openai" ? "Enter a valid OpenAI secret key, starting with sk-." : "Enter a valid API key.");
      const current = (await chrome.storage.local.get("providerKeys")).providerKeys as Partial<Record<ProviderId, string>> ?? {};
      const providerKeys = { ...current, [provider]: key };
      const providerModels = { ...((await chrome.storage.local.get("providerModels")).providerModels as Partial<Record<ProviderId, string[]>> ?? {}), [provider]: [] };
      await chrome.storage.local.set({ providerKeys, providerModels, ...(provider === "openai" ? { apiKey: key, models: [] } : {}) });
      return {};
    }
    case "LOAD_MODELS": {
      const d = await data();
      const provider: ProviderId = m.provider === undefined ? "openai" : m.provider;
      if (!PROVIDERS.some((p) => p.id === provider)) throw new Error("Choose a supported AI provider.");
      const key = d.providerKeys[provider];
      if (!key) throw new Error(`Save your ${PROVIDERS.find((p) => p.id === provider)?.label} key first.`);
      const endpoint = providerEndpoint(provider);
      let response: Response;
      try { response = await fetch(endpoint.url, { method: "GET", headers: providerHeaders(provider, key, false), signal: AbortSignal.timeout(25000) }); }
      catch { throw new Error(`${PROVIDERS.find((p) => p.id === provider)?.label} could not be reached to load models.`); }
      if (!response.ok) throw new Error(`Could not load ${PROVIDERS.find((p) => p.id === provider)?.label} models (${response.status}). Check the key and try again.`);
      const r = await response.json();
      const models = providerModels(provider, r).filter((id) => provider !== "openai" || (/^gpt-/.test(id) && !/(audio|realtime|transcribe|tts|image|search|instruct|codex)/.test(id)));
      const providerModelsById = { ...d.providerModels, [provider]: models };
      await chrome.storage.local.set({ providerModels: providerModelsById, ...(provider === "openai" ? { models } : {}) });
      return { models };
    }
    case "TRANSCRIBE_AUDIO": {
      await assertLicenseAccess();
      const d = await data();
      const route = requireTaskKey(d, "stt");
      return transcribeAudio(m.audio, m.mimeType, taskKey(d, "stt"), MAX_DICTATION_AUDIO_BYTES, 8000, undefined, route.provider, route.model);
    }
    case "CALL_RECORD_START":
      await assertLicenseAccess();
      return startCallCapture(tabId, m.chatId);
    case "CALL_RECORD_STATUS":
      return relayCallCapture(tabId, "CALL_RECORD_STATUS", m.sessionId);
    case "CALL_RECORD_STOP":
      return relayCallCapture(tabId, "CALL_RECORD_STOP", m.sessionId);
    case "CALL_RECORD_CANCEL":
      await relayCallCapture(tabId, "CALL_RECORD_CANCEL", m.sessionId);
      return {};
    case "TRANSCRIBE_CALL": {
      await assertLicenseAccess();
      const d = await data();
      const route = requireTaskKey(d, "callStt");
      const name = typeof m.name === "string" ? m.name.slice(0, 150) : undefined;
      const spk = callSpeakers(m.speakers);
      const hint = whisperCallPrompt({
        businessName: d.settings.businessName,
        businessSpeaker: spk.business,
        customerName: name,
        customerSpeaker: spk.customer,
      });
      return transcribeAudio(m.audio, m.mimeType, taskKey(d, "callStt"), CALL_TRANSCRIPTION_AUDIO_MAX_BYTES, CALL_TRANSCRIPT_MAX_CHARS, hint ?? undefined, route.provider, route.model);
    }
    case "SUMMARIZE_CALL": {
      await assertLicenseAccess();
      if (typeof m.text !== "string") throw new Error("Provide the call transcript to summarize.");
      return summarizeCall(m.text, { name: m.name, startedAt: m.startedAt, speakers: m.speakers });
    }
    case "POLISH_TEXT": {
      await assertLicenseAccess();
      if (typeof m.text !== "string" || m.text.length > 5000)
        throw new Error("Enter text with 1 to 5,000 characters to polish.");
      return polishText(m.text, m.style);
    }
    case "RECORD_AUDIO_START":
    case "RECORD_AUDIO_STOP":
    case "RECORD_AUDIO_CANCEL": {
      const timeoutMs = m.type === "RECORD_AUDIO_START" ? 30000 : m.type === "RECORD_AUDIO_STOP" ? 8000 : 5000;
      const timeoutMessage = m.type === "RECORD_AUDIO_START"
        ? "Microphone permission took too long. Check the browser permission prompt and try again."
        : m.type === "RECORD_AUDIO_STOP" ? "Recording did not finish in time. Try again." : "Recording could not be cancelled in time. Try again.";
      const result = await boundedMessage(tabId, { type: m.type }, timeoutMs, timeoutMessage);
      if (!result?.ok) throw new Error(result?.error ?? (m.type === "RECORD_AUDIO_START"
        ? "Could not access the microphone. Check permission and try again."
        : "The recording action could not be completed. Try again."));
      return result.value ?? result;
    }
    case "ADD_KNOWLEDGE": {
      const k = m.document;
      const text = String(k?.text ?? "").trim();
      if (!text || text.length > 300000)
        throw new Error(
          "Each document must contain between 1 and 300,000 text characters.",
        );
      await mutate(async () => {
        const d = await data();
        if (
          d.knowledge.reduce((n, k) => n + k.text.length, 0) + text.length >
          2000000
        )
          throw new Error(
            "Your knowledge library is full. Remove an older document first.",
          );
        d.knowledge.push({
          id: crypto.randomUUID(),
          name: String(k.name ?? "Business note").slice(0, 150),
          text,
          addedAt: Date.now(),
        });
        await chrome.storage.local.set({ knowledge: d.knowledge });
      });
      return {};
    }
    case "REMOVE_KNOWLEDGE": {
      await mutate(async () => {
        const d = await data();
        await chrome.storage.local.set({
          knowledge: d.knowledge.filter((k) => k.id !== m.id),
        });
      });
      return {};
    }
    case "UPDATE_CLIENT": {
      await mutate(async () => {
        const d = await data();
        const c = d.clients[m.chatId];
        if (!c) throw new Error("Open this client first.");
        if (typeof m.patch?.human === "boolean") c.human = m.patch.human;
        if (typeof m.patch?.notes === "string")
          c.notes = m.patch.notes.slice(0, 5000);
        if (
          ["New lead", "In conversation", "Follow-up", "Client"].includes(
            m.patch?.stage,
          )
        )
          c.stage = m.patch.stage;
        await chrome.storage.local.set({ clients: d.clients });
      });
      if (m.patch?.human === true)
        for (const job of Object.values(await pendingReplies()))
          if (job.chatId === m.chatId) await cancelPending(job.tabId);
      return {};
    }
    case "OPEN_INBOX_ITEM": {
      const state = (await chrome.storage.session.get(`inbox:${tabId}`))[
        `inbox:${tabId}`
      ] as InboxState;
      const item = state?.items.find((i) => i.key === m.key);
      if (!item?.chatId)
        throw new Error("This chat is still waiting to be identified.");
      await chrome.tabs.sendMessage(tabId, { type: "INBOX_PAUSE" });
      const result = await chrome.tabs.sendMessage(tabId, {
        type: "OPEN_CLIENT",
        chatId: item.chatId,
        name: item.name,
      });
      if (!result?.ok)
        throw new Error(
          result?.error ?? "Open this chat in WhatsApp to review it.",
        );
      return {};
    }
    case "GENERATE": {
      await assertLicenseAccess();
      if (m.assistOnly !== true) await cancelPending(tabId);
      try {
        return await generate(tabId, false, undefined, undefined, {
          instruction: m.instruction,
          assistOnly: m.assistOnly === true,
          ...(Object.hasOwn(m, "expectedChatId") ? { expectedChatId: m.expectedChatId } : {}),
        });
      } catch (e) {
        if (!(await pendingReplies())[tabId])
          await setActivity(tabId, safeError(e));
        throw e;
      }
    }
    case "PLACE_DRAFT": {
      const ctx = await freshContext(tabId);
      if (
        !ctx ||
        ctx.chatId !== m.chatId ||
        ctx.lastIncomingId !== m.incomingId
      )
        throw new Error("The conversation changed. Generate a fresh reply.");
      const r = await chrome.tabs.sendMessage(tabId, {
        type: "PLACE_DRAFT",
        chatId: m.chatId,
        incomingId: m.incomingId,
        text: String(m.text).slice(0, 8000),
        send: false,
      });
      if (!r?.ok) throw new Error(r?.error ?? "Could not place the draft.");
      return {};
    }
    case "PLACE_MESSAGE": {
      const text = typeof m.text === "string" ? m.text.trim() : "";
      const chatId = typeof m.chatId === "string" ? m.chatId : "";
      if (!text || text.length > 8000)
        throw new Error("The dictated message is empty or too long.");
      if (!chatId || chatId.length > 150)
        throw new Error("Select a WhatsApp conversation before placing dictation.");
      const ctx = await freshContext(tabId);
      if (!ctx || ctx.chatId !== chatId)
        throw new Error("The selected WhatsApp conversation changed. Select it again before placing dictation.");
      if (!ctx.composerEmpty)
        throw new Error(`Your WhatsApp message box already has text. The transcript is still in ${APP_NAME}; clear the message box before placing it.`);
      const paused = await boundedMessage(tabId, { type: "INBOX_PAUSE" }, 5000,
        "Inbox monitoring could not be paused. Try placing the transcript again.");
      if (!paused?.ok)
        throw new Error(paused?.error ?? "Inbox monitoring could not be paused for manual dictation.");
      const placed = await boundedMessage(tabId, { type: "PLACE_MESSAGE", chatId, text }, 12000,
        "WhatsApp did not respond while placing the transcript. Check the composer before trying again.");
      if (!placed?.ok) throw new Error(placed?.error ?? "Could not place the transcript in WhatsApp.");
      return { placed: true };
    }
    case "SYNC_MESSAGE": {
      const chatId = typeof m.chatId === "string" ? m.chatId : "";
      const text = typeof m.text === "string" ? m.text : null;
      const expectedText = typeof m.expectedText === "string" ? m.expectedText : null;
      if (!chatId || chatId.length > 150 || text === null || expectedText === null || text.length > 5000 || expectedText.length > 5000)
        throw new Error("The WhatsApp message could not be synced.");
      const ctx = await freshContext(tabId);
      if (!ctx || ctx.chatId !== chatId)
        throw new Error("The selected WhatsApp conversation changed. Select it again before syncing.");
      await cancelPending(tabId);
      const paused = await boundedMessage(tabId, { type: "INBOX_PAUSE" }, 5000,
        "Inbox monitoring could not be paused. Try syncing the message again.");
      if (!paused?.ok) throw new Error(paused?.error ?? "Inbox monitoring could not be paused for manual editing.");
      const result = await boundedMessage(tabId, { type: "SYNC_MESSAGE", chatId, text, expectedText }, 12000,
        "WhatsApp did not respond while syncing. Check the composer before trying again.");
      if (!result?.ok) throw new Error(result?.error ?? "Could not sync the WhatsApp message.");
      return { synced: true, text };
    }
    case "ADD_FOLLOW_UP": {
      const ctx = await freshContext(tabId);
      if (!ctx?.chatId || ctx.isGroup)
        throw new Error("Open the individual client conversation first.");
      const dueAt = Number(m.dueAt);
      const message = String(m.message ?? "").trim();
      if (!Number.isFinite(dueAt) || dueAt <= Date.now())
        throw new Error("Choose a date and time in the future.");
      if (!message || message.length > 8000)
        throw new Error("Write a follow-up message of up to 8,000 characters.");
      await mutate(async () => {
        const d = await data();
        d.followUps.push({
          id: crypto.randomUUID(),
          chatId: ctx.chatId,
          name: ctx.name,
          message,
          dueAt,
          mode: m.mode === "automatic" ? "automatic" : "review",
          status: "pending",
          createdAt: Date.now(),
        });
        await chrome.storage.local.set({ followUps: d.followUps });
      });
      await ensureAlarm();
      return {};
    }
    case "UPDATE_FOLLOW_UP": {
      if (!["completed", "cancelled", "pending"].includes(m.status))
        throw new Error("Invalid follow-up action.");
      if (m.status === "pending") {
        await mutate(async () => {
          const d = await data();
          const f = d.followUps.find((f) => f.id === m.id);
          if (f) {
            f.status = "pending";
            f.dueAt = Date.now() + 3600000;
          }
          await chrome.storage.local.set({ followUps: d.followUps });
        });
      } else await updateFollowUp(m.id, m.status);
      return {};
    }
    case "OPEN_FOLLOW_UP": {
      const d = await data();
      const f = d.followUps.find((f) => f.id === m.id);
      if (!f) throw new Error("Follow-up not found.");
      const r = await chrome.tabs.sendMessage(tabId, {
        type: "OPEN_CLIENT",
        chatId: f.chatId,
        name: f.name,
      });
      if (!r?.ok)
        throw new Error(
          r?.error ?? "Open this conversation in WhatsApp first.",
        );
      return {};
    }
    case "CLOSE_PANEL": {
      await chrome.tabs.sendMessage(tabId, { type: "TOGGLE_PANEL" });
      return {};
    }
    default:
      throw new Error("Unknown action.");
  }
}
chrome.runtime.onMessage.addListener((m, sender, respond) => {
  handle(m, sender)
    .then((value) => respond({ ok: true, value }))
    .catch((e) => respond({ ok: false, error: safeError(e) }));
  return true;
});
chrome.alarms.onAlarm.addListener((a) => {
  if (a.name.startsWith("whatsapp-reply:"))
    void runPending(Number(a.name.slice("whatsapp-reply:".length)));
  if (a.name === "whatsapp-follow-ups") void sweep();
});
chrome.runtime.onStartup.addListener(() => {
  void ensureAlarm().then(sweep);
});
chrome.runtime.onInstalled.addListener(() => {
  void ensureAlarm().then(sweep);
});
chrome.action.onClicked.addListener(async (tab) => {
  if (tab.id && tab.url?.startsWith("https://web.whatsapp.com/"))
    await chrome.tabs
      .sendMessage(tab.id, { type: "TOGGLE_PANEL" })
      .catch(() => chrome.tabs.reload(tab.id!));
  else await chrome.tabs.create({ url: "https://web.whatsapp.com/" });
});
chrome.notifications.onClicked.addListener(async () => {
  const tabs = await chrome.tabs.query({ url: "https://web.whatsapp.com/*" });
  if (tabs[0]?.id) {
    await chrome.tabs.update(tabs[0].id, { active: true });
    if (tabs[0].windowId)
      await chrome.windows.update(tabs[0].windowId, { focused: true });
  } else await chrome.tabs.create({ url: "https://web.whatsapp.com/" });
});
chrome.tabs.onRemoved.addListener((id) => {
  void cancelPending(id);
  void chrome.storage.session.remove([
    sessionKey(id),
    `draft:${id}`,
    `activity:${id}`,
    `replyTiming:${id}`,
    `inbox:${id}`,
    callCaptureKey(id),
  ]);
});
void ready
  .then(ensureAlarm)
  .then(async () => {
    for (const job of Object.values(await pendingReplies()))
      await armReply(job);
  })
  .then(sweep)
  .catch(() => {});
