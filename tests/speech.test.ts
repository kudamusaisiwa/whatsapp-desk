import { test } from "node:test";
import assert from "node:assert/strict";
import { JSDOM } from "jsdom";
import React, { act } from "react";
import { SpeechInput } from "../src/speech";

const globalKeys = ["window", "document", "navigator", "location"] as const;

async function mountSpeech(rpcCall: (type: string, payload?: any) => Promise<any>) {
  const dom = new JSDOM("<div id='root'></div>", {
    url: "https://preview.example/panel.html?tabId=4",
  });
  const before = new Map(
    globalKeys.map((key) => [key, Object.getOwnPropertyDescriptor(globalThis, key)]),
  );
  for (const key of globalKeys) {
    Object.defineProperty(globalThis, key, {
      configurable: true,
      value: key === "window" ? dom.window : (dom.window as any)[key],
    });
  }
  (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
  const { createRoot } = await import("react-dom/client");
  const root = createRoot(dom.window.document.getElementById("root")!);
  const appended: string[] = [];
  act(() =>
    root.render(
      React.createElement(SpeechInput, {
        onTranscript: (text: string) => appended.push(text),
        extensionMode: true,
        rpcCall,
      }),
    ),
  );
  return {
    dom,
    appended,
    click() {
      const button = dom.window.document.querySelector(".speech-input__toggle") as HTMLButtonElement;
      assert.ok(button);
      act(() => button.click());
    },
    text() {
      return dom.window.document.body.textContent ?? "";
    },
    async flush() {
      await act(async () => {
        await Promise.resolve();
        await Promise.resolve();
        await Promise.resolve();
        await Promise.resolve();
      });
    },
    async cleanup() {
      act(() => root.unmount());
      dom.window.close();
      for (const key of globalKeys) {
        const descriptor = before.get(key);
        if (descriptor) Object.defineProperty(globalThis, key, descriptor);
        else delete (globalThis as any)[key];
      }
      delete (globalThis as any).IS_REACT_ACT_ENVIRONMENT;
    },
  };
}

test("mic button starts top-level capture, stops it, and appends only transcription text", async () => {
  const calls: Array<{ type: string; payload?: any }> = [];
  const rpc = async (type: string, payload?: any) => {
    calls.push({ type, payload });
    if (type === "RECORD_AUDIO_STOP")
      return { audio: "c3BlZWNo", mimeType: "audio/webm;codecs=opus" };
    if (type === "TRANSCRIBE_AUDIO") return { text: "  update the client record  " };
    return {};
  };
  const app = await mountSpeech(rpc);
  try {
    app.click();
    await app.flush();
    assert.deepEqual(calls.map((call) => call.type), ["RECORD_AUDIO_START"]);
    assert.match(app.text(), /Stop recording/);
    app.click();
    await app.flush();
    assert.deepEqual(calls.map((call) => call.type), [
      "RECORD_AUDIO_START",
      "RECORD_AUDIO_STOP",
      "TRANSCRIBE_AUDIO",
    ]);
    assert.deepEqual(calls[2].payload, {
      audio: "c3BlZWNo",
      mimeType: "audio/webm;codecs=opus",
    });
    assert.deepEqual(app.appended, ["update the client record"]);
    assert.match(app.text(), /Transcript added/);
  } finally {
    await app.cleanup();
  }
});

test("microphone permission error is visible and retry begins a new capture", async () => {
  let attempts = 0;
  const app = await mountSpeech(async (type) => {
    if (type === "RECORD_AUDIO_START" && attempts++ === 0)
      throw new Error("Microphone access was denied. Allow microphone access for WhatsApp Web in Chrome.");
    if (type === "RECORD_AUDIO_STOP")
      return { audio: "YQ==", mimeType: "audio/webm" };
    return {};
  });
  try {
    app.click();
    await app.flush();
    assert.match(app.text(), /Microphone access was denied/);
    app.click();
    await app.flush();
    assert.equal(attempts, 2);
    assert.match(app.text(), /Stop recording/);
  } finally {
    await app.cleanup();
  }
});

test("transcription service failure leaves the instruction editable and does not append", async () => {
  const app = await mountSpeech(async (type) => {
    if (type === "RECORD_AUDIO_STOP")
      return { audio: "c3BlZWNo", mimeType: "audio/webm" };
    if (type === "TRANSCRIBE_AUDIO") throw new Error("Transcription service unavailable. Retry shortly.");
    return {};
  });
  try {
    app.click();
    await app.flush();
    app.click();
    await app.flush();
    assert.match(app.text(), /Transcription service unavailable/);
    assert.deepEqual(app.appended, []);
  } finally {
    await app.cleanup();
  }
});

test("empty backend transcripts show retry guidance and never alter the field", async () => {
  const app = await mountSpeech(async (type) => {
    if (type === "RECORD_AUDIO_STOP")
      return { audio: "c3BlZWNo", mimeType: "audio/webm" };
    if (type === "TRANSCRIBE_AUDIO") return { text: "  " };
    return {};
  });
  try {
    app.click();
    await app.flush();
    app.click();
    await app.flush();
    assert.match(app.text(), /No speech was recognized/);
    assert.deepEqual(app.appended, []);
  } finally {
    await app.cleanup();
  }
});

test("unmount during recording sends cancel and never submits audio", async () => {
  const calls: string[] = [];
  const app = await mountSpeech(async (type) => {
    calls.push(type);
    return {};
  });
  app.click();
  await app.flush();
  await app.cleanup();
  await Promise.resolve();
  assert.deepEqual(calls, ["RECORD_AUDIO_START", "RECORD_AUDIO_CANCEL"]);
});

test("unmount while start RPC is pending cancels capture even if it resolves later", async () => {
  let resolveStart!: () => void;
  const calls: string[] = [];
  const app = await mountSpeech((type) => {
    calls.push(type);
    if (type === "RECORD_AUDIO_START") return new Promise((resolve) => (resolveStart = resolve));
    return Promise.resolve({});
  });
  app.click();
  await Promise.resolve();
  await app.cleanup();
  resolveStart();
  await Promise.resolve();
  await Promise.resolve();
  assert.equal(calls.filter((type) => type === "RECORD_AUDIO_CANCEL").length, 2);
  assert.equal(calls.includes("TRANSCRIBE_AUDIO"), false);
});
