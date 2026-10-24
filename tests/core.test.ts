import { test } from "node:test";
import assert from "node:assert/strict";
import { JSDOM } from "jsdom";
import {
  automationBlock,
  extractResponse,
  latestIncoming,
  parseWhatsAppTimestamp,
  peerFromMessageId,
  selectKnowledge,
  windowState,
  WINDOW_MS,
} from "../src/core";
import { readChat, rememberChatIdentity } from "../src/adapter";
import type { ChatContext } from "../src/types";
const now = new Date(2026, 9, 23, 19, 0).getTime();
const ctx: ChatContext = {
  chatId: "263700000000@c.us",
  name: "Test client",
  isGroup: false,
  messages: [],
  lastIncomingId: "in-1",
  lastIncomingAt: now - 3600000,
  composerEmpty: true,
  atBottom: true,
  observedAt: now,
};
test("24-hour countdown is anchored to customer time and expires exactly once", () => {
  assert.equal(windowState(now - 3600000, now).display, "23:00:00");
  assert.equal(windowState(now - WINDOW_MS, now).display, "00:00:00");
  assert.equal(windowState(now - WINDOW_MS, now).open, false);
  assert.equal(windowState(null, now).known, false);
  assert.equal(windowState(now + 120000, now).known, false);
});
test("WhatsApp timestamp parser supports configured date order, 12-hour time and strict invalid dates", () => {
  assert.equal(parseWhatsAppTimestamp("[19:00, 23/10/2026] Test: "), now);
  assert.equal(
    parseWhatsAppTimestamp("[7:00 PM, 10/23/26] Test: ", "MDY"),
    now,
  );
  assert.equal(
    parseWhatsAppTimestamp("[12:05 AM, 23.10.2026] Test:"),
    +new Date(2026, 9, 23, 0, 5),
  );
  assert.equal(
    parseWhatsAppTimestamp("[12:05 PM, 23.10.2026] Test:"),
    +new Date(2026, 9, 23, 12, 5),
  );
  assert.equal(parseWhatsAppTimestamp("[19:00, 31/02/2026] Test:"), null);
  assert.equal(parseWhatsAppTimestamp("[25:00, 23/10/2026] Test:"), null);
  assert.equal(parseWhatsAppTimestamp("today at 7pm"), null);
  assert.equal(
    parseWhatsAppTimestamp("[19:00, 03/04/2026] Test:", "DMY"),
    +new Date(2026, 3, 3, 19, 0),
  );
});
test("outgoing replies do not reset the response timer; unknown incoming timestamps stay unknown", () => {
  const incoming = {
    id: "a",
    text: "hello",
    direction: "in" as const,
    at: now - 5000,
  };
  assert.deepEqual(
    latestIncoming([
      incoming,
      { id: "b", text: "reply", direction: "out", at: now },
    ]),
    { lastIncomingId: "a", lastIncomingAt: now - 5000 },
  );
  assert.equal(
    latestIncoming([
      incoming,
      { id: "c", text: "voice", direction: "in", at: null },
    ]).lastIncomingAt,
    null,
  );
});
test("automation refuses human handoff, groups, occupied composers, stale windows and scrolled history", () => {
  assert.equal(automationBlock(ctx, false, now), null);
  for (const changed of [
    { isGroup: true },
    { composerEmpty: false },
    { atBottom: false },
    { lastIncomingAt: now - WINDOW_MS },
    { lastIncomingAt: null },
  ])
    assert.ok(automationBlock({ ...ctx, ...changed }, false, now));
  assert.ok(automationBlock(ctx, true, now));
  assert.ok(automationBlock(null, false, now));
});
test("stable peer identifiers include privacy IDs and reject display-name identities", () => {
  assert.equal(
    peerFromMessageId("false_263700000000@c.us_ABCD"),
    "263700000000@c.us",
  );
  assert.equal(peerFromMessageId("true_12345678@lid_ABCD"), "12345678@lid");
  assert.equal(peerFromMessageId("false_12345-6@g.us_ABCD"), "12345-6@g.us");
  assert.equal(peerFromMessageId("Tariro"), null);
});
test("retrieval prioritizes relevant business chunks and respects the context budget", () => {
  const docs = [
    {
      id: "one",
      name: "Hours",
      text: "Office hours Monday to Friday.",
      addedAt: 0,
    },
    {
      id: "two",
      name: "Documents",
      text: "Company registration requires identity documents.",
      addedAt: 0,
    },
  ];
  assert.equal(
    selectKnowledge(docs, "company registration documents", 100)[0].id,
    "two",
  );
  assert.ok(
    selectKnowledge(docs, "hours", 40).reduce((n, c) => n + c.text.length, 0) <=
      40,
  );
});
test("Responses extraction uses only actual message output text", () => {
  assert.equal(
    extractResponse({
      output: [
        {
          type: "reasoning",
          content: [{ type: "output_text", text: "hidden" }],
        },
        {
          type: "message",
          content: [
            { type: "output_text", text: "Hello " },
            { type: "output_text", text: "client" },
          ],
        },
      ],
    }),
    "Hello client",
  );
});
test("DOM adapter reads visible conversation only and preserves the last customer timestamp", () => {
  const dom = new JSDOM(
    `<div id="main"><header><span title="Test client">Test client</span></header><div class="message-in" data-id="false_263700000000@c.us_A"><div data-pre-plain-text="[18:00, 23/10/2026] Test: "><span class="selectable-text">Customer question</span></div></div><div class="message-out" data-id="true_263700000000@c.us_B"><div data-pre-plain-text="[19:00, 23/10/2026] Business: "><span class="selectable-text">Our reply</span></div></div><footer><div contenteditable="true" role="textbox"></div></footer></div>`,
  );
  const c = readChat(dom.window.document)!;
  assert.equal(c.chatId, ctx.chatId);
  assert.equal(c.name, "Test client");
  assert.equal(c.messages.length, 2);
  assert.equal(c.messages[1].direction, "out");
  assert.equal(c.lastIncomingAt, now - 3600000);
  assert.equal(c.composerEmpty, true);
  dom.window.document.querySelector("footer div")!.textContent =
    "Human is typing";
  assert.equal(readChat(dom.window.document)!.composerEmpty, false);
  dom.window.close();
});

