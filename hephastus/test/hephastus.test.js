import { test } from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { loadConfig } from "../src/config.js";
import { createFileStore, createUpstashStore } from "../src/store.js";
import { buildRequest, createAssistant, trimHistory } from "../src/assistant.js";
import { createHandler } from "../src/handler.js";
import { createServer } from "../src/server.js";
import { createWhatsAppClient, extractMessages, isValidSignature, splitText } from "../src/whatsapp.js";

const OWNER = "201000000000";
const SECRET = "app-secret";

function memoryStore() {
  let history = [];
  let facts = [];
  const seen = new Set();
  return {
    getHistory: async () => structuredClone(history),
    setHistory: async (h) => { history = structuredClone(h); },
    getFacts: async () => [...facts],
    setFacts: async (f) => { facts = [...f]; },
    markSeen: async (id) => (seen.has(id) ? false : (seen.add(id), true)),
  };
}

// A stand-in for the Claude API that replays scripted responses and records requests.
function fakeClaude(responses) {
  const requests = [];
  return {
    requests,
    beta: {
      messages: {
        create: async (request) => {
          requests.push(structuredClone(request));
          return responses.shift();
        },
      },
    },
  };
}

function fakeWhatsApp() {
  const sent = [];
  return { sent, sendText: async (to, text) => sent.push({ to, text }), markReadAndTyping: async () => {} };
}

const quietLog = { warn() {}, error() {} };

function textMessage(id, text, from = OWNER) {
  return { id, from, type: "text", text };
}

test("loadConfig lists every missing setting", () => {
  assert.throws(() => loadConfig({}), /ANTHROPIC_API_KEY.*WHATSAPP_TOKEN.*OWNER_WHATSAPP_NUMBER/);
});

test("loadConfig keeps only the digits of the owner number", () => {
  const config = loadConfig({
    ANTHROPIC_API_KEY: "k", WHATSAPP_TOKEN: "t", WHATSAPP_PHONE_NUMBER_ID: "1",
    WHATSAPP_VERIFY_TOKEN: "v", WHATSAPP_APP_SECRET: "s", OWNER_WHATSAPP_NUMBER: "+20 100-000-0000",
  });
  assert.equal(config.ownerNumber, "201000000000");
  assert.equal(config.model, "claude-opus-5-5");
  assert.equal(config.upstash, null);
});

test("signature check accepts Meta's signature and rejects anything else", () => {
  const body = Buffer.from('{"a":1}');
  const good = "sha256=" + crypto.createHmac("sha256", SECRET).update(body).digest("hex");
  assert.equal(isValidSignature(body, good, SECRET), true);
  assert.equal(isValidSignature(body, good, "other-secret"), false);
  assert.equal(isValidSignature(body, undefined, SECRET), false);
  assert.equal(isValidSignature(body, "sha256=abc", SECRET), false);
});

test("extractMessages reads text messages and skips status updates", () => {
  const payload = {
    entry: [{ changes: [
      { value: { messages: [{ id: "m1", from: OWNER, type: "text", text: { body: "hi" } }] } },
      { value: { statuses: [{ id: "m0", status: "read" }] } },
      { value: { messages: [{ id: "m2", from: OWNER, type: "image", image: {} }] } },
    ] }],
  };
  assert.deepEqual(extractMessages(payload), [
    { id: "m1", from: OWNER, type: "text", text: "hi" },
    { id: "m2", from: OWNER, type: "image", text: null },
  ]);
  assert.deepEqual(extractMessages({}), []);
});

test("splitText keeps every part within WhatsApp's limit without losing words", () => {
  const text = Array.from({ length: 2000 }, (_, i) => `word${i}`).join(" ");
  const parts = splitText(text, 1000);
  assert.ok(parts.length > 1);
  assert.ok(parts.every((part) => part.length <= 1000));
  assert.equal(parts.join(" "), text);
  assert.deepEqual(splitText("short"), ["short"]);
});

test("WhatsApp client sends text to the Cloud API", async () => {
  const calls = [];
  const fetchImpl = async (url, init) => {
    calls.push({ url, init });
    return { ok: true, json: async () => ({}) };
  };
  const client = createWhatsAppClient({ token: "tok", phoneNumberId: "123", graphVersion: "v23.0" }, fetchImpl);
  await client.sendText(OWNER, "hello");
  assert.equal(calls[0].url, "https://graph.facebook.com/v23.0/123/messages");
  assert.equal(calls[0].init.headers.Authorization, "Bearer tok");
  assert.deepEqual(JSON.parse(calls[0].init.body), {
    messaging_product: "whatsapp", to: OWNER, type: "text", text: { body: "hello" },
  });
});

