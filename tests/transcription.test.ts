import { test } from "node:test";
import assert from "node:assert/strict";
import { transcribeAudio } from "../src/transcription";

test("transcription sends bounded audio as Whisper multipart using the saved key", async () => {
  const originalFetch = globalThis.fetch;
  let request: { url: string; init?: RequestInit } | undefined;
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    request = { url: String(input), init };
    return { ok: true, json: async () => ({ text: "  Help me summarize this policy.  " }) } as Response;
  }) as typeof fetch;
  try {
    assert.deepEqual(await transcribeAudio("AQIDBA==", "audio/webm;codecs=opus", "sk-fixture-key"), {
      text: "Help me summarize this policy.",
    });
    assert.equal(request?.url, "https://api.openai.com/v1/audio/transcriptions");
    assert.equal(request?.init?.method, "POST");
    assert.deepEqual(request?.init?.headers, { Authorization: "Bearer sk-fixture-key" });
    const form = request?.init?.body as FormData;
    assert.equal(form.get("model"), "whisper-1");
    assert.equal(form.get("response_format"), "json");
    const file = form.get("file") as File;
    assert.equal(file.name, "recording.webm");
    assert.equal(file.type, "audio/webm;codecs=opus");
    assert.deepEqual([...new Uint8Array(await file.arrayBuffer())], [1, 2, 3, 4]);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("transcription rejects data URLs, invalid base64, unsupported MIME types and oversized audio", async () => {
  for (const [audio, mimeType] of [
    ["", "audio/webm"],
    ["data:audio/webm;base64,AQIDBA==", "audio/webm"],
    ["%%%", "audio/webm"],
    ["AQIDBA==", "application/octet-stream"],
    ["A".repeat(14_000_000), "audio/webm"],
  ]) {
    await assert.rejects(transcribeAudio(audio, mimeType, "sk-fixture-key"));
  }
});