function modernRow(id: string, tail: "in" | "out" | null, minute: number) {
  return `<div data-id="${id}" data-testid="conv-msg-${id}"><div data-testid="msg-container">${tail ? `<span data-testid="tail-${tail}"></span>` : ""}<div data-pre-plain-text="[18:${String(minute).padStart(2, "0")}, 23/10/2026] Fixture: "><span data-testid="selectable-text">Message ${id}</span></div></div></div>`;
}
function modernDoc(rows: string) {
  return new JSDOM(
    `<div id="main"><header><div data-testid="conversation-info-header-chat-title-name">Same client name</div></header><section>${rows}</section><footer><div role="textbox" contenteditable="true"></div></footer></div>`,
  );
}
test("current WhatsApp bare IDs and grouped bubbles preserve incoming/outgoing direction", () => {
  const dom = modernDoc(
    modernRow("IN-A", "in", 0) +
      modernRow("IN-B", null, 1) +
      modernRow("OUT-A", "out", 2) +
      modernRow("OUT-B", null, 3),
  );
  const c = readChat(dom.window.document, "MDY")!;
  assert.equal(c.name, "Same client name");
  assert.deepEqual(
    c.messages.map((m) => m.direction),
    ["in", "in", "out", "out"],
  );
  assert.equal(c.lastIncomingId, "IN-B");
  assert.equal(c.lastIncomingAt, +new Date(2026, 9, 23, 18, 1));
  assert.equal(c.messages[0].text, "Message IN-A");
  dom.window.close();
});
test("message anchors keep a thread stable as messages arrive and distinguish identical contact names", () => {
  const one = modernDoc(modernRow("FIRST-A", "in", 0));
  const first = readChat(one.window.document)!;
  one.window.document
    .querySelector("section")!
    .insertAdjacentHTML("beforeend", modernRow("SECOND-A", "in", 1));
  assert.equal(readChat(one.window.document)!.chatId, first.chatId);
  const two = modernDoc(modernRow("FIRST-B", "in", 2));
  assert.notEqual(readChat(two.window.document)!.chatId, first.chatId);
  const reopened = modernDoc(modernRow("SECOND-A", "in", 1));
  rememberChatIdentity(reopened.window.document, first.chatId, [
    "FIRST-A",
    "SECOND-A",
  ]);
  assert.equal(readChat(reopened.window.document)!.chatId, first.chatId);
  one.window.close();
  two.window.close();
  reopened.window.close();
});
test("unknown leading continuation bubbles are not guessed to be incoming; group author markers block groups", () => {
  const unknown = modernDoc(modernRow("UNKNOWN", null, 0));
  assert.equal(readChat(unknown.window.document), null);
  const group = modernDoc(
    modernRow("GROUP", "in", 0) +
      '<span data-testid="msg-author">Participant</span>',
  );
  assert.equal(readChat(group.window.document)!.isGroup, true);
  unknown.window.close();
  group.window.close();
});
