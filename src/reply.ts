import { DEFAULT_BUSINESS_NAME } from "./product";

export const REPLY_STYLE_INSTRUCTIONS = `Format the reply for WhatsApp:
- Answer the latest question directly. Usually use 40–90 words; use fewer for a simple answer. Give more detail only when the customer asks for it.
- Use short paragraphs of one or two short sentences, separated by a blank line. Never return a wall of text.
- Put each requirement, option or step on its own line starting with "- ". Leave a blank line before and after a list.
- Use WhatsApp *single-asterisk bold* sparingly for a useful label. Do not use Markdown headings, tables or **double-asterisk bold**.
- End with at most one useful next question. Do not repeat the greeting, full service pitch or checklist unless needed.
- Include actual newline characters in the reply string (JSON-escaped as normal), not literal backslash-n text.`;

// Compare message layout as well as words. Collapsing all whitespace would let
// missing paragraph breaks pass the final automatic-send check.
export function messageText(text: string): string {
  return text
    .replace(/\r\n?/g, "\n")
    .replace(/[\u2028\u2029]/g, "\n")
    .replace(/\u00a0/g, " ")
    .replace(/[\u200b\ufeff]/g, "")
    .split("\n")
    .map((line) => line.trimEnd())
    .join("\n")
    .trim();
}

export function draftMatches(actual: string, expected: string): boolean {
  const lines = (text: string) => {
    let blankLines = 0;
    return messageText(text)
      .split("\n")
      .flatMap((line) => {
        if (!line.trim()) {
          blankLines++;
          return [];
        }
        const item = {
          // WhatsApp renders pasted "- " as its own bullet and may display
          // formatting delimiters separately from the formatted text.
          text: line
            .replace(/[\u200e\u200f]/g, "")
            .replace(/^\s*[-•·]\s+/, "")
            .replace(/\*([^*\n]+)\*/g, "$1")
            .replace(/[ \t]+/g, " ")
            .trim(),
          blankLines,
        };
        blankLines = 0;
        return [item];
      });
  };
  const observed = lines(actual);
  const wanted = lines(expected);
  return (
    observed.length === wanted.length &&
    wanted.every(
      (line, i) =>
        observed[i].text === line.text &&
        observed[i].blankLines >= line.blankLines,
    )
  );
}

export function formatReply(text: string): string {
  const cleaned = messageText(text)
    .replace(/^#{1,6}\s+(.+)$/gm, "*$1*")
    .replace(/\*\*([^*\n]+)\*\*/g, "*$1*")
    .replace(/\n{3,}/g, "\n\n");

  // If a model ignores the layout request, only insert paragraph breaks at
  // sentence boundaries. Preserve its words, amounts, URLs and existing lists.
  const segmenter = new Intl.Segmenter(undefined, { granularity: "sentence" });
  return cleaned
    .split("\n")
    .map((line) => {
      if (line.length <= 360 || /^\s*(?:[-*•]|\d+[.)])\s/.test(line))
        return line;
      const sentences = [...segmenter.segment(line)].map((s) =>
        s.segment.trim(),
      );
      const paragraphs: string[] = [];
      let paragraph: string[] = [];
      for (const sentence of sentences) {
        if (
          paragraph.length &&
          (paragraph.length >= 2 ||
            [...paragraph, sentence].join(" ").length > 280)
        ) {
          paragraphs.push(paragraph.join(" "));
          paragraph = [];
        }
        paragraph.push(sentence);
      }
      if (paragraph.length) paragraphs.push(paragraph.join(" "));
      return paragraphs.join("\n\n");
    })
    .join("\n");
}

// A model may echo an old welcome template. Remove only a leading standalone
// opening on follow-up turns; keep the answer and ordinary "You're welcome".
export function removeRepeatedOpening(
  text: string,
  businessAlreadyReplied: boolean,
  businessName = DEFAULT_BUSINESS_NAME,
): string {
  if (!businessAlreadyReplied) return text;
  const escapedName = businessName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const opening = new RegExp(
    `^(?:(?:hello|hi|hey)(?: there)?|good (?:morning|afternoon|evening)|welcome(?: (?:back|to ${escapedName}))?)(?=[ \\t]*(?:$|[\\n!.，,：:—–👋😊🙂]))[!.，,：:—–\\s]*(?:[👋😊🙂!\\s]*)`,
    "iu",
  );
  let result = messageText(text);
  for (let i = 0; i < 3; i++) {
    const next = result
      .replace(
        opening,
        "",
      )
      .trimStart();
    if (next === result) break;
    result = next;
  }
  return result;
}
