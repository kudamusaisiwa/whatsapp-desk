const MAX_AUDIO_BYTES = 10 * 1024 * 1024;
const MIME_EXTENSIONS: Record<string, string> = {
  "audio/webm;codecs=opus": "webm", "audio/webm": "webm",
  "audio/ogg;codecs=opus": "ogg", "audio/ogg": "ogg",
  "audio/mp4;codecs=mp4a.40.2": "mp4", "audio/mp4": "mp4",
  "audio/mpeg": "mp3", "audio/mp3": "mp3", "audio/wav": "wav",
  "audio/x-wav": "wav", "audio/flac": "flac",
};

export async function transcribeAudio(audio: unknown, mimeType: unknown, key: string, maxBytes = MAX_AUDIO_BYTES, maxTranscriptChars = 8000, prompt?: string): Promise<{ text: string }> {
  const maxBase64 = 4 * Math.ceil(maxBytes / 3);
  const isCall = maxBytes > MAX_AUDIO_BYTES;
  const sizeMessage = `Recording is too large. Keep it under ${Math.floor(maxBytes / (1024 * 1024))} MB.`;
  if (typeof audio !== "string" || !audio) throw new Error(isCall ? "The call recording is empty." : "Record a short voice instruction first.");
  if (audio.length > maxBase64) throw new Error(sizeMessage);
  let padding = 0;
  for (let i = 0; i < audio.length; i++) {
    const code = audio.charCodeAt(i);
    if (code === 61) {
      padding++;
      if (padding > 2 || i < audio.length - 2) throw new Error("The recording data is invalid. Please record it again.");
    } else if (
      padding ||
      !((code >= 65 && code <= 90) || (code >= 97 && code <= 122) ||
        (code >= 48 && code <= 57) || code === 43 || code === 47)
    ) throw new Error("The recording data is invalid. Please record it again.");
  }
  if (audio.length % 4 !== 0)
    throw new Error("The recording data is invalid. Please record it again.");
  if (typeof mimeType !== "string" || !Object.hasOwn(MIME_EXTENSIONS, mimeType))
    throw new Error("This recording format is not supported.");
  let binary: string;
  try { binary = atob(audio); } catch { throw new Error("The recording data is invalid. Please record it again."); }
  if (!binary.length || binary.length > maxBytes) throw new Error(binary.length ? sizeMessage : "Recording is empty.");
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  const form = new FormData();
  form.append("file", new Blob([bytes], { type: mimeType }), `recording.${MIME_EXTENSIONS[mimeType]}`);
  form.append("model", "whisper-1");
  if (prompt) form.append("prompt", prompt);
  form.append("response_format", "json");
  let response: Response;
  try {
    response = await fetch("https://api.openai.com/v1/audio/transcriptions", {
      method: "POST", headers: { Authorization: `Bearer ${key}` }, body: form,
      signal: AbortSignal.timeout(isCall ? 60000 : 45000),
    });
  } catch (error) {
    throw new Error(error instanceof Error && error.name === "TimeoutError"
      ? "Voice transcription took too long. Try a shorter recording."
      : "OpenAI could not be reached for voice transcription. Check your connection and try again.");
  }
  if (!response.ok) {
    const messages: Record<number, string> = {
      400: "The recording could not be transcribed. Try recording it again.",
      401: "The OpenAI key was not accepted. Check the key in Settings.",
      413: "Recording is too large. Keep it under 10 MB.",
      429: "OpenAI usage or rate limit reached. Try again shortly.",
    };
    throw new Error(messages[response.status] ?? `Voice transcription is temporarily unavailable (${response.status}). Try again shortly.`);
  }
  let result: any;
  try { result = await response.json(); } catch { throw new Error("OpenAI returned an invalid transcription. Please try again."); }
  if (typeof result?.text !== "string" || !result.text.trim()) throw new Error("No speech was recognized. Try recording again.");
  const transcript = result.text.trim();
  if (isCall && transcript.length > maxTranscriptChars)
    throw new Error("The call transcript is over 100,000 characters. It was not shortened, so no actions were lost; use a shorter recording and try again.");
  return { text: transcript.slice(0, maxTranscriptChars) };
}
