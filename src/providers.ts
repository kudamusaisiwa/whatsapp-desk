export type ProviderId = "openai" | "openrouter" | "kimi" | "deepseek" | "anthropic" | "gemini" | "grok";
export type AiTask = "text" | "vision" | "polish" | "summary" | "stt" | "callStt";
export interface AiRoute { provider: ProviderId; model: string }
export interface ProviderInfo { id: ProviderId; label: string; tasks: AiTask[]; models: string[]; sttModels?: string[] }

export const AI_TASKS: { id: AiTask; label: string; description: string }[] = [
  { id: "text", label: "Assistant replies", description: "Conversation replies and general assistant requests." },
  { id: "vision", label: "Pictures and POPs", description: "Understand pictures and payment proof attachments." },
  { id: "polish", label: "Polish text", description: "Edit dictated or drafted text." },
  { id: "summary", label: "Call summaries", description: "Summarize recorded call transcripts." },
  { id: "stt", label: "Voice dictation", description: "Transcribe short voice instructions." },
  { id: "callStt", label: "Call transcription", description: "Transcribe recorded calls." },
];
export const PROVIDERS: ProviderInfo[] = [
  { id: "openai", label: "OpenAI", tasks: ["text", "vision", "polish", "summary", "stt", "callStt"], models: ["gpt-5-mini", "gpt-4.1-mini", "gpt-4o-mini"], sttModels: ["whisper-1", "gpt-4o-mini-transcribe"] },
  { id: "openrouter", label: "OpenRouter", tasks: ["text", "vision", "polish", "summary", "stt", "callStt"], models: [], sttModels: ["openai/whisper-large-v3", "openai/whisper-1"] },
  { id: "kimi", label: "Kimi (Moonshot AI)", tasks: ["text", "vision", "polish", "summary"], models: ["kimi-k3", "kimi-k2.6"] },
  { id: "deepseek", label: "DeepSeek", tasks: ["text", "vision", "polish", "summary"], models: ["deepseek-v4-pro", "deepseek-flash"] },
  { id: "anthropic", label: "Anthropic", tasks: ["text", "vision", "polish", "summary"], models: ["claude-sonnet-4-5", "claude-haiku-4-5"] },
  { id: "gemini", label: "Google Gemini", tasks: ["text", "vision", "polish", "summary", "stt", "callStt"], models: ["gemini-3.8-flash", "gemini-3.8-pro"], sttModels: ["gemini-3.8-flash"] },
  { id: "grok", label: "xAI Grok", tasks: ["text", "vision", "polish", "summary"], models: ["grok-4.1-fast", "grok-4.1"] },
];
const taskList = AI_TASKS.map((x) => x.id);
const isProvider = (x: unknown): x is ProviderId => PROVIDERS.some((p) => p.id === x);
function modelFor(provider: ProviderId, task: AiTask, legacy?: string) {
  if (provider === "openai" && legacy && task !== "stt" && task !== "callStt") return legacy;
  const p = PROVIDERS.find((x) => x.id === provider)!;
  return task === "stt" || task === "callStt" ? p.sttModels?.[0] ?? "" : p.models[0] ?? "";
}
export function defaultRoutes(legacyModel?: string): Record<AiTask, AiRoute> {
  return Object.fromEntries(taskList.map((task) => [task, { provider: "openai", model: modelFor("openai", task, legacyModel) }])) as Record<AiTask, AiRoute>;
}
export function normalizeRoutes(raw: unknown, legacyModel?: string): Record<AiTask, AiRoute> {
  const routes = defaultRoutes(legacyModel);
  if (!raw || typeof raw !== "object") return routes;
  for (const task of taskList) {
    const candidate = (raw as Record<string, unknown>)[task];
    if (!candidate || typeof candidate !== "object") continue;
    const { provider, model } = candidate as Record<string, unknown>;
    if (isProvider(provider) && PROVIDERS.find((p) => p.id === provider)!.tasks.includes(task) && typeof model === "string" && model.trim() && model.length <= 150)
      routes[task] = { provider, model: model.trim() };
  }
  return routes;
}
export function invalidRouteTasks(raw: unknown): AiTask[] {
  if (!raw || typeof raw !== "object") return [];
  return taskList.filter((task) => {
    const candidate = (raw as Record<string, unknown>)[task];
    if (candidate === undefined) return false;
    if (!candidate || typeof candidate !== "object") return true;
    const { provider, model } = candidate as Record<string, unknown>;
    return !isProvider(provider) || !PROVIDERS.find((p) => p.id === provider)!.tasks.includes(task) || typeof model !== "string" || !model.trim() || model.length > 150 || !routeSupports({ provider, model: typeof model === "string" ? model : "" }, task);
  });
}
export function routeSupports(route: AiRoute, task: AiTask): boolean {
  const provider = PROVIDERS.find((p) => p.id === route.provider);
  if (!provider?.tasks.includes(task) || !route.model) return false;
  if (task !== "vision") return true;
  const m = route.model.toLowerCase();
  if (route.provider === "kimi") return /vision|kimi-k[23](?:\.|$)|kimi-k2\.[56]/.test(m);
  if (route.provider === "anthropic") return /claude-(3|4|sonnet|opus|haiku)/.test(m);
  if (route.provider === "openai") return !/(^gpt-3\.5|instruct|audio|transcribe)/.test(m);
  if (route.provider === "gemini") return /^gemini-/.test(m) && !/(image|tts|live|transcribe|embedding)/.test(m);
  if (route.provider === "grok") return /grok-4/.test(m);
  if (route.provider === "deepseek") return /flash|vision/.test(m);
  return true;
}

