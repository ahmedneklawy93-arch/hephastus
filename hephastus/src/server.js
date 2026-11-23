import crypto from "node:crypto";
import fs from "node:fs/promises";
import http from "node:http";
import { pathToFileURL } from "node:url";
import { loadConfig } from "./config.js";
import { createStore } from "./store.js";
import { createAssistant } from "./assistant.js";
import { SCHEMA, createOps } from "./ops.js";
import { importLedger } from "./ledger.js";
import { connectPostgres } from "./gl/db.js";
import { createLedger } from "./gl/service.js";
import { createReports } from "./gl/reports.js";
import { importErpLedger } from "./gl/import.js";
import { reconcileStatement } from "./gl/statement.js";

// Who may use the accounting books. For now only the owner; add "manager" to open it to managers.
export const GL_ROLES = ["admin"];
import { ADMIN_USERNAME, hashPassword, normalizeUsername, publicUser, validateUser, verifyPassword } from "./users.js";

const SESSION_DAYS = 30;
const MAX_BODY_BYTES = 64 * 1024;
const MAX_MESSAGE_CHARS = 20000;
const MAX_LEDGER_BYTES = 25 * 1024 * 1024;
// After this many wrong passwords, logins pause for the rest of the window.
const MAX_FAILED_LOGINS = 10;
const LOGIN_WINDOW_MS = 15 * 60 * 1000;

const PAGE = new URL("../public/index.html", import.meta.url);
const OPS_SCRIPT = new URL("../public/ops.js", import.meta.url);
const GL_SCRIPT = new URL("../public/gl.js", import.meta.url);
const FALCON_MARK = new URL("../public/falcon-mark.png", import.meta.url);
const ADMIN = { username: ADMIN_USERNAME, displayName: "Admin", role: "admin" };

function sign(value, secret) {
  return crypto.createHmac("sha256", secret).update(value).digest("hex");
}

function safeEqual(a, b) {
  const hashA = crypto.createHash("sha256").update(a).digest();
  const hashB = crypto.createHash("sha256").update(b).digest();
  return crypto.timingSafeEqual(hashA, hashB);
}

// A session is "<username>.<expiry time>.<signature>", so it can't be forged without the secret.
export function createSessionToken(secret, now = Date.now(), username = ADMIN_USERNAME) {
  const payload = `${Buffer.from(username).toString("base64url")}.${now + SESSION_DAYS * 24 * 60 * 60 * 1000}`;
  return `${payload}.${sign(payload, secret)}`;
}

// Returns the username a valid session belongs to, or null.
export function readSession(token, secret, now = Date.now()) {
  if (!token) return null;
  const [name, expires, signature] = token.split(".");
  if (!name || !expires || !signature || !safeEqual(signature, sign(`${name}.${expires}`, secret))) return null;
  if (!(Number(expires) > now)) return null;
  return Buffer.from(name, "base64url").toString("utf8");
}

export function isValidSession(token, secret, now = Date.now()) {
  return readSession(token, secret, now) !== null;
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

// Reads an uploaded file sent as the raw request body.
async function readFile(req, limit) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > limit) throw Object.assign(new Error("That file is too large (25 MB at most)."), { status: 413 });
    chunks.push(chunk);
  }
  if (!size) throw Object.assign(new Error("The file is empty."), { status: 400 });
  return Buffer.concat(chunks);
}

function sendJson(res, status, body, headers = {}) {
  res.writeHead(status, { "Content-Type": "application/json", "Cache-Control": "no-store", ...headers });
  res.end(JSON.stringify(body));
}

function forbidden(message = "Your role can't do this.") {
  return Object.assign(new Error(message), { status: 403 });
}

