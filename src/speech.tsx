import { useEffect, useRef, useState } from "react";
import { LoaderCircle, Mic, Square } from "lucide-react";
import { MAX_AUDIO_BYTES, MAX_RECORDING_MS, Recorder } from "./recording";

export const SPEECH_PRIVACY_NOTE =
  "Recorded audio is sent to the selected transcription provider and is not saved in Desk AI for WhatsApp.";

export type SpeechInputState =
  | "idle"
  | "requesting"
  | "recording"
  | "transcribing"
  | "error";

type RpcCall = (
  type: string,
  payload?: Record<string, unknown>,
) => Promise<any>;

async function defaultRpc(type: string, payload: Record<string, unknown> = {}) {
  const { rpc } = await import("./bridge");
  return rpc(type, payload);
}

function hasExtensionRuntime(): boolean {
  return typeof chrome !== "undefined" && !!chrome.runtime?.id;
}

function errorMessage(error: unknown): string {
  const name = (error as { name?: string } | null)?.name;
  switch (name) {
    case "NotAllowedError":
    case "PermissionDeniedError":
    case "SecurityError":
      return "Microphone access was denied. Allow microphone access for WhatsApp Web in Chrome, then retry.";
    case "NotFoundError":
    case "DevicesNotFoundError":
      return "No microphone was found. Connect or enable a microphone, then retry.";
    case "NotReadableError":
    case "TrackStartError":
      return "The microphone is busy or unavailable. Close other apps using it, then retry.";
    default: {
      const message = (error as { message?: string } | null)?.message;
      return message || "Voice input failed. You can retry or type your instruction.";
    }
  }
}