test("buildRequest uses web search, fallbacks and caching on Opus 5.5", () => {
  const request = buildRequest({ model: "claude-opus-5-5", effort: "medium", facts: ["Likes tea"], messages: [] });
  assert.equal(request.tools[0].type, "web_search_20260209");
  assert.deepEqual(request.betas, ["server-side-fallback-2026-07-01"]);
  assert.equal(request.fallbacks, "default");
  assert.deepEqual(request.cache_control, { type: "ephemeral" });
  assert.match(request.system, /1\. Likes tea/);
});

test("buildRequest uses basic web search and no fallbacks on Haiku 5.5", () => {
  const request = buildRequest({ model: "claude-haiku-5-5", effort: "low", facts: [], messages: [] });
  assert.equal(request.tools[0].type, "web_search_20250305");
  assert.equal(request.fallbacks, undefined);
  assert.equal(request.betas, undefined);
});

test("assistant runs the remember tool, then replies and saves history", async () => {
  const store = memoryStore();
  const claude = fakeClaude([
    { stop_reason: "tool_use", content: [{ type: "tool_use", id: "t1", name: "remember", input: { fact: "Name is Ahmed." } }] },
    { stop_reason: "end_turn", content: [{ type: "text", text: "Nice to meet you, Ahmed!" }] },
  ]);
  const assistant = createAssistant({ model: "claude-opus-5-5", effort: "medium", historyLimit: 40 }, store, claude);

  assert.equal(await assistant.reply("I'm Ahmed"), "Nice to meet you, Ahmed!");
  assert.deepEqual(await store.getFacts(), ["Name is Ahmed."]);
  assert.deepEqual(claude.requests[1].messages.at(-1).content, [
    { type: "tool_result", tool_use_id: "t1", content: "Saved as fact 1." },
  ]);
  assert.match(claude.requests[1].system, /1\. Name is Ahmed\./);
  assert.deepEqual(await store.getHistory(), [
    { role: "user", content: "I'm Ahmed" },
    { role: "assistant", content: "Nice to meet you, Ahmed!" },
  ]);
});

test("assistant forget tool removes a fact and reports a bad number as an error", async () => {
  const store = memoryStore();
  await store.setFacts(["A", "B"]);
  const claude = fakeClaude([
    { stop_reason: "tool_use", content: [
      { type: "tool_use", id: "t1", name: "forget", input: { fact_number: 1 } },
      { type: "tool_use", id: "t2", name: "forget", input: { fact_number: 9 } },
    ] },
    { stop_reason: "end_turn", content: [{ type: "text", text: "Done." }] },
  ]);
  const assistant = createAssistant({ model: "claude-opus-5-5", effort: "medium", historyLimit: 40 }, store, claude);
  await assistant.reply("forget A");
  assert.deepEqual(await store.getFacts(), ["B"]);
  const results = claude.requests[1].messages.at(-1).content;
  assert.equal(results.length, 2);
  assert.equal(results[1].is_error, true);
});

test("assistant resumes a paused web search and joins cited text", async () => {
  const store = memoryStore();
  const paused = [{ type: "server_tool_use", id: "s1", name: "web_search", input: { query: "weather" } }];
  const claude = fakeClaude([
    { stop_reason: "pause_turn", content: paused },
    { stop_reason: "end_turn", content: [{ type: "text", text: "It's sunny " }, { type: "text", text: "in Cairo." }] },
  ]);
  const assistant = createAssistant({ model: "claude-opus-5-5", effort: "medium", historyLimit: 40 }, store, claude);
  assert.equal(await assistant.reply("weather?"), "It's sunny in Cairo.");
  assert.deepEqual(claude.requests[1].messages.at(-1), { role: "assistant", content: paused });
});

test("assistant answers politely on a refusal", async () => {
  const store = memoryStore();
  const claude = fakeClaude([{ stop_reason: "refusal", content: [] }]);
  const assistant = createAssistant({ model: "claude-opus-5-5", effort: "medium", historyLimit: 40 }, store, claude);
  assert.equal(await assistant.reply("bad"), "Sorry, I can't help with that one.");
});

test("trimHistory keeps the newest turns and starts with the owner", () => {
  const history = [
    { role: "user", content: "1" }, { role: "assistant", content: "2" },
    { role: "user", content: "3" }, { role: "assistant", content: "4" },
  ];
  assert.deepEqual(trimHistory(history, 3), history.slice(2));
  assert.deepEqual(trimHistory(history, 10), history);
});

