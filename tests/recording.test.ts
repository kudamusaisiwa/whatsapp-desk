import { test } from "node:test";
import assert from "node:assert/strict";
import { JSDOM } from "jsdom";
import {
  AUTO_STOP_RESULT_TTL_MS,
  MAX_AUDIO_BYTES,
  MAX_RECORDING_MS,
  MICROPHONE_REQUEST_TIMEOUT_MS,
  RECORDER_STOP_TIMEOUT_MS,
  Recorder,
} from "../src/recording";

class TrackStub {
  stopped = 0;
  stop() {
    this.stopped++;
  }
}

class MediaRecorderStub {
  static instances: MediaRecorderStub[] = [];
  static isTypeSupported(type: string) {
    return type.startsWith("audio/webm");
  }
  state: RecordingState = "inactive";
  mimeType = "audio/webm;codecs=opus";
  ondataavailable: ((event: any) => void) | null = null;
  onerror: ((event: any) => void) | null = null;
  onstop: (() => void) | null = null;
  finalChunk: Blob | null = null;
  timeslice = 0;
  constructor(readonly stream: any, readonly options?: MediaRecorderOptions) {
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

const globalKeys = ["window", "document", "navigator", "location", "MediaRecorder"] as const;

function setup(mediaDevices: { getUserMedia: () => Promise<MediaStream> }) {
  const dom = new JSDOM("", { url: "https://web.whatsapp.com/" });
  const original = new Map(
    globalKeys.map((key) => [key, Object.getOwnPropertyDescriptor(globalThis, key)]),
  );
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
              ? { mediaDevices }
              : (dom.window as any)[key],
    });
  }
  return {
    dom,
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

function streamFixture() {
  const track = new TrackStub();
  return { track, stream: { getTracks: () => [track] } as unknown as MediaStream };
}

test("Recorder requests audio, collects chunks, returns base64 and stops all tracks", async () => {
  const { stream, track } = streamFixture();
  let request: unknown;
  const env = setup({
    getUserMedia: async () => {
      request = { audio: true };
      return stream;
    },
  });
  const recorder = new Recorder();
  try {
    await recorder.start();
    const browserRecorder = MediaRecorderStub.instances[0];
    assert.deepEqual(request, { audio: true });
    assert.equal(browserRecorder.timeslice, 1_000);
    browserRecorder.emit(new Blob(["spoken bytes"]));
    browserRecorder.finalChunk = new Blob([" final"]);
    const audio = await recorder.stop();
    assert.equal(atob(audio.audio), "spoken bytes final");
    assert.equal(audio.mimeType, browserRecorder.mimeType);
    assert.equal(track.stopped, 1);
  } finally {
    recorder.cancel();
    env.restore();
  }
});

test("automatic 60-second stop keeps one result for the panel STOP RPC to consume", async () => {
  const { stream, track } = streamFixture();
  const env = setup({ getUserMedia: async () => stream });
  const realSetTimeout = globalThis.setTimeout;
  const realClearTimeout = globalThis.clearTimeout;
  const timers: Array<{ callback: () => void; delay: number; cleared: boolean }> = [];
  (globalThis as any).setTimeout = (callback: () => void, delay: number) => {
    const timer = { callback, delay, cleared: false };
    timers.push(timer);
    return timer;
  };
  (globalThis as any).clearTimeout = (timer: any) => {
    if (timer) timer.cleared = true;
  };
  const recorder = new Recorder();
  try {
    await recorder.start();
    const browserRecorder = MediaRecorderStub.instances[0];
    browserRecorder.finalChunk = new Blob(["at the time limit"]);
    assert.equal(MAX_RECORDING_MS, 60_000);
    const limit = timers.find((timer) => timer.delay === MAX_RECORDING_MS && !timer.cleared)!;
    assert.ok(limit);
    limit.callback();
    await Promise.resolve();
    await Promise.resolve();
    await new Promise<void>((resolve) => realSetTimeout(resolve, 0));
    assert.equal(typeof limit.callback, "function");
    assert.equal(AUTO_STOP_RESULT_TTL_MS, 30_000);
    assert.equal(atob((await recorder.stop()).audio), "at the time limit");
    await assert.rejects(recorder.stop(), /no active recording/);
    assert.equal(track.stopped, 1);
  } finally {
    recorder.cancel();
    (globalThis as any).setTimeout = realSetTimeout;
    (globalThis as any).clearTimeout = realClearTimeout;
    env.restore();
  }
});

test("stop timeout releases the microphone if MediaRecorder never emits stop", async () => {
  const { stream, track } = streamFixture();
  const env = setup({ getUserMedia: async () => stream });
  const realSetTimeout = globalThis.setTimeout;
  const realClearTimeout = globalThis.clearTimeout;
  const timers: Array<{ callback: () => void; delay: number; cleared: boolean }> = [];
  (globalThis as any).setTimeout = (callback: () => void, delay: number) => {
    const timer = { callback, delay, cleared: false };
    timers.push(timer);
    return timer;
  };
  (globalThis as any).clearTimeout = (timer: any) => {
    if (timer) timer.cleared = true;
  };
  const recorder = new Recorder();
  try {
    await recorder.start();
    const browserRecorder = MediaRecorderStub.instances[0];
    browserRecorder.onstop = null;
    const stopping = recorder.stop();
    const timeout = timers.find((timer) => timer.delay === RECORDER_STOP_TIMEOUT_MS && !timer.cleared)!;
    assert.ok(timeout);
    timeout.callback();
    await assert.rejects(stopping, /did not stop correctly/);
    assert.equal(track.stopped, 1);
  } finally {
    recorder.cancel();
    (globalThis as any).setTimeout = realSetTimeout;
    (globalThis as any).clearTimeout = realClearTimeout;
    env.restore();
  }
});

test("audio larger than 10 MiB is stopped and rejected without returning payload", async () => {
  const { stream, track } = streamFixture();
  const env = setup({ getUserMedia: async () => stream });
  const recorder = new Recorder();
  try {
    await recorder.start();
    assert.equal(MAX_AUDIO_BYTES, 10 * 1024 * 1024);
    const oversized = new Blob([new Uint8Array(MAX_AUDIO_BYTES + 1)]);
    MediaRecorderStub.instances[0].emit(oversized);
    await assert.rejects(recorder.stop(), /exceeded 10 MB/);
    assert.equal(track.stopped, 1);
  } finally {
    recorder.cancel();
    env.restore();
  }
});

test("permission denial rejects start cleanly and never starts MediaRecorder", async () => {
  const env = setup({
    getUserMedia: async () => {
      throw Object.assign(new Error("denied"), { name: "NotAllowedError" });
    },
  });
  const recorder = new Recorder();
  try {
    await assert.rejects(recorder.start(), /denied/);
    assert.equal(MediaRecorderStub.instances.length, 0);
  } finally {
    recorder.cancel();
    env.restore();
  }
});

test("permission prompt timeout cancels the request and late permission stops its tracks", async () => {
  let resolvePermission!: (stream: MediaStream) => void;
  const env = setup({
    getUserMedia: () => new Promise((resolve) => (resolvePermission = resolve)),
  });
  const realSetTimeout = globalThis.setTimeout;
  const realClearTimeout = globalThis.clearTimeout;
  const timers: Array<{ callback: () => void; delay: number; cleared: boolean }> = [];
  (globalThis as any).setTimeout = (callback: () => void, delay: number) => {
    const timer = { callback, delay, cleared: false };
    timers.push(timer);
    return timer;
  };
  (globalThis as any).clearTimeout = (timer: any) => {
    if (timer) timer.cleared = true;
  };
  const recorder = new Recorder();
  try {
    const starting = recorder.start();
    const timeout = timers.find((timer) => timer.delay === MICROPHONE_REQUEST_TIMEOUT_MS)!;
    assert.ok(timeout);
    timeout.callback();
    await assert.rejects(starting, /permission timed out/i);
    const { stream, track } = streamFixture();
    resolvePermission(stream);
    await Promise.resolve();
    await Promise.resolve();
    assert.equal(track.stopped, 1);
    assert.equal(MediaRecorderStub.instances.length, 0);
  } finally {
    recorder.cancel();
    (globalThis as any).setTimeout = realSetTimeout;
    (globalThis as any).clearTimeout = realClearTimeout;
    env.restore();
  }
});

test("cancel during recording stops capture and releases stream tracks", async () => {
  const { stream, track } = streamFixture();
  const env = setup({ getUserMedia: async () => stream });
  const recorder = new Recorder();
  try {
    await recorder.start();
    const browserRecorder = MediaRecorderStub.instances[0];
    recorder.cancel();
    assert.equal(track.stopped, 1);
    assert.equal(browserRecorder.state, "inactive");
    assert.equal(browserRecorder.onstop, null);
    await assert.rejects(recorder.stop(), /There is no active recording/);
  } finally {
    recorder.cancel();
    env.restore();
  }
});