export function createServer({ password, sessionSecret, assistant, store, ops = createOps(store), gl = null, log = console }) {
  const failedLogins = [];
  // Account changes are applied one at a time.
  let userQueue = Promise.resolve();
  const serialUsers = (work) => {
    const run = userQueue.then(work);
    userQueue = run.catch(() => {});
    return run;
  };

  async function findUser(username) {
    if (username === ADMIN_USERNAME) return ADMIN;
    const user = (await store.getCollection("users")).find((u) => u.username === username);
    return user ? publicUser(user) : null;
  }

  async function checkLogin(username, attempt) {
    if (!username || username === ADMIN_USERNAME) return safeEqual(attempt, password) ? ADMIN : null;
    const user = (await store.getCollection("users")).find((u) => u.username === username);
    return user && verifyPassword(attempt, user.passwordHash) ? publicUser(user) : null;
  }
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
        "Content-Security-Policy": "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'unsafe-inline' https://fonts.googleapis.com; font-src https://fonts.gstatic.com; img-src 'self' data:",
        "X-Frame-Options": "DENY",
        "Referrer-Policy": "no-referrer",
      });
      res.end(await fs.readFile(PAGE));
      return;
    }

    if (req.method === "GET" && url.pathname === "/falcon-mark.png") {
      res.writeHead(200, { "Content-Type": "image/png", "Cache-Control": "public, max-age=86400" });
      res.end(await fs.readFile(FALCON_MARK));
      return;
    }

    if (req.method === "GET" && (url.pathname === "/ops.js" || url.pathname === "/gl.js")) {
      res.writeHead(200, { "Content-Type": "text/javascript; charset=utf-8", "Cache-Control": "no-cache" });
      res.end(await fs.readFile(url.pathname === "/ops.js" ? OPS_SCRIPT : GL_SCRIPT));
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
      const user = typeof body.password === "string" ? await checkLogin(normalizeUsername(body.username), body.password) : null;
      if (!user) {
        failedLogins.push(now);
        sendJson(res, 401, { error: "Wrong username or password." });
        return;
      }
      const token = createSessionToken(sessionSecret, now, user.username);
      sendJson(res, 200, { ok: true }, { "Set-Cookie": sessionCookie(req, token, SESSION_DAYS * 24 * 60 * 60) });
      return;
    }

    if (!url.pathname.startsWith("/api/")) {
      res.writeHead(404).end();
      return;
    }

    const username = readSession(readCookie(req, "session"), sessionSecret);
    // Looked up on every request, so removing an account or changing a role takes effect at once.
    const user = username === null ? null : await findUser(username);
    if (!user) {
      sendJson(res, 401, { error: "Please log in." });
      return;
    }
    const office = user.role === "admin" || user.role === "manager";

    if (req.method === "POST" && url.pathname === "/api/logout") {
      sendJson(res, 200, { ok: true }, { "Set-Cookie": sessionCookie(req, "", 0) });
      return;
    }

    if (req.method === "GET" && url.pathname === "/api/state") {
      sendJson(res, 200, { me: { ...user, accounting: GL_ROLES.includes(user.role) ? (gl ? "ready" : "not-set-up") : null }, messages: await store.getHistory(user.username), facts: await store.getFacts() });
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
      const turn = queue.then(() => assistant.reply(message.trim(), user));
      queue = turn.catch(() => {});
      sendJson(res, 200, { reply: await turn });
      return;
    }

    if (req.method === "POST" && url.pathname === "/api/reset") {
      await store.setHistory([], user.username);
      sendJson(res, 200, { ok: true });
      return;
    }

    const factMatch = url.pathname.match(/^\/api\/facts\/(\d+)$/);
    if (req.method === "DELETE" && factMatch) {
      if (!office) throw forbidden("Only managers can remove team memory.");
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

    if (url.pathname.startsWith("/api/gl/")) {
      if (!GL_ROLES.includes(user.role)) throw forbidden("Accounting is open to the owner only for now.");
      if (!gl) throw Object.assign(new Error("The accounting database isn't set up. Add DATABASE_URL (see the README)."), { status: 503 });
      await routeGl(req, res, url, user);
      return;
    }

    if (url.pathname.startsWith("/api/finance")) {
      if (!office) throw forbidden("Only the admin and managers can see the finances.");
      await routeFinance(req, res, url, user);
      return;
    }

    if (url.pathname.startsWith("/api/ops")) {
      await routeOps(req, res, url, user);
      return;
    }

    if (url.pathname === "/api/users" || url.pathname.startsWith("/api/users/")) {
      if (user.role !== "admin") throw forbidden("Only the admin manages the team.");
      await routeUsers(req, res, url);
      return;
    }

    sendJson(res, 404, { error: "Not found." });
  }

  async function routeOps(req, res, url, user) {
    if (req.method === "GET" && url.pathname === "/api/ops/schema") {
      sendJson(res, 200, { schema: SCHEMA });
      return;
    }
    if (req.method === "GET" && url.pathname === "/api/ops/data") {
      const data = await ops.loadAll();
      sendJson(res, 200, { ...data, summary: await ops.summary() });
      return;
    }
    const match = url.pathname.match(/^\/api\/ops\/([a-z]+)(?:\/([0-9a-f-]{36}))?$/);
    if (!match || !SCHEMA[match[1]]) {
      sendJson(res, 404, { error: "Not found." });
      return;
    }
    const [, collection, id] = match;
    if (req.method === "POST" && !id) {
      sendJson(res, 201, { record: await ops.create(collection, await readJson(req), user) });
    } else if (req.method === "PUT" && id) {
      sendJson(res, 200, { record: await ops.update(collection, id, await readJson(req), user) });
    } else if (req.method === "DELETE" && id) {
      await ops.remove(collection, id, user);
      sendJson(res, 200, { ok: true });
    } else {
      sendJson(res, 405, { error: "Not allowed." });
    }
  }

  async function routeFinance(req, res, url, user) {
    if (req.method === "GET" && url.pathname === "/api/finance") {
      const [ledger] = await store.getCollection("ledger");
      sendJson(res, 200, { ledger: ledger ?? null });
      return;
    }
    if (req.method === "POST" && url.pathname === "/api/finance/ledger") {
      const fileName = String(url.searchParams.get("name") ?? "").slice(0, 200);
      const ledger = importLedger(await readFile(req, MAX_LEDGER_BYTES), { fileName, importedBy: user.username });
      // Each weekly export covers the year to date, so the newest upload replaces the previous one.
      await store.setCollection("ledger", [ledger]);
      sendJson(res, 200, { ledger });
      return;
    }
    sendJson(res, 404, { error: "Not found." });
  }

  async function routeGl(req, res, url, user) {
    const p = url.pathname.slice("/api/gl/".length).split("/").map(decodeURIComponent);
    const qs = Object.fromEntries(url.searchParams);
    const m = req.method;
    const body = async () => readJson(req);
    const ok = (value, status = 200) => sendJson(res, status, value ?? { ok: true });
    const { ledger, reports } = gl;
    if (p[0] === "accounts") {
      if (m === "GET" && p.length === 1) return ok({ accounts: await ledger.listAccounts() });
      if (m === "POST" && p.length === 1) return ok({ code: await ledger.saveAccount(await body(), user, { create: true }) }, 201);
      if (m === "PUT" && p.length === 2) return ok({ code: await ledger.saveAccount({ ...(await body()), code: p[1] }, user, { create: false }) });
    }
    if (p[0] === "cost-centres") {
      if (m === "GET" && p.length === 1) return ok({ costCentres: await ledger.listCostCentres() });
      if (m === "POST" && p.length === 1) return ok({ id: await ledger.saveCostCentre(await body(), user) }, 201);
      if (m === "PUT" && p.length === 2) return ok({ id: await ledger.saveCostCentre({ ...(await body()), id: p[1] }, user) });
    }
    if (p[0] === "entries") {
      if (m === "GET" && p.length === 1) return ok(await ledger.listEntries(qs));
      if (m === "POST" && p.length === 1) return ok({ entry: await ledger.saveDraft(await body(), user) }, 201);
      if (m === "GET" && p.length === 2) return ok({ entry: await ledger.getEntry(p[1]) });
      if (m === "PUT" && p.length === 2) return ok({ entry: await ledger.saveDraft(await body(), user, p[1]) });
      if (m === "POST" && p.length === 3) {
        const b = await body();
        if (p[2] === "post") return ok({ entry: await ledger.post(p[1], user) });
        if (p[2] === "approve") return ok({ entry: await ledger.approve(p[1], user) });
        if (p[2] === "void") return ok({ entry: await ledger.voidEntry(p[1], b.reason, user) });
        if (p[2] === "reverse") return ok({ entry: await ledger.reverse(p[1], b.date, user) });
      }
    }
    if (p[0] === "periods") {
      if (m === "GET" && p.length === 1) return ok({ periods: await ledger.listPeriods() });
      if (m === "POST" && p.length === 3 && ["lock", "unlock"].includes(p[2])) { await ledger.setLock(p[1], p[2] === "lock", user); return ok(); }
    }
    if (p[0] === "reports" && m === "GET") {
      const run = { "trial-balance": reports.trialBalance, income: reports.incomeStatement, "balance-sheet": reports.balanceSheet,
        statement: reports.accountStatement, "cost-centres": reports.costCentres }[p[1]];
      if (run) return ok(await run(qs));
    }
    if (p[0] === "import" && m === "POST") return ok({ report: await importErpLedger(ledger, await readFile(req, MAX_LEDGER_BYTES), user) });
    if (p[0] === "check-statement" && m === "POST") return ok({ check: await reconcileStatement(ledger, await readFile(req, MAX_LEDGER_BYTES)) });
    if (p[0] === "audit" && m === "GET") return ok({ audit: await ledger.auditLog(qs) });
    sendJson(res, 404, { error: "Not found." });
  }

  async function routeUsers(req, res, url) {
    const target = url.pathname === "/api/users" ? null : normalizeUsername(decodeURIComponent(url.pathname.slice(11)));
    if (req.method === "GET" && !target) {
      sendJson(res, 200, { users: [ADMIN, ...(await store.getCollection("users")).map(publicUser)] });
      return;
    }
    const body = ["POST", "PUT"].includes(req.method) ? await readJson(req) : null;
    const result = await serialUsers(async () => {
      const users = await store.getCollection("users");
      if (req.method === "POST" && !target) {
        const fields = { ...body, username: normalizeUsername(body.username) };
        const problem = validateUser(fields, { requirePassword: true });
        if (problem) throw Object.assign(new Error(problem), { status: 400 });
        if (users.some((u) => u.username === fields.username)) {
          throw Object.assign(new Error("That username is taken."), { status: 400 });
        }
        users.push({
          username: fields.username,
          displayName: fields.displayName.trim(),
          role: fields.role,
          passwordHash: hashPassword(fields.password),
        });
      } else if (target && ["PUT", "DELETE"].includes(req.method)) {
        const index = users.findIndex((u) => u.username === target);
        if (index < 0) throw Object.assign(new Error("No such user."), { status: 404 });
        if (req.method === "DELETE") {
          users.splice(index, 1);
        } else {
          const problem = validateUser({ ...body, username: target }, { requirePassword: false });
          if (problem) throw Object.assign(new Error(problem), { status: 400 });
          users[index] = {
            ...users[index],
            displayName: body.displayName.trim(),
            role: body.role,
            ...(body.password ? { passwordHash: hashPassword(body.password) } : {}),
          };
        }
      } else {
        throw Object.assign(new Error("Not allowed."), { status: 405 });
      }
      await store.setCollection("users", users);
      return [ADMIN, ...users.map(publicUser)];
    });
    sendJson(res, 200, { users: result });
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
  const ops = createOps(store);
  const assistant = createAssistant(config, store, undefined, ops);
  let gl = null;
  if (config.databaseUrl) {
    const db = await connectPostgres(config.databaseUrl);
    gl = { ledger: createLedger(db), reports: createReports(db) };
  } else {
    console.warn("DATABASE_URL is not set: the Accounting screens are off.");
  }
  const server = createServer({
    password: config.password,
    sessionSecret: config.sessionSecret,
    assistant,
    store,
    ops,
    gl,
  });
  // Claude can take a while on hard questions; don't let Node cut the request off.
  server.requestTimeout = 0;
  server.listen(config.port, () => {
    console.log(`Hephastus listening on port ${config.port} with ${config.model}`);
  });
}
