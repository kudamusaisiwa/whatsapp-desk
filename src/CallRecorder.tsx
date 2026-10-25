import React, { useEffect, useRef, useState } from "react";
import { AudioLines, ChevronDown, CircleStop, LoaderCircle, Mic, Phone, Sparkles } from "lucide-react";
import { rpc } from "./bridge";
import type { DeskState } from "./types";

type CallSession = { sessionId: string; chatId: string; name: string; startedAt: number; speakers?: { business?: string; customer?: string } };
type CaptureStatus = {
  phase: "idle" | "requesting" | "recording" | "stopping" | "stopped" | "error";
  startedAt: number | null;
  durationMs: number;
  bytes: number;
  hasMicrophone: boolean;
  hasCallAudio: boolean;
  error?: string;
};

export type CallPhase = "idle" | "starting" | "recording" | "stopped" | "transcribing" | "transcription-error" | "ready" | "summarizing";
export type CallStatus = { phase: CallPhase; startedAt: number | null; name: string | null };

const initialStatus: CaptureStatus = { phase: "idle", startedAt: null, durationMs: 0, bytes: 0, hasMicrophone: false, hasCallAudio: false };
export const formatDuration = (durationMs: number) => {
  const seconds = Math.floor(Math.max(0, durationMs) / 1000);
  return `${String(Math.floor(seconds / 60)).padStart(2, "0")}:${String(seconds % 60).padStart(2, "0")}`;
};

