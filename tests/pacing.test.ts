import { test } from "node:test";
import assert from "node:assert/strict";
import {
  replyCountdown,
  isDefinitiveQuestion,
  quietDelay,
  replyDelay,
  replyParts,
} from "../src/pacing";

test("greetings retain 30–45 seconds and pacing varies by length and randomness", () => {
  assert.equal(
    quietDelay("Hey", () => 0),
    30000,
  );
  assert.equal(
    quietDelay("Hey", () => 1),
    45000,
  );
  assert.ok(
    replyDelay("Short reply.", () => 0) < replyDelay("Short reply.", () => 1),
  );
  assert.ok(
    replyDelay("Short reply.", () => 0.5) <
      replyDelay("Long reply. ".repeat(40), () => 0.5),
  );
  assert.ok(replyDelay("x".repeat(8000), () => 1) <= 22000);
});
test("splitting keeps all wording and lists intact and never creates more than two messages", () => {
  const intro = "Here is our company package. ".repeat(6).trim();
  const list =
    "*Starting requirements*\n- A valid passport\n- Email and residential details\n- Four proposed company names";
  const ending =
    "You can send the documents using our registration form or here on WhatsApp. "
      .repeat(3)
      .trim();
  const text = [intro, list, ending].join("\n\n");
  const parts = replyParts(text);
  assert.equal(parts.length, 2);
  assert.equal(parts.join("\n\n"), text);
  assert.ok(parts.some((p) => p.includes(list)));
  assert.deepEqual(
    replyParts("Of course. What time tomorrow would suit you?"),
    ["Of course. What time tomorrow would suit you?"],
  );
  const noBoundary = "One long sentence ".repeat(40);
  assert.deepEqual(replyParts(noBoundary), [noBoundary]);
});

test("complete questions get 8–12 seconds while unfinished and vague messages keep the longer pause", () => {
  for (const question of [
    "How much?",
    "What's the difference?",
    "Do I need a permit?",
    "What documents do I need",
    "Requirements please",
    "Can I apply online?",
    "Where are you located?",
  ]) {
    assert.equal(isDefinitiveQuestion(question), true, question);
    assert.equal(
      quietDelay(question, () => 0),
      8000,
      question,
    );
    assert.equal(
      quietDelay(question, () => 1),
      12000,
      question,
    );
  }
  for (const fragment of [
    "Hey",
    "Hi?",
    "Are you there?",
    "Can you help?",
    "I want an account",
    "Can I ask",
    "How much...",
    "I wanted to ask about",
    "How much for",
    "What documents and",
    "",
  ]) {
    assert.equal(isDefinitiveQuestion(fragment), false, fragment);
    assert.equal(
      quietDelay(fragment, () => 0),
      30000,
      fragment,
    );
  }
  assert.ok(
    replyDelay("A short answer.", () => 0, true) <
      replyDelay("A short answer.", () => 1, true),
  );
  assert.ok(replyDelay("x".repeat(8000), () => 1, true) <= 6000);
});

test("the displayed countdown follows the deadline, rounds up and never goes negative", () => {
  const timing = {
    chatId: "chat",
    incomingId: "in",
    phase: "quiet" as const,
    dueAt: 40000,
  };
  assert.equal(replyCountdown(timing, 8000), "Drafting in 00:32");
  assert.equal(replyCountdown(timing, 9000), "Drafting in 00:31");
  assert.equal(replyCountdown(timing, 39999), "Drafting in 00:01");
  assert.equal(replyCountdown(timing, 41000), "Drafting will start shortly…");
  assert.equal(
    replyCountdown({ ...timing, phase: "send" }, 35000),
    "Sending in 00:05",
  );
  assert.equal(
    replyCountdown({ ...timing, phase: "send" }, 41000),
    "Sending shortly…",
  );
});
