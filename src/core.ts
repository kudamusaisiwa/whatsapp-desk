import type { ChatContext, DateOrder, Knowledge, Message } from "./types";
export const WINDOW_MS = 24 * 60 * 60 * 1000;
export function windowState(lastIncomingAt: number | null, now = Date.now()) {
  if (!lastIncomingAt || lastIncomingAt > now + 60000)
    return {
      known: false,
      remaining: 0,
      open: false,
      progress: 0,
      display: "--:--:--",
    };
  const remaining = Math.max(0, lastIncomingAt + WINDOW_MS - now);
  const total = Math.floor(remaining / 1000);
  return {
    known: true,
    remaining,
    open: remaining > 0,
    progress: Math.min(1, remaining / WINDOW_MS),
    display: [
      Math.floor(total / 3600),
      Math.floor((total % 3600) / 60),
      total % 60,
    ]
      .map((n) => String(n).padStart(2, "0"))
      .join(":"),
  };
}
export function parseWhatsAppTimestamp(
  raw: string,
  order: DateOrder = "DMY",
): number | null {
  const header = raw.match(/^\[([^\]]+)\]/)?.[1];
  if (!header) return null;
  const time = header.match(/(\d{1,2}):(\d{2})(?::\d{2})?\s*([ap]\.?m\.?)?/i);
  const date = header.match(/(\d{1,4})[/.\-](\d{1,2})[/.\-](\d{1,4})/);
  if (!time || !date) return null;
  let hour = Number(time[1]);
  const minute = Number(time[2]);
  const meridiem = time[3]?.replaceAll(".", "").toLowerCase();
  if (minute > 59 || hour > (meridiem ? 12 : 23) || (meridiem && hour < 1))
    return null;
  if (meridiem) hour = (hour % 12) + (meridiem === "pm" ? 12 : 0);
  let year: number, month: number, day: number;
  if (date[1].length === 4) [year, month, day] = [+date[1], +date[2], +date[3]];
  else {
    year = +date[3];
    if (year < 100) year += 2000;
    const dayFirst = +date[1] > 12 || (+date[2] <= 12 && order === "DMY");
    [day, month] = dayFirst ? [+date[1], +date[2]] : [+date[2], +date[1]];
  }
  const result = new Date(year, month - 1, day, hour, minute);
  if (
    result.getFullYear() !== year ||
    result.getMonth() !== month - 1 ||
    result.getDate() !== day ||
    !Number.isFinite(+result)
  )
    return null;
  return +result;
}
export function peerFromMessageId(id: string): string | null {
  return (
    /^(?:true|false)_([^_]+@(?:c\.us|s\.whatsapp\.net|lid|g\.us))_/.exec(
      id,
    )?.[1] ?? null
  );
}
export function latestIncoming(messages: Message[]) {
  const incoming = messages.filter((m) => m.direction === "in");
  const last = incoming.at(-1);
  return { lastIncomingId: last?.id ?? null, lastIncomingAt: last?.at ?? null };
}
export function automationBlock(
  context: ChatContext | null,
  human: boolean,
  now = Date.now(),
): string | null {
  if (!context?.chatId) return "Open a client conversation first.";
  if (context.isGroup) return "Group chats require human review.";
  if (human) return "A human is handling this conversation.";
  if (!context.atBottom)
    return "Scroll to the latest messages before using automatic replies.";
  if (!context.composerEmpty)
    return "There is already a message in the chat box.";
  if (!context.lastIncomingId) return "No customer message is visible.";
  if (!windowState(context.lastIncomingAt, now).open)
    return "The response window is closed or its timestamp is unknown.";
  return null;
}
export function selectKnowledge(
  docs: Knowledge[],
  query: string,
  budget = 20000,
) {
  const terms = new Set(query.toLowerCase().match(/[\p{L}\p{N}]{3,}/gu) ?? []);
  const chunks = docs
    .flatMap((d) => {
      const parts = d.text.match(/[\s\S]{1,1600}/g) ?? [];
      return parts.map((text, i) => ({
        id: d.id,
        name: d.name,
        text,
        index: i,
        score: [...terms].reduce(
          (sum, t) => sum + (text.toLowerCase().includes(t) ? 1 : 0),
          0,
        ),
      }));
    })
    .sort((a, b) => b.score - a.score || a.index - b.index);
  const selected: typeof chunks = [];
  let used = 0;
  for (const c of chunks) {
    if (used + c.text.length > budget) continue;
    selected.push(c);
    used += c.text.length;
  }
  return selected;
}
export function extractResponse(body: any): string {
  return (body.output ?? [])
    .filter((o: any) => o.type === "message")
    .flatMap((o: any) => o.content ?? [])
    .filter((c: any) => c.type === "output_text")
    .map((c: any) => c.text)
    .join("");
}
