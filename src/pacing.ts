import type { ReplyTiming } from "./types";

// Conservative text cues: ambiguous statements and unfinished questions keep
// the full quiet window. This does not infer a service or generate a reply.
export function isDefinitiveQuestion(text: string): boolean {
  const value = text.trim().replace(/[’]/g, "'").toLowerCase();
  if (
    !value ||
    /(?:\.\.\.|…|[:,]|\b(?:and|or|but|because|about|with|for|to))\s*\??$/.test(
      value,
    )
  )
    return false;
  if (
    /^(?:hi|hey|hello|good (?:morning|afternoon|evening)|are you there|can (?:i ask|you help)|i (?:have|wanted to ask) a question)[!.?\s]*$/.test(
      value,
    )
  )
    return false;
  if (
    /^(?:price|cost|fees?|requirements|documents|location)(?: please)?[?.!]*$/.test(
      value,
    )
  )
    return true;
  if (
    /^(?:how much|what(?:'s| is) (?:the )?(?:price|cost|difference)|where (?:are you|is your office)|what (?:are the )?(?:requirements|documents))\b/.test(
      value,
    )
  )
    return true;
  const words = value.match(/[\p{L}\p{N}']+/gu) ?? [];
  if (words.length < 4) return false;
  return (
    /[?？]$/.test(value) ||
    /^(?:what|which|where|when|why|how|do (?:i|you|we)|does|is|are|can|could|will|would)\b/.test(
      value,
    )
  );
}
export function quietDelay(text = "", random = Math.random): number {
  return isDefinitiveQuestion(text)
    ? 8000 + Math.floor(random() * 4000)
    : 30000 + Math.floor(random() * 15000);
}
export function replyDelay(
  text: string,
  random = Math.random,
  quick = false,
): number {
  return Math.min(
    quick ? 6000 : 22000,
    Math.round(
      (quick ? 1000 : 2500) +
        text.length * (quick ? 8 + random() * 7 : 25 + random() * 25) +
        random() * (quick ? 1000 : 2000),
    ),
  );
}
// Split only complete paragraphs, preserving lists and all original wording.
export function replyParts(text: string): string[] {
  if (text.length < 420) return [text];
  const paragraphs = text.split("\n\n");
  let best: string[] | null = null;
  let distance = Infinity;
  for (let i = 1; i < paragraphs.length; i++) {
    const first = paragraphs.slice(0, i).join("\n\n");
    const second = paragraphs.slice(i).join("\n\n");
    const tail = paragraphs[i - 1].trim();
    if (
      first.length < 100 ||
      second.length < 100 ||
      /[:：]$/.test(tail) ||
      /^\*[^*\n]+\*$/.test(tail)
    )
      continue;
    const score = Math.abs(first.length - second.length);
    if (score < distance) {
      best = [first, second];
      distance = score;
    }
  }
  return best ?? [text];
}

export function replyCountdown(timing: ReplyTiming, now = Date.now()): string {
  const seconds = Math.max(0, Math.ceil((timing.dueAt - now) / 1000));
  if (!seconds)
    return timing.phase === "quiet"
      ? "Drafting will start shortly…"
      : "Sending shortly…";
  const time = `${Math.floor(seconds / 60)
    .toString()
    .padStart(2, "0")}:${(seconds % 60).toString().padStart(2, "0")}`;
  return `${timing.phase === "quiet" ? "Drafting" : "Sending"} in ${time}`;
}
