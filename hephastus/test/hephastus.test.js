import { test } from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { loadConfig } from "../src/config.js";
import { createFileStore, createUpstashStore } from "../src/store.js";
import { buildRequest, createAssistant, trimHistory } from "../src/assistant.js";
import { createServer, createSessionToken, isValidSession } from "../src/server.js";

const SECRET = "session-secret";

function memoryStore() {
  let history = [];
  let facts = [];
  return {
    getHistory: async () => structuredClone(history),
    setHistory: async (h) => { history = structuredClone(h); },
    getFacts: async () => [...facts],
    setFacts: async (f) => { facts = [...f]; },
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

const quietLog = { warn() {}, error() {} };

test("loadConfig lists every missing setting", () => {
  assert.throws(() => loadConfig({}), /ANTHROPIC_API_KEY, APP_PASSWORD, SESSION_SECRET/);
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

test("file store saves history and facts to disk", async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "hephastus-"));
  const store = createFileStore(dir);
  await store.setHistory([{ role: "user", content: "hi" }]);
  await store.setFacts(["A"]);
  const reopened = createFileStore(dir);
  assert.deepEqual(await reopened.getHistory(), [{ role: "user", content: "hi" }]);
  assert.deepEqual(await reopened.getFacts(), ["A"]);
});

test("Upstash store sends Redis commands over REST", async () => {
  const data = new Map();
  const fetchImpl = async (url, init) => {
    const [cmd, key, value] = JSON.parse(init.body);
    let result = null;
    if (cmd === "GET") result = data.get(key) ?? null;
    if (cmd === "SET") { data.set(key, value); result = "OK"; }
    return { ok: true, json: async () => ({ result }) };
  };
  const store = createUpstashStore({ url: "https://example.upstash.io", token: "t" }, fetchImpl);
  assert.deepEqual(await store.getFacts(), []);
  await store.setFacts(["A"]);
  assert.deepEqual(await store.getFacts(), ["A"]);
});

test("session tokens expire and can't be forged", () => {
  const now = Date.now();
  const token = createSessionToken(SECRET, now);
  assert.equal(isValidSession(token, SECRET, now), true);
  assert.equal(isValidSession(token, "other-secret", now), false);
  assert.equal(isValidSession(token, SECRET, now + 31 * 24 * 60 * 60 * 1000), false);
  assert.equal(isValidSession(token.replace(/^\d/, "9"), SECRET, now), false);
  assert.equal(isValidSession(null, SECRET, now), false);
  assert.equal(isValidSession("garbage", SECRET, now), false);
});

async function withServer(options, fn) {
  const server = createServer({ password: "pw", sessionSecret: SECRET, log: quietLog, ...options });
  await new Promise((resolve) => server.listen(0, resolve));
  const base = `http://localhost:${server.address().port}`;
  try {
    await fn(base);
  } finally {
    server.close();
  }
}

const json = (body, cookie) => ({
  method: "POST",
  headers: { "Content-Type": "application/json", ...(cookie ? { Cookie: cookie } : {}) },
  body: JSON.stringify(body),
});

async function login(base) {
  const response = await fetch(`${base}/api/login`, json({ password: "pw" }));
  assert.equal(response.status, 200);
  return response.headers.get("set-cookie").split(";")[0];
}

test("server serves the chat page and keeps the API behind the password", async () => {
  await withServer({ store: memoryStore(), assistant: {} }, async (base) => {
    const page = await fetch(base);
    assert.equal(page.status, 200);
    assert.match(await page.text(), /<title>Hephastus<\/title>/);
    assert.match(page.headers.get("content-security-policy"), /default-src 'self'/);

    assert.equal((await fetch(`${base}/api/state`)).status, 401);
    assert.equal((await fetch(`${base}/api/chat`, json({ message: "hi" }))).status, 401);
    assert.equal((await fetch(`${base}/api/state`, { headers: { Cookie: "session=1.abc" } })).status, 401);
    assert.equal((await fetch(`${base}/api/login`, json({ password: "nope" }))).status, 401);

    const cookie = await login(base);
    const state = await fetch(`${base}/api/state`, { headers: { Cookie: cookie } });
    assert.deepEqual(await state.json(), { messages: [], facts: [] });
  });
});

test("login cookie is HttpOnly, SameSite=Strict, and Secure behind HTTPS", async () => {
  await withServer({ store: memoryStore(), assistant: {} }, async (base) => {
    const response = await fetch(`${base}/api/login`, {
      ...json({ password: "pw" }),
      headers: { "Content-Type": "application/json", "X-Forwarded-Proto": "https" },
    });
    const cookie = response.headers.get("set-cookie");
    assert.match(cookie, /HttpOnly/);
    assert.match(cookie, /SameSite=Strict/);
    assert.match(cookie, /Secure/);
  });
});

test("server blocks password guessing after 10 wrong tries", async () => {
  await withServer({ store: memoryStore(), assistant: {} }, async (base) => {
    for (let i = 0; i < 10; i++) {
      assert.equal((await fetch(`${base}/api/login`, json({ password: "x" }))).status, 401);
    }
    assert.equal((await fetch(`${base}/api/login`, json({ password: "pw" }))).status, 429);
  });
});

test("chat, reset and forget work for a logged-in owner", async () => {
  const store = memoryStore();
  await store.setFacts(["A", "B"]);
  const assistant = {
    reply: async (text) => {
      const history = await store.getHistory();
      await store.setHistory([...history, { role: "user", content: text }, { role: "assistant", content: "pong" }]);
      return "pong";
    },
  };
  await withServer({ store, assistant }, async (base) => {
    const cookie = await login(base);
    const chat = await fetch(`${base}/api/chat`, json({ message: "  ping  " }, cookie));
    assert.deepEqual(await chat.json(), { reply: "pong" });
    assert.equal((await store.getHistory())[0].content, "ping");

    assert.equal((await fetch(`${base}/api/chat`, json({ message: "   " }, cookie))).status, 400);
    const plain = await fetch(`${base}/api/chat`, { method: "POST", headers: { Cookie: cookie }, body: "hi" });
    assert.equal(plain.status, 415);

    const forget = await fetch(`${base}/api/facts/0`, { method: "DELETE", headers: { Cookie: cookie } });
    assert.deepEqual(await forget.json(), { facts: ["B"] });
    assert.equal((await fetch(`${base}/api/facts/5`, { method: "DELETE", headers: { Cookie: cookie } })).status, 404);

    await fetch(`${base}/api/reset`, json({}, cookie));
    assert.deepEqual(await store.getHistory(), []);
  });
});

test("chat failures return a friendly error instead of crashing", async () => {
  const assistant = { reply: async () => { throw new Error("boom"); } };
  await withServer({ store: memoryStore(), assistant }, async (base) => {
    const cookie = await login(base);
    const response = await fetch(`${base}/api/chat`, json({ message: "hi" }, cookie));
    assert.equal(response.status, 500);
    assert.match((await response.json()).error, /Something went wrong/);
  });
});
