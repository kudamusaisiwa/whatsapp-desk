import { test } from "node:test";
import assert from "node:assert/strict";
import {
  callParticipants,
  callSpeakers,
  callSummaryInput,
  formatCallDate,
  renderCallSummary,
  whisperCallPrompt,
} from "../src/call-summary";

const startedAt = new Date(2026, 9, 24, 14, 5).getTime();
const now = startedAt + 60_000;
const dmyDate = formatCallDate(startedAt, "DMY", now);
const mdyDate = formatCallDate(startedAt, "MDY", now);

const participants = (business: unknown, customer: unknown) =>
  callParticipants({ businessName: business, customerName: customer });

test("renders the full customer-facing call summary with names, date and all sections", () => {
  const rendered = renderCallSummary(
    {
      greetingName: "Normaliso",
      discussed: [
        "Your documents arrived and are being reviewed.",
        "Your account is ready for the next step.",
      ],
      nextSteps: [
        "We'll send you the invoice by Friday.",
        "You'll send us your ID copy tomorrow.",
      ],
      toConfirm: ["We still need to confirm the delivery fee."],
    },
    participants("MySA Address", "Normaliso Msasiwa"),
    dmyDate,
  );
  assert.equal(
    rendered,
    `*Call summary*
Conversation between MySA Address and Normaliso Msasiwa · 24 October 2026

Hi Normaliso, thank you for the call. Here's a summary of what we discussed:

• Your documents arrived and are being reviewed.
• Your account is ready for the next step.

*Next steps*
• We'll send you the invoice by Friday.
• You'll send us your ID copy tomorrow.

*Still to confirm*
• We still need to confirm the delivery fee.

_This summary was prepared from a transcript of our call. If anything is missing or incorrect, just reply here and we'll update it._`,
  );
});

test("honours the configured MDY date order", () => {
  assert.equal(dmyDate, "24 October 2026");
  assert.equal(mdyDate, "October 24, 2026");
  const rendered = renderCallSummary(
    {
      greetingName: "Normaliso",
      discussed: ["We reviewed your account."],
      nextSteps: [],
      toConfirm: [],
    },
    participants("MySA Address", "Normaliso Msasiwa"),
    mdyDate,
  );
  assert.match(
    rendered,
    /Conversation between MySA Address and Normaliso Msasiwa · October 24, 2026/,
  );
});

test("omits the next steps and still-to-confirm blocks when their lists are empty", () => {
  const rendered = renderCallSummary(
    {
      greetingName: "Normaliso",
      discussed: ["We reviewed your account."],
      nextSteps: [],
      toConfirm: [],
    },
    participants("MySA Address", "Normaliso Msasiwa"),
    dmyDate,
  );
  assert.equal(rendered.includes("*Next steps*"), false);
  assert.equal(rendered.includes("*Still to confirm*"), false);
  assert.equal(
    rendered,
    `*Call summary*
Conversation between MySA Address and Normaliso Msasiwa · 24 October 2026

Hi Normaliso, thank you for the call. Here's a summary of what we discussed:

• We reviewed your account.

_This summary was prepared from a transcript of our call. If anything is missing or incorrect, just reply here and we'll update it._`,
  );
});

test("drops the placeholder business name and falls back for missing names", () => {
  for (const business of ["Your business", "your BUSINESS", "", null, 42]) {
    const rendered = renderCallSummary(
      {
        greetingName: "Normaliso",
        discussed: ["We reviewed your account."],
        nextSteps: [],
        toConfirm: [],
      },
      participants(business, "Normaliso Msasiwa"),
      dmyDate,
    );
    assert.match(rendered, /Conversation with Normaliso Msasiwa · 24 October 2026/);
  }
  const phoneOnly = renderCallSummary(
    {
      greetingName: "Normaliso",
      discussed: ["We reviewed your account."],
      nextSteps: [],
      toConfirm: [],
    },
    participants("MySA Address", "+263 71 964 7366"),
    dmyDate,
  );
  assert.match(phoneOnly, /Conversation with MySA Address · 24 October 2026/);
  assert.match(phoneOnly, /Hi there, thank you for the call/);
  const neither = renderCallSummary(
    {
      greetingName: "",
      discussed: ["We reviewed your account."],
      nextSteps: [],
      toConfirm: [],
    },
    participants("Your business", "+263719647366"),
    dmyDate,
  );
  assert.match(neither, /Call on 24 October 2026/);
});

