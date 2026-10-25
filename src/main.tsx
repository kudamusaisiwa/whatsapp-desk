import { APP_NAME, BRAND_PREFIX } from "./product";
import { Assistant } from "./Assistant";
import { CallRecorder, formatDuration, type CallStatus } from "./CallRecorder";
import React, { useEffect, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import {
  ArrowDownToLine,
  ArrowRight,
  ArrowUpRight,
  Bell,
  BookOpen,
  CalendarClock,
  Check,
  CheckCheck,
  ChevronDown,
  ChevronRight,
  CircleHelp,
  Clock3,
  FileText,
  Fingerprint,
  Headphones,
  KeyRound,
  LoaderCircle,
  LockKeyhole,
  MessageCircle,
  MoreHorizontal,
  PanelRightClose,
  Plus,
  RefreshCw,
  Search,
  Send,
  Settings2,
  ShieldCheck,
  Sparkles,
  StickyNote,
  Trash2,
  UploadCloud,
  UserRound,
  Users,
  X,
} from "lucide-react";
import { isExtension, rpc } from "./bridge";
import {
  DEFAULT_SETTINGS,
  type Client,
  type DeskState,
  type FollowUp,
  type LicenseState,
  type Settings,
  type Stage,
} from "./types";
import { STORE_RELEASE } from "./release";
import { windowState } from "./core";
import { replyCountdown } from "./pacing";
import { readKnowledge } from "./files";
import "@fontsource/dm-sans/latin-400.css";
import "@fontsource/dm-sans/latin-500.css";
import "@fontsource/dm-sans/latin-600.css";
import "@fontsource/dm-sans/latin-700.css";
import "@fontsource/manrope/latin-600.css";
import "@fontsource/manrope/latin-700.css";
import "@fontsource/ibm-plex-mono/latin-400.css";
import "./styles.css";

type Tab = "assistant" | "followups" | "knowledge" | "settings";
const CALL_PILL_PHASES: CallStatus["phase"][] = [
  "starting",
  "recording",
  "stopped",
  "transcribing",
  "summarizing",
];
function callPillText(call: CallStatus, now: number) {
  switch (call.phase) {
    case "recording":
      return `REC ${formatDuration(call.startedAt ? now - call.startedAt : 0)}`;
    case "starting":
      return "Starting call…";
    case "stopped":
      return "Call ended · finish";
    case "transcribing":
      return "Transcribing…";
    default:
      return "Summarizing…";
  }
}
const initials = (name: string) =>
  name
    .split(/\s+/)
    .map((s) => s.match(/\p{L}/u)?.[0] ?? "")
    .filter(Boolean)
    .slice(0, 2)
    .join("")
    .toUpperCase();
/** Initials for named contacts; a person icon for phone-number-only contacts. */
function Initials({ name, size = 18 }: { name: string; size?: number }) {
  const text = initials(name);
  return text ? <>{text}</> : <UserRound size={size} aria-hidden="true" />;
}
const dateText = (n: number) =>
  new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(n);
const localInput = (n: number) => {
  const d = new Date(n);
  return new Date(n - d.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
};
function Toggle({
  checked,
  onChange,
  label,
  disabled = false,
}: {
  checked: boolean;
  onChange: (value: boolean) => void;
  label: string;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      className={`toggle ${checked ? "on" : ""}`}
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      onClick={() => onChange(!checked)}
    >
      <span />
    </button>
  );
}
function licenseSummary(license: LicenseState, now = Date.now()) {
  if (license.status === "paid") return "Unlocked";
  if (license.status === "trial" && license.trialEndsAt) {
    const days = Math.max(0, Math.ceil((license.trialEndsAt - now) / 86400000));
    return `${days} day${days === 1 ? "" : "s"} left in your trial`;
  }
  if (license.status === "expired") return "Trial ended";
  if (license.status === "unconfigured") return "Licensing not configured";
  return "Checking license";
}
function LicenseBanner({
  license,
  now,
  openSettings,
}: {
  license: LicenseState;
  now: number;
  openSettings: () => void;
}) {
  if (!STORE_RELEASE || license.status === "bypass" || license.status === "paid")
    return null;
  const locked = license.status === "expired";
  return (
    <div className={`license-banner ${locked ? "locked" : ""}`} role="status">
      <span className="license-banner-icon">
        {locked ? <LockKeyhole size={15} /> : <Clock3 size={15} />}
      </span>
      <div>
        <strong>
          {locked ? `Your ${APP_NAME} trial has ended` : `${APP_NAME} trial`}
        </strong>
        <small>
          {locked
            ? "Unlock the assistant for a one-time $9.99 payment."
            : `${licenseSummary(license, now)} · bring your own OpenAI key.`}
        </small>
      </div>
      <button className="text-button" onClick={openSettings}>
        {locked ? "Unlock" : "Manage"} <ArrowRight size={13} />
      </button>
    </div>
  );
}
function App() {
  const [desk, setDesk] = useState<DeskState | null>(null);
  const [tab, setTab] = useState<Tab>("assistant");
  const [call, setCall] = useState<CallStatus | null>(null);
  const [callOpenSignal, setCallOpenSignal] = useState(0);
  const [toast, setToast] = useState("");
  const [clock, setClock] = useState(Date.now());
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  async function refresh() {
    try {
      setDesk(await rpc("GET_STATE"));
    } catch (e) {
      setToast((e as Error).message);
    }
  }
  useEffect(() => {
    void refresh();
    const i = setInterval(() => setClock(Date.now()), 1000);
    let debounce: ReturnType<typeof setTimeout>;
    const listener = () => {
      clearTimeout(debounce);
      debounce = setTimeout(() => void refresh(), 150);
    };
    if (isExtension) chrome.storage.onChanged.addListener(listener);
    return () => {
      clearInterval(i);
      clearTimeout(debounce);
      if (isExtension) chrome.storage.onChanged.removeListener(listener);
    };
  }, []);
  function notify(message: string) {
    setToast(message);
    clearTimeout(timer.current);
    timer.current = setTimeout(() => setToast(""), 6000);
  }
  async function act(
    type: string,
    payload: Record<string, unknown> = {},
    success?: string,
  ) {
    try {
      const result = await rpc(type, payload);
      await refresh();
      if (success) notify(success);
      return result;
    } catch (e) {
      notify((e as Error).message);
      throw e;
    }
  }
  const changeSettings = (patch: Partial<Settings>) =>
    void act("SAVE_SETTINGS", { settings: patch }).catch(() => {});
  if (!desk)
    return (
      <div className="loading">
        <span className="brand-mark">
          <MessageCircle size={24} />
        </span>
        <p>Opening your client desk…</p>
      </div>
    );
  const context = desk.context;
  const client = context ? desk.clients[context.chatId] : null;
  const count = desk.followUps.filter(
    (f) => f.status === "pending" || f.status === "ready",
  ).length;
  const chatOpen = context && client ? { context, client } : null;
  const needsReview = !!desk.inbox?.items.some((i) => i.status === "review");
  const callPill =
    call && CALL_PILL_PHASES.includes(call.phase) ? callPillText(call, clock) : null;
  const panel = (
    <div className="desk">
      <header className="desk-header">
        <div className="wordmark">
          <span className="brand-mark">
            <MessageCircle size={16} strokeWidth={1.9} />
            <i />
          </span>
          <strong>
            {BRAND_PREFIX} <span>AI for WhatsApp Web</span>
          </strong>
        </div>
        <div className="header-tools">
          {call && callPill && (
            <button
              type="button"
              className="call-pill"
              data-phase={call.phase}
              aria-label={`Call notes: ${callPill}. Open call notes.`}
              onClick={() => {
                setTab("assistant");
                setCallOpenSignal((n) => n + 1);
              }}
            >
              <i />
              {callPill}
            </button>
          )}
          <span
            className={`connection ${isExtension ? "" : "preview-status"}`}
            title={
              isExtension
                ? "Local workspace — data stays in this browser profile"
                : "Design preview with sample data"
            }
          >
            <i />
            <span className="connection-label">
              {isExtension ? "Local" : "Preview"}
            </span>
          </span>
          {isExtension && (
            <button
              className="icon-button"
              aria-label={`Collapse ${APP_NAME}`}
              onClick={() => void act("CLOSE_PANEL").catch(() => {})}
            >
              <PanelRightClose size={18} />
            </button>
          )}
        </div>
      </header>
      <div className="tabs-wrap">
        <nav className="tabs" aria-label="Workspace">
          {(
            [
              { id: "assistant", label: "Assistant", Icon: Sparkles },
              { id: "followups", label: "Follow-ups", Icon: CalendarClock },
              { id: "knowledge", label: "Knowledge", Icon: BookOpen },
              { id: "settings", label: "Settings", Icon: Settings2 },
            ] as const
          ).map(({ id, label, Icon }) => (
            <button
              className={tab === id ? "active" : ""}
              key={id}
              onClick={() => setTab(id)}
            >
              <Icon size={15} />
              <span>{label}</span>
              {id === "followups" && count > 0 && <b>{count}</b>}
              {id === "assistant" && tab !== "assistant" && needsReview && (
                <>
                  <i className="tab-dot" aria-hidden="true" />
                  <span className="sr-only">needs review</span>
                </>
              )}
            </button>
          ))}
        </nav>
      </div>
      <LicenseBanner
        license={desk.license}
        now={clock}
        openSettings={() => setTab("settings")}
      />
      <main className="desk-scroll">
        <div className="tab-panel assistant-panel" hidden={tab !== "assistant"}>
          {chatOpen ? (
            <ClientBar
              context={chatOpen.context}
              client={chatOpen.client}
              now={clock}
              act={act}
              openFollowUps={() => setTab("followups")}
            />
          ) : (
            <NoChatHint />
          )}
          <AutomationBar
            desk={desk}
            now={clock}
            act={act}
            changeSettings={changeSettings}
          />
          <Assistant
            desk={desk}
            refresh={refresh}
            openSettings={() => setTab("settings")}
          />
          <CallRecorder
            desk={desk}
            visible={tab === "assistant"}
            refresh={refresh}
            onStatusChange={setCall}
            openSignal={callOpenSignal}
          />
          {chatOpen ? (
            <ClientNotes
              client={chatOpen.client}
              save={(chatId, notes) =>
                act("UPDATE_CLIENT", { chatId, patch: { notes } })
              }
            />
          ) : (
            <SetupChecklist desk={desk} select={setTab} />
          )}
        </div>
        {tab === "followups" && <FollowUps desk={desk} act={act} now={clock} />}
        {tab === "knowledge" && <KnowledgeView desk={desk} act={act} />}
        {tab === "settings" && <SettingsView desk={desk} act={act} />}
      </main>
      {toast && (
        <div className="toast" role="status">
          <span>{toast}</span>
          <button aria-label="Dismiss notice" onClick={() => setToast("")}>
            <X size={15} />
          </button>
        </div>
      )}
    </div>
  );
  return isExtension ? (
    panel
  ) : (
    <div className="preview-app">
      <DemoWhatsApp context={context} />
      <aside className="preview-panel">{panel}</aside>
      <div className="preview-banner">
        <span className="preview-dot" />
        DESIGN PREVIEW · sample conversation{" "}
        <span>Load the extension in Chrome to use your real chats.</span>
      </div>
    </div>
  );
}
type Act = (
  type: string,
  payload?: Record<string, unknown>,
  success?: string,
) => Promise<any>;
const WINDOW_NOTE =
  "Tracks 24 hours from the latest observed customer message. Your outgoing replies do not reset it.";
function WindowChip({
  incoming,
  now,
}: {
  incoming: number | null;
  now: number;
}) {
  const w = windowState(incoming, now);
  const state = !w.known
    ? "unknown"
    : !w.open
      ? "closed"
      : w.remaining < 3 * 3600000
        ? "urgent"
        : "open";
  const label =
    state === "unknown"
      ? "Reply window: not yet known"
      : state === "closed"
        ? "Window closed"
        : `${w.display} left`;
  const last = incoming
    ? `Last customer message · ${dateText(incoming)}.`
    : "Waiting for a readable customer timestamp.";
  return (
    <span
      className="window-chip"
      data-state={state}
      role="img"
      aria-label={`24-hour reply window: ${label}`}
      title={`${last} ${WINDOW_NOTE}`}
    >
      {state !== "unknown" && state !== "closed" && <Clock3 size={13} />}
      {label}
    </span>
  );
}
function ClientBar({
  context,
  client,
  now,
  act,
  openFollowUps,
}: {
  context: NonNullable<DeskState["context"]>;
  client: Client;
  now: number;
  act: Act;
  openFollowUps: () => void;
}) {
  const incoming =
    context.lastIncomingId && context.lastIncomingAt === null
      ? null
      : Math.max(client.lastIncomingAt ?? 0, context.lastIncomingAt ?? 0) ||
        null;
  return (
    <section className="client-bar" aria-label="Client">
      <div className="client-bar-row">
        <div className="avatar">
          <Initials name={context.name} size={18} />
        </div>
        <div className="client-title">
          <h1 title={context.name}>{context.name}</h1>
        </div>
        <button
          type="button"
          className={`takeover-button ${client.human ? "on" : ""}`}
          aria-pressed={client.human}
          aria-label="Human takeover"
          title={
            client.human
              ? "Automatic replies are paused. Resume the assistant."
              : "Take over whenever you need. Automatic replies pause."
          }
          onClick={() =>
            void act(
              "UPDATE_CLIENT",
              { chatId: context.chatId, patch: { human: !client.human } },
              client.human
                ? "Assistant resumed."
                : "Human handoff enabled. Automatic replies paused.",
            ).catch(() => {})
          }
        >
          <Headphones size={15} />
          <span>{client.human ? "Resume AI" : "Take over"}</span>
        </button>
        <button
          className="icon-button client-schedule"
          aria-label="Schedule a follow-up for this client"
          onClick={openFollowUps}
        >
          <CalendarClock size={18} />
        </button>
      </div>
      <div className="client-bar-row client-bar-meta">
        <div className="stage-select" data-stage={client.stage}>
          <select
            aria-label="Client stage"
            value={client.stage}
            onChange={(e) =>
              void act("UPDATE_CLIENT", {
                chatId: context.chatId,
                patch: { stage: e.target.value },
              }).catch(() => {})
            }
          >
            {(
              [
                "New lead",
                "In conversation",
                "Follow-up",
                "Client",
              ] as Stage[]
            ).map((s) => (
              <option key={s}>{s}</option>
            ))}
          </select>
          <ChevronDown size={11} />
        </div>
        <WindowChip incoming={incoming} now={now} />
      </div>
      {client.human && (
        <p className="human-strip">
          You're handling this chat. Automatic replies are paused.
        </p>
      )}
    </section>
  );
}
function NoChatHint() {
  return (
    <div className="no-chat-hint">
      <MessageCircle size={16} />
      <p>
        Open an individual client chat in WhatsApp to see their reply window and
        follow-ups.
      </p>
    </div>
  );
}
function AutomationChip({
  label,
  name,
  icon,
  checked,
  onChange,
  title,
  disabled = false,
}: {
  label: string;
  name: string;
  icon: React.ReactNode;
  checked: boolean;
  onChange: (value: boolean) => void;
  title: string;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={name}
      title={title}
      disabled={disabled}
      className={`automation-chip ${checked ? "on" : ""}`}
      onClick={() => onChange(!checked)}
    >
      {icon}
      <span>{label}</span>
    </button>
  );
}
function AutomationBar({
  desk,
  now,
  act,
  changeSettings,
}: {
  desk: DeskState;
  now: number;
  act: Act;
  changeSettings: (patch: Partial<Settings>) => void;
}) {
  const [queueOpen, setQueueOpen] = useState(false);
  const { settings } = desk;
  const queue = (desk.inbox?.items ?? [])
    .filter((i) => ["waiting", "replying", "review"].includes(i.status))
    .sort((a, b) => a.dueAt - b.dueAt);
  const reviewCount = queue.filter((i) => i.status === "review").length;
  const shown = queueOpen
    ? queue.slice(0, 5)
    : queue.filter((i) => i.status === "review");
  return (
    <section className="automation-bar" role="group" aria-label="Automation">
      <div className="automation-chips">
        <AutomationChip
          label="Auto-draft"
          name="Auto-draft new messages"
          icon={<Sparkles size={13} />}
          checked={settings.autoDraft}
          onChange={(autoDraft) => changeSettings({ autoDraft })}
          title="Draft as messages arrive. Clear questions: 8–12 sec · Other messages: 30–45 sec."
        />
        <AutomationChip
          label={STORE_RELEASE ? "Manual send" : "Auto-send"}
          name={
            STORE_RELEASE ? "Manual sending is required" : "Auto-send replies"
          }
          icon={<Send size={13} />}
          checked={STORE_RELEASE ? false : settings.autoSend}
          onChange={(autoSend) => changeSettings({ autoSend })}
          disabled={STORE_RELEASE}
          title={
            STORE_RELEASE
              ? "Review every draft in WhatsApp and click Send yourself."
              : settings.autoSend
                ? "Replies are paced by length. Longer answers may arrive in two messages."
                : "Drafts stay in the chat box for a human to send."
          }
        />
        <AutomationChip
          label="All chats"
          name="Reply across all chats"
          icon={<Users size={13} />}
          checked={settings.allChats}
          onChange={(allChats) => changeSettings({ allChats })}
          title="Reply to new messages across all chats. Chats open automatically to reply; switching pauses while you type."
        />
      </div>
      {desk.replyTiming ? (
        <p className="activity-text reply-countdown" role="timer" aria-live="off">
          <Clock3 size={14} aria-hidden="true" />
          <strong>{replyCountdown(desk.replyTiming, now)}</strong>
        </p>
      ) : desk.activity ? (
        <p className="activity-text" role="status">
          {desk.activity}
        </p>
      ) : null}
      {settings.allChats && (
        <div className="queue-row">
          <button
            type="button"
            className="queue-toggle"
            aria-expanded={queueOpen}
            onClick={() => setQueueOpen(!queueOpen)}
          >
            <Users size={14} />
            <span className="queue-status">
              {desk.inbox?.status ?? "Connecting inbox monitor…"}
            </span>
            {reviewCount > 0 && (
              <span className="badge amber-badge">
                {reviewCount} {reviewCount === 1 ? "needs" : "need"} review
              </span>
            )}
            <ChevronDown size={14} className={queueOpen ? "rotated" : ""} />
          </button>
          {shown.map((item) => (
            <div className="inbox-queue-item" key={item.key}>
              <span>
                <strong>{item.name}</strong>
                <small>
                  {item.status === "waiting"
                    ? replyCountdown(
                        {
                          chatId: item.chatId ?? "",
                          incomingId: item.incomingId ?? null,
                          dueAt: item.dueAt,
                          phase: "quiet",
                        },
                        now,
                      )
                    : item.status === "replying"
                      ? "Preparing reply…"
                      : "Human review needed"}
                </small>
              </span>
              {item.status === "review" && item.chatId && (
                <button
                  className="text-button"
                  title={item.detail}
                  onClick={() =>
                    void act("OPEN_INBOX_ITEM", { key: item.key }).catch(
                      () => {},
                    )
                  }
                >
                  Review <ArrowRight size={13} />
                </button>
              )}
            </div>
          ))}
          {queueOpen && queue.length > 5 && (
            <small className="inbox-monitor-hint">
              {queue.length - 5} more in the queue
            </small>
          )}
        </div>
      )}
    </section>
  );
}
type NoteStatus = "idle" | "saving" | "saved" | "error";
function ClientNotes({
  client,
  save,
}: {
  client: Client;
  save: (chatId: string, notes: string) => Promise<unknown>;
}) {
  const [notes, setNotes] = useState(client.notes);
  const [open, setOpen] = useState(false);
  const [status, setStatus] = useState<NoteStatus>("idle");
  const state = useRef({
    chatId: client.chatId,
    saved: client.notes,
    text: client.notes,
    dirty: false,
  });
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const mounted = useRef(true);
  const saveRef = useRef(save);
  saveRef.current = save;
  function persist(chatId: string, text: string) {
    const current = () => state.current.chatId === chatId;
    if (mounted.current && current()) setStatus("saving");
    return Promise.resolve()
      .then(() => saveRef.current(chatId, text))
      .then(() => {
        if (!current()) return;
        if (state.current.text === text) {
          state.current.saved = text;
          state.current.dirty = false;
        }
        if (mounted.current)
          setStatus(state.current.dirty ? "saving" : "saved");
      })
      .catch(() => {
        if (mounted.current && current()) setStatus("error");
      });
  }
  function flush() {
    clearTimeout(timer.current);
    const s = state.current;
    if (s.dirty) void persist(s.chatId, s.text);
  }
  useEffect(() => {
    const s = state.current;
    if (s.chatId !== client.chatId) {
      clearTimeout(timer.current);
      if (s.dirty) void persist(s.chatId, s.text);
      state.current = {
        chatId: client.chatId,
        saved: client.notes,
        text: client.notes,
        dirty: false,
      };
      setNotes(client.notes);
      setStatus("idle");
    } else if (!s.dirty && client.notes !== s.text) {
      s.saved = client.notes;
      s.text = client.notes;
      setNotes(client.notes);
    }
  }, [client.chatId, client.notes]);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      clearTimeout(timer.current);
      const s = state.current;
      if (s.dirty) void persist(s.chatId, s.text);
    };
  }, []);
  function change(value: string) {
    const s = state.current;
    s.text = value;
    s.dirty = value !== s.saved;
    setNotes(value);
    clearTimeout(timer.current);
    if (s.dirty) timer.current = setTimeout(flush, 800);
    else setStatus("idle");
  }
  const preview = notes.trim().split("\n")[0];
  return (
    <section className="client-notes">
      <button
        type="button"
        className="note-toggle"
        aria-expanded={open}
        onClick={() => setOpen(!open)}
      >
        <StickyNote size={15} />
        <strong>Client note</strong>
        <span className={`note-preview ${preview ? "" : "empty"}`}>
          {preview || "Add a detail worth remembering"}
        </span>
        <span className={`note-status ${status}`} aria-live="polite">
          {status === "saving"
            ? "Saving…"
            : status === "saved"
              ? "Saved"
              : status === "error"
                ? "Not saved"
                : ""}
        </span>
        <ChevronDown size={14} className={open ? "rotated" : ""} />
      </button>
      {open && (
        <textarea
          aria-label="Client note"
          placeholder="A detail worth remembering…"
          rows={3}
          value={notes}
          onChange={(e) => change(e.target.value)}
          onBlur={flush}
          maxLength={5000}
        />
      )}
    </section>
  );
}
function SetupChecklist({
  desk,
  select,
}: {
  desk: DeskState;
  select: (tab: Tab) => void;
}) {
  if (desk.knowledge.length && desk.hasKey) return null;
  return (
    <div className="setup-checklist">
      <h2>Make it yours</h2>
      <button
        className={desk.knowledge.length ? "done" : ""}
        onClick={() => select("knowledge")}
      >
        <BookOpen size={18} />
        <span>Add your business knowledge</span>
        {desk.knowledge.length ? <Check size={16} /> : <ArrowRight size={16} />}
      </button>
      <button
        className={desk.hasKey ? "done" : ""}
        onClick={() => select("settings")}
      >
        <KeyRound size={18} />
        <span>Connect your OpenAI key</span>
        {desk.hasKey ? <Check size={16} /> : <ArrowRight size={16} />}
      </button>
    </div>
  );
}
function PageTitle({
  title,
  subtitle,
  action,
}: {
  title: string;
  subtitle?: string;
  action?: React.ReactNode;
}) {
  return (
    <div className="page-title">
      <div>
        <h1>{title}</h1>
        {subtitle && <p>{subtitle}</p>}
      </div>
      {action}
    </div>
  );
}
function FollowUps({
  desk,
  act,
  now,
}: {
  desk: DeskState;
  act: Act;
  now: number;
}) {
  const [show, setShow] = useState(false);
  const [message, setMessage] = useState("");
  const [when, setWhen] = useState(localInput(Date.now() + 3600000));
  const [mode, setMode] = useState("review");
  const [saving, setSaving] = useState(false);
  const [filter, setFilter] = useState<"upcoming" | "history">("upcoming");
  const items = desk.followUps
    .filter((f) =>
      filter === "upcoming"
        ? ["pending", "ready", "sending"].includes(f.status)
        : ["completed", "cancelled"].includes(f.status),
    )
    .sort((a, b) => a.dueAt - b.dueAt);
  async function save(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    try {
      await act(
        "ADD_FOLLOW_UP",
        { message, dueAt: new Date(when).getTime(), mode },
        "Follow-up scheduled on this device.",
      );
      setShow(false);
      setMessage("");
    } catch {
    } finally {
      setSaving(false);
    }
  }
  return (
    <>
      <PageTitle
        title="Follow-ups"
        subtitle="A timely check-in can turn an enquiry into a client."
        action={
          <button
            className="primary-button compact-button"
            disabled={!desk.context || desk.context.isGroup}
            onClick={() => setShow(!show)}
          >
            <Plus size={15} />
            {show ? "Close" : "Schedule"}
          </button>
        }
      />
      {(!desk.context || desk.context.isGroup) && (
        <p className="field-hint">
          Open an individual client chat to schedule.
        </p>
      )}
      {show && (
        <form className="form-card followup-form" onSubmit={save}>
          <div className="form-card-title">
            <span className="small-avatar">
              <Initials name={desk.context?.name ?? ""} size={15} />
            </span>
            <strong>{desk.context?.name}</strong>
          </div>
          <label>
            Follow-up message
            <textarea
              required
              rows={4}
              maxLength={8000}
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              placeholder="Hi! Just checking in on your enquiry. Can I help with anything?"
            />
          </label>
          <label>
            When
            <input
              type="datetime-local"
              required
              min={localInput(now)}
              value={when}
              onChange={(e) => setWhen(e.target.value)}
            />
          </label>
          <div className="time-shortcuts">
            <button
              type="button"
              onClick={() => setWhen(localInput(Date.now() + 3600000))}
            >
              In 1 hour
            </button>
            <button
              type="button"
              onClick={() => setWhen(localInput(Date.now() + 86400000))}
            >
              Tomorrow
            </button>
            {windowState(desk.context?.lastIncomingAt ?? null).remaining >
              900000 && (
              <button
                type="button"
                onClick={() =>
                  setWhen(
                    localInput(
                      (desk.context?.lastIncomingAt ?? 0) +
                        24 * 3600000 -
                        900000,
                    ),
                  )
                }
              >
                Before window closes
              </button>
            )}
          </div>
          <label>
            At the scheduled time
            <select value={mode} onChange={(e) => setMode(e.target.value)}>
              <option value="review">Remind me to review and send</option>
              <option value="automatic">
                Send if auto-send is on and this chat is open
              </option>
            </select>
          </label>
          <p className="field-hint">
            {mode === "review"
              ? "You get a local reminder. Place the saved message in chat when you are ready."
              : "Needs auto-send on, this exact chat open, an empty chat box and an open response window. Otherwise it becomes a reminder."}
          </p>
          <button
            className="primary-button full-button"
            disabled={saving}
            type="submit"
          >
            {saving ? (
              <LoaderCircle className="spin" size={16} />
            ) : (
              <CalendarClock size={16} />
            )}
            Save follow-up
          </button>
        </form>
      )}
      <div className="segmented">
        <button
          className={filter === "upcoming" ? "selected" : ""}
          onClick={() => setFilter("upcoming")}
        >
          Upcoming{" "}
          <span>
            {
              desk.followUps.filter((f) =>
                ["pending", "ready", "sending"].includes(f.status),
              ).length
            }
          </span>
        </button>
        <button
          className={filter === "history" ? "selected" : ""}
          onClick={() => setFilter("history")}
        >
          History
        </button>
      </div>
      {!items.length ? (
        <div className="empty-state compact">
          <span className="large-icon">
            <CalendarClock size={29} />
          </span>
          <h2>
            {filter === "upcoming"
              ? "A little space in your day."
              : "No completed follow-ups yet."}
          </h2>
          <p>
            {filter === "upcoming"
              ? "Save a message for the client you have open. We’ll bring it back at the right time."
              : "Completed and cancelled follow-ups will appear here."}
          </p>
        </div>
      ) : (
        <div className="followup-list">
          {items.map((f) => (
            <FollowUpCard
              key={f.id}
              item={f}
              act={act}
              now={now}
              context={desk.context}
            />
          ))}
        </div>
      )}
      <div
        className="info-note one-line"
        title={`Keep Chrome running for on-time reminders. If your computer sleeps or the browser closes, overdue items appear when it wakes or reopens. Your timezone: ${Intl.DateTimeFormat().resolvedOptions().timeZone}.`}
      >
        <Bell size={14} />
        <p>
          Reminders need Chrome running ·{" "}
          {Intl.DateTimeFormat().resolvedOptions().timeZone}
        </p>
      </div>
    </>
  );
}
function FollowUpCard({
  item: f,
  act,
  now,
  context,
}: {
  item: FollowUp;
  act: Act;
  now: number;
  context: DeskState["context"];
}) {
  const due =
    f.status === "ready" || (f.status === "pending" && f.dueAt <= now);
  const active = ["ready", "pending", "sending"].includes(f.status);
  return (
    <article className={`followup-item ${due ? "due" : ""}`}>
      <div className="followup-top">
        <div className="small-avatar">
          <Initials name={f.name} size={15} />
        </div>
        <div>
          <strong>{f.name}</strong>
          <small>
            <Clock3 size={11} />
            {dateText(f.dueAt)}
          </small>
        </div>
        <span className={`badge ${due ? "amber-badge" : ""}`}>
          {due ? "Ready" : f.status === "pending" ? "Scheduled" : f.status}
        </span>
      </div>
      <p>{f.message}</p>
      <small className="schedule-mode">
        {f.mode === "automatic" ? <Send size={12} /> : <Bell size={12} />}{" "}
        {f.mode === "automatic"
          ? "Automatic when available"
          : "Review before sending"}
      </small>
      {f.detail && <small className="field-hint">{f.detail}</small>}
      {active && (
        <div className="followup-actions">
          {context?.chatId === f.chatId ? (
            <button
              className="text-button"
              onClick={() =>
                void act(
                  "PLACE_DRAFT",
                  {
                    chatId: f.chatId,
                    incomingId: context.lastIncomingId,
                    text: f.message,
                  },
                  "Follow-up placed in WhatsApp for review.",
                ).catch(() => {})
              }
            >
              Place in chat <ArrowUpRight size={13} />
            </button>
          ) : (
            <button
              className="text-button"
              onClick={() =>
                void act("OPEN_FOLLOW_UP", { id: f.id }).catch(() => {})
              }
            >
              Open client <ArrowUpRight size={13} />
            </button>
          )}
          <button
            className="icon-button"
            aria-label={`Mark follow-up for ${f.name} complete`}
            onClick={() =>
              void act(
                "UPDATE_FOLLOW_UP",
                { id: f.id, status: "completed" },
                "Marked complete.",
              ).catch(() => {})
            }
          >
            <Check size={16} />
          </button>
          <button
            className="icon-button"
            aria-label={`Snooze follow-up for ${f.name} by one hour`}
            onClick={() =>
              void act(
                "UPDATE_FOLLOW_UP",
                { id: f.id, status: "pending" },
                "Snoozed for 1 hour.",
              ).catch(() => {})
            }
          >
            <Clock3 size={16} />
          </button>
          <button
            className="icon-button danger"
            aria-label={`Cancel follow-up for ${f.name}`}
            onClick={() =>
              void act(
                "UPDATE_FOLLOW_UP",
                { id: f.id, status: "cancelled" },
                "Follow-up cancelled.",
              ).catch(() => {})
            }
          >
            <X size={16} />
          </button>
        </div>
      )}
    </article>
  );
}
function KnowledgeView({ desk, act }: { desk: DeskState; act: Act }) {
  const fileInput = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const [note, setNote] = useState(false);
  const [title, setTitle] = useState("");
  const [text, setText] = useState("");
  const [error, setError] = useState("");
  const [search, setSearch] = useState("");
  const [expanded, setExpanded] = useState<string | null>(null);
  const [drag, setDrag] = useState(false);
  const dragDepth = useRef(0);
  async function upload(files: FileList | File[] | null) {
    if (!files?.length) return;
    setUploading(true);
    setError("");
    const errors: string[] = [];
    for (const file of [...files])
      try {
        const text = await readKnowledge(file);
        await act("ADD_KNOWLEDGE", { document: { name: file.name, text } });
      } catch (e) {
        errors.push(`${file.name}: ${(e as Error).message}`);
      }
    setError(errors.join("\n"));
    setUploading(false);
    if (fileInput.current) fileInput.current.value = "";
  }
  async function saveNote(e: React.FormEvent) {
    e.preventDefault();
    try {
      await act(
        "ADD_KNOWLEDGE",
        { document: { name: title.trim(), text: text.trim() } },
        "Business note added.",
      );
      setNote(false);
      setTitle("");
      setText("");
    } catch {}
  }
  const docs = desk.knowledge.filter((k) =>
    `${k.name} ${k.text}`.toLowerCase().includes(search.toLowerCase()),
  );
  const hasDocs = desk.knowledge.length > 0;
  const knowledgeSize = desk.knowledge.reduce((n, k) => n + k.text.length, 0);
  const dropZone = (
    <button
      className={`upload-zone ${drag ? "drag" : ""}`}
      disabled={uploading}
      onClick={() => fileInput.current?.click()}
    >
      <span className="upload-icon">
        {uploading ? (
          <LoaderCircle className="spin" size={22} />
        ) : (
          <UploadCloud size={22} />
        )}
      </span>
      <strong>
        {uploading
          ? "Reading your documents…"
          : "Drop your business documents here"}
      </strong>
      <span>
        or <b>choose files</b> from your device
      </span>
      <small>PDF, DOCX, TXT, MD, CSV, JSON · up to 10 MB each</small>
    </button>
  );
  return (
    <div
      className={`knowledge-view ${drag ? "drag" : ""}`}
      onDragEnter={(e) => {
        e.preventDefault();
        dragDepth.current++;
        setDrag(true);
      }}
      onDragOver={(e) => e.preventDefault()}
      onDragLeave={() => {
        dragDepth.current = Math.max(0, dragDepth.current - 1);
        if (!dragDepth.current) setDrag(false);
      }}
      onDrop={(e) => {
        e.preventDefault();
        dragDepth.current = 0;
        setDrag(false);
        void upload(e.dataTransfer.files);
      }}
    >
      <PageTitle
        title="Knowledge"
        subtitle="The know-how behind every reply."
        action={
          <div className="page-actions">
            <button
              className="secondary-button compact-button"
              disabled={uploading}
              onClick={() => fileInput.current?.click()}
            >
              <UploadCloud size={15} />
              Upload
            </button>
            <button
              className="secondary-button compact-button"
              aria-expanded={note}
              onClick={() => setNote(!note)}
            >
              <Plus size={15} />
              Note
            </button>
          </div>
        }
      />
      <input
        ref={fileInput}
        type="file"
        multiple
        hidden
        accept=".pdf,.docx,.txt,.md,.csv,.json"
        onChange={(e) => void upload(e.target.files)}
      />
      {!hasDocs && dropZone}
      {error && (
        <p role="alert" className="inline-error">
          {error}
        </p>
      )}
      {note && (
        <form className="form-card" onSubmit={saveNote}>
          <label>
            Note title
            <input
              required
              maxLength={150}
              placeholder="e.g. Services and registration fees"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
            />
          </label>
          <label>
            Business knowledge
            <textarea
              required
              rows={7}
              maxLength={300000}
              value={text}
              onChange={(e) => setText(e.target.value)}
              placeholder="Write the information your assistant should use. Include exact prices, what’s included and when to ask a colleague."
            />
          </label>
          <button type="submit" className="primary-button full-button">
            <Check size={16} />
            Add to knowledge
          </button>
        </form>
      )}
      {hasDocs && (
        <div className="library-heading">
          <h2>
            Knowledge library <span>{desk.knowledge.length}</span>
          </h2>
          <span>
            {knowledgeSize < 1000
              ? `${knowledgeSize.toLocaleString()} characters`
              : `${Math.round(knowledgeSize / 1000)}k characters`}
          </span>
        </div>
      )}
      {desk.knowledge.length > 2 && (
        <div className="search-field">
          <Search size={15} />
          <input
            aria-label="Search business knowledge"
            placeholder="Find a document…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
      )}
      <div className="document-list">
        {docs.map((k) => (
          <article className="document-card" key={k.id}>
            <button
              className="document-summary"
              onClick={() => setExpanded(expanded === k.id ? null : k.id)}
              aria-expanded={expanded === k.id}
            >
              <span className="file-icon">
                <FileText size={21} />
              </span>
              <span>
                <strong>{k.name}</strong>
                <small>
                  {k.text.length.toLocaleString()} characters · Added{" "}
                  {new Date(k.addedAt).toLocaleDateString(undefined, {
                    month: "short",
                    day: "numeric",
                  })}
                </small>
              </span>
              <ChevronDown
                size={15}
                className={expanded === k.id ? "rotated" : ""}
              />
            </button>
            {expanded === k.id && (
              <div className="document-body">
                <pre>{k.text}</pre>
                <button
                  className="text-button danger"
                  onClick={() =>
                    void act(
                      "REMOVE_KNOWLEDGE",
                      { id: k.id },
                      "Document removed from knowledge.",
                    ).catch(() => {})
                  }
                >
                  <Trash2 size={14} />
                  Remove document
                </button>
              </div>
            )}
          </article>
        ))}
      </div>
      {hasDocs && !docs.length && (
        <p className="empty-library">No documents match your search.</p>
      )}
      <div
        className="info-note one-line"
        title="Documents stay on this device. Relevant excerpts and the current conversation are sent directly to OpenAI when drafting. Scanned PDFs need readable text or OCR."
      >
        <LockKeyhole size={14} />
        <p>Documents stay on this device · excerpts go to OpenAI when drafting</p>
      </div>
    </div>
  );
}
const CUSTOM_MODEL = "__custom__";
const EDITABLE_SETTINGS = [
  "model",
  "businessName",
  "businessInstructions",
  "dateOrder",
] as const;
type EditableSettings = Pick<Settings, (typeof EDITABLE_SETTINGS)[number]>;
function SettingsSummary({
  title,
  value,
  icon,
}: {
  title: string;
  value?: string;
  icon?: React.ReactNode;
}) {
  return (
    <summary>
      {icon}
      <strong>{title}</strong>
      {value && <small>{value}</small>}
      <ChevronDown size={15} />
    </summary>
  );
}
function LicenseCard({ desk, act }: { desk: DeskState; act: Act }) {
  const [email, setEmail] = useState("");
  const [busy, setBusy] = useState(false);
  const license = desk.license;
  if (!STORE_RELEASE || license.status === "bypass") return null;
  async function checkout() {
    setBusy(true);
    try {
      await act(
        "START_CHECKOUT",
        { email },
        "Stripe Checkout opened in a new tab.",
      );
    } catch {
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="form-card license-card">
      <div className="card-heading">
        <span className="tiny-icon">
          {license.status === "paid" ? (
            <Check size={18} />
          ) : (
            <Clock3 size={18} />
          )}
        </span>
        <div>
          <h2>{license.status === "paid" ? "License active" : `${APP_NAME} trial`}</h2>
          <p>{licenseSummary(license)}</p>
        </div>
        <span className={`key-status ${license.status === "paid" ? "saved" : ""}`}>
          <i />
          {license.status === "paid" ? "Unlocked" : "7-day trial"}
        </span>
      </div>
      {license.status !== "paid" && (
        <>
          <p className="license-copy">
            The one-time unlock is <strong>$9.99 USD</strong>. Stripe handles
            payment on its hosted checkout page. Your OpenAI key remains your
            own and is never sent to Stripe or {APP_NAME}.
          </p>
          {license.status === "unconfigured" ? (
            <p className="inline-error" role="alert">
              Licensing is not configured for this build.
            </p>
          ) : (
            <>
              <label>
                Email for your Stripe receipt (optional)
                <input
                  type="email"
                  autoComplete="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="you@example.com"
                />
              </label>
              <button
                type="button"
                className="primary-button full-button"
                onClick={() => void checkout()}
                disabled={busy}
              >
                {busy ? <LoaderCircle size={16} className="spin" /> : <LockKeyhole size={16} />}
                Unlock for $9.99
              </button>
              <p className="field-hint">
                Already paid? Return to this extension after checkout and
                refresh the license status below.
              </p>
              <button
                type="button"
                className="text-button"
                onClick={() => void act("REFRESH_LICENSE", {}, "License status refreshed.")}
                disabled={busy}
              >
                <RefreshCw size={13} /> Refresh license status
              </button>
            </>
          )}
        </>
      )}
    </section>
  );
}
function SettingsView({ desk, act }: { desk: DeskState; act: Act }) {
  const [edits, setEdits] = useState<Partial<EditableSettings>>({});
  const [key, setKey] = useState("");
  const [saving, setSaving] = useState(false);
  const [loading, setLoading] = useState(false);
  const [showKey, setShowKey] = useState(false);
  const [customModel, setCustomModel] = useState(false);
  const form: Settings = { ...desk.settings, ...edits };
  const changed: Partial<EditableSettings> = {};
  for (const field of EDITABLE_SETTINGS)
    if (field in edits && edits[field] !== desk.settings[field])
      Object.assign(changed, { [field]: edits[field] });
  const dirty = Object.keys(changed).length > 0;
  const edit = (patch: Partial<EditableSettings>) =>
    setEdits((current) => ({ ...current, ...patch }));
  const setAutomation = (patch: Partial<Settings>) =>
    void act("SAVE_SETTINGS", { settings: patch }).catch(() => {});
  async function save(e: React.FormEvent) {
    e.preventDefault();
    if (!dirty) return;
    setSaving(true);
    try {
      await act("SAVE_SETTINGS", { settings: changed }, "Workspace settings saved.");
      setEdits({});
    } catch {
    } finally {
      setSaving(false);
    }
  }
  async function saveKey() {
    if (!key.trim()) return;
    setSaving(true);
    try {
      await act("SAVE_KEY", { key }, "OpenAI key saved locally.");
      setKey("");
      setLoading(true);
      await act("LOAD_MODELS", {}, "Connected. Available models refreshed.");
    } catch {
    } finally {
      setSaving(false);
      setLoading(false);
    }
  }
  const models = [
    ...new Set([
      ...desk.models,
      ...(!desk.models.length ? ["gpt-5-mini", "gpt-4.1-mini", "gpt-4.1"] : []),
    ]),
  ];
  const showCustomModel = customModel || !models.includes(form.model);
  return (
    <>
      <PageTitle title="Settings" />
      <LicenseCard desk={desk} act={act} />
      <details className="form-card settings-section key-card" open={!desk.hasKey}>
        <SettingsSummary
          title="OpenAI connection"
          icon={<KeyRound size={16} />}
          value={desk.hasKey ? "Key saved" : "Not connected"}
        />
        <div className="settings-body">
          <label>
            API key
            <div className="key-input">
              <input
                type={showKey ? "text" : "password"}
                autoComplete="off"
                spellCheck={false}
                value={key}
                onChange={(e) => setKey(e.target.value)}
                placeholder={
                  desk.hasKey
                    ? "Paste a new key to replace the saved one"
                    : "sk-…"
                }
                aria-label="OpenAI API key"
              />
              <button
                type="button"
                className="text-button"
                onClick={() => setShowKey(!showKey)}
              >
                {showKey ? "Hide" : "Show"}
              </button>
            </div>
          </label>
          <button
            type="button"
            className="primary-button full-button"
            onClick={() => void saveKey()}
            disabled={!key.trim() || saving || loading}
          >
            {saving || loading ? (
              <LoaderCircle size={16} className="spin" />
            ) : (
              <LockKeyhole size={16} />
            )}
            Save key & connect
          </button>
          <p className="key-privacy">
            <ShieldCheck size={13} />
            Stored in this extension’s local browser storage. Never synced or
            exposed to the WhatsApp page. Anyone with access to your browser
            profile may access it.
          </p>
          {desk.hasKey && (
            <button
              className="text-button danger"
              onClick={() =>
                void act(
                  "SAVE_KEY",
                  { key: "" },
                  "Saved OpenAI key removed.",
                ).catch(() => {})
              }
            >
              Remove saved key
            </button>
          )}
        </div>
      </details>
      <form
        onSubmit={save}
        onInvalidCapture={(e) =>
          (e.target as HTMLElement).closest("details")?.setAttribute("open", "")
        }
      >
        <details className="form-card settings-section">
          <SettingsSummary
            title="Reply model"
            icon={<Sparkles size={16} />}
            value={form.model}
          />
          <div className="settings-body">
            <div className="label-row">
              <label htmlFor="settings-model">Model</label>
              <button
                className="text-button"
                type="button"
                disabled={!desk.hasKey || loading}
                onClick={async () => {
                  setLoading(true);
                  try {
                    await act("LOAD_MODELS", {}, "Available models refreshed.");
                  } catch {
                  } finally {
                    setLoading(false);
                  }
                }}
              >
                <RefreshCw size={13} className={loading ? "spin" : ""} />
                Refresh
              </button>
            </div>
            <select
              id="settings-model"
              aria-label="Model"
              value={showCustomModel ? CUSTOM_MODEL : form.model}
              onChange={(e) => {
                if (e.target.value === CUSTOM_MODEL) setCustomModel(true);
                else {
                  setCustomModel(false);
                  edit({ model: e.target.value });
                }
              }}
            >
              {models.map((id) => (
                <option key={id} value={id}>
                  {id}
                </option>
              ))}
              <option value={CUSTOM_MODEL}>Custom model ID…</option>
            </select>
            {showCustomModel && (
              <input
                className="model-custom"
                aria-label="Custom model ID"
                value={form.model}
                required
                maxLength={150}
                spellCheck={false}
                onChange={(e) => edit({ model: e.target.value })}
                placeholder="e.g. gpt-5-mini"
              />
            )}
            <p className="field-hint">
              Pick a model or type an ID. Choose one that supports image input
              and structured output to read pictures. Usage is billed to your
              OpenAI account.
            </p>
          </div>
        </details>
        <details className="form-card settings-section">
          <SettingsSummary
            title="Your business voice"
            icon={<MessageCircle size={16} />}
            value={form.businessName}
          />
          <div className="settings-body">
            <label>
              Business name
              <input
                required
                maxLength={150}
                value={form.businessName}
                onChange={(e) => edit({ businessName: e.target.value })}
              />
            </label>
            <label>
              How should your assistant reply?
              <textarea
                rows={6}
                maxLength={6000}
                value={form.businessInstructions}
                onChange={(e) => edit({ businessInstructions: e.target.value })}
              />
            </label>
          </div>
        </details>
        <details className="form-card settings-section">
          <SettingsSummary
            title="Automation"
            icon={<Send size={16} />}
            value={`Draft ${desk.settings.autoDraft ? "on" : "off"} · ${STORE_RELEASE ? "Manual send" : `Send ${desk.settings.autoSend ? "on" : "off"}`} · All chats ${desk.settings.allChats ? "on" : "off"}`}
          />
          <div className="settings-body">
            <div className="automation-row">
              <div>
                <strong>Draft as messages arrive</strong>
                <small>
                  Clear questions: 8–12 sec · Other messages: 30–45 sec
                </small>
              </div>
              <Toggle
                label="Automatically draft new messages"
                checked={desk.settings.autoDraft}
                onChange={(autoDraft) => setAutomation({ autoDraft })}
              />
            </div>
            <div className="automation-row">
              <div>
                <strong>
                  {STORE_RELEASE ? "Manual send" : "Auto-send replies"}
                </strong>
                <small>
                  {STORE_RELEASE
                    ? "Review every draft in WhatsApp and click Send yourself."
                    : desk.settings.autoSend
                      ? "Replies are paced by length. Longer answers may arrive in two messages."
                      : "Drafts stay in the chat box for a human to send."}
                </small>
              </div>
              <Toggle
                label={
                  STORE_RELEASE
                    ? "Manual sending is required"
                    : "Auto-send replies"
                }
                checked={STORE_RELEASE ? false : desk.settings.autoSend}
                disabled={STORE_RELEASE}
                onChange={(autoSend) => setAutomation({ autoSend })}
              />
            </div>
            <div className="automation-row">
              <div>
                <strong>Reply across all chats</strong>
                <small>
                  {desk.settings.allChats
                    ? "Chats open automatically to reply. Switching pauses while you type."
                    : "Reply only in the conversation you open"}
                </small>
              </div>
              <Toggle
                label="Reply to new messages across all chats"
                checked={desk.settings.allChats}
                onChange={(allChats) => setAutomation({ allChats })}
              />
            </div>
          </div>
        </details>
        <details className="form-card settings-section">
          <SettingsSummary
            title="Conversation timestamps"
            icon={<CalendarClock size={16} />}
            value={form.dateOrder === "DMY" ? "Day / month / year" : "Month / day / year"}
          />
          <div className="settings-body">
            <label>
              Date order shown in WhatsApp
              <select
                value={form.dateOrder}
                onChange={(e) =>
                  edit({ dateOrder: e.target.value as Settings["dateOrder"] })
                }
              >
                <option value="DMY">Day / month / year · 23/10/2026</option>
                <option value="MDY">Month / day / year · 10/23/2026</option>
              </select>
            </label>
            <p className="field-hint">
              Match WhatsApp’s displayed dates so the 24-hour countdown is
              accurate. It tracks the latest observed incoming message; it is
              an internal follow-up timer.
            </p>
          </div>
        </details>
        {dirty && (
          <div className="settings-savebar" role="group" aria-label="Unsaved settings">
            <span>Unsaved changes</span>
            <button
              type="button"
              className="secondary-button compact-button"
              onClick={() => setEdits({})}
              disabled={saving}
            >
              Discard
            </button>
            <button
              className="primary-button compact-button"
              type="submit"
              disabled={saving}
            >
              <Check size={15} />
              {saving ? "Saving…" : "Save"}
            </button>
          </div>
        )}
      </form>
      <div
        className="info-note one-line"
        title="Knowledge, keys, client notes and follow-ups live in this browser profile. Removing the extension clears its local data. Automatic replies work only in the open chat and pause during human handoff."
      >
        <Fingerprint size={14} />
        <p>Data lives in this browser profile</p>
      </div>
    </>
  );
}
function DemoWhatsApp({ context }: { context: DeskState["context"] }) {
  return (
    <section className="demo-whatsapp" aria-label="WhatsApp design preview">
      <aside className="demo-rail">
        <span className="demo-wa-icon">
          <MessageCircle size={21} />
        </span>
        <CalendarClock size={21} />
        <Users size={21} />
        <span className="rail-bottom">
          <Settings2 size={21} />
          <div className="demo-me">{BRAND_PREFIX.slice(0, 2)}</div>
        </span>
      </aside>
      <div className="demo-inbox">
        <header>
          <h2>WhatsApp</h2>
          <div>
            <Plus size={20} />
            <MoreHorizontal size={20} />
          </div>
        </header>
        <div className="demo-search">
          <Search size={17} />
          <span>Search or start a new chat</span>
        </div>
        <div className="inbox-filters">
          <span className="selected">All</span>
          <span>Unread</span>
          <span>Favourites</span>
        </div>
        {[
          {
            name: "Tariro M.",
            time: "17:08",
            message: "What documents will I need?",
            active: true,
          },
          {
            name: "Brian N.",
            time: "16:42",
            message: "Thank you, I’ll send those through.",
          },
          {
            name: "Chiedza K.",
            time: "15:21",
            message: "Hi, I saw your company registration ad.",
          },
          {
            name: "Farai D.",
            time: "Yesterday",
            message: "Perfect. Let’s go ahead.",
          },
        ].map((c) => (
          <div
            className={`inbox-client ${c.active ? "active" : ""}`}
            key={c.name}
          >
            <div className="demo-avatar">{initials(c.name)}</div>
            <div>
              <strong>{c.name}</strong>
              <p>{c.message}</p>
            </div>
            <time>{c.time}</time>
          </div>
        ))}
        <div className="inbox-encrypted">
          <LockKeyhole size={12} />
          Your personal messages are end-to-end encrypted
        </div>
      </div>
      <div className="demo-conversation">
        <header>
          <div className="demo-avatar">TM</div>
          <div>
            <strong>{context?.name ?? "Tariro M."}</strong>
            <small>Business enquiry</small>
          </div>
          <Search size={20} />
          <MoreHorizontal size={22} />
        </header>
        <div className="demo-message-area">
          <span className="date-pill">Today</span>
          <span className="encrypted-pill">
            <LockKeyhole size={10} />
            Messages are end-to-end encrypted
          </span>
          {context?.messages.map((m) => (
            <div className={`demo-bubble ${m.direction}`} key={m.id}>
              <p>{m.text}</p>
              <small>
                {new Date(m.at ?? Date.now()).toLocaleTimeString(undefined, {
                  hour: "2-digit",
                  minute: "2-digit",
                })}
                {m.direction === "out" && <CheckCheck size={14} />}
              </small>
            </div>
          ))}
          <div className="demo-quiet-note">
            <Sparkles size={16} />
            <span>
              A good conversation starts
              <br />
              with a little understanding.
            </span>
          </div>
        </div>
        <div className="demo-composer">
          <Plus size={23} />
          <span>Type a message</span>
          <Send size={20} />
        </div>
      </div>
    </section>
  );
}
createRoot(document.getElementById("root")!).render(<App />);

document.title = APP_NAME;
