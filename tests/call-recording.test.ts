import { test } from "node:test";
import assert from "node:assert/strict";
import { JSDOM } from "jsdom";
import {
  CALL_RECORD_MAX_BYTES,
  CALL_RECORD_MAX_MS,
  CALL_RECORD_PERMISSION_TIMEOUT_MS,
  CALL_RECORD_RESULT_TTL_MS,
  CALL_RECORD_STOP_TIMEOUT_MS,
  CallRecorder,
} from "../src/call-recording";

class TrackStub extends EventTarget {
  stopped = 0;
  readyState: MediaStreamTrackState = "live";
  constructor(readonly kind: string) {
    super();
  }
  stop() {
    this.stopped++;
    this.readyState = "ended";
  }
  end() {
    this.readyState = "ended";
    this.dispatchEvent(new Event("ended"));
  }
}

class StreamStub {
  constructor(readonly tracks: TrackStub[]) {}
  getTracks() {
    return this.tracks;
  }
  getAudioTracks() {
    return this.tracks.filter((track) => track.kind === "audio");
  }
}

class MediaRecorderStub {
  static instances: MediaRecorderStub[] = [];
  static isTypeSupported(type: string) {
    return type === "audio/webm;codecs=opus";
  }
  state: RecordingState = "inactive";
  mimeType = "audio/webm;codecs=opus";
  ondataavailable: ((event: any) => void) | null = null;
  onerror: ((event: any) => void) | null = null;
  onstop: (() => void) | null = null;
  finalChunk: Blob | null = null;
  timeslice = 0;
  constructor(
    readonly stream: any,
    readonly options?: MediaRecorderOptions,
  ) {
    MediaRecorderStub.instances.push(this);
  }
  start(timeslice?: number) {
    this.timeslice = timeslice ?? 0;
    this.state = "recording";
  }
  stop() {
    if (this.state === "inactive") return;
    if (this.finalChunk) this.ondataavailable?.({ data: this.finalChunk });
    this.state = "inactive";
    this.onstop?.();
  }
  emit(blob: Blob) {
    this.ondataavailable?.({ data: blob });
  }
}

class AudioContextStub {
  static instances: AudioContextStub[] = [];
  state: AudioContextState = "running";
  connections: Array<{ source: unknown; destination: unknown }> = [];
  destination: object = { speakers: true };
  readonly mixedTrack = new TrackStub("audio");
  readonly mixedStream = new StreamStub([this.mixedTrack]);
  readonly mixDestination: any = {
    stream: this.mixedStream,
    channelCount: 2,
    channelCountMode: "max",
  };
  constructor() {
    AudioContextStub.instances.push(this);
  }
  async resume() {}
  createMediaStreamDestination() {
    return this.mixDestination as any;
  }
  createMediaStreamSource(stream: unknown) {
    const source = { stream };
    return {
      connect: (destination: unknown) =>
        this.connections.push({ source, destination }),
    };
  }
  async close() {
    this.state = "closed";
  }
}

const globalKeys = [
  "window",
  "document",
  "navigator",
  "MediaRecorder",
  "btoa",
] as const;

function setup(getUserMedia: (constraints: any) => Promise<MediaStream>) {
  const dom = new JSDOM("", { url: "https://web.whatsapp.com/" });
  const original = new Map(
    globalKeys.map((key) => [
      key,
      Object.getOwnPropertyDescriptor(globalThis, key),
    ]),
  );
  Object.defineProperty(dom.window, "AudioContext", {
    configurable: true,
    value: AudioContextStub,
  });
  AudioContextStub.instances = [];
  MediaRecorderStub.instances = [];
  for (const key of globalKeys) {
    Object.defineProperty(globalThis, key, {
      configurable: true,
      value:
        key === "window"
          ? dom.window
          : key === "MediaRecorder"
            ? MediaRecorderStub
            : key === "navigator"
              ? { mediaDevices: { getUserMedia } }
              : key === "btoa"
                ? (value: string) =>
                    Buffer.from(value, "binary").toString("base64")
                : (dom.window as any)[key],
    });
  }
  return {
    restore() {
      dom.window.close();
      for (const key of globalKeys) {
        const descriptor = original.get(key);
        if (descriptor) Object.defineProperty(globalThis, key, descriptor);
        else delete (globalThis as any)[key];
      }
    },
  };
}

function fixture(kind = "audio") {
  const tracks = [new TrackStub(kind)];
  return { stream: new StreamStub(tracks) as unknown as MediaStream, tracks };
}

