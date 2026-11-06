import crypto from "node:crypto";
import fs from "node:fs/promises";
import http from "node:http";
import { pathToFileURL } from "node:url";
import { loadConfig } from "./config.js";
import { createStore } from "./store.js";
import { createAssistant } from "./assistant.js";

const SESSION_DAYS = 30;
const MAX_BODY_BYTES = 64 * 1024;
const MAX_MESSAGE_CHARS = 20000;
// After this many wrong passwords, logins pause for the rest of the window.
const MAX_FAILED_LOGINS = 10;
const LOGIN_WINDOW_MS = 15 * 60 * 1000;

const PAGE = new URL("../public/index.html", import.meta.url);

function sign(value, secret) {
  return crypto.createHmac("sha256", secret).update(value).digest("hex");
}

function safeEqual(a, b) {
  const hashA = crypto.createHash("sha256").update(a).digest();
  const hashB = crypto.createHash("sha256").update(b).digest();
  return crypto.timingSafeEqual(hashA, hashB);
}

// A session is "<expiry time>.<signature>", so it can't be forged without the secret.
export function createSessionToken(secret, now = Date.now()) {
  const expires = String(now + SESSION_DAYS * 24 * 60 * 60 * 1000);
  return `${expires}.${sign(expires, secret)}`;
}

export function isValidSession(token, secret, now = Date.now()) {
  if (!token) return false;
  const [expires, signature] = token.split(".");
  if (!expires || !signature || !safeEqual(signature, sign(expires, secret))) return false;
  return Number(expires) > now;
}

function readCookie(req, name) {
  for (const part of (req.headers.cookie ?? "").split(";")) {
    const [key, ...rest] = part.trim().split("=");
    if (key === name) return rest.join("=");
  }
  return null;
}

async function readJson(req) {
  if (!(req.headers["content-type"] ?? "").startsWith("application/json")) {
    throw Object.assign(new Error("Expected JSON"), { status: 415 });
  }
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > MAX_BODY_BYTES) throw Object.assign(new Error("Message too large"), { status: 413 });
    chunks.push(chunk);
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}");
  } catch {
    throw Object.assign(new Error("Invalid JSON"), { status: 400 });
  }
}

function sendJson(res, status, body, headers = {}) {
  res.writeHead(status, { "Content-Type": "application/json", "Cache-Control": "no-store", ...headers });
  res.end(JSON.stringify(body));
}

export function createServer({ password, sessionSecret, assistant, store, log = console }) {
  const failedLogins = [];
  // Chat messages are answered one at a time so the history never gets mixed up.
  let queue = Promise.resolve();

  function sessionCookie(req, token, maxAgeSeconds) {
    // Render and most hosts terminate HTTPS in front of the app and say so in this header.
    const secure = req.headers["x-forwarded-proto"] === "https" ? "; Secure" : "";
    return `session=${token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${maxAgeSeconds}${secure}`;
  }

  async function route(req, res) {
    const url = new URL(req.url, "http://localhost");

    if (req.method === "GET" && url.pathname === "/") {
      res.writeHead(200, {
        "Content-Type": "text/html; charset=utf-8",
        "Content-Security-Policy": "default-src 'self'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src 'self' data:",
        "X-Frame-Options": "DENY",
        "Referrer-Policy": "no-referrer",
      });
      res.end(await fs.readFile(PAGE));
      return;
    }

    if (req.method === "GET" && url.pathname === "/health") {
      res.writeHead(200, { "Content-Type": "text/plain" }).end("ok");
      return;
    }

    if (req.method === "POST" && url.pathname === "/api/login") {
      const now = Date.now();
      while (failedLogins.length && failedLogins[0] < now - LOGIN_WINDOW_MS) failedLogins.shift();
      if (failedLogins.length >= MAX_FAILED_LOGINS) {
        sendJson(res, 429, { error: "Too many wrong passwords. Try again in 15 minutes." });
        return;
      }
      const body = await readJson(req);
      if (typeof body.password !== "string" || !safeEqual(body.password, password)) {
        failedLogins.push(now);
        sendJson(res, 401, { error: "Wrong password." });
        return;
      }
      const token = createSessionToken(sessionSecret, now);
      sendJson(res, 200, { ok: true }, { "Set-Cookie": sessionCookie(req, token, SESSION_DAYS * 24 * 60 * 60) });
      return;
    }

    if (!url.pathname.startsWith("/api/")) {
      res.writeHead(404).end();
      return;
    }

    if (!isValidSession(readCookie(req, "session"), sessionSecret)) {
      sendJson(res, 401, { error: "Please log in." });
      return;
    }

    if (req.method === "POST" && url.pathname === "/api/logout") {
      sendJson(res, 200, { ok: true }, { "Set-Cookie": sessionCookie(req, "", 0) });
      return;
    }

    if (req.method === "GET" && url.pathname === "/api/state") {
      sendJson(res, 200, { messages: await store.getHistory(), facts: await store.getFacts() });
      return;
    }

    if (req.method === "POST" && url.pathname === "/api/chat") {
      const { message } = await readJson(req);
      if (typeof message !== "string" || !message.trim()) {
        sendJson(res, 400, { error: "Empty message." });
        return;
      }
      if (message.length > MAX_MESSAGE_CHARS) {
        sendJson(res, 413, { error: "That message is too long." });
        return;
      }
      const turn = queue.then(() => assistant.reply(message.trim()));
      queue = turn.catch(() => {});
      sendJson(res, 200, { reply: await turn });
      return;
    }

    if (req.method === "POST" && url.pathname === "/api/reset") {
      await store.setHistory([]);
      sendJson(res, 200, { ok: true });
      return;
    }

    const factMatch = url.pathname.match(/^\/api\/facts\/(\d+)$/);
    if (req.method === "DELETE" && factMatch) {
      const facts = await store.getFacts();
      const index = Number(factMatch[1]);
      if (index >= facts.length) {
        sendJson(res, 404, { error: "No such fact." });
        return;
      }
      facts.splice(index, 1);
      await store.setFacts(facts);
      sendJson(res, 200, { facts });
      return;
    }

    sendJson(res, 404, { error: "Not found." });
  }

  return http.createServer(async (req, res) => {
    try {
      await route(req, res);
    } catch (error) {
      if (error.status) {
        sendJson(res, error.status, { error: error.message });
        return;
      }
      log.error(error);
      if (!res.headersSent) sendJson(res, 500, { error: "Something went wrong on my side. Please try again." });
    }
  });
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  const config = loadConfig();
  const store = createStore(config);
  const assistant = createAssistant(config, store);
  const server = createServer({
    password: config.password,
    sessionSecret: config.sessionSecret,
    assistant,
    store,
  });
  // Claude can take a while on hard questions; don't let Node cut the request off.
  server.requestTimeout = 0;
  server.listen(config.port, () => {
    console.log(`Hephastus listening on port ${config.port} with ${config.model}`);
  });
}
