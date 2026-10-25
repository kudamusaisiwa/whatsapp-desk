import { test } from "node:test";
import assert from "node:assert/strict";
import {
  AI_TASKS,
  PROVIDERS,
  defaultRoutes,
  invalidRouteTasks,
  normalizeRoutes,
  providerEndpoint,
  providerHeaders,
  providerModels,
  providerRequest,
  providerText,
  routeSupports,
} from "../src/providers";

const schema = { type: "object", properties: { reply: { type: "string" } }, required: ["reply"], additionalProperties: false };
const body = {
  instructions: "Use only known business facts.",
  input: [{ role: "user", content: [
    { type: "input_text", text: "Read this POP." },
    { type: "input_image", image_url: "data:image/jpeg;base64,AQIDBA==", detail: "auto" },
  ] }],
  max_output_tokens: 2500,
  text: { format: { type: "json_schema", schema } },
};

test("defaults preserve a legacy model while independently routing and normalizing all AI tasks", () => {
  const legacy = defaultRoutes("gpt-4.1-mini");
  assert.equal(legacy.text.model, "gpt-4.1-mini");
  assert.equal(legacy.vision.model, "gpt-4.1-mini");
  assert.equal(legacy.stt.model, "whisper-1");
  assert.deepEqual(AI_TASKS.map((task) => task.id), ["text", "vision", "polish", "summary", "stt", "callStt"]);
  assert.deepEqual(normalizeRoutes({ text: { provider: "gemini", model: "gemini-3.8-flash" } }, "gpt-4.1-mini").text, { provider: "gemini", model: "gemini-3.8-flash" });
  assert.equal(normalizeRoutes(null, "gpt-4.1-mini").text.model, "gpt-4.1-mini");
  assert.equal(PROVIDERS.length, 7);
});

test("invalid explicit routes are rejected rather than silently falling back to OpenAI", () => {
  assert.deepEqual(invalidRouteTasks({ text: { provider: "anthropic", model: "claude-haiku-4-5" } }), []);
  assert.deepEqual(invalidRouteTasks({ text: { provider: "unknown", model: "x" } }), ["text"]);
  assert.deepEqual(invalidRouteTasks({ vision: { provider: "deepseek", model: "deepseek-v4-pro" } }), ["vision"]);
  assert.equal(routeSupports({ provider: "deepseek", model: "deepseek-flash" }, "vision"), true);
});

test("fixed endpoints and provider auth headers never accept caller-supplied hosts", () => {
  assert.equal(providerEndpoint("openai", "gpt-5-mini").url, "https://api.openai.com/v1/responses");
  assert.equal(providerEndpoint("kimi", "kimi-k3").url, "https://api.moonshot.ai/v1/chat/completions");
  assert.equal(providerEndpoint("gemini", "gemini-3.8-flash").url, "https://generativelanguage.googleapis.com/v1beta/models/gemini-3.8-flash:generateContent");
  assert.deepEqual(providerHeaders("gemini", "fixture", true), { "Content-Type": "application/json", "x-goog-api-key": "fixture" });
  assert.equal(providerHeaders("anthropic", "fixture")["anthropic-dangerous-direct-browser-access"], "true");
  assert.equal(providerEndpoint("grok", "grok-4.1").url.startsWith("https://api.x.ai/"), true);
});

test("Chat Completions maps JSON schema prompting and preserves vision pixels", () => {
  for (const provider of ["openrouter", "kimi", "deepseek", "grok"] as const) {
    const request = providerRequest(provider, provider === "deepseek" ? "deepseek-flash" : provider === "kimi" ? "kimi-k3" : provider === "grok" ? "grok-4.1" : "vision-model", body, "vision") as any;
    assert.equal(request.response_format.type, "json_object");
    assert.match(request.messages[0].content, /JSON Schema/);
    const image = request.messages[1].content.find((part: any) => part.type === "image_url");
    assert.equal(image.image_url.url, "data:image/jpeg;base64,AQIDBA==");
  }
});

test("Anthropic and Gemini map multimodal structured requests without dropping images", () => {
  const anthropic = providerRequest("anthropic", "claude-sonnet-4-5", body, "vision") as any;
  assert.match(anthropic.system, /JSON Schema/);
  assert.deepEqual(anthropic.messages[0].content[1], { type: "image", source: { type: "base64", media_type: "image/jpeg", data: "AQIDBA==" } });
  const gemini = providerRequest("gemini", "gemini-3.8-flash", body, "vision") as any;
  assert.equal(gemini.generationConfig.responseMimeType, "application/json");
  assert.equal(gemini.contents[0].parts[1].inlineData.data, "AQIDBA==");
  assert.deepEqual(gemini.generationConfig.responseSchema, { type: "object", properties: { reply: { type: "string" } }, required: ["reply"] });
  assert.throws(() => providerRequest("anthropic", "claude-sonnet-4-5", { ...body, input: [{ role: "user", content: [{ type: "input_image", image_url: "https://not-available.example/a.jpg" }] }] }, "vision"), /cannot be sent to Anthropic/);
});

test("provider response extractors normalize each native wire response", () => {
  assert.equal(providerText("openai", { output: [{ content: [{ type: "output_text", text: "one" }] }] }), "one");
  assert.equal(providerText("deepseek", { choices: [{ message: { content: "two" } }] }), "two");
  assert.equal(providerText("anthropic", { content: [{ type: "text", text: "three" }] }), "three");
  assert.equal(providerText("gemini", { candidates: [{ content: { parts: [{ text: "thought", thought: true }, { text: "four" }] } }] }), "four");
  assert.deepEqual(providerModels("gemini", { models: [{ name: "models/gemini-3.8-flash" }] }), ["gemini-3.8-flash"]);
});


test("OpenAI uses the task route model even when a legacy text model remains in the input", () => {
  const request = providerRequest("openai", "gpt-4.1-mini", { ...body, model: "gpt-5-mini", store: false }, "summary") as any;
  assert.equal(request.model, "gpt-4.1-mini");
  assert.equal(request.store, false);
});
