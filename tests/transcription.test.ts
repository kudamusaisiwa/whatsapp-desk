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

test("OpenRouter uses its fixed Whisper endpoint and the selected model", async () => {
  const originalFetch = globalThis.fetch;
  let request: { url: string; init?: RequestInit } | undefined;
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    request = { url: String(input), init };
    return { ok: true, json: async () => ({ text: "OpenRouter transcript" }) } as Response;
  }) as typeof fetch;
  try {
    assert.deepEqual(await transcribeAudio("AQIDBA==", "audio/wav", "sk-or-fixture-key", 10 * 1024 * 1024, 8000, "names", "openrouter", "openai/whisper-large-v3"), { text: "OpenRouter transcript" });
    assert.equal(request?.url, "https://openrouter.ai/api/v1/audio/transcriptions");
    assert.deepEqual(request?.init?.headers, { Authorization: "Bearer sk-or-fixture-key" });
    assert.equal((request?.init?.body as FormData).get("model"), "openai/whisper-large-v3");
    assert.equal((request?.init?.body as FormData).get("prompt"), "names");
  } finally { globalThis.fetch = originalFetch; }
});

test("Gemini uses the native generateContent audio schema and returns text only", async () => {
  const originalFetch = globalThis.fetch;
  let request: { url: string; init?: RequestInit } | undefined;
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    request = { url: String(input), init };
    return { ok: true, json: async () => ({ candidates: [{ finishReason: "STOP", content: { parts: [{ text: "internal reasoning", thought: true }, { text: "  Gemini transcript.  " }] } }] }) } as Response;
  }) as typeof fetch;
  try {
    assert.deepEqual(await transcribeAudio("AQIDBA==", "audio/webm;codecs=opus", "AIza-fixture-key", 20 * 1024 * 1024, 100_000, "Use names", "gemini", "gemini-3.8-flash"), { text: "Gemini transcript." });
    assert.equal(request?.url, "https://generativelanguage.googleapis.com/v1beta/models/gemini-3.8-flash:generateContent");
    assert.deepEqual(request?.init?.headers, { "Content-Type": "application/json", "x-goog-api-key": "AIza-fixture-key" });
    const body = JSON.parse(String(request?.init?.body));
    assert.equal(body.contents[0].parts[0].text.includes("Use names"), true);
    assert.deepEqual(body.contents[0].parts[1], { inlineData: { mimeType: "audio/webm", data: "AQIDBA==" } });
  } finally { globalThis.fetch = originalFetch; }
});

test("speech transcription rejects providers without official STT routes", async () => {
  await assert.rejects(transcribeAudio("AQIDBA==", "audio/wav", "fixture-key", undefined, undefined, undefined, "anthropic"), /does not support speech transcription/);
});

test("Gemini transcription rejects incomplete MAX_TOKENS responses", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async () => ({ ok: true, json: async () => ({ candidates: [{ finishReason: "MAX_TOKENS", content: { parts: [{ text: "partial transcript" }] } }] }) } as Response)) as typeof fetch;
  try {
    await assert.rejects(transcribeAudio("AQIDBA==", "audio/webm", "AIza-fixture-key", 10 * 1024 * 1024, 8000, undefined, "gemini", "gemini-3.8-flash"), /stopped before finishing/);
  } finally { globalThis.fetch = originalFetch; }
});