const payload = {
  streamId: "desktop-stream-id",
  sessionId: "session-123",
  chatId: "chat-456",
  name: "Customer",
};

test("mixes call tab and microphone audio into an audio-only recorder without speaker feedback", async () => {
  const call = fixture();
  const callVideo = new TrackStub("video");
  const desktopStream = new StreamStub([
    ...call.tracks,
    callVideo,
  ]) as unknown as MediaStream;
  const microphone = fixture();
  const requests: any[] = [];
  const env = setup(async (constraints) => {
    requests.push(constraints);
    return requests.length === 1 ? desktopStream : microphone.stream;
  });
  const capture = new CallRecorder();
  try {
    const status = await capture.start(payload);
    const browserRecorder = MediaRecorderStub.instances[0];
    const audioContext = AudioContextStub.instances[0];
    assert.equal(status.phase, "recording");
    assert.equal(status.hasCallAudio, true);
    assert.equal(status.hasMicrophone, true);
    assert.equal(requests.length, 2);
    assert.equal(requests[0].audio.mandatory.chromeMediaSource, "desktop");
    assert.equal(
      requests[0].audio.mandatory.chromeMediaSourceId,
      payload.streamId,
    );
    assert.equal(
      requests[0].video.mandatory.chromeMediaSourceId,
      payload.streamId,
    );
    assert.deepEqual(requests[1], { audio: true, video: false });
    assert.equal(browserRecorder.stream, audioContext.mixedStream);
    assert.equal(browserRecorder.options.audioBitsPerSecond, 32_000);
    assert.equal(browserRecorder.options.mimeType, "audio/webm;codecs=opus");
    assert.equal(audioContext.mixDestination.channelCount, 1);
    assert.equal(audioContext.mixDestination.channelCountMode, "explicit");
    assert.equal(audioContext.connections.length, 2);
    assert.ok(
      audioContext.connections.every(
        (connection) => connection.destination === audioContext.mixDestination,
      ),
    );
    assert.ok(
      audioContext.connections.every(
        (connection) => connection.destination !== audioContext.destination,
      ),
    );
    browserRecorder.emit(new Blob(["local and remote call bytes"]));
    browserRecorder.finalChunk = new Blob([" tail"]);
    const result = await capture.stop(payload.sessionId);
    assert.equal(atob(result.audio), "local and remote call bytes tail");
    assert.equal(result.mimeType, browserRecorder.mimeType);
    assert.ok(result.durationMs >= 0);
    assert.equal(call.tracks[0].stopped, 1);
    assert.equal(callVideo.stopped, 1);
    assert.equal(microphone.tracks[0].stopped, 1);
    assert.equal(audioContext.mixedTrack.stopped, 1);
    assert.equal(audioContext.state, "closed");
  } finally {
    capture.cancel();
    env.restore();
  }
});

test("fails closed when either required audio source is missing", async () => {
  const desktop = fixture("video");
  const microphone = fixture();
  let callCount = 0;
  const env = setup(async () =>
    callCount++ === 0 ? desktop.stream : microphone.stream,
  );
  const capture = new CallRecorder();
  try {
    await assert.rejects(
      capture.start(payload),
      /Both WhatsApp call audio and microphone/,
    );
    assert.equal(MediaRecorderStub.instances.length, 0);
    assert.equal(desktop.tracks[0].stopped, 1);
    assert.equal(microphone.tracks[0].stopped, 1);
    assert.equal(capture.getStatus().phase, "error");
    assert.equal(capture.getStatus().hasCallAudio, false);
    assert.equal(capture.getStatus().hasMicrophone, false);
  } finally {
    capture.cancel();
    env.restore();
  }
});

test("denied source permission rejects without starting a recorder", async () => {
  const desktop = fixture();
  let callCount = 0;
  const env = setup(async () => {
    if (callCount++ === 0) return desktop.stream;
    throw Object.assign(new Error("microphone denied"), {
      name: "NotAllowedError",
    });
  });
  const capture = new CallRecorder();
  try {
    await assert.rejects(capture.start(payload), /microphone denied/);
    assert.equal(desktop.tracks[0].stopped, 1);
    assert.equal(MediaRecorderStub.instances.length, 0);
  } finally {
    capture.cancel();
    env.restore();
  }
});