test("handler ignores strangers and repeat deliveries", async () => {
  const store = memoryStore();
  const whatsapp = fakeWhatsApp();
  let calls = 0;
  const assistant = { reply: async () => { calls++; return "hi"; } };
  const handler = createHandler({ ownerNumber: OWNER, assistant, store, whatsapp, log: quietLog });

  await handler.enqueue(textMessage("m1", "hello", "19999999999"));
  await handler.enqueue(textMessage("m2", "hello"));
  await handler.enqueue(textMessage("m2", "hello"));
  assert.equal(calls, 1);
  assert.deepEqual(whatsapp.sent, [{ to: OWNER, text: "hi" }]);
});

test("handler supports /memory and /reset", async () => {
  const store = memoryStore();
  await store.setFacts(["Likes tea"]);
  await store.setHistory([{ role: "user", content: "x" }]);
  const whatsapp = fakeWhatsApp();
  const handler = createHandler({ ownerNumber: OWNER, assistant: {}, store, whatsapp, log: quietLog });

  await handler.enqueue(textMessage("m1", "/memory"));
  await handler.enqueue(textMessage("m2", "/reset"));
  assert.match(whatsapp.sent[0].text, /1\. Likes tea/);
  assert.deepEqual(await store.getHistory(), []);
  assert.deepEqual(await store.getFacts(), ["Likes tea"]);
});

test("handler tells the owner when something fails", async () => {
  const whatsapp = fakeWhatsApp();
  const assistant = { reply: async () => { throw new Error("boom"); } };
  const handler = createHandler({ ownerNumber: OWNER, assistant, store: memoryStore(), whatsapp, log: quietLog });
  await handler.enqueue(textMessage("m1", "hi"));
  assert.match(whatsapp.sent[0].text, /Something went wrong/);
});

test("file store saves history and facts to disk", async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "hephastus-"));
  const store = createFileStore(dir);
  await store.setHistory([{ role: "user", content: "hi" }]);
  await store.setFacts(["A"]);
  const reopened = createFileStore(dir);
  assert.deepEqual(await reopened.getHistory(), [{ role: "user", content: "hi" }]);
  assert.deepEqual(await reopened.getFacts(), ["A"]);
  assert.equal(await store.markSeen("x"), true);
  assert.equal(await store.markSeen("x"), false);
});

test("Upstash store sends Redis commands over REST", async () => {
  const data = new Map();
  const fetchImpl = async (url, init) => {
    const [cmd, key, value, ...rest] = JSON.parse(init.body);
    let result = null;
    if (cmd === "GET") result = data.get(key) ?? null;
    if (cmd === "SET") {
      if (rest.includes("NX") && data.has(key)) result = null;
      else { data.set(key, value); result = "OK"; }
    }
    return { ok: true, json: async () => ({ result }) };
  };
  const store = createUpstashStore({ url: "https://example.upstash.io", token: "t" }, fetchImpl);
  assert.deepEqual(await store.getFacts(), []);
  await store.setFacts(["A"]);
  assert.deepEqual(await store.getFacts(), ["A"]);
  assert.equal(await store.markSeen("m1"), true);
  assert.equal(await store.markSeen("m1"), false);
});

test("server verifies the webhook and passes signed messages to the handler", async () => {
  const received = [];
  const server = createServer({
    verifyToken: "verify-me", appSecret: SECRET,
    handler: { enqueue: (message) => received.push(message) }, log: quietLog,
  });
  await new Promise((resolve) => server.listen(0, resolve));
  const base = `http://localhost:${server.address().port}`;
  try {
    const verify = await fetch(`${base}/webhook?hub.mode=subscribe&hub.verify_token=verify-me&hub.challenge=42`);
    assert.equal(await verify.text(), "42");
    const wrong = await fetch(`${base}/webhook?hub.mode=subscribe&hub.verify_token=nope&hub.challenge=42`);
    assert.equal(wrong.status, 403);

    const body = JSON.stringify({ entry: [{ changes: [{ value: { messages: [
      { id: "m1", from: OWNER, type: "text", text: { body: "hi" } },
    ] } }] }] });
    const signature = "sha256=" + crypto.createHmac("sha256", SECRET).update(body).digest("hex");
    const unsigned = await fetch(`${base}/webhook`, { method: "POST", body });
    assert.equal(unsigned.status, 401);
    const signed = await fetch(`${base}/webhook`, { method: "POST", body, headers: { "x-hub-signature-256": signature } });
    assert.equal(signed.status, 200);
    assert.deepEqual(received, [{ id: "m1", from: OWNER, type: "text", text: "hi" }]);
  } finally {
    server.close();
  }
});