export function SpeechInput({
  onTranscript,
  onRecordingStart,
  disabled = false,
  className,
  compact = false,
  extensionMode = hasExtensionRuntime(),
  rpcCall = defaultRpc,
}: {
  /** Receives recognized text only; the owner decides how to append/edit it. */
  onTranscript: (text: string) => void;
  onRecordingStart?: () => void;
  disabled?: boolean;
  className?: string;
  /** Icon-only toggle; the status line is laid out by the parent toolbar. */
  compact?: boolean;
  /** Override only for tests. Capture in the extension runs in the WhatsApp document. */
  extensionMode?: boolean;
  rpcCall?: RpcCall;
}) {
  const [state, setState] = useState<SpeechInputState>("idle");
  const [message, setMessage] = useState("");
  const requestIdRef = useRef(0);
  const mountedRef = useRef(true);
  const recordingTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const capturePendingRef = useRef(false);
  const localRecorderRef = useRef<Recorder | null>(null);
  const onTranscriptRef = useRef(onTranscript);
  const rpcRef = useRef(rpcCall);
  onTranscriptRef.current = onTranscript;
  rpcRef.current = rpcCall;

  function clearRecordingTimer() {
    if (recordingTimerRef.current) clearTimeout(recordingTimerRef.current);
    recordingTimerRef.current = null;
  }

  async function cancelCapture() {
    capturePendingRef.current = false;
    if (extensionMode) {
      try {
        await rpcRef.current("RECORD_AUDIO_CANCEL");
      } catch {
        // The content script may have navigated or already cleaned up.
      }
    }
    localRecorderRef.current?.cancel();
    localRecorderRef.current = null;
  }

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      requestIdRef.current++;
      clearRecordingTimer();
      if (capturePendingRef.current) void cancelCapture();
      localRecorderRef.current?.cancel();
      localRecorderRef.current = null;
    };
  }, []);

  async function transcribeCapture(
    capture: { audio?: unknown; mimeType?: unknown },
    requestId: number,
  ) {
    if (typeof capture.audio !== "string" || !capture.audio || capture.audio.startsWith("data:"))
      throw new Error("The recording could not be read. Please retry.");
    if (capture.audio.length > Math.ceil((MAX_AUDIO_BYTES * 4) / 3) + 8)
      throw new Error("Recording exceeded 10 MB. Try a shorter recording.");
    if (typeof capture.mimeType !== "string" || !capture.mimeType)
      throw new Error("The recording format was unavailable. Please retry.");
    if (!mountedRef.current || requestId !== requestIdRef.current) return;
    if (!extensionMode) {
      setState("error");
      setMessage("Voice transcription requires Desk AI for WhatsApp in Chrome. Load the extension to transcribe this recording.");
      return;
    }
    const result = await rpcRef.current("TRANSCRIBE_AUDIO", {
      audio: capture.audio,
      mimeType: capture.mimeType,
    });
    if (!mountedRef.current || requestId !== requestIdRef.current) return;
    const transcript = typeof result?.text === "string" ? result.text.trim() : "";
    if (!transcript) {
      setState("error");
      setMessage("No speech was recognized. Try again or type your instruction.");
      return;
    }
    onTranscriptRef.current(transcript);
    setState("idle");
    setMessage("Transcript added. You can edit it before continuing.");
  }

  async function stopAndTranscribe(requestId: number, reachedLimit = false) {
    clearRecordingTimer();
    if (!mountedRef.current || requestId !== requestIdRef.current) return;
    setState("transcribing");
    setMessage(reachedLimit ? "Recording limit reached. Transcribing audio…" : "Transcribing audio…");
    try {
      const capture = extensionMode
        ? await rpcRef.current("RECORD_AUDIO_STOP")
        : await localRecorderRef.current?.stop();
      capturePendingRef.current = false;
      localRecorderRef.current = null;
      if (!capture) throw new Error("There is no active recording to transcribe.");
      await transcribeCapture(capture, requestId);
    } catch (error) {
      if (capturePendingRef.current) await cancelCapture();
      if (!mountedRef.current || requestId !== requestIdRef.current) return;
      setState("error");
      setMessage(errorMessage(error));
    }
  }

  async function startRecording() {
    if (state === "recording") {
      await stopAndTranscribe(requestIdRef.current);
      return;
    }
    if (state === "requesting" || state === "transcribing") return;
    onRecordingStart?.();
    const requestId = ++requestIdRef.current;
    setState("requesting");
    setMessage("Requesting microphone access…");
    try {
      if (extensionMode) {
        capturePendingRef.current = true;
        await rpcRef.current("RECORD_AUDIO_START");
      } else {
        const recorder = new Recorder();
        localRecorderRef.current = recorder;
        await recorder.start();
      }
      if (!mountedRef.current || requestId !== requestIdRef.current) {
        await cancelCapture();
        return;
      }
      setState("recording");
      setMessage("Recording. Select Stop recording when you are done.");
      recordingTimerRef.current = setTimeout(() => {
        void stopAndTranscribe(requestId, true);
      }, MAX_RECORDING_MS);
    } catch (error) {
      if (capturePendingRef.current) await cancelCapture();
      localRecorderRef.current?.cancel();
      localRecorderRef.current = null;
      if (!mountedRef.current || requestId !== requestIdRef.current) return;
      setState("error");
      setMessage(errorMessage(error));
    }
  }

  const isBusy = state === "requesting" || state === "transcribing";
  const label =
    state === "recording"
      ? "Stop recording"
      : state === "requesting"
        ? "Requesting microphone…"
        : state === "transcribing"
          ? "Transcribing…"
          : "Use mic";

  return (
    <span className={`speech-input${compact ? " speech-input--compact" : ""}${className ? ` ${className}` : ""}`}>
      <button
        className="speech-input__toggle"
        type="button"
        onClick={() => void startRecording()}
        disabled={disabled || isBusy}
        aria-label={label}
        aria-pressed={state === "recording"}
        title={label}
      >
        {state === "recording" ? (
          <><Square size={14} aria-hidden="true" />{!compact && <> {label}</>}</>
        ) : state === "transcribing" || state === "requesting" ? (
          <><LoaderCircle className="speech-input__spinner" size={15} aria-hidden="true" />{!compact && <> {label}</>}</>
        ) : (
          <><Mic size={15} aria-hidden="true" />{!compact && <> {label}</>}</>
        )}
      </button>
      {message && (
        <span role={state === "error" ? "alert" : "status"} aria-live="polite">
          {message}
        </span>
      )}
      {(!compact || isBusy || state === "recording") && (
        <small className="speech-input__privacy">
          {SPEECH_PRIVACY_NOTE}
        </small>
      )}
    </span>
  );
}