test("accepts only greeting names drawn from the customer name", () => {
  const base = {
    discussed: ["We reviewed your account."],
    nextSteps: [],
    toConfirm: [],
  };
  assert.match(
    renderCallSummary(
      { ...base, greetingName: "Tendai" },
      participants("MySA Address", "Normaliso Msasiwa"),
      dmyDate,
    ),
    /Hi there, thank you for the call/,
  );
  assert.match(
    renderCallSummary(
      { ...base, greetingName: "Normaliso" },
      participants("MySA Address", null),
      dmyDate,
    ),
    /Hi there, thank you for the call/,
  );
  assert.match(
    renderCallSummary(
      { ...base, greetingName: "linda" },
      participants("MySA Address", "LINDA KAMUZANGAZA"),
      dmyDate,
    ),
    /Hi linda, thank you for the call/,
  );
  assert.match(
    renderCallSummary(
      { ...base, greetingName: "Dr. Moyo" },
      participants("MySA Address", "Dr Moyo"),
      dmyDate,
    ),
    /Hi Dr\. Moyo, thank you for the call/,
  );
});

test("sanitises participant names and caps them at 80 characters", () => {
  const cleaned = participants(
    "  My*SA\nAdd`ress ~Co_  ",
    "Normaliso\tMsasiwa*",
  );
  assert.equal(cleaned.business, "MySA Address Co");
  assert.equal(cleaned.customer, "Normaliso Msasiwa");
  const long = participants("B".repeat(100), "C".repeat(95));
  assert.equal(long.business?.length, 80);
  assert.equal(long.customer?.length, 80);
});

test("cleans list markers, newlines, non-strings and enforces item and count caps", () => {
  const rendered = renderCallSummary(
    {
      greetingName: "",
      discussed: [
        "- First point.",
        "• Second point.",
        "1. Third point.",
        "Fourth point\nwith a newline.",
        42,
        null,
        "x".repeat(300),
        "Fifth point.",
        "Sixth point.",
        "Seventh point dropped.",
      ],
      nextSteps: [
        "We'll do one.",
        "We'll do two.",
        "We'll do three.",
        "We'll do four.",
        "We'll do five.",
        "We'll do six.",
        "We'll do seven dropped.",
        "We'll do eight dropped.",
      ],
      toConfirm: [
        "Confirm one.",
        "Confirm two.",
        "Confirm three.",
        "Confirm four.",
        "Confirm five dropped.",
      ],
    },
    participants("MySA Address", "Normaliso Msasiwa"),
    dmyDate,
  );
  assert.match(rendered, /• First point\./);
  assert.match(rendered, /• Second point\./);
  assert.match(rendered, /• Third point\./);
  assert.match(rendered, /• Fourth point with a newline\./);
  assert.equal(rendered.includes("42"), false);
  const overlong = rendered
    .split("\n")
    .find((line) => line.startsWith("• x"));
  assert.equal(overlong?.length, 252);
  assert.ok(overlong?.endsWith("…"));
  assert.equal(rendered.includes("Sixth point."), false);
  assert.equal(rendered.includes("Seventh point dropped."), false);
  assert.equal(rendered.includes("We'll do seven dropped."), false);
  assert.equal(rendered.includes("We'll do eight dropped."), false);
  assert.equal(rendered.includes("Confirm five dropped."), false);
});

test("rejects an invalid summary shape and an empty discussed list", () => {
  const p = participants("MySA Address", "Normaliso Msasiwa");
  for (const raw of [
    "not an object",
    42,
    null,
    [],
    { discussed: [], nextSteps: [], toConfirm: [] },
    { greetingName: 7, discussed: [], nextSteps: [], toConfirm: [] },
    { greetingName: "", discussed: "x", nextSteps: [], toConfirm: [] },
    { greetingName: "", discussed: [], nextSteps: [], toConfirm: {} },
  ]) {
    assert.throws(() => renderCallSummary(raw, p, dmyDate), /invalid call summary/);
  }
  assert.throws(
    () =>
      renderCallSummary(
        { greetingName: "", discussed: [" ", 5, "- "], nextSteps: [], toConfirm: [] },
        p,
        dmyDate,
      ),
    /empty/,
  );
});

test("callSummaryInput carries business, customer, speakers and transcript", () => {
  assert.deepEqual(
    JSON.parse(
      callSummaryInput(
        "The transcript.",
        {
          business: "MySA Address",
          customer: "Normaliso Msasiwa",
        },
        { business: "Kuda", customer: "Linda" },
      ),
    ),
    {
      business: "MySA Address",
      customer: "Normaliso Msasiwa",
      speakers: { business: "Kuda", customer: "Linda" },
      transcript: "The transcript.",
    },
  );
  assert.deepEqual(
    JSON.parse(
      callSummaryInput(
        "T",
        { business: null, customer: null },
        { business: null, customer: null },
      ),
    ),
    {
      business: null,
      customer: null,
      speakers: { business: null, customer: null },
      transcript: "T",
    },
  );
});

