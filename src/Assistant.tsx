import React, { useEffect, useRef, useState } from "react";
import { BookOpen, Check, CircleHelp, ClipboardPaste, Copy, LoaderCircle, Sparkles, WandSparkles } from "lucide-react";
import { rpc } from "./bridge";
import { SPEECH_PRIVACY_NOTE, SpeechInput } from "./speech";
import type { DeskState, Draft } from "./types";
import { defaultRoutes, PROVIDERS } from "./providers";

type Target = { chatId: string; name: string };
type PolishStyle = "professional" | "shorten" | "clarify" | "summarize";
const MAX_INSERT_LENGTH = 5000;
const BOX_HAS_TEXT = "WhatsApp's message box already has text. Clear it to insert, or use Copy.";
type InsertNotice = { key: string; conflict: boolean; text: string };
const polishOptions: { style: PolishStyle; label: string }[] = [
  { style: "professional", label: "Make professional" },
  { style: "shorten", label: "Shorten" },
  { style: "clarify", label: "Clarify" },
  { style: "summarize", label: "Summarize" },
];

/** Manual assistance stays available independently of WhatsApp's send controls. */
export function Assistant({ desk, refresh, openSettings }: { desk: DeskState; refresh: () => Promise<void>; openSettings: () => void }) {
  const [instruction, setInstruction] = useState("");
  const [result, setResult] = useState<Draft | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [copied, setCopied] = useState(false);
  const [dictated, setDictated] = useState(false);
  const [dictationTarget, setDictationTarget] = useState<Target | null>(null);
  const [syncing, setSyncing] = useState(false);
  const [syncNotice, setSyncNotice] = useState("");
  const [syncConflict, setSyncConflict] = useState(false);
  const [polishOpen, setPolishOpen] = useState(false);
  const [polishing, setPolishing] = useState(false);
  const [undoText, setUndoText] = useState<string | null>(null);
  const [helpOpen, setHelpOpen] = useState(false);
  const [inserting, setInserting] = useState(false);
  const [insertedKey, setInsertedKey] = useState("");
  const [insertNotice, setInsertNotice] = useState<InsertNotice | null>(null);
  const insertInFlight = useRef(false);
  const recordingTarget = useRef<Target | null>(null);
  const polishWrapRef = useRef<HTMLDivElement | null>(null);
  const polishTriggerRef = useRef<HTMLButtonElement | null>(null);
  const instructionRef = useRef(instruction);
  const targetRef = useRef<Target | null>(dictationTarget);
  const dictatedRef = useRef(dictated);
  const contextIdRef = useRef(desk.context?.chatId ?? null);
  const contextRef = useRef(desk.context);
  const contextId = desk.context?.chatId ?? null;
  const routes = { ...defaultRoutes(desk.settings.model), ...desk.settings.aiRoutes };
  const sttReady = desk.providerStatus?.[routes.stt.provider] ?? (routes.stt.provider === "openai" && desk.hasKey);
  const textProvider = PROVIDERS.find((provider) => provider.id === routes.text.provider)?.label ?? routes.text.provider;
  contextIdRef.current = contextId;
  instructionRef.current = instruction;
  targetRef.current = dictationTarget;
  dictatedRef.current = dictated;
  const contentRevision = useRef(0);
  const syncQueue = useRef<Promise<unknown>>(Promise.resolve());
  const expectedByChat = useRef(new Map<string, string>());
  const outgoingBaselineByChat = useRef(new Map<string, Set<string>>());
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const inFlight = useRef(false);
  const mounted = useRef(true);
  const context = desk.context;
  const saved = desk.draft?.chatId === context?.chatId && desk.draft?.incomingId === context?.lastIncomingId ? desk.draft : null;
  const suggestion = result ?? saved;
  contextRef.current = desk.context;
  const suggestionKey = suggestion ? `${suggestion.createdAt}:${suggestion.reply}` : "";
  const canInsert = !!context && !!suggestion && (!suggestion.placementReason || suggestion.placementReason === "panel-only");
  const otherChat = !!(context && suggestion?.chatId && suggestion.chatId !== context.chatId);
  const tooLong = !!suggestion && suggestion.reply.length > MAX_INSERT_LENGTH;
  const noticeForSuggestion = insertNotice && insertNotice.key === suggestionKey ? insertNotice : null;

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      if (debounceRef.current) clearTimeout(debounceRef.current);
      debounceRef.current = null;
    };
  }, []);

  useEffect(() => {
    if (!polishOpen) return;
    const dismiss = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setPolishOpen(false);
        polishTriggerRef.current?.focus();
      }
    };
    const clickOutside = (event: PointerEvent) => {
      if (event.target instanceof Node && !polishWrapRef.current?.contains(event.target)) setPolishOpen(false);
    };
    document.addEventListener("keydown", dismiss);
    document.addEventListener("pointerdown", clickOutside);
    document.querySelector<HTMLButtonElement>('[role="menuitem"]')?.focus();
    return () => {
      document.removeEventListener("keydown", dismiss);
      document.removeEventListener("pointerdown", clickOutside);
    };
  }, [polishOpen]);

  async function ask() {
    if (inFlight.current) return;
    inFlight.current = true;
    setBusy(true);
    setError("");
    setCopied(false);
    try {
      const reply = await rpc<Draft>("GENERATE", { instruction: instruction.trim(), assistOnly: true });
      setResult(reply);
      void refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Assistance could not finish. Please try again.");
    } finally {
      inFlight.current = false;
      setBusy(false);
    }
  }

  async function insertSuggestion() {
    if (!context || !suggestion || insertInFlight.current || syncing || otherChat || tooLong) return;
    const key = suggestionKey;
    if (context.composerEmpty === false) {
      setInsertNotice({ key, conflict: true, text: BOX_HAS_TEXT });
      return;
    }
    insertInFlight.current = true;
    setInserting(true);
    setInsertNotice(null);
    try {
      await rpc("SYNC_MESSAGE", { chatId: context.chatId, text: suggestion.reply, expectedText: "" });
      if (!mounted.current) return;
      setInsertedKey(key);
      setInsertNotice({ key, conflict: false, text: "Added to WhatsApp — review and send there." });
    } catch (e) {
      if (!mounted.current) return;
      const message = e instanceof Error ? e.message : "";
      setInsertNotice({
        key,
        conflict: true,
        text: /message changed/i.test(message) ? BOX_HAS_TEXT : message || "Could not add the suggestion to WhatsApp. Use Copy instead.",
      });
    } finally {
      insertInFlight.current = false;
      if (mounted.current) setInserting(false);
    }
  }

  function queueSync(text: string, target: Target | null = targetRef.current, resetExpected = false) {
    if (!target) {
      setSyncNotice("Open the WhatsApp chat you want to use before dictating.");
      setSyncConflict(true);
      return;
    }
    if (debounceRef.current) { clearTimeout(debounceRef.current); debounceRef.current = null; }
    setSyncing(true);
    setSyncNotice("Adding text to WhatsApp…");
    setSyncConflict(false);
    const chain = syncQueue.current.then(async () => {
      if (!mounted.current) return false;
      if (contextIdRef.current !== target.chatId) {
        throw new Error(`Open ${target.name} in WhatsApp before syncing. Your text is still saved here.`);
      }
      const expectedText = resetExpected ? "" : (expectedByChat.current.get(target.chatId) ?? "");
      if (!outgoingBaselineByChat.current.has(target.chatId)) {
        outgoingBaselineByChat.current.set(target.chatId, new Set(
          contextRef.current?.messages.filter((message) => message.direction === "out").map((message) => message.id) ?? [],
        ));
      }
      const response = await rpc<{ synced: boolean; text: string }>("SYNC_MESSAGE", {
        chatId: target.chatId, text, expectedText,
      });
      // The queue serializes writes. The reply is the verified content now in the composer.
      expectedByChat.current.set(target.chatId, response.text);
      return true;
    }).catch((e) => {
      const message = e instanceof Error ? e.message : "Could not sync text to WhatsApp. Your panel draft is safe.";
      if (mounted.current) {
        setSyncNotice(message);
        setSyncConflict(true);
      }
      return false;
    });
    syncQueue.current = chain;
    // A later request, if any, owns the status and the final composer content.
    void chain.then((synced) => {
      if (syncQueue.current === chain) {
        if (mounted.current) setSyncing(false);
        if (synced && mounted.current) {
          setSyncNotice("Added to WhatsApp — review and send there.");
          setSyncConflict(false);
        }
      }
    });
  }

  function changeInstruction(value: string) {
    contentRevision.current++;
    instructionRef.current = value;
    setInstruction(value);
    setError("");
    setSyncNotice("");
    setUndoText(null);
    if (dictatedRef.current) {
      const target = targetRef.current;
      if (debounceRef.current) clearTimeout(debounceRef.current);
      debounceRef.current = setTimeout(() => queueSync(instructionRef.current, target), 300);
    }
    if (!value.trim() && !dictatedRef.current) {
      setDictated(false);
      setDictationTarget(null);
      targetRef.current = null;
    }
  }

  function onTranscript(text: string) {
    const current = instructionRef.current;
    const next = `${current}${current && !/\s$/.test(current) ? " " : ""}${text}`.slice(0, 5000);
    const target = targetRef.current ?? recordingTarget.current;
    contentRevision.current++;
    instructionRef.current = next;
    targetRef.current = target;
    dictatedRef.current = true;
    setInstruction(next);
    setDictationTarget(target);
    setDictated(true);
    setError("");
    setUndoText(null);
    queueSync(next, target);
  }

  function onRecordingStart() {
    const currentChat = context;
    const target = targetRef.current;
    const lastSynced = target ? expectedByChat.current.get(target.chatId) : undefined;
    const lastOutgoing = currentChat?.messages.filter((message) => message.direction === "out").at(-1);
    const initialOutgoingIds = target ? outgoingBaselineByChat.current.get(target.chatId) : undefined;
    // If WhatsApp has sent this exact panel draft, start the next recording cleanly.
    // A merely empty composer is not enough: require the matching outgoing message.
    if (currentChat?.composerEmpty && target?.chatId === currentChat.chatId && lastSynced &&
        !!lastOutgoing?.id && !!initialOutgoingIds && !initialOutgoingIds.has(lastOutgoing.id) &&
        instructionRef.current === lastSynced && lastOutgoing?.text.trim() === lastSynced.trim()) {
      contentRevision.current++;
      instructionRef.current = "";
      targetRef.current = null;
      dictatedRef.current = false;
      expectedByChat.current.delete(target.chatId);
      outgoingBaselineByChat.current.delete(target.chatId);
      setInstruction("");
      setDictationTarget(null);
      setDictated(false);
      setSyncNotice("");
      setSyncConflict(false);
    }
    recordingTarget.current = context ? { chatId: context.chatId, name: context.name } : null;
  }

  async function polish(style: PolishStyle) {
    const submitted = instructionRef.current.trim();
    if (!submitted || polishing) return;
    const revision = contentRevision.current;
    const prior = instructionRef.current;
    const target = targetRef.current;
    setPolishOpen(false);
    setPolishing(true);
    setError("");
    try {
      const response = await rpc<{ text: string }>("POLISH_TEXT", { text: submitted, style });
      if (contentRevision.current !== revision || instructionRef.current !== prior) return;
      if (typeof response.text !== "string" || response.text.length > 5000) throw new Error("The polished text was too long. Your draft is unchanged.");
      const next = response.text;
      contentRevision.current++;
      instructionRef.current = next;
      setInstruction(next);
      setUndoText(prior);
      if (dictatedRef.current) queueSync(next, target);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not polish this text. Your draft is unchanged.");
    } finally {
      setPolishing(false);
    }
  }

  function undoPolish() {
    if (undoText === null) return;
    const prior = undoText;
    setUndoText(null);
    changeInstruction(prior);
  }

  function retrySync() {
    if (!dictatedRef.current) return;
    const target = targetRef.current;
    const composerWasCleared = !!target && contextRef.current?.chatId === target.chatId && contextRef.current.composerEmpty;
    queueSync(instructionRef.current, target, composerWasCleared);
  }

  const instructionLabel = dictated ? "Your WhatsApp message" : "How can I help?";
  const hasText = !!instruction.trim();
  return (
    <section className="manual-assistant" aria-label="AI assistance">
      <div className={`reply-card ${busy ? "generating" : ""}`}>
        <label className="assistant-label" htmlFor="assistant-instruction">{instructionLabel}</label>
        <textarea
          id="assistant-instruction"
          className="assistant-instruction"
          value={instruction}
          onChange={(event) => changeInstruction(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
              event.preventDefault();
              void ask();
            }
          }}
          rows={3}
          maxLength={5000}
          placeholder={context ? "Ask a question, explain what to say, or leave blank for a reply suggestion…" : "Ask about your services, prices, or help writing a message…"}
        />
        <div className="assistant-toolbar">
          <SpeechInput
            compact
            disabled={!sttReady}
            onRecordingStart={onRecordingStart}
            onTranscript={onTranscript}
          />
          <div className="polish-menu-wrap" ref={polishWrapRef}>
            <button ref={polishTriggerRef} type="button" className="text-button polish-trigger" aria-haspopup="menu" aria-expanded={polishOpen} onClick={() => setPolishOpen((open) => !open)} disabled={!hasText || polishing || syncing}>
              {polishing ? <LoaderCircle size={15} className="spin" /> : <WandSparkles size={15} />} Polish
            </button>
            {polishOpen && <div className="polish-menu" role="menu" aria-label="Polish text">
              {polishOptions.map((option) => <button type="button" role="menuitem" key={option.style} onClick={() => void polish(option.style)}>{option.label}</button>)}
            </div>}
          </div>
          {undoText !== null && <button type="button" className="text-button" onClick={undoPolish}>Undo polish</button>}
          <button type="button" className="icon-button assistant-help-button" aria-label="About this assistant" aria-expanded={helpOpen} aria-controls="assistant-help" title="Help" onClick={() => setHelpOpen((open) => !open)}>
            <CircleHelp size={16} />
          </button>
          <button className="primary-button draft-button" onClick={() => void ask()} disabled={busy}>
            {busy ? <LoaderCircle size={17} className="spin" /> : <Sparkles size={17} />}
            <span>{busy ? "Preparing assistance…" : hasText || !context ? "Ask assistant" : "Suggest a reply"}</span>
          </button>
        </div>
        {helpOpen && <p className="assistant-help" id="assistant-help">
          {dictated ? "Edit your transcript here; WhatsApp mirrors it automatically." : "Type to ask the assistant, or use the mic to dictate a WhatsApp message."}{" "}
          Suggestions stay in the panel until you copy or insert them. {SPEECH_PRIVACY_NOTE} Model: {desk.settings.model}.
        </p>}
        {syncNotice && <p className={`field-hint ${syncConflict ? "sync-conflict" : ""}`} role={syncConflict ? "alert" : "status"}>{syncNotice}</p>}
        {syncConflict && dictated && <div className="assistant-sync-actions">
          <small>Keep your WhatsApp edits, or clear its message box and try again.</small>
          <button type="button" className="text-button" onClick={retrySync} disabled={syncing}>Try again</button>
        </div>}
        {!desk.hasKey && <button className="setup-link" onClick={openSettings}>Connect {textProvider} in Settings to get assistance</button>}
        {context?.messages.slice(-35).some((message) => message.images?.length) && <p className="field-hint">Pictures detected. Open or download blurred images in WhatsApp so the assistant can read them.</p>}
        {error && <p className="assistant-error" role="alert">{error}</p>}
        {suggestion && (
          <div className="assistant-result" aria-live="polite">
            <div className="assistant-result-heading">
              <strong>{suggestion.contextName ? `Suggestion · ${suggestion.contextName}` : "Your suggestion"}</strong>
              <span className="assistant-result-actions">
                <button className="text-button" onClick={async () => {
                  try { await navigator.clipboard.writeText(suggestion.reply); setCopied(true); }
                  catch { setError("Copy was unavailable. Select the suggestion text to copy it."); }
                }} aria-label="Copy suggestion">
                  {copied ? <Check size={14} /> : <Copy size={14} />}{copied ? "Copied" : "Copy"}
                </button>
                {canInsert && <button
                  className="text-button insert-button"
                  onClick={() => void insertSuggestion()}
                  disabled={inserting || syncing || tooLong || otherChat}
                  title={tooLong ? "Too long to insert — use Copy" : "Add this suggestion to the WhatsApp message box. It is not sent."}
                  aria-label="Insert suggestion into chat"
                >
                  {inserting ? <LoaderCircle size={14} className="spin" /> : insertedKey === suggestionKey ? <Check size={14} /> : <ClipboardPaste size={14} />}
                  {insertedKey === suggestionKey ? "Inserted ✓" : "Insert into chat"}
                </button>}
              </span>
            </div>
            <p className="draft-text">{suggestion.reply}</p>
            {canInsert && otherChat && <p className="field-hint">Written for {suggestion.contextName ?? "another chat"}. Open that chat to insert it.</p>}
            {noticeForSuggestion && <p className={`field-hint ${noticeForSuggestion.conflict ? "sync-conflict" : ""}`} role={noticeForSuggestion.conflict ? "alert" : "status"}>{noticeForSuggestion.text}</p>}
            {suggestion.needsHuman && <p className="review-note">{suggestion.reason || "Review this suggestion before using it."}</p>}
            {!!suggestion.sources.length && <div className="draft-sources"><BookOpen size={13} /><span>{suggestion.sources.map((id) => desk.knowledge.find((item) => item.id === id)?.name).filter(Boolean).join(", ")}</span></div>}
          </div>
        )}
        {dictated && <div className="reply-footnote">{`Text is added to ${dictationTarget?.name ?? "your selected chat"}. Review it and press Send in WhatsApp.`}</div>}
      </div>
    </section>
  );
}