/** Captures a call locally in the WhatsApp tab, then makes a reviewable action note. */
export function CallRecorder({ visible, desk, refresh, onStatusChange, openSignal }: { visible: boolean; desk: DeskState; refresh: () => Promise<void>; onStatusChange?: (status: CallStatus) => void; openSignal?: number }) {
  const [phase, setPhase] = useState<CallPhase>("idle");
  const [userOpen, setUserOpen] = useState(false);
  const rootRef = useRef<HTMLElement | null>(null);
  const onStatusChangeRef = useRef(onStatusChange);
  onStatusChangeRef.current = onStatusChange;
  const [session, setSession] = useState<CallSession | null>(null);
  const [callOrigin, setCallOrigin] = useState<CallSession | null>(null);
  const [capture, setCapture] = useState<CaptureStatus>(initialStatus);
  const [elapsedMs, setElapsedMs] = useState(0);
  const [transcript, setTranscript] = useState("");
  const [summary, setSummary] = useState("");
  const [speakers, setSpeakers] = useState({ business: "", customer: "" });
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [syncFailed, setSyncFailed] = useState(false);
  const [summarySyncing, setSummarySyncing] = useState(false);
  const [summaryPlaced, setSummaryPlaced] = useState(false);
  const [hasPendingAudio, setHasPendingAudio] = useState(false);
  const sessionRef = useRef<CallSession | null>(null);
  const callOriginRef = useRef<CallSession | null>(null);
  const captureRef = useRef<CaptureStatus>(initialStatus);
  const contextRef = useRef(desk.context);
  const transcriptRef = useRef(transcript);
  const summaryRef = useRef(summary);
  const speakersRef = useRef(speakers);
  const transcriptRevision = useRef(0);
  const summaryRevision = useRef(0);
  const summarizedTranscript = useRef("");
  const pendingAudio = useRef<{ audio: string; mimeType: string; durationMs: number } | null>(null);
  const expectedByChat = useRef(new Map<string, string>());
  const syncQueue = useRef<Promise<void>>(Promise.resolve());
  const syncTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const mounted = useRef(true);
  const contextId = desk.context?.chatId ?? null;
  contextRef.current = desk.context;
  transcriptRef.current = transcript;
  summaryRef.current = summary;
  speakersRef.current = speakers;

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      if (syncTimer.current) clearTimeout(syncTimer.current);
      const active = sessionRef.current;
      if (active && captureRef.current.phase !== "stopped" && captureRef.current.phase !== "error")
        void rpc("CALL_RECORD_CANCEL", { sessionId: active.sessionId }).catch(() => {});
    };
  }, []);

  const reportedStart = capture.startedAt ?? callOrigin?.startedAt ?? null;
  const reportedName = callOrigin?.name ?? null;
  useEffect(() => {
    onStatusChangeRef.current?.({ phase, startedAt: reportedStart, name: reportedName });
  }, [phase, reportedStart, reportedName]);

  const previousPhase = useRef<CallPhase>("idle");
  useEffect(() => {
    if (phase === "ready" && previousPhase.current !== "ready") setUserOpen(true);
    previousPhase.current = phase;
  }, [phase]);

  useEffect(() => {
    if (!openSignal) return;
    setUserOpen(true);
    const timer = setTimeout(() => rootRef.current?.scrollIntoView?.({ block: "nearest" }), 0);
    return () => clearTimeout(timer);
  }, [openSignal]);

  useEffect(() => {
    const active = session;
    if (!active || (phase !== "recording" && phase !== "stopped")) return;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const poll = async () => {
      try {
        const status = await rpc<CaptureStatus & Partial<CallSession>>("CALL_RECORD_STATUS", { sessionId: active.sessionId });
        if (cancelled || sessionRef.current?.sessionId !== active.sessionId) return;
        setCapture(status);
        captureRef.current = status;
        setElapsedMs(status.durationMs ?? 0);
        if (status.phase === "error") {
          sessionRef.current = null;
          setSession(null);
          setPhase("idle");
          setError(status.error || "Call recording ended unexpectedly. Your earlier notes are still here.");
          return;
        }
        if (status.phase === "stopped") setPhase("stopped");
      } catch (e) {
        if (!cancelled && mounted.current) setError(e instanceof Error ? e.message : "Call status could not be checked.");
      }
      if (!cancelled && sessionRef.current?.sessionId === active.sessionId) timer = setTimeout(poll, 2000);
    };
    timer = setTimeout(poll, 2000);
    return () => { cancelled = true; if (timer) clearTimeout(timer); };
  }, [session, phase]);

  async function startRecording() {
    const target = contextRef.current;
    if (!desk.hasKey) {
      setError("Connect OpenAI in Settings before recording a call for notes.");
      return;
    }
    if (!target) {
      setError("Open the WhatsApp chat for this call before recording.");
      return;
    }
    if (phase === "starting" || phase === "recording" || phase === "stopped" || phase === "transcribing") return;
    setPhase("starting");
    setError("");
    setNotice("Choose the WhatsApp call tab in Chrome’s sharing picker and enable Share audio.");
    setSyncFailed(false);
    try {
      const started = await rpc<CallSession & Partial<CaptureStatus>>("CALL_RECORD_START", { chatId: target.chatId });
      if (!started.sessionId || started.chatId !== target.chatId) throw new Error("The recorder could not confirm the selected WhatsApp chat.");
      const next: CallSession = { sessionId: started.sessionId, chatId: target.chatId, name: started.name || target.name, startedAt: started.startedAt || Date.now() };
      if (!mounted.current) {
        if (started.phase !== "stopped" && started.phase !== "error") await rpc("CALL_RECORD_CANCEL", { sessionId: started.sessionId }).catch(() => {});
        return;
      }
      const typedCustomer = speakersRef.current.customer.trim();
      const spk = {
        business: speakersRef.current.business.trim(),
        customer: (typedCustomer && typedCustomer !== callOriginRef.current?.name ? typedCustomer : "") || next.name,
      };
      next.speakers = spk;
      speakersRef.current = spk;
      setSpeakers(spk);
      sessionRef.current = next;
      callOriginRef.current = next;
      setCallOrigin(next);
      setSession(next);
      const startingStatus = { ...initialStatus, ...started, phase: "recording" as const, startedAt: next.startedAt };
      // CALL_RECORD_START resolves only after both inputs are acquired and mixed.
      startingStatus.hasCallAudio = true;
      startingStatus.hasMicrophone = true;
      captureRef.current = startingStatus;
      setCapture(startingStatus);
      setElapsedMs(started.durationMs ?? 0);
      setTranscript("");
      transcriptRef.current = "";
      transcriptRevision.current++;
      setSummary("");
      summaryRef.current = "";
      summarizedTranscript.current = "";
      pendingAudio.current = null;
      setHasPendingAudio(false);
      summaryRevision.current++;
      setSummaryPlaced(false);
      setPhase("recording");
      setNotice("Recording call audio and your microphone. Stop when the call is finished.");
    } catch (e) {
      if (!mounted.current) return;
      setPhase(transcriptRef.current ? "ready" : "idle");
      setError(e instanceof Error ? e.message : "Recording could not start. Check the tab sharing permission and try again.");
    }
  }

  async function stopRecording() {
    const active = sessionRef.current;
    if (!active || (phase !== "recording" && phase !== "stopped")) return;
    setPhase("transcribing");
    setError("");
    setNotice("Stopping the call capture and preparing its transcript…");
    try {
      const audio = await rpc<{ audio: string; mimeType: string; durationMs: number; hasCallAudio?: boolean; hasMicrophone?: boolean }>("CALL_RECORD_STOP", { sessionId: active.sessionId });
      const finalStatus = {
        ...captureRef.current,
        phase: "stopped" as const,
        durationMs: audio.durationMs ?? captureRef.current.durationMs,
        hasCallAudio: audio.hasCallAudio ?? captureRef.current.hasCallAudio,
        hasMicrophone: audio.hasMicrophone ?? captureRef.current.hasMicrophone,
      };
      captureRef.current = finalStatus;
      setCapture(finalStatus);
      sessionRef.current = null;
      setSession(null);
      if (!finalStatus.hasCallAudio || !finalStatus.hasMicrophone) {
        setPhase(transcriptRef.current ? "ready" : "idle");
        setNotice("");
        setError("Both call audio and microphone audio are required. No transcript was created.");
        return;
      }
      pendingAudio.current = audio;
      setHasPendingAudio(true);
      await transcribePending(audio);
    } catch (e) {
      await rpc("CALL_RECORD_CANCEL", { sessionId: active.sessionId }).catch(() => {});
      sessionRef.current = null;
      setSession(null);
      setPhase(pendingAudio.current ? "transcription-error" : transcriptRef.current ? "ready" : "idle");
      setNotice("");
      setError(e instanceof Error ? e.message : "The call could not be transcribed. Your recording remains available for retry.");
    }
  }

  async function transcribePending(audio: { audio: string; mimeType: string; durationMs: number }) {
    setPhase("transcribing");
    setError("");
    try {
      const result = await rpc<{ text: string }>("TRANSCRIBE_CALL", { audio: audio.audio, mimeType: audio.mimeType, name: callOriginRef.current?.name, speakers: speakersRef.current });
      if (!mounted.current) return;
      if (!result.text?.trim()) throw new Error("No call speech was recognized. Your recording remains available for retry.");
      pendingAudio.current = null;
      setHasPendingAudio(false);
      transcriptRef.current = result.text.trim();
      transcriptRevision.current++;
      setTranscript(result.text.trim());
      setElapsedMs(audio.durationMs ?? elapsedMs);
      setPhase("ready");
      setNotice("Transcript ready. Review it, then write the call summary.");
    } catch (e) {
      if (!mounted.current) return;
      setPhase("transcription-error");
      setNotice("");
      setError(e instanceof Error ? e.message : "The call could not be transcribed. Your recording remains available for retry.");
    }
  }

  function retryTranscription() {
    if (pendingAudio.current) void transcribePending(pendingAudio.current);
  }

  async function cancelRecording() {
    const active = sessionRef.current;
    if (!active) return;
    setNotice("Cancelling call recording…");
    try { await rpc("CALL_RECORD_CANCEL", { sessionId: active.sessionId }); }
    catch (e) { setError(e instanceof Error ? e.message : "Recording cancellation could not be confirmed."); }
    sessionRef.current = null;
    setSession(null);
    setCapture(initialStatus);
    captureRef.current = initialStatus;
    setPhase(transcriptRef.current ? "ready" : "idle");
    setNotice("");
  }

  function syncSummary(text: string, retry = false) {
    const target = callOriginRef.current;
    const original = target ? { chatId: target.chatId, name: target.name } : null;
    if (!original) return;
    const submittedRevision = summaryRevision.current;
    const task = syncQueue.current.then(async () => {
      if (!mounted.current) return;
      if (contextRef.current?.chatId !== original.chatId) throw new Error(`Open ${original.name} in WhatsApp to add these call notes.`);
      const expectedText = retry && contextRef.current.composerEmpty ? "" : (expectedByChat.current.get(original.chatId) ?? "");
      const response = await rpc<{ synced: boolean; text: string }>("SYNC_MESSAGE", { chatId: original.chatId, text, expectedText });
      if (!mounted.current) return;
      expectedByChat.current.set(original.chatId, response.text);
      if (mounted.current) {
        setSummaryPlaced(true);
        setSyncFailed(false);
        setNotice("Call summary added to WhatsApp — review and send there.");
      }
      if (mounted.current && summaryRevision.current !== submittedRevision && summaryRef.current.trim())
        syncSummary(summaryRef.current);
    });
    syncQueue.current = task.catch((e) => {
      if (mounted.current) {
        setSyncFailed(true);
        setNotice(e instanceof Error ? e.message : "Could not add the call summary. Your call notes are safe here.");
      }
    }).finally(() => { if (mounted.current) setSummarySyncing(false); });
    setSummarySyncing(true);
  }

  async function summarize() {
    const origin = callOriginRef.current;
    const text = transcriptRef.current.trim();
    if (!origin || !text || !desk.hasKey || phase === "summarizing") return;
    const revision = transcriptRevision.current;
    const noteRevision = summaryRevision.current;
    setPhase("summarizing");
    setError("");
    setNotice("Writing the call summary…");
    try {
      const result = await rpc<{ text: string }>("SUMMARIZE_CALL", { text, name: origin.name, chatId: origin.chatId, startedAt: origin.startedAt, speakers: { business: speakersRef.current.business.trim() || undefined, customer: speakersRef.current.customer.trim() || undefined } });
      if (!mounted.current) return;
      if (transcriptRevision.current !== revision || transcriptRef.current.trim() !== text) {
        setPhase("ready");
        setNotice("Transcript changed while the summary was being prepared. Review it and summarize again.");
        return;
      }
      if (summaryRevision.current !== noteRevision) {
        setPhase("ready");
        setNotice("Call summary changed while a new one was being prepared. Your edit was kept.");
        return;
      }
      if (!result.text?.trim()) throw new Error("The call summary was empty. Review the transcript and try again.");
      summaryRevision.current++;
      summaryRef.current = result.text.trim();
      setSummary(result.text.trim());
      summarizedTranscript.current = text;
      setSummaryPlaced(false);
      setPhase("ready");
      syncSummary(result.text.trim());
    } catch (e) {
      if (!mounted.current) return;
      setPhase("ready");
      setError(e instanceof Error ? e.message : "The call could not be summarized. Your transcript is safe.");
    }
  }

  function changeSummary(value: string) {
    summaryRevision.current++;
    summaryRef.current = value;
    setSummary(value);
    if (!summaryPlaced) return;
    if (syncTimer.current) clearTimeout(syncTimer.current);
    syncTimer.current = setTimeout(() => syncSummary(summaryRef.current), 350);
  }

  function retrySummary() {
    if (summaryRef.current.trim()) syncSummary(summaryRef.current, true);
  }

  const active = phase === "recording" || phase === "stopped";
  const displayDuration = phase === "recording" ? Math.max(elapsedMs, capture.startedAt ? Date.now() - capture.startedAt : 0) : elapsedMs;
  const forcedOpen = phase === "starting" || phase === "recording" || phase === "stopped" || phase === "transcribing" || phase === "summarizing" || phase === "transcription-error" || !!error;
  const bodyOpen = forcedOpen || userOpen;
  const canRecord = phase === "idle" || phase === "ready" || phase === "transcription-error";
  const recordBlock = !contextId
    ? "Open the WhatsApp chat for the call before recording."
    : !desk.hasKey
      ? "Connect OpenAI in Settings before recording a call for notes."
      : undefined;
  return (
    <section className={`call-recorder ${bodyOpen ? "open" : ""}`} aria-label="Call notes" hidden={!visible} ref={rootRef}>
      <div className="call-recorder-head">
        <button type="button" className="call-recorder-toggle" aria-expanded={bodyOpen} aria-controls="call-recorder-body" disabled={forcedOpen} title={forcedOpen ? "Open while a call is in progress" : undefined} onClick={() => setUserOpen(!userOpen)}>
          <span className="call-recorder-icon"><Phone size={14} /></span>
          <strong>Call notes</strong>
          <ChevronDown size={14} className={bodyOpen ? "rotated" : ""} />
        </button>
        {active && <span className="call-recorder-time" aria-label={`Recording ${formatDuration(displayDuration)}`}><i />{formatDuration(displayDuration)}</span>}
        {canRecord && <button type="button" className="call-record-button" onClick={() => void startRecording()} disabled={!contextId || !desk.hasKey} title={recordBlock}>
          {transcript ? <><Mic size={15} />Record another call</> : <><Mic size={15} />Record call</>}
        </button>}
      </div>
      {bodyOpen && <div className="call-recorder-body" id="call-recorder-body">
        <p className="call-recorder-hint">Record both sides, then send the customer a reviewable call summary.</p>
      {!contextId && phase === "idle" && <p className="call-recorder-hint">Open the WhatsApp chat for the call before recording.</p>}
      {!desk.hasKey && phase === "idle" && <p className="call-recorder-hint">Connect OpenAI in Settings before recording a call for notes.</p>}
      {callOrigin && <div className="call-recorder-origin"><span>Call with</span><strong>{callOrigin.name}</strong></div>}
      {(callOrigin || canRecord) && <div className="call-speakers">
        <label>Company speaker<input aria-label="Company speaker" maxLength={80} placeholder={desk.settings.businessName} value={speakers.business} onChange={(event) => { const next = { ...speakersRef.current, business: event.target.value }; speakersRef.current = next; setSpeakers(next); }} /></label>
        <label>Customer speaker<input aria-label="Customer speaker" maxLength={80} placeholder={callOrigin?.name ?? desk.context?.name} value={speakers.customer} onChange={(event) => { const next = { ...speakersRef.current, customer: event.target.value }; speakersRef.current = next; setSpeakers(next); }} /></label>
      </div>}
      {active && <div className="call-audio-sources" aria-label="Call audio sources">
        <span className={capture.hasCallAudio ? "source-ready" : "source-missing"}><AudioLines size={13} />Call audio {capture.hasCallAudio ? "connected" : "waiting"}</span>
        <span className={capture.hasMicrophone ? "source-ready" : "source-missing"}><Mic size={13} />Microphone {capture.hasMicrophone ? "connected" : "waiting"}</span>
      </div>}
      {phase === "starting" && <button type="button" className="call-record-button" disabled><LoaderCircle size={15} className="spin" />Waiting for tab sharing…</button>}
      {active && <div className="call-record-actions">
        <button type="button" className="call-record-button call-stop-button" onClick={() => void stopRecording()}><CircleStop size={15} />{phase === "stopped" ? "Finish and transcribe" : "Stop recording"}</button>
        <button type="button" className="text-button" onClick={() => void cancelRecording()}>Cancel recording</button>
      </div>}
      {phase === "transcribing" && <p className="call-recorder-status" role="status"><LoaderCircle size={14} className="spin" />{notice || "Transcribing call…"}</p>}
      {phase === "transcription-error" && hasPendingAudio && <button type="button" className="text-button call-try-again" onClick={retryTranscription}>Retry transcription</button>}
      {phase === "summarizing" && <p className="call-recorder-status" role="status"><LoaderCircle size={14} className="spin" />Writing the call summary…</p>}
      {callOrigin && <p className="call-recorder-target-note">Notes stay linked to {callOrigin.name} if you switch WhatsApp chats.</p>}
      {notice && phase !== "transcribing" && phase !== "summarizing" && <p className="call-recorder-status" role="status">{notice}</p>}
      {error && <p className="call-recorder-error" role="alert">{error}</p>}
      {transcript && <details className="call-transcript-details">
        <summary>Review transcript · {formatDuration(elapsedMs)}</summary>
        <textarea aria-label="Call transcript" value={transcript} onChange={(event) => { transcriptRevision.current++; transcriptRef.current = event.target.value; setTranscript(event.target.value); }} rows={5} />
      </details>}
      {phase === "ready" && transcript && (!summary || transcript.trim() !== summarizedTranscript.current) && <button type="button" className="call-summarize-button" onClick={() => void summarize()} disabled={!desk.hasKey}>
        <Sparkles size={15} />{desk.hasKey ? summary ? "Update call summary" : "Write call summary" : "Connect OpenAI to summarize"}
      </button>}
      {summary && <div className="call-summary-block">
        <label htmlFor="call-action-note">Call summary for WhatsApp</label>
        <textarea id="call-action-note" value={summary} onChange={(event) => changeSummary(event.target.value)} rows={4} />
        <small>{summaryPlaced ? "Edit here to update the original WhatsApp composer." : "Review this summary before sending it in WhatsApp."}</small>
        {syncFailed && <button type="button" className="text-button call-try-again" onClick={retrySummary} disabled={summarySyncing}>Try again</button>}
        {summarySyncing && <p className="call-recorder-status" role="status"><LoaderCircle size={13} className="spin" />Updating WhatsApp…</p>}
      </div>}
      <p className="call-recorder-footnote">Call audio is sent to OpenAI for transcription. Review the call summary, then send it yourself in WhatsApp.</p>
      </div>}
    </section>
  );
}