export function providerEndpoint(provider: ProviderId, model?: string): { url: string; method: "GET" | "POST" } {
  switch (provider) {
    case "openai": return { url: model ? "https://api.openai.com/v1/responses" : "https://api.openai.com/v1/models", method: model ? "POST" : "GET" };
    case "openrouter": return { url: model ? "https://openrouter.ai/api/v1/chat/completions" : "https://openrouter.ai/api/v1/models", method: model ? "POST" : "GET" };
    case "kimi": return { url: model ? "https://api.moonshot.ai/v1/chat/completions" : "https://api.moonshot.ai/v1/models", method: model ? "POST" : "GET" };
    case "deepseek": return { url: model ? "https://api.deepseek.com/chat/completions" : "https://api.deepseek.com/models", method: model ? "POST" : "GET" };
    case "anthropic": return { url: model ? "https://api.anthropic.com/v1/messages" : "https://api.anthropic.com/v1/models", method: model ? "POST" : "GET" };
    case "gemini": return { url: model ? `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent` : "https://generativelanguage.googleapis.com/v1beta/models", method: "GET" };
    case "grok": return { url: model ? "https://api.x.ai/v1/chat/completions" : "https://api.x.ai/v1/models", method: model ? "POST" : "GET" };
  }
}
export function providerHeaders(provider: ProviderId, key: string, json = true): Record<string, string> {
  const headers: Record<string, string> = json ? { "Content-Type": "application/json" } : {};
  if (provider === "anthropic") Object.assign(headers, { "x-api-key": key, "anthropic-version": "2023-06-01", "anthropic-dangerous-direct-browser-access": "true" });
  else if (provider === "gemini") headers["x-goog-api-key"] = key;
  else headers.Authorization = `Bearer ${key}`;
  return headers;
}
function formatSchema(body: any) { return body?.text?.format?.schema; }
function schemaPrompt(schema: unknown) { return schema ? `Return only a JSON object that conforms to this JSON Schema:\n${JSON.stringify(schema)}` : ""; }
function asChatMessages(body: any, withJson = false) {
  const system = [body.instructions, withJson ? schemaPrompt(formatSchema(body)) : ""].filter(Boolean).join("\n\n");
  const input = Array.isArray(body.input) ? body.input : [{ role: "user", content: [{ type: "input_text", text: String(body.input ?? "") }] }];
  return [...(system ? [{ role: "system", content: system }] : []), ...input.map((item: any) => ({
    role: item.role === "assistant" ? "assistant" : "user",
    content: typeof item.content === "string" ? item.content : (item.content ?? []).map((part: any) => part.type === "input_image" ? { type: "image_url", image_url: { url: part.image_url, detail: part.detail ?? "auto" } } : { type: "text", text: part.text ?? "" }),
  }))];
}
function chatBody(model: string, body: any, json: boolean) {
  return { model, messages: asChatMessages(body, json), max_tokens: body.max_output_tokens ?? 3000, ...(json ? { response_format: { type: "json_object" } } : {}) };
}
function geminiSchema(schema: any): any {
  if (!schema || typeof schema !== "object") return undefined;
  if (Array.isArray(schema.anyOf)) {
    const chosen = schema.anyOf.find((item: any) => item?.type !== "null") ?? schema.anyOf[0];
    return { ...geminiSchema(chosen), nullable: schema.anyOf.some((item: any) => item?.type === "null") };
  }
  const out: any = {};
  for (const key of ["type", "description", "enum", "format", "nullable", "required"]) if (schema[key] !== undefined) out[key] = schema[key];
  if (Array.isArray(out.type) && out.type.includes("null")) {
    out.type = out.type.find((type: string) => type !== "null");
    out.nullable = true;
  }
  if (schema.properties) out.properties = Object.fromEntries(Object.entries(schema.properties).map(([k, v]) => [k, geminiSchema(v)]));
  if (schema.items) out.items = geminiSchema(schema.items);
  return out;
}
export function providerRequest(provider: ProviderId, model: string, body: unknown, task: AiTask): unknown {
  const b = body as any;
  if (!routeSupports({ provider, model }, task)) throw new Error(`${PROVIDERS.find((p) => p.id === provider)?.label ?? provider} model “${model}” does not support ${task === "vision" ? "picture input" : task}. Choose a compatible model in Settings.`);
  if (provider === "openai") return { ...b, model };
  const json = !!formatSchema(b);
  if (["openrouter", "kimi", "deepseek", "grok"].includes(provider)) return chatBody(model, b, json);
  if (provider === "anthropic") {
    const messages = asChatMessages(b, json).filter((m: any) => m.role !== "system").map((m: any) => ({ role: m.role, content: typeof m.content === "string" ? m.content : m.content.map((p: any) => p.type === "image_url" ? anthropicImage(p.image_url.url) : p) }));
    return { model, max_tokens: b.max_output_tokens ?? 3000, ...(b.instructions ? { system: [b.instructions, json ? schemaPrompt(formatSchema(b)) : ""].filter(Boolean).join("\n\n") } : {}), messages };
  }
  const all = asChatMessages(b, json);
  const system = all.find((m: any) => m.role === "system")?.content;
  const contents = all.filter((m: any) => m.role !== "system").map((m: any) => ({ role: m.role === "assistant" ? "model" : "user", parts: typeof m.content === "string" ? [{ text: m.content }] : m.content.map((p: any) => p.type === "image_url" ? geminiImage(p.image_url.url) : { text: p.text }) }));
  return { ...(system ? { systemInstruction: { parts: [{ text: system }] } } : {}), contents, generationConfig: { maxOutputTokens: b.max_output_tokens ?? 3000, ...(json ? { responseMimeType: "application/json", responseSchema: geminiSchema(formatSchema(b)) } : {}) } };
}
function anthropicImage(url: string) {
  const m = /^data:(image\/(?:jpeg|png|gif|webp));base64,([\s\S]+)$/.exec(url);
  if (!m) throw new Error("This image format cannot be sent to Anthropic. Choose a vision provider that accepts this image.");
  return { type: "image", source: { type: "base64", media_type: m[1], data: m[2] } };
}
function geminiImage(url: string) {
  const m = /^data:(image\/[\w.+-]+);base64,([\s\S]+)$/.exec(url);
  if (!m) throw new Error("This image format cannot be sent to Gemini. Choose a vision provider that accepts this image.");
  return { inlineData: { mimeType: m[1], data: m[2] } };
}
export function providerText(provider: ProviderId, response: any): string {
  if (provider === "openai") return (response?.output ?? []).flatMap((item: any) => item.content ?? []).filter((part: any) => part.type === "output_text").map((part: any) => part.text ?? "").join("");
  if (["openrouter", "kimi", "deepseek", "grok"].includes(provider)) {
    const content = response?.choices?.[0]?.message?.content;
    return typeof content === "string" ? content : Array.isArray(content) ? content.filter((p: any) => p.type === "text").map((p: any) => p.text).join("") : "";
  }
  if (provider === "anthropic") return (response?.content ?? []).filter((p: any) => p.type === "text").map((p: any) => p.text).join("");
  return (response?.candidates?.[0]?.content?.parts ?? []).filter((p: any) => !p.thought).map((p: any) => p.text ?? "").join("");
}
export function providerModels(provider: ProviderId, response: any): string[] {
  const entries = Array.isArray(response?.data) ? response.data : Array.isArray(response?.models) ? response.models : [];
  const ids: string[] = entries.map((x: any) => String(x.id ?? x.name ?? "").replace(/^models\//, "")).filter((id: string) => !!id);
  return [...new Set(ids)].sort((a, b) => b.localeCompare(a, undefined, { numeric: true }));
}