test("callSpeakers sanitises operator-entered names like participant names", () => {
  for (const input of [undefined, null, 42, "Kuda", ["Kuda"], true]) {
    assert.deepEqual(callSpeakers(input), { business: null, customer: null });
  }
  assert.deepEqual(callSpeakers({}), { business: null, customer: null });
  assert.deepEqual(callSpeakers({ business: 42, customer: null }), {
    business: null,
    customer: null,
  });
  const cleaned = callSpeakers({
    business: "  Ku*da\nMus`asiwa ~Co_  ",
    customer: "Linda\tMoyo*",
  });
  assert.equal(cleaned.business, "Kuda Musasiwa Co");
  assert.equal(cleaned.customer, "Linda Moyo");
  const long = callSpeakers({ business: "B".repeat(100), customer: "C".repeat(95) });
  assert.equal(long.business?.length, 80);
  assert.equal(long.customer?.length, 80);
  assert.deepEqual(
    callSpeakers({ business: "Kuda", customer: "+263 71 964 7366" }),
    { business: "Kuda", customer: null },
  );
});

test("whisperCallPrompt names whichever sides of the call are known", () => {
  assert.equal(
    whisperCallPrompt({
      businessName: "MySA Address",
      customerName: "Normaliso Msasiwa",
    }),
    "Call between MySA Address and Normaliso Msasiwa.",
  );
  assert.equal(
    whisperCallPrompt({
      businessName: "MySA Address",
      businessSpeaker: "Kuda",
      customerName: "Normaliso Msasiwa",
      customerSpeaker: "Linda",
    }),
    "Call between Kuda and Linda.",
  );
  assert.equal(
    whisperCallPrompt({ businessName: "MySA Address" }),
    "Call between MySA Address and the customer.",
  );
  assert.equal(
    whisperCallPrompt({ customerSpeaker: "Linda" }),
    "Call between the business and Linda.",
  );
  assert.equal(
    whisperCallPrompt({ customerName: "Normaliso Msasiwa" }),
    "Call between the business and Normaliso Msasiwa.",
  );
  assert.equal(whisperCallPrompt({}), null);
  assert.equal(
    whisperCallPrompt({
      businessName: "Your business",
      customerName: "+263 71 964 7366",
    }),
    null,
  );
  assert.equal(
    whisperCallPrompt({ businessName: "Your business", customerSpeaker: "Linda" }),
    "Call between the business and Linda.",
  );
});

test("renderCallSummary prefers the customer speaker in the header and greeting", () => {
  const speakers = { business: "Kuda", customer: "Linda" };
  const rendered = renderCallSummary(
    {
      greetingName: "Linda",
      discussed: ["We reviewed your account."],
      nextSteps: [],
      toConfirm: [],
    },
    participants("MySA Address", "Normaliso Msasiwa"),
    dmyDate,
    speakers,
  );
  assert.match(
    rendered,
    /Conversation between MySA Address and Linda · 24 October 2026/,
  );
  assert.match(rendered, /Hi Linda, thank you for the call/);
  const wrongGreeting = renderCallSummary(
    {
      greetingName: "Normaliso",
      discussed: ["We reviewed your account."],
      nextSteps: [],
      toConfirm: [],
    },
    participants("MySA Address", "Normaliso Msasiwa"),
    dmyDate,
    speakers,
  );
  assert.match(wrongGreeting, /Hi there, thank you for the call/);
  const noSpeakers = renderCallSummary(
    {
      greetingName: "Normaliso",
      discussed: ["We reviewed your account."],
      nextSteps: [],
      toConfirm: [],
    },
    participants("MySA Address", "Normaliso Msasiwa"),
    dmyDate,
    { business: "Kuda", customer: null },
  );
  assert.match(
    noSpeakers,
    /Conversation between MySA Address and Normaliso Msasiwa · 24 October 2026/,
  );
  assert.match(noSpeakers, /Hi Normaliso, thank you for the call/);
});

test("formatCallDate uses a plausible call time and falls back to now otherwise", () => {
  const late = new Date(2026, 9, 24, 23, 58).getTime();
  assert.equal(formatCallDate(late - 86_400_000, "DMY", late), "23 October 2026");
  assert.equal(formatCallDate(late + 4 * 60_000, "DMY", late), "25 October 2026");
  assert.equal(formatCallDate("yesterday", "DMY", late), "24 October 2026");
  assert.equal(formatCallDate(NaN, "DMY", late), "24 October 2026");
  assert.equal(formatCallDate(late + 10 * 60_000, "DMY", late), "24 October 2026");
  assert.equal(
    formatCallDate(late - 8 * 86_400_000, "DMY", late),
    "24 October 2026",
  );
});
