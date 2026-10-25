export const MAX_RECORDING_MS = 60_000;
export const MAX_AUDIO_BYTES = 10 * 1024 * 1024;
export const MICROPHONE_REQUEST_TIMEOUT_MS = 25_000;
export const RECORDER_STOP_TIMEOUT_MS = 3_000;
export const AUTO_STOP_RESULT_TTL_MS = 30_000;

export type RecordedAudio = { audio: string; mimeType: string };

function abortError(message = "Recording cancelled.") {
  const error = new Error(message);
  error.name = "AbortError";
  return error;
}

function stopTracks(stream: MediaStream | null) {
  for (const track of stream?.getTracks() ?? []) {
    try {
      track.stop();
    } catch {
      // The browser may already have ended the track.
    }
  }
}

export async function audioBlobToBase64(blob: Blob): Promise<string> {
  if (blob.size > MAX_AUDIO_BYTES)
    throw new Error("Recording is larger than 10 MB. Try a shorter recording.");
  const bytes = new Uint8Array(await blob.arrayBuffer());
  let binary = "";
  const chunkSize = 0x8000;
  for (let offset = 0; offset < bytes.length; offset += chunkSize) {
    const end = Math.min(offset + chunkSize, bytes.length);
    for (let i = offset; i < end; i++) binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}

/** In-memory microphone capture for the top-level WhatsApp content document. */
export class Recorder {
  private generation = 0;
  private stream: MediaStream | null = null;
  private recorder: MediaRecorder | null = null;
  private chunks: Blob[] = [];
  private audioBytes = 0;
  private tooLarge = false;
  private captureTimer: ReturnType<typeof setTimeout> | null = null;
  private permissionTimer: ReturnType<typeof setTimeout> | null = null;
  private stopTimer: ReturnType<typeof setTimeout> | null = null;
  private autoResultTimer: ReturnType<typeof setTimeout> | null = null;
  private cancelPermission: ((error: Error) => void) | null = null;
  private stopPromise: Promise<RecordedAudio> | null = null;
  private resolveStop: ((audio: RecordedAudio) => void) | null = null;
  private rejectStop: ((error: Error) => void) | null = null;
  private failure: Error | null = null;
  private autoStoppedAudio: RecordedAudio | null = null;
  private retainAutoResult = false;

  async start(): Promise<void> {
    if (this.recorder || this.stream || this.cancelPermission)
      throw new Error("A recording is already active.");
    if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === "undefined")
      throw new Error("Microphone recording is unavailable in this browser.");

    const generation = ++this.generation;
    this.failure = null;
    this.clearAutoStoppedAudio();
    this.stopPromise = null;
    this.resolveStop = null;
    this.rejectStop = null;
    this.chunks = [];
    this.audioBytes = 0;
    this.tooLarge = false;

    const permission = navigator.mediaDevices.getUserMedia({ audio: true });
    void permission.then(
      (lateStream) => {
        if (this.generation !== generation) stopTracks(lateStream);
      },
      () => {},
    );
    let rejectPermission!: (error: Error) => void;
    const permissionWait = new Promise<MediaStream>((resolve, reject) => {
      rejectPermission = reject;
      permission.then(resolve, reject);
    });
    this.cancelPermission = (error) => rejectPermission(error);
    this.permissionTimer = setTimeout(() => {
      if (this.generation !== generation) return;
      this.generation++;
      this.cancelPermission?.(
        new Error("Microphone permission timed out. Check the browser prompt and retry."),
      );
    }, MICROPHONE_REQUEST_TIMEOUT_MS);

    let stream: MediaStream;
    try {
      stream = await permissionWait;
    } catch (error) {
      if (this.generation === generation) this.generation++;
      this.failure = error instanceof Error ? error : new Error(String(error));
      throw this.failure;
    } finally {
      if (this.permissionTimer) clearTimeout(this.permissionTimer);
      this.permissionTimer = null;
      this.cancelPermission = null;
    }
    if (this.generation !== generation) {
      stopTracks(stream);
      throw abortError();
    }

    this.stream = stream;
    try {
      const preferred = "audio/webm;codecs=opus";
      const options = MediaRecorder.isTypeSupported?.(preferred)
        ? { mimeType: preferred }
        : undefined;
      const recorder = new MediaRecorder(stream, options);
      this.recorder = recorder;
      recorder.ondataavailable = (event) => {
        if (this.recorder !== recorder || this.generation !== generation) return;
        if (!event.data?.size) return;
        this.audioBytes += event.data.size;
        if (this.audioBytes > MAX_AUDIO_BYTES) {
          this.tooLarge = true;
          this.chunks = [];
          void this.stop().catch(() => {});
          return;
        }
        this.chunks.push(event.data);
      };
      recorder.onerror = (event) => {
        if (this.recorder !== recorder) return;
        this.fail(event.error ?? new Error("The microphone recording failed."));
      };
      recorder.onstop = () => {
        if (this.recorder !== recorder || this.generation !== generation) return;
        if (this.stopTimer) clearTimeout(this.stopTimer);
        this.stopTimer = null;
        void this.finish(recorder, generation);
      };
      recorder.start(1_000);
      this.captureTimer = setTimeout(() => {
        if (this.recorder === recorder) void this.stop(true).catch(() => {});
      }, MAX_RECORDING_MS);
    } catch (error) {
      this.detachAndStopRecorder();
      this.releaseStream();
      this.generation++;
      this.failure = error instanceof Error ? error : new Error(String(error));
      throw this.failure;
    }
  }

  stop(retainAutoStoppedResult = false): Promise<RecordedAudio> {
    if (this.autoStoppedAudio) {
      const result = this.autoStoppedAudio;
      this.clearAutoStoppedAudio();
      return Promise.resolve(result);
    }
    if (this.stopPromise) {
      if (!retainAutoStoppedResult) this.retainAutoResult = false;
      return this.stopPromise;
    }
    if (this.failure) return Promise.reject(this.failure);
    const recorder = this.recorder;
    if (!recorder) return Promise.reject(new Error("There is no active recording to stop."));
    this.retainAutoResult = retainAutoStoppedResult;
    const completion = new Promise<RecordedAudio>((resolve, reject) => {
      this.resolveStop = resolve;
      this.rejectStop = reject;
    });
    this.stopPromise = completion;
    if (this.captureTimer) clearTimeout(this.captureTimer);
    this.captureTimer = null;
    try {
      const generation = this.generation;
      this.stopTimer = setTimeout(() => {
        if (this.recorder !== recorder || this.generation !== generation) return;
        this.fail(new Error("The recording did not stop correctly. Please retry."));
      }, RECORDER_STOP_TIMEOUT_MS);
      if (recorder.state !== "inactive") recorder.stop();
      else void this.finish(recorder, this.generation);
    } catch (error) {
      this.fail(error instanceof Error ? error : new Error(String(error)));
    }
    return completion;
  }

  cancel() {
    this.generation++;
    if (this.permissionTimer) clearTimeout(this.permissionTimer);
    if (this.captureTimer) clearTimeout(this.captureTimer);
    if (this.stopTimer) clearTimeout(this.stopTimer);
    this.permissionTimer = null;
    this.captureTimer = null;
    this.stopTimer = null;
    this.cancelPermission?.(abortError());
    this.cancelPermission = null;
    this.detachAndStopRecorder();
    this.releaseStream();
    this.chunks = [];
    this.audioBytes = 0;
    this.tooLarge = false;
    this.rejectStop?.(abortError());
    this.clearStopPromise();
    this.failure = null;
    this.retainAutoResult = false;
    this.clearAutoStoppedAudio();
  }

  private async finish(recorder: MediaRecorder, generation: number) {
    if (this.recorder !== recorder || this.generation !== generation) return;
    this.recorder = null;
    if (this.captureTimer) clearTimeout(this.captureTimer);
    if (this.stopTimer) clearTimeout(this.stopTimer);
    this.captureTimer = null;
    this.stopTimer = null;
    this.releaseStream();
    const chunks = this.chunks;
    const tooLarge = this.tooLarge || this.audioBytes > MAX_AUDIO_BYTES;
    this.chunks = [];
    this.audioBytes = 0;
    this.tooLarge = false;
    if (tooLarge) {
      const error = new Error("Recording exceeded 10 MB. Try a shorter recording.");
      this.failure = error;
      this.rejectStop?.(error);
      this.clearStopPromise();
      return;
    }
    const blob = new Blob(chunks, { type: recorder.mimeType || chunks[0]?.type });
    if (!blob.size) {
      const error = new Error("No audio was recorded. Check the microphone and try again.");
      this.failure = error;
      this.rejectStop?.(error);
      this.clearStopPromise();
      return;
    }
    try {
      const audio = await audioBlobToBase64(blob);
      if (this.generation !== generation) return;
      const result = { audio, mimeType: recorder.mimeType || blob.type || "audio/webm" };
      if (this.retainAutoResult) this.retainAutoStoppedAudio(result);
      this.resolveStop?.(result);
      this.clearStopPromise();
    } catch (error) {
      const failure = error instanceof Error ? error : new Error(String(error));
      this.failure = failure;
      this.rejectStop?.(failure);
      this.clearStopPromise();
    }
  }

  private fail(error: Error) {
    if (this.permissionTimer) clearTimeout(this.permissionTimer);
    if (this.captureTimer) clearTimeout(this.captureTimer);
    if (this.stopTimer) clearTimeout(this.stopTimer);
    this.permissionTimer = null;
    this.captureTimer = null;
    this.stopTimer = null;
    this.detachAndStopRecorder();
    this.releaseStream();
    this.chunks = [];
    this.audioBytes = 0;
    this.failure = error;
    this.rejectStop?.(error);
    this.clearStopPromise();
  }

  private detachAndStopRecorder() {
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

  private releaseStream() {
    stopTracks(this.stream);
    this.stream = null;
  }

  private clearStopPromise() {
    this.stopPromise = null;
    this.resolveStop = null;
    this.rejectStop = null;
  }

  private retainAutoStoppedAudio(audio: RecordedAudio) {
    this.clearAutoStoppedAudio();
    this.autoStoppedAudio = audio;
    this.autoResultTimer = setTimeout(
      () => this.clearAutoStoppedAudio(),
      AUTO_STOP_RESULT_TTL_MS,
    );
  }

  private clearAutoStoppedAudio() {
    if (this.autoResultTimer) clearTimeout(this.autoResultTimer);
    this.autoResultTimer = null;
    this.autoStoppedAudio = null;
  }
}
