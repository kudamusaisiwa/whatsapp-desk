export const CALL_RECORD_MAX_MS = 60 * 60 * 1_000;
export const CALL_RECORD_MAX_BYTES = 20 * 1024 * 1024;
export const CALL_RECORD_PERMISSION_TIMEOUT_MS = 25_000;
export const CALL_RECORD_STOP_TIMEOUT_MS = 3_000;
export const CALL_RECORD_RESULT_TTL_MS = 5 * 60 * 1_000;

export type CallRecordingPhase =
  "idle" | "requesting" | "recording" | "stopping" | "stopped" | "error";

export type CallRecordingPayload = {
  streamId: string;
  sessionId: string;
  chatId: string;
  name: string;
};

export type CallRecordingStatus = {
  phase: CallRecordingPhase;
  startedAt: number | null;
  durationMs: number;
  bytes: number;
  hasMicrophone: boolean;
  hasCallAudio: boolean;
  error?: string;
  sessionId?: string;
  chatId?: string;
  name?: string;
};

export type RecordedCallAudio = {
  audio: string;
  mimeType: string;
  durationMs: number;
};

type AudioContextLike = AudioContext & {
  createMediaStreamDestination(): MediaStreamAudioDestinationNode;
};

function stopTracks(stream: MediaStream | null) {
  for (const track of stream?.getTracks() ?? []) {
    try {
      track.stop();
    } catch {
      // The browser may already have ended the track.
    }
  }
}

function asError(error: unknown, fallback: string) {
  return error instanceof Error ? error : new Error(fallback);
}

function validateToken(sessionId: string) {
  if (
    typeof sessionId !== "string" ||
    !sessionId.trim() ||
    sessionId.length > 100
  )
    throw new Error("A valid call recording session token is required.");
}

