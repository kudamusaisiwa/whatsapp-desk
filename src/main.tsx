import { APP_NAME, BRAND_PREFIX } from "./product";
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
          {locked ? "Your WhatsApp Desk trial has ended" : "WhatsApp Desk trial"}
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
  const [toast, setToast] = useState("");
  const [busy, setBusy] = useState(false);
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
  const draft =
    desk.draft?.chatId === context?.chatId &&
    desk.draft?.incomingId === context?.lastIncomingId
      ? desk.draft
      : null;
  async function generate() {
    setBusy(true);
    try {
      const d = await act("GENERATE");
      notify(
        d.placement === "Sent automatically"
          ? "Reply sent automatically."
          : "Reply placed in WhatsApp. Review it before sending.",
      );
    } catch {
    } finally {
      setBusy(false);
    }
  }
  const panel = (
    <div className="desk">
      <header className="desk-header">
        <div className="wordmark">
          <span className="brand-mark">
            <MessageCircle size={22} strokeWidth={1.9} />
            <i />
          </span>
          <div>
            <strong>
              {BRAND_PREFIX} <span>Desk</span>
            </strong>
            <small>Your client companion</small>
          </div>
        </div>
        <div className="header-tools">
          <span className={`connection ${isExtension ? "" : "preview-status"}`}>
            <i />
            {isExtension ? "Local workspace" : "Preview"}
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
        {tab === "assistant" && (
          <>
            <div className="section-label">
              <span>CONVERSATION DESK</span>
              <span className="live">
                <i />
                {context ? "Chat connected" : "Waiting for a chat"}
              </span>
            </div>
            <section
              className="inbox-monitor"
              aria-label="All-chat reply queue"
            >
              <div className="inbox-monitor-head">
                <span className="inbox-monitor-icon">
                  <Users size={17} />
                </span>
                <div>
                  <strong>Reply across all chats</strong>
                  <small>
                    {desk.settings.allChats
                      ? (desk.inbox?.status ?? "Connecting inbox monitor…")
                      : "Reply only in the conversation you open"}
                  </small>
                </div>
                <Toggle
                  label="Reply to new messages across all chats"
                  checked={desk.settings.allChats}
                  onChange={(allChats) => changeSettings({ allChats })}
                />
              </div>
              {desk.settings.allChats && (
                <>
                  <p className="inbox-monitor-hint">
                    Chats open automatically to reply. Switching pauses while
                    you type.
                  </p>
                  {desk.inbox?.items
                    .filter((i) =>
                      ["waiting", "replying", "review"].includes(i.status),
                    )
                    .sort((a, b) => a.dueAt - b.dueAt)
                    .slice(0, 5)
                    .map((item) => (
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
                                  clock,
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
                              void act("OPEN_INBOX_ITEM", {
                                key: item.key,
                              }).catch(() => {})
                            }
                          >
                            Review <ArrowRight size={13} />
                          </button>
                        )}
                      </div>
                    ))}
                  {desk.inbox &&
                    desk.inbox.items.filter((i) =>
                      ["waiting", "replying", "review"].includes(i.status),
                    ).length > 5 && (
                      <small className="inbox-monitor-hint">
                        {desk.inbox.items.filter((i) =>
                          ["waiting", "replying", "review"].includes(i.status),
                        ).length - 5}{" "}
                        more in the queue
                      </small>
                    )}
                </>
              )}
            </section>
            {context && client ? (
              <>
                <div className="client-heading">
                  <div className="avatar">
                    <Initials name={context.name} size={22} />
                  </div>
                  <div className="client-title">
                    <h1 title={context.name}>{context.name}</h1>
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
                  </div>
                  <button
                    className="icon-button client-schedule"
                    aria-label="Schedule a follow-up for this client"
                    onClick={() => setTab("followups")}
                  >
                    <CalendarClock size={20} />
                  </button>
                </div>
                <WindowCard
                  incoming={
                    context.lastIncomingId && context.lastIncomingAt === null
                      ? null
                      : Math.max(
                          client.lastIncomingAt ?? 0,
                          context.lastIncomingAt ?? 0,
                        ) || null
                  }
                  now={clock}
                />
                <div className="handoff-row">
                  <div>
                    <span
                      className={`tiny-icon ${client.human ? "amber" : ""}`}
                    >
                      <Headphones size={17} />
                    </span>
                    <div>
                      <strong>
                        {client.human
                          ? "Human is handling this"
                          : "Human support"}
                      </strong>
                      <small>
                        {client.human
                          ? "Automatic replies are paused"
                          : "Take over whenever you need"}
                      </small>
                    </div>
                  </div>
                  <button
                    className={`subtle-button ${client.human ? "amber-text" : ""}`}
                    onClick={() =>
                      void act(
                        "UPDATE_CLIENT",
                        {
                          chatId: context.chatId,
                          patch: { human: !client.human },
                        },
                        client.human
                          ? "Assistant resumed."
                          : "Human handoff enabled. Automatic replies paused.",
                      ).catch(() => {})
                    }
                  >
                    {client.human ? "Resume AI" : "Take over"}
                    <ArrowRight size={13} />
                  </button>
                </div>
                <div className="section-title">
                  <h2>
                    <Sparkles size={16} />
                    Reply assistant
                  </h2>
                  <span className="model-tag">{desk.settings.model}</span>
                </div>
                {context.messages.slice(-35).some((m) => m.images?.length) && (
                  <p className="field-hint" role="status">
                    Pictures detected · the AI will read their contents with
                    this conversation. Open or download any blurred image in
                    WhatsApp first.
                  </p>
                )}
                <div className={`reply-card ${busy ? "generating" : ""}`}>
                  <div className="reply-top">
                    <span>
                      <i />
                      {busy
                        ? "Drafting your reply"
                        : draft
                          ? "Suggested reply"
                          : "Ready when you are"}
                    </span>
                    <Sparkles size={16} />
                  </div>
                  {busy ? (
                    <div className="draft-loading">
                      <span />
                      <span />
                      <span />
                      <p>Finding the right answer in your knowledge…</p>
                    </div>
                  ) : draft ? (
                    <>
                      <p className="draft-text">{draft.reply}</p>
                      {draft.needsHuman && (
                        <div className="review-note">
                          <Headphones size={14} />
                          <span>
                            {draft.reason ||
                              "A human should review this reply."}
                          </span>
                        </div>
                      )}
                      <div className="draft-sources">
                        <BookOpen size={13} />
                        <span>
                          {draft.sources.length
                            ? draft.sources
                                .map(
                                  (id) =>
                                    desk.knowledge.find((k) => k.id === id)
                                      ?.name,
                                )
                                .filter(Boolean)
                                .join(", ")
                            : "General conversation · no business facts cited"}
                        </span>
                      </div>
                    </>
                  ) : (
                    <div className="reply-empty">
                      <div className="sparkle-pair">
                        <Sparkles size={24} />
                      </div>
                      <h3>A thoughtful reply, one click away.</h3>
                      <p>
                        Uses this conversation and your business knowledge.
                        Lands right in the WhatsApp chat box.
                      </p>
                    </div>
                  )}
                  <button
                    className="primary-button draft-button"
                    onClick={() => void generate()}
                    disabled={busy || context.isGroup || !context.composerEmpty}
                  >
                    {busy ? (
                      <LoaderCircle size={17} className="spin" />
                    ) : (
                      <Sparkles size={17} />
                    )}
                    <span>
                      {busy
                        ? "Drafting reply…"
                        : !context.composerEmpty
                          ? "Review your reply in WhatsApp"
                          : desk.settings.autoSend && !client.human
                            ? "Draft & send reply"
                            : draft
                              ? "Draft another reply"
                              : "Draft a reply"}
                    </span>
                    {!busy && <ArrowUpRight size={17} />}
                  </button>
                  <div className="reply-footnote">
                    <ShieldCheck size={12} />
                    {!context.composerEmpty
                      ? "Send or clear the chat box before drafting again."
                      : draft?.placement === "Sent automatically"
                        ? draft.placement
                        : desk.settings.autoSend && !client.human
                          ? "Auto-send is on · supported replies may send"
                          : "You review. You decide when to send."}
                  </div>
                </div>
                {!desk.hasKey && (
                  <button
                    className="setup-link"
                    onClick={() => setTab("settings")}
                  >
                    <KeyRound size={16} />
                    <span>Connect OpenAI to start drafting</span>
                    <ChevronRight size={16} />
                  </button>
                )}
                <div className="automation-group">
                  <div className="automation-card">
                    <div>
                      <div className="automation-title">
                        <Send size={15} />
                        <strong>
                          {STORE_RELEASE ? "Manual send" : "Auto-send"}
                        </strong>
                        <span
                          className={
                            desk.settings.autoSend
                              ? "badge active-badge"
                              : "badge"
                          }
                        >
                          {STORE_RELEASE
                            ? "REQUIRED"
                            : desk.settings.autoSend
                              ? "ON"
                              : "OFF"}
                        </span>
                      </div>
                      <p>
                        {STORE_RELEASE
                          ? "Review every draft in WhatsApp and click Send yourself."
                          : desk.settings.autoSend
                          ? "Replies are paced by length. Longer answers may arrive in two messages."
                          : "Drafts stay in the chat box for a human to send."}
                      </p>
                    </div>
                    <Toggle
                      label={
                        STORE_RELEASE
                          ? "Manual sending is required"
                          : "Auto-send replies"
                      }
                      checked={desk.settings.autoSend}
                      onChange={(v) => changeSettings({ autoSend: v })}
                      disabled={STORE_RELEASE}
                    />
                  </div>
                  <div className="auto-draft-row">
                    <div>
                      <strong>Draft as messages arrive</strong>
                      <small>
                        Clear questions: 8–12 sec · Other messages: 30–45 sec
                      </small>
                    </div>
                    <Toggle
                      label="Automatically draft new messages"
                      checked={desk.settings.autoDraft}
                      onChange={(v) => changeSettings({ autoDraft: v })}
                    />
                  </div>
                </div>
                {desk.replyTiming ? (
                  <p
                    className="activity-text reply-countdown"
                    role="timer"
                    aria-live="off"
                  >
                    <Clock3 size={14} aria-hidden="true" />
                    <strong>{replyCountdown(desk.replyTiming, clock)}</strong>
                  </p>
                ) : desk.activity && !busy ? (
                  <p className="activity-text" role="status">
                    {desk.activity}
                  </p>
                ) : null}
                <ClientNotes
                  client={client}
                  save={(notes) =>
                    act(
                      "UPDATE_CLIENT",
                      { chatId: client.chatId, patch: { notes } },
                      "Client note saved",
                    )
                  }
                />
              </>
            ) : (
              <>
                <div className="empty-state">
                  <span className="large-icon">
                    <MessageCircle size={32} />
                  </span>
                  <h1>Your next great conversation starts here.</h1>
                  <p>
                    Open an individual client chat in WhatsApp. Their reply
                    window, AI assistant and follow-ups will appear here.
                  </p>
                </div>
                <SetupChecklist desk={desk} select={setTab} />
              </>
            )}
            <button
              className="knowledge-shortcut"
              onClick={() => setTab("knowledge")}
            >
              <span className="tiny-icon">
                <BookOpen size={17} />
              </span>
              <div>
                <strong>Your business knowledge</strong>
                <small>
                  {desk.knowledge.length
                    ? `${desk.knowledge.length} document${desk.knowledge.length === 1 ? "" : "s"} ready for replies`
                    : "Add your services, prices and FAQs"}
                </small>
              </div>
              <ChevronRight size={17} />
            </button>
          </>
        )}
        {tab === "followups" && <FollowUps desk={desk} act={act} now={clock} />}
        {tab === "knowledge" && <KnowledgeView desk={desk} act={act} />}
        {tab === "settings" && <SettingsView desk={desk} act={act} />}
      </main>
      <footer className="desk-footer">
        <span>
          <Fingerprint size={13} />
          Saved on this device
        </span>
        <span>
          Made for better conversations <i>✦</i>
        </span>
      </footer>
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
function WindowCard({
  incoming,
  now,
}: {
  incoming: number | null;
  now: number;
}) {
  const w = windowState(incoming, now);
  const urgent = w.known && w.remaining < 3 * 3600000;
  return (
    <section
      className={`window-card ${urgent ? "urgent" : ""}`}
      aria-label="24-hour customer response window"
    >
      <div className="window-top">
        <span>
          <Clock3 size={14} />
          24-hour response window
        </span>
        <span className="window-state">
          <i />
          {!w.known ? "Not yet known" : w.open ? "Open" : "Closed"}
        </span>
      </div>
      <div className="countdown">
        <span>{w.display}</span>
        <small>
          {!w.known
            ? "Open the latest messages"
            : w.open
              ? "time remaining"
              : "window has ended"}
        </small>
      </div>
      <div className="window-track">
        <span style={{ width: `${w.progress * 100}%` }} />
      </div>
      <div className="window-detail">
        <span>
          {incoming
            ? `Last customer message · ${new Intl.DateTimeFormat(undefined, { hour: "2-digit", minute: "2-digit", month: "short", day: "numeric" }).format(incoming)}`
            : "Waiting for a readable customer timestamp"}
        </span>
        <CircleHelp size={13}>
          <title>
            Tracks 24 hours from the latest observed customer message. Your
            outgoing replies do not reset it.
          </title>
        </CircleHelp>
      </div>
    </section>
  );
}
type Act = (
  type: string,
  payload?: Record<string, unknown>,
  success?: string,
) => Promise<any>;
function ClientNotes({
  client,
  save,
}: {
  client: Client;
  save: (notes: string) => Promise<any>;
}) {
  const [notes, setNotes] = useState(client.notes);
  useEffect(() => setNotes(client.notes), [client.chatId, client.notes]);
  return (
    <div className="client-notes">
      <div className="section-title">
        <h2>Client note</h2>
        {notes !== client.notes && (
          <button
            className="text-button"
            onClick={() => void save(notes).catch(() => {})}
          >
            Save note
          </button>
        )}
      </div>
      <textarea
        aria-label="Client note"
        placeholder="A detail worth remembering…"
        rows={2}
        value={notes}
        onChange={(e) => setNotes(e.target.value)}
        maxLength={5000}
      />
    </div>
  );
}
function SetupChecklist({
  desk,
  select,
}: {
  desk: DeskState;
  select: (tab: Tab) => void;
}) {
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
      <div className="page-heading">
        <span className="eyebrow">A LITTLE FOLLOW-THROUGH</span>
        <h1>Keep the conversation going.</h1>
        <p>A timely check-in can turn an enquiry into a client.</p>
      </div>
      <button
        className="primary-button full-button"
        disabled={!desk.context || desk.context.isGroup}
        onClick={() => setShow(!show)}
      >
        <Plus size={18} />
        {show ? "Close new follow-up" : "Schedule a follow-up"}
      </button>
      {!desk.context && (
        <p className="field-hint">
          Open the client’s WhatsApp conversation first.
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
      <div className="info-note">
        <Bell size={16} />
        <p>
          Keep Chrome running for on-time reminders. If your computer sleeps or the
          browser closes, overdue items appear when it wakes or reopens. Your
          timezone:{" "}
          <strong>{Intl.DateTimeFormat().resolvedOptions().timeZone}</strong>.
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
  return (
    <>
      <div className="page-heading">
        <span className="eyebrow">THE KNOW-HOW BEHIND EVERY REPLY</span>
        <h1>
          Your business,
          <br />
          in its own words.
        </h1>
        <p>
          Give your assistant the information you trust. Services, pricing,
          processes and those often-asked questions.
        </p>
      </div>
      <input
        ref={fileInput}
        type="file"
        multiple
        hidden
        accept=".pdf,.docx,.txt,.md,.csv,.json"
        onChange={(e) => void upload(e.target.files)}
      />
      <button
        className={`upload-zone ${drag ? "drag" : ""}`}
        disabled={uploading}
        onClick={() => fileInput.current?.click()}
        onDragOver={(e) => {
          e.preventDefault();
          setDrag(true);
        }}
        onDragLeave={() => setDrag(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDrag(false);
          void upload(e.dataTransfer.files);
        }}
      >
        <span className="upload-icon">
          {uploading ? (
            <LoaderCircle className="spin" size={25} />
          ) : (
            <UploadCloud size={25} />
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
      {error && (
        <p role="alert" className="inline-error">
          {error}
        </p>
      )}
      <button
        className="secondary-button full-button"
        onClick={() => setNote(!note)}
      >
        <Plus size={16} />
        {note ? "Close note" : "Write a business note"}
      </button>
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
      <div className="library-heading">
        <h2>
          Knowledge library <span>{desk.knowledge.length}</span>
        </h2>
        <span>
          {Math.round(
            desk.knowledge.reduce((n, k) => n + k.text.length, 0) / 1000,
          )}
          k characters
        </span>
      </div>
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
      {!docs.length && (
        <p className="empty-library">
          {search
            ? "No documents match your search."
            : "Your library is ready for its first document."}
        </p>
      )}
      <div className="info-note">
        <LockKeyhole size={16} />
        <p>
          Documents stay on this device. Relevant excerpts and the current
          conversation are sent directly to OpenAI when drafting. Scanned PDFs
          need readable text or OCR.
        </p>
      </div>
    </>
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
          <h2>{license.status === "paid" ? "License active" : "WhatsApp Desk trial"}</h2>
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
            own and is never sent to Stripe or WhatsApp Desk.
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
  const [form, setForm] = useState({ ...desk.settings });
  const [key, setKey] = useState("");
  const [saving, setSaving] = useState(false);
  const [loading, setLoading] = useState(false);
  const [showKey, setShowKey] = useState(false);
  async function save(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    try {
      await act(
        "SAVE_SETTINGS",
        { settings: form },
        "Workspace settings saved.",
      );
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
      form.model,
      ...desk.models,
      ...(!desk.models.length ? ["gpt-5-mini", "gpt-4.1-mini", "gpt-4.1"] : []),
    ]),
  ];
  return (
    <>
      <div className="page-heading">
        <span className="eyebrow">SET UP YOUR WAY OF WORKING</span>
        <h1>
          A little setup.
          <br />A lot less typing.
        </h1>
        <p>Your AI connection, your business voice, your control.</p>
      </div>
      <LicenseCard desk={desk} act={act} />
      <section className="form-card key-card">
        <div className="card-heading">
          <span className="tiny-icon">
            <KeyRound size={19} />
          </span>
          <div>
            <h2>OpenAI connection</h2>
            <p>
              {desk.hasKey
                ? "A key is saved on this device"
                : "Bring your own OpenAI API key"}
            </p>
          </div>
          <span className={`key-status ${desk.hasKey ? "saved" : ""}`}>
            <i />
            {desk.hasKey ? "Key saved" : "Not connected"}
          </span>
        </div>
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
      </section>
      <form onSubmit={save}>
        <section className="form-card">
          <div className="section-title">
            <h2>
              <Sparkles size={16} />
              Reply model
            </h2>
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
          <label>
            Model
            <select
              value={form.model}
              onChange={(e) => setForm({ ...form, model: e.target.value })}
            >
              {models.map((id) => (
                <option key={id}>{id}</option>
              ))}
            </select>
          </label>
          <label className="custom-model-label">
            Or enter a model ID
            <input
              value={form.model}
              required
              maxLength={150}
              onChange={(e) => setForm({ ...form, model: e.target.value })}
              placeholder="e.g. gpt-5-mini"
            />
          </label>
          <p className="field-hint">
            Refresh loads models available to your OpenAI project. Choose one
            that supports image input, Responses and structured output to read
            pictures and screenshots. OpenAI usage is billed to your API
            account.
          </p>
        </section>
        <section className="form-card">
          <h2>Your business voice</h2>
          <label>
            Business name
            <input
              required
              maxLength={150}
              value={form.businessName}
              onChange={(e) =>
                setForm({ ...form, businessName: e.target.value })
              }
            />
          </label>
          <label>
            How should your assistant reply?
            <textarea
              rows={6}
              maxLength={6000}
              value={form.businessInstructions}
              onChange={(e) =>
                setForm({ ...form, businessInstructions: e.target.value })
              }
            />
          </label>
        </section>
        <section className="form-card">
          <h2>Conversation timestamps</h2>
          <label>
            Date order shown in WhatsApp
            <select
              value={form.dateOrder}
              onChange={(e) =>
                setForm({
                  ...form,
                  dateOrder: e.target.value as Settings["dateOrder"],
                })
              }
            >
              <option value="DMY">Day / month / year · 23/10/2026</option>
              <option value="MDY">Month / day / year · 10/23/2026</option>
            </select>
          </label>
          <p className="field-hint">
            Match WhatsApp’s displayed dates so the 24-hour countdown is
            accurate. It tracks the latest observed incoming message; it is an
            internal follow-up timer.
          </p>
        </section>
        <button
          className="primary-button full-button"
          type="submit"
          disabled={saving}
        >
          <Check size={17} />
          {saving ? "Saving…" : "Save workspace settings"}
        </button>
      </form>
      <div className="info-note">
        <Fingerprint size={16} />
        <p>
          Knowledge, keys, client notes and follow-ups live in this browser
          profile. Removing the extension clears its local data. Automatic
          replies work only in the open chat and pause during human handoff.
        </p>
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