test("permission timeout cleans acquired streams and stops streams granted late", async () => {
  const desktop = fixture();
  const lateMicrophone = fixture();
  let resolveMic!: (stream: MediaStream) => void;
  let callCount = 0;
  const env = setup((constraints) => {
    callCount++;
    if (constraints.audio?.mandatory) return Promise.resolve(desktop.stream);
    return new Promise((resolve) => (resolveMic = resolve));
  });
  const realSetTimeout = globalThis.setTimeout;
  const realClearTimeout = globalThis.clearTimeout;
  const timers: Array<{
    callback: () => void;
    delay: number;
    cleared: boolean;
  }> = [];
  (globalThis as any).setTimeout = (callback: () => void, delay: number) => {
    const timer = { callback, delay, cleared: false };
    timers.push(timer);
    return timer;
  };
  (globalThis as any).clearTimeout = (timer: any) => {
    if (timer) timer.cleared = true;
  };
  const capture = new CallRecorder();
  try {
    const starting = capture.start(payload);
    const timeout = timers.find(
      (timer) => timer.delay === CALL_RECORD_PERMISSION_TIMEOUT_MS,
    )!;
    assert.ok(timeout);
    assert.equal(CALL_RECORD_PERMISSION_TIMEOUT_MS, 25_000);
    timeout.callback();
    await assert.rejects(starting, /permission timed out/);
    assert.equal(desktop.tracks[0].stopped, 1);
    resolveMic(lateMicrophone.stream);
    await Promise.resolve();
    await Promise.resolve();
    assert.equal(lateMicrophone.tracks[0].stopped, 1);
  } finally {
    capture.cancel();
    (globalThis as any).setTimeout = realSetTimeout;
    (globalThis as any).clearTimeout = realClearTimeout;
    env.restore();
  }
});

test("enforces recording session token, 60 minute and 20 MiB limits", async () => {
  const desktop = fixture();
  const microphone = fixture();
  let callCount = 0;
  const env = setup(async () =>
    callCount++ === 0 ? desktop.stream : microphone.stream,
  );
  const realSetTimeout = globalThis.setTimeout;
  const realClearTimeout = globalThis.clearTimeout;
  const timers: Array<{
    callback: () => void;
    delay: number;
    cleared: boolean;
  }> = [];
  (globalThis as any).setTimeout = (callback: () => void, delay: number) => {
    const timer = { callback, delay, cleared: false };
    timers.push(timer);
    return timer;
  };
  (globalThis as any).clearTimeout = (timer: any) => {
    if (timer) timer.cleared = true;
  };
  const capture = new CallRecorder();
  try {
    await capture.start(payload);
    assert.equal(capture.getStatus().phase, "recording");
    assert.equal(CALL_RECORD_MAX_MS, 60 * 60 * 1_000);
    assert.equal(CALL_RECORD_MAX_BYTES, 20 * 1024 * 1024);
    assert.equal(CALL_RECORD_RESULT_TTL_MS, 5 * 60 * 1_000);
    assert.equal(CALL_RECORD_STOP_TIMEOUT_MS, 3_000);
    assert.ok(timers.some((timer) => timer.delay === CALL_RECORD_MAX_MS));
    await assert.rejects(capture.status("wrong-token"), /does not match/);
    const oversized = new Blob([new Uint8Array(CALL_RECORD_MAX_BYTES + 1)]);
    MediaRecorderStub.instances[0].emit(oversized);
    await assert.rejects(capture.stop(payload.sessionId), /exceeded 20 MB/);
  } finally {
    capture.cancel();
    (globalThis as any).setTimeout = realSetTimeout;
    (globalThis as any).clearTimeout = realClearTimeout;
    env.restore();
  }
});

test("ended audio source auto-stops and keeps a short-lived result for STOP", async () => {
  const desktop = fixture();
  const microphone = fixture();
  let callCount = 0;
  const env = setup(async () =>
    callCount++ === 0 ? desktop.stream : microphone.stream,
  );
  const capture = new CallRecorder();
  try {
    await capture.start(payload);
    const browserRecorder = MediaRecorderStub.instances[0];
    browserRecorder.finalChunk = new Blob(["captured until share ended"]);
    desktop.tracks[0].end();
    await Promise.resolve();
    await Promise.resolve();
    await new Promise<void>((resolve) => globalThis.setTimeout(resolve, 0));
    assert.equal(capture.getStatus().phase, "stopped");
    assert.equal(
      atob((await capture.stop(payload.sessionId)).audio),
      "captured until share ended",
    );
    await assert.rejects(
      capture.stop(payload.sessionId),
      /no active call recording/,
    );
  } finally {
    capture.cancel();
    env.restore();
  }
});