export async function callAudioBlobToBase64(blob: Blob): Promise<string> {
  if (blob.size > CALL_RECORD_MAX_BYTES)
    throw new Error("Call recording exceeded 20 MB. Try a shorter recording.");
  const bytes = new Uint8Array(await blob.arrayBuffer());
  let binary = "";
  const chunkSize = 0x8000;
  for (let offset = 0; offset < bytes.length; offset += chunkSize) {
    const end = Math.min(offset + chunkSize, bytes.length);
    for (let i = offset; i < end; i++) binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}

/** In-memory mixed microphone and WhatsApp tab audio capture. */
export class CallRecorder {
  private generation = 0;
  private phase: CallRecordingPhase = "idle";
  private payload: CallRecordingPayload | null = null;
  private callStream: MediaStream | null = null;
  private microphoneStream: MediaStream | null = null;
  private acquiredStreams = new Set<MediaStream>();
  private mixedStream: MediaStream | null = null;
  private context: AudioContextLike | null = null;
  private recorder: MediaRecorder | null = null;
  private chunks: Blob[] = [];
  private bytes = 0;
  private startedAt: number | null = null;
  private durationMs = 0;
  private hasMicrophone = false;
  private hasCallAudio = false;
  private error: string | undefined;
  private permissionTimers = new Set<ReturnType<typeof setTimeout>>();
  private captureTimer: ReturnType<typeof setTimeout> | null = null;
  private stopTimer: ReturnType<typeof setTimeout> | null = null;
  private resultTimer: ReturnType<typeof setTimeout> | null = null;
  private pendingResult: RecordedCallAudio | null = null;
  private stopPromise: Promise<RecordedCallAudio> | null = null;
  private resolveStop: ((result: RecordedCallAudio) => void) | null = null;
  private rejectStop: ((error: Error) => void) | null = null;
  private retainEndedResult = false;

  async start(payload: CallRecordingPayload): Promise<CallRecordingStatus> {
    validateToken(payload?.sessionId);
    if (
      typeof payload.streamId !== "string" ||
      !payload.streamId ||
      typeof payload.chatId !== "string" ||
      !payload.chatId ||
      typeof payload.name !== "string" ||
      !payload.name
    )
      throw new Error("Call recording details are incomplete.");
    if (["requesting", "recording", "stopping"].includes(this.phase))
      throw new Error("A call recording is already active.");
    if (
      !navigator.mediaDevices?.getUserMedia ||
      typeof MediaRecorder === "undefined"
    )
      throw new Error("Call recording is unavailable in this browser.");
    this.clearPendingResult();
    this.resetCapture();
    const generation = ++this.generation;
    this.payload = { ...payload };
    this.phase = "requesting";
    this.error = undefined;

    const desktopConstraints = {
      audio: {
        mandatory: {
          chromeMediaSource: "desktop",
          chromeMediaSourceId: payload.streamId,
        },
      },
      // Chrome requires video for tab audio capture on some versions. It is
      // kept only for source compatibility and is never recorded.
      video: {
        mandatory: {
          chromeMediaSource: "desktop",
          chromeMediaSourceId: payload.streamId,
        },
      },
    };

    try {
      const [callStream, microphoneStream] = await Promise.all([
        this.requestStream(
          desktopConstraints as MediaStreamConstraints,
          generation,
          "WhatsApp call audio",
        ),
        this.requestStream(
          { audio: true, video: false },
          generation,
          "microphone",
        ),
      ]);
      if (generation !== this.generation) {
        stopTracks(callStream);
        stopTracks(microphoneStream);
        throw new Error("Call recording was cancelled.");
      }
      this.callStream = callStream;
      this.microphoneStream = microphoneStream;
      this.acquiredStreams.delete(callStream);
      this.acquiredStreams.delete(microphoneStream);
      const callTrack = callStream
        .getAudioTracks()
        .find((track) => track.readyState !== "ended");
      const microphoneTrack = microphoneStream
        .getAudioTracks()
        .find((track) => track.readyState !== "ended");
      if (!callTrack || !microphoneTrack)
        throw new Error(
          "Both WhatsApp call audio and microphone audio are required.",
        );
      this.hasCallAudio = true;
      this.hasMicrophone = true;

      const AudioContextConstructor =
        window.AudioContext || (window as any).webkitAudioContext;
      if (!AudioContextConstructor)
        throw new Error("Mixed call audio is unavailable in this browser.");
      const context: AudioContextLike = new AudioContextConstructor();
      this.context = context;
      await context.resume();
      if (generation !== this.generation)
        throw new Error("Call recording was cancelled.");
      const destination = context.createMediaStreamDestination();
      destination.channelCount = 1;
      destination.channelCountMode = "explicit";
      const callSource = context.createMediaStreamSource(callStream);
      const microphoneSource =
        context.createMediaStreamSource(microphoneStream);
      // Connect only to the recorder destination. Sending the microphone to
      // context.destination would feed the caller's voice back to their speakers.
      callSource.connect(destination);
      microphoneSource.connect(destination);
      this.mixedStream = destination.stream;
      const preferred = "audio/webm;codecs=opus";
      const options = MediaRecorder.isTypeSupported?.(preferred)
        ? { mimeType: preferred, audioBitsPerSecond: 32_000 }
        : { audioBitsPerSecond: 32_000 };
      const recorder = new MediaRecorder(this.mixedStream, options);
      this.recorder = recorder;
      recorder.ondataavailable = (event) => {
        if (this.recorder !== recorder || this.generation !== generation)
          return;
        if (!event.data?.size) return;
        this.bytes += event.data.size;
        if (this.bytes > CALL_RECORD_MAX_BYTES) {
          this.error =
            "Call recording exceeded 20 MB. Try a shorter recording.";
          void this.stop(payload.sessionId).catch(() => {});
          return;
        }
        this.chunks.push(event.data);
      };
      recorder.onerror = (event) => {
        if (this.recorder === recorder)
          this.fail(event.error ?? new Error("Call recording failed."));
      };
      recorder.onstop = () => {
        if (this.recorder === recorder && this.generation === generation)
          void this.finish(recorder, generation);
      };
      recorder.start(1_000);
      this.startedAt = Date.now();
      this.phase = "recording";
      this.attachEndHandlers(callStream, microphoneStream, generation);
      this.captureTimer = setTimeout(() => {
        if (this.recorder === recorder)
          void this.stop(payload.sessionId, true).catch(() => {});
      }, CALL_RECORD_MAX_MS);
      return this.getStatus();
    } catch (error) {
      if (generation === this.generation) {
        this.generation++;
        this.error = asError(error, "Call recording could not start.").message;
        this.phase = "error";
        await this.releaseCapture();
        for (const stream of this.acquiredStreams) stopTracks(stream);
        this.acquiredStreams.clear();
      }
      throw asError(error, "Call recording could not start.");
    } finally {
      for (const timer of this.permissionTimers) clearTimeout(timer);
      this.permissionTimers.clear();
    }
  }

  getStatus(): CallRecordingStatus {
    const elapsed =
      this.startedAt === null ? 0 : Math.max(0, Date.now() - this.startedAt);
    return {
      phase: this.phase,
      startedAt: this.startedAt,
      durationMs:
        this.phase === "recording" || this.phase === "stopping"
          ? elapsed
          : this.durationMs,
      bytes: this.bytes,
      hasMicrophone: this.hasMicrophone,
      hasCallAudio: this.hasCallAudio,
      ...(this.error ? { error: this.error } : {}),
      ...(this.payload
        ? {
            sessionId: this.payload.sessionId,
            chatId: this.payload.chatId,
            name: this.payload.name,
          }
        : {}),
    };
  }

  get active() {
    return (
      this.phase === "requesting" ||
      this.phase === "recording" ||
      this.phase === "stopping"
    );
  }

  async status(sessionId: string): Promise<CallRecordingStatus> {
    this.assertSession(sessionId);
    return this.getStatus();
  }

  stop(
    sessionId: string,
    retainEndedResult = false,
  ): Promise<RecordedCallAudio> {
    this.assertSession(sessionId);
    if (this.pendingResult) {
      const result = this.pendingResult;
      this.clearPendingResult();
      return Promise.resolve(result);
    }
    if (this.stopPromise) {
      if (!retainEndedResult) this.retainEndedResult = false;
      return this.stopPromise;
    }
    const recorder = this.recorder;
    if (!recorder)
      return Promise.reject(
        new Error("There is no active call recording to stop."),
      );
    this.phase = "stopping";
    this.retainEndedResult = retainEndedResult;
    this.stopPromise = new Promise((resolve, reject) => {
      this.resolveStop = resolve;
      this.rejectStop = reject;
    });
    if (this.captureTimer) clearTimeout(this.captureTimer);
    this.captureTimer = null;
    const generation = this.generation;
    this.stopTimer = setTimeout(() => {
      if (this.recorder === recorder && this.generation === generation)
        this.fail(
          new Error("Call recording did not stop correctly. Please retry."),
        );
    }, CALL_RECORD_STOP_TIMEOUT_MS);
    try {
      if (recorder.state !== "inactive") recorder.stop();
      else void this.finish(recorder, generation);
    } catch (error) {
      this.fail(asError(error, "Call recording did not stop correctly."));
    }
    return this.stopPromise;
  }

  cancel(sessionId?: string) {
    if (sessionId !== undefined) this.assertSession(sessionId);
    this.generation++;
    this.clearTimers();
    for (const stream of this.acquiredStreams) stopTracks(stream);
    this.acquiredStreams.clear();
    this.detachRecorder();
    this.rejectStop?.(new Error("Call recording cancelled."));
    this.clearStopPromise();
    this.clearPendingResult();
    void this.releaseCapture();
    this.chunks = [];
    this.bytes = 0;
    this.durationMs = 0;
    this.startedAt = null;
    this.hasMicrophone = false;
    this.hasCallAudio = false;
    this.phase = "idle";
    this.error = undefined;
    this.payload = null;
  }

  private requestStream(
    constraints: MediaStreamConstraints,
    generation: number,
    label: string,
  ) {
    let request: Promise<MediaStream>;
    try {
      request = navigator.mediaDevices.getUserMedia(constraints);
    } catch (error) {
      return Promise.reject(error);
    }
    let timer: ReturnType<typeof setTimeout>;
    const permissionWait = new Promise<MediaStream>((resolve, reject) => {
      timer = setTimeout(() => {
        reject(
          new Error(
            `${label} permission timed out. Check the browser prompt and retry.`,
          ),
        );
      }, CALL_RECORD_PERMISSION_TIMEOUT_MS);
      this.permissionTimers.add(timer);
      request.then((stream) => {
        if (generation !== this.generation) stopTracks(stream);
        else {
          this.acquiredStreams.add(stream);
          resolve(stream);
        }
      }, reject);
    });
    return permissionWait.finally(() => {
      clearTimeout(timer!);
      this.permissionTimers.delete(timer!);
    });
  }

  private attachEndHandlers(
    callStream: MediaStream,
    microphoneStream: MediaStream,
    generation: number,
  ) {
    for (const track of [
      ...callStream.getAudioTracks(),
      ...microphoneStream.getAudioTracks(),
    ]) {
      track.addEventListener(
        "ended",
        () => {
          if (this.generation === generation && this.phase === "recording")
            void this.stop(this.payload!.sessionId, true).catch(() => {});
        },
        { once: true },
      );
    }
  }

  private async finish(recorder: MediaRecorder, generation: number) {
    if (this.recorder !== recorder || generation !== this.generation) return;
    this.recorder = null;
    if (this.stopTimer) clearTimeout(this.stopTimer);
    this.stopTimer = null;
    if (this.captureTimer) clearTimeout(this.captureTimer);
    this.captureTimer = null;
    this.durationMs =
      this.startedAt === null ? 0 : Math.max(0, Date.now() - this.startedAt);
    const chunks = this.chunks;
    const bytes = this.bytes;
    this.chunks = [];
    await this.releaseCapture();
    if (bytes > CALL_RECORD_MAX_BYTES) {
      this.fail(
        new Error("Call recording exceeded 20 MB. Try a shorter recording."),
      );
      return;
    }
    const blob = new Blob(chunks, {
      type: recorder.mimeType || chunks[0]?.type,
    });
    if (!blob.size) {
      this.fail(
        new Error(
          "No call audio was recorded. Check both audio sources and retry.",
        ),
      );
      return;
    }
    try {
      const result: RecordedCallAudio = {
        audio: await callAudioBlobToBase64(blob),
        mimeType: recorder.mimeType || blob.type || "audio/webm",
        durationMs: this.durationMs,
      };
      if (generation !== this.generation) return;
      this.phase = "stopped";
      if (this.retainEndedResult) this.retainResult(result);
      this.resolveStop?.(result);
      this.clearStopPromise();
    } catch (error) {
      this.fail(asError(error, "Call audio could not be prepared."));
    }
  }

  private fail(error: Error) {
    this.error = error.message;
    this.phase = "error";
    this.generation++;
    this.clearTimers();
    this.detachRecorder();
    void this.releaseCapture();
    this.chunks = [];
    this.rejectStop?.(error);
    this.clearStopPromise();
    this.hasMicrophone = false;
    this.hasCallAudio = false;
  }

  private assertSession(sessionId: string) {
    validateToken(sessionId);
    if (!this.payload || this.payload.sessionId !== sessionId)
      throw new Error("Call recording session token does not match.");
  }

  private async releaseCapture() {
    stopTracks(this.mixedStream);
    stopTracks(this.callStream);
    stopTracks(this.microphoneStream);
    for (const stream of this.acquiredStreams) stopTracks(stream);
    this.mixedStream = null;
    this.callStream = null;
    this.microphoneStream = null;
    this.acquiredStreams.clear();
    const context = this.context;
    this.context = null;
    if (context && context.state !== "closed") {
      try {
        await context.close();
      } catch {
        // A context can close itself when the browser ends its source.
      }
    }
  }

  private detachRecorder() {
    const recorder = this.recorder;
    this.recorder = null;
    if (!recorder) return;
    recorder.ondataavailable = null;
    recorder.onerror = null;
    recorder.onstop = null;
    try {
      if (recorder.state !== "inactive") recorder.stop();
    } catch {
      // The recorder may already be stopped by the browser.
    }
  }

  private clearTimers() {
    for (const timer of this.permissionTimers) clearTimeout(timer);
    this.permissionTimers.clear();
    if (this.captureTimer) clearTimeout(this.captureTimer);
    if (this.stopTimer) clearTimeout(this.stopTimer);
    this.captureTimer = null;
    this.stopTimer = null;
  }

  private clearStopPromise() {
    this.stopPromise = null;
    this.resolveStop = null;
    this.rejectStop = null;
  }

  private retainResult(result: RecordedCallAudio) {
    this.clearPendingResult();
    this.pendingResult = result;
    this.resultTimer = setTimeout(
      () => this.clearPendingResult(),
      CALL_RECORD_RESULT_TTL_MS,
    );
  }

  private clearPendingResult() {
    if (this.resultTimer) clearTimeout(this.resultTimer);
    this.resultTimer = null;
    this.pendingResult = null;
  }

  private resetCapture() {
    this.clearTimers();
    this.detachRecorder();
    this.stopPromise = null;
    this.resolveStop = null;
    this.rejectStop = null;
    this.callStream = null;
    this.microphoneStream = null;
    this.acquiredStreams.clear();
    this.mixedStream = null;
    this.context = null;
    this.chunks = [];
    this.bytes = 0;
    this.startedAt = null;
    this.durationMs = 0;
    this.hasMicrophone = false;
    this.hasCallAudio = false;
    this.retainEndedResult = false;
  }
}
