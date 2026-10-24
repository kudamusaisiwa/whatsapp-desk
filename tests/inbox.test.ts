import { test } from "node:test";
import assert from "node:assert/strict";
import { JSDOM } from "jsdom";
import { InboxMonitor, readInbox } from "../src/inbox";
import type { ChatContext } from "../src/types";
function fixture() {
  let now = Date.now();
  const dom = new JSDOM(
    '<div id="side"></div><div id="pane-side"></div><div id="main"><footer><div contenteditable="true" role="textbox"></div></footer></div>',
  );
  Object.defineProperty(dom.window.HTMLElement.prototype, "innerText", {
    get() {
      return this.textContent;
    },
  });
  const doc = dom.window.document;
  const contexts = new Map<string, ChatContext>();
  let current = "origin@lid";
  let enabled = true;
  const runs: any[] = [];
  const opens: string[] = [];
  const humanChats: string[] = [];
  let onRun: ((payload: any) => void) | null = null;
  const monitor = new InboxMonitor({
    doc,
    context: () => contexts.get(current) ?? null,
    now: () => now,
    random: () => 0.5,
    sleep: async () => {},
    rpc: async (type, payload: any) => {
      if (type === "INBOX_STATUS") return { enabled, humanChats };
      if (type === "INBOX_RUN") {
        onRun?.(payload);
        if (!monitor.canSend(payload.token))
          return { status: "review", detail: "Human intervention" };
        runs.push(payload);
        contexts.get(current)!.messages.push({
          id: `sent-${runs.length}`,
          text: "A reply",
          direction: "out",
          at: now,
        });
        return { status: "sent" };
      }
      return {};
    },
  });
  function row(
    id: string,
    name: string,
    preview = "Previous reply",
    unread = false,
    time?: string,
  ) {
    const existing = doc.querySelector(`[data-jid="${id}"]`);
    existing?.remove();
    const node = doc.createElement("div");
    node.setAttribute("role", "row");
    node.dataset.jid = id;
    const dt = new Date(now),
      stamp =
        time ?? `${dt.getHours()}:${String(dt.getMinutes()).padStart(2, "0")}`;
    node.innerHTML = `<span title="${name}">${name}</span> <span>${stamp}</span> <span class="preview"></span> ${unread ? '<span aria-label="1 unread message">1</span>' : ""}`;
    const p = node.querySelector(".preview")!;
    p.textContent = preview;
    p.setAttribute("title", preview);
    node.addEventListener("click", () => {
      current = id;
      opens.push(id);
      node.querySelector('[aria-label*="unread"]')?.remove();
    });
    doc.querySelector("#pane-side")!.append(node);
    if (!contexts.has(id))
      contexts.set(id, {
        chatId: id,
        name,
        isGroup: false,
        messages: [
          { id: `in-${id}-1`, text: preview, direction: "in", at: now },
        ],
        lastIncomingId: `in-${id}-1`,
        lastIncomingAt: now,
        composerEmpty: true,
        atBottom: true,
        observedAt: now,
      });
    else {
      const c = contexts.get(id)!;
      c.lastIncomingId = `in-${id}-${now}`;
      c.lastIncomingAt = now;
      c.messages.push({
        id: c.lastIncomingId,
        text: preview,
        direction: "in",
        at: now,
      });
    }
    return node;
  }
  row(current, "Original");
  contexts.get(current)!.messages.push({
    id: "already-answered",
    text: "Handled",
    direction: "out",
    at: now,
  });
  return {
    dom,
    doc,
    monitor,
    row,
    contexts,
    runs,
    opens,
    humanChats,
    current: () => current,
    advance: (ms: number) => {
      now += ms;
    },
    setEnabled: (value: boolean) => {
      enabled = value;
    },
    onRun: (fn: (payload: any) => void) => {
      onRun = fn;
    },
  };
}
test("two unselected chats queue independently, open automatically and restore the original selection", async () => {
  const f = fixture();
  try {
    f.row("a@lid", "Alice");
    f.row("b@lid", "Bob");
    await f.monitor.tick();
    f.row("a@lid", "Alice", "How much is the package?", true);
    f.row("b@lid", "Bob", "What documents do I need?", true);
    f.monitor.observeRows();
    assert.equal(
      f.monitor.snapshot().items.filter((i) => i.status === "waiting").length,
      2,
    );
    assert.equal(f.runs.length, 0);
    f.advance(11000);
    await f.monitor.tick();
    await f.monitor.tick();
    assert.deepEqual(
      f.runs.map((r) => r.chatId),
      ["a@lid", "b@lid"],
    );
    assert.equal(f.current(), "origin@lid");
    await f.monitor.tick();
    assert.equal(f.runs.length, 2);
  } finally {
    f.dom.window.close();
  }
});
test("an addition restarts only that customer's pause while another ready chat is answered", async () => {
  const f = fixture();
  try {
    f.row("a@lid", "Alice");
    f.row("b@lid", "Bob");
    await f.monitor.tick();
    f.row("a@lid", "Alice", "How much is the package?", true);
    f.row("b@lid", "Bob", "Where are you located?", true);
    f.monitor.observeRows();
    f.advance(5000);
    f.row("a@lid", "Alice", "And I wanted to ask about", true);
    f.monitor.observeRows();
    f.advance(6000);
    await f.monitor.tick();
    assert.deepEqual(
      f.runs.map((r) => r.chatId),
      ["b@lid"],
    );
    f.advance(32000);
    await f.monitor.tick();
    assert.deepEqual(
      f.runs.map((r) => r.chatId),
      ["b@lid", "a@lid"],
    );
  } finally {
    f.dom.window.close();
  }
});
test("typing preserves the human composer and leaves other chats queued", async () => {
  const f = fixture();
  try {
    f.row("a@lid", "Alice", "How much is the package?", true);
    await f.monitor.tick();
    f.advance(11000);
    const input = f.doc.querySelector("footer div")!;
    input.textContent = "A human is writing";
    await f.monitor.tick();
    assert.equal(f.runs.length, 0);
    assert.equal(f.current(), "origin@lid");
    assert.equal(input.textContent, "A human is writing");
    input.textContent = "";
    f.monitor.pauseForHuman();
    f.advance(9000);
    await f.monitor.tick();
    assert.equal(f.runs.length, 0);
    f.advance(2000);
    await f.monitor.tick();
    assert.equal(f.runs.length, 1);
  } finally {
    f.dom.window.close();
  }
});
test("human intervention invalidates the send token and prevents restoring over the human's selection", async () => {
  const f = fixture();
  try {
    f.row("a@lid", "Alice", "How much is the package?", true);
    await f.monitor.tick();
    f.advance(11000);
    f.onRun(() => f.monitor.pauseForHuman());
    await f.monitor.tick();
    assert.equal(f.runs.length, 0);
    assert.equal(f.current(), "a@lid");
    assert.equal(f.monitor.snapshot().items[0].status, "review");
  } finally {
    f.dom.window.close();
  }
});
test("old unread backlog, groups and human-takeover clients do not receive automatic replies", async () => {
  const f = fixture();
  try {
    f.row("old@lid", "Old lead", "Hey", true, "Yesterday");
    f.row("g@g.us", "Group", "How much does it cost?", true);
    f.contexts.get("g@g.us")!.isGroup = true;
    f.row("h@lid", "Human client", "How much does it cost?", true);
    f.humanChats.push("h@lid");
    await f.monitor.tick();
    f.advance(11000);
    await f.monitor.tick();
    await f.monitor.tick();
    assert.equal(f.runs.length, 0);
    assert.ok(!f.opens.includes("old@lid"));
    assert.equal(
      f.monitor.snapshot().items.filter((i) => i.status === "skipped").length,
      2,
    );
  } finally {
    f.dom.window.close();
  }
});
test("disabling automation removes waiting work and interrupted sends restore as human review", async () => {
  const f = fixture();
  try {
    f.row("a@lid", "Alice", "How much does it cost?", true);
    await f.monitor.tick();
    const state = f.monitor.snapshot();
    state.items[0].status = "replying";
    f.monitor.restore(state);
    assert.equal(f.monitor.snapshot().items[0].status, "review");
    f.row("b@lid", "Bob", "How much does it cost?", true);
    f.monitor.observeRows();
    f.setEnabled(false);
    await f.monitor.tick();
    assert.equal(
      f.monitor.snapshot().items.some((i) => i.status === "waiting"),
      false,
    );
  } finally {
    f.dom.window.close();
  }
});
test("ambiguous name-only sidebar rows are excluded, while distinct stable peers remain separate", () => {
  const f = fixture();
  try {
    const a = f.row("a@lid", "Same name", "Hey", true),
      b = f.row("b@lid", "Same name", "Hey", true);
    assert.equal(
      readInbox(f.doc).filter((r) => r.name === "Same name").length,
      2,
    );
    delete a.dataset.jid;
    delete b.dataset.jid;
    assert.equal(
      readInbox(f.doc).filter((r) => r.name === "Same name").length,
      0,
    );
  } finally {
    f.dom.window.close();
  }
});

