import http from "node:http";
import { pathToFileURL } from "node:url";
import { loadConfig } from "./config.js";
import { createStore } from "./store.js";
import { createAssistant } from "./assistant.js";
import { createWhatsAppClient, extractMessages, isValidSignature } from "./whatsapp.js";
import { createHandler } from "./handler.js";

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on("data", (chunk) => chunks.push(chunk));
    req.on("end", () => resolve(Buffer.concat(chunks)));
    req.on("error", reject);
  });
}

export function createServer({ verifyToken, appSecret, handler, log = console }) {
  return http.createServer(async (req, res) => {
    const url = new URL(req.url, "http://localhost");

    if (req.method === "GET" && url.pathname === "/") {
      res.writeHead(200, { "Content-Type": "text/plain" }).end("Hephastus is running.");
      return;
    }

    // Meta calls this once, when you connect the webhook, to check it's really yours.
    if (req.method === "GET" && url.pathname === "/webhook") {
      const ok =
        url.searchParams.get("hub.mode") === "subscribe" &&
        url.searchParams.get("hub.verify_token") === verifyToken;
      if (ok) res.writeHead(200).end(url.searchParams.get("hub.challenge"));
      else res.writeHead(403).end();
      return;
    }

    if (req.method === "POST" && url.pathname === "/webhook") {
      const raw = await readBody(req);
      if (!isValidSignature(raw, req.headers["x-hub-signature-256"], appSecret)) {
        log.warn("Rejected a webhook with an invalid signature.");
        res.writeHead(401).end();
        return;
      }
      // Answer Meta right away; Claude can take longer than Meta is willing to wait.
      res.writeHead(200).end();
      let payload;
      try {
        payload = JSON.parse(raw.toString("utf8"));
      } catch {
        log.warn("Ignored a webhook that wasn't JSON.");
        return;
      }
      for (const message of extractMessages(payload)) handler.enqueue(message);
      return;
    }

    res.writeHead(404).end();
  });
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  const config = loadConfig();
  const store = createStore(config);
  const whatsapp = createWhatsAppClient(config.whatsapp);
  const assistant = createAssistant(config, store);
  const handler = createHandler({ ownerNumber: config.ownerNumber, assistant, store, whatsapp });
  const server = createServer({
    verifyToken: config.whatsapp.verifyToken,
    appSecret: config.whatsapp.appSecret,
    handler,
  });
  server.listen(config.port, () => {
    console.log(`Hephastus listening on port ${config.port} with ${config.model}`);
  });
}
