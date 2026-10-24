import { test } from "node:test";
import assert from "node:assert/strict";
import { draftMatches, formatReply, messageText } from "../src/reply";

test("paragraph verification distinguishes newlines from spaces", () => {
  assert.notEqual(
    messageText("Hello.\n\nNext step."),
    messageText("Hello. Next step."),
  );
  assert.equal(
    messageText("Hello.\r\n\r\nNext\u00a0step.\n"),
    "Hello.\n\nNext step.",
  );
});

test("readable replies keep their paragraphs, list items, prices and URLs", () => {
  const text =
    "Hello!\n\n*Requirements*\n- A passport\n- Email\n\nSee https://example.com/form?a=1.2 and confirm R3,000.";
  assert.equal(formatReply(text), text);
});

test("long model paragraphs are spaced without dropping or paraphrasing facts", () => {
  const text = [
    "We can help you prepare the application for the account type you choose.",
    "The first step is to confirm whether the applicant needs a personal or company account.",
    "For the company package, our starting checklist includes a valid passport and an email address.",
    "We also ask for a residential address, a phone number and four possible company names.",
    "A colleague will confirm any additional requirements for the applicant's circumstances.",
    "Will the company have one director or several directors?",
  ].join(" ");
  const formatted = formatReply(text);
  assert.ok(formatted.includes("\n\n"));
  assert.equal(formatted.replace(/\s+/g, " "), text);
  assert.ok(formatted.split("\n\n").every((p) => p.length <= 280));
});

test("Markdown labels become WhatsApp labels without literal Markdown headings", () => {
  assert.equal(
    formatReply("## Documents\n\n**Passport**\n- Email"),
    "*Documents*\n\n*Passport*\n- Email",
  );
});

test("native WhatsApp bullets and labels pass when all text and paragraph breaks remain", () => {
  assert.equal(
    draftMatches(
      "Hello.\n\n* Documents *\n•  Passport\n•  Email\n\nNext step?",
      "Hello.\n\n*Documents*\n- Passport\n- Email\n\nNext step?",
    ),
    true,
  );
  assert.equal(
    draftMatches("Hello.\nNext step?", "Hello.\n\nNext step?"),
    false,
  );
  assert.equal(
    draftMatches("Hello. Next step?", "Hello.\n\nNext step?"),
    false,
  );
  assert.equal(
    draftMatches("Hello.\n\nNextstep?", "Hello.\n\nNext step?"),
    false,
  );
});

test("repeated welcomes use the configured business name and escape punctuation", async () => {
  const { removeRepeatedOpening } = await import("../src/reply");
  assert.equal(
    removeRepeatedOpening("Welcome to Cakes (Pvt) Ltd.\n\nBread costs $2.", true, "Cakes (Pvt) Ltd"),
    "Bread costs $2.",
  );
});