test("idle monitoring never scrolls the chat list or changes the selected filter", async () => {
  const f = fixture();
  try {
    const pane = f.doc.querySelector<HTMLElement>("#pane-side")!;
    let writes = 0,
      filterClicks = 0;
    Object.defineProperties(pane, {
      clientHeight: { value: 500 },
      scrollHeight: { value: 5000 },
      scrollTop: {
        get: () => 320,
        set: () => {
          writes++;
        },
      },
    });
    f.doc.querySelector("#side")!.innerHTML =
      '<button role="tab" aria-selected="false">All</button><button role="tab" aria-selected="true">Unread</button>';
    f.doc
      .querySelector('#side [role="tab"]')!
      .addEventListener("click", () => filterClicks++);
    for (let i = 0; i < 5; i++) {
      await f.monitor.tick();
      f.advance(20000);
    }
    assert.equal(writes, 0);
    assert.equal(filterClicks, 0);
    assert.equal(pane.scrollTop, 320);
    assert.equal(f.opens.length, 0);
  } finally {
    f.dom.window.close();
  }
});
test("an offscreen queued row never triggers a scrolling search or blocks another visible enquiry", async () => {
  const f = fixture();
  try {
    f.row("a@lid", "Alice", "How much is the package?", true);
    f.row("b@lid", "Bob", "Where are you located?", true);
    await f.monitor.tick();
    f.doc.querySelector('[data-jid="a@lid"]')!.remove();
    const pane = f.doc.querySelector<HTMLElement>("#pane-side")!;
    let writes = 0;
    Object.defineProperties(pane, {
      clientHeight: { value: 500 },
      scrollHeight: { value: 5000 },
      scrollTop: {
        get: () => 0,
        set: () => {
          writes++;
        },
      },
    });
    f.advance(11000);
    await f.monitor.tick();
    await f.monitor.tick();
    assert.equal(writes, 0);
    assert.deepEqual(
      f.runs.map((r) => r.chatId),
      ["b@lid"],
    );
    assert.equal(
      f.monitor.snapshot().items.find((i) => i.name === "Alice")!.status,
      "waiting",
    );
  } finally {
    f.dom.window.close();
  }
});
