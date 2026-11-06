import crypto from "node:crypto";

// WhatsApp rejects text messages longer than 4096 characters.
const MAX_TEXT = 4096;

// Meta signs every webhook with the app secret; reject anything that doesn't match.
export function isValidSignature(rawBody, signatureHeader, appSecret) {
  if (!signatureHeader || !signatureHeader.startsWith("sha256=")) return false;
  const expected = crypto.createHmac("sha256", appSecret).update(rawBody).digest("hex");
  const given = signatureHeader.slice("sha256=".length);
  if (given.length !== expected.length) return false;
  return crypto.timingSafeEqual(Buffer.from(given), Buffer.from(expected));
}

// Pull the incoming messages out of a webhook payload. Delivery/read
// receipts ("statuses") are ignored.
export function extractMessages(payload) {
  const messages = [];
  for (const entry of payload?.entry ?? []) {
    for (const change of entry.changes ?? []) {
      for (const message of change.value?.messages ?? []) {
        messages.push({
          id: message.id,
          from: message.from,
          type: message.type,
          text: message.type === "text" ? message.text?.body ?? "" : null,
        });
      }
    }
  }
  return messages;
}

export function splitText(text, limit = MAX_TEXT) {
  const parts = [];
  let rest = text;
  while (rest.length > limit) {
    // Prefer to break at a paragraph, then a line, then a space.
    let cut = rest.lastIndexOf("\n\n", limit);
    if (cut < limit / 2) cut = rest.lastIndexOf("\n", limit);
    if (cut < limit / 2) cut = rest.lastIndexOf(" ", limit);
    if (cut < limit / 2) cut = limit;
    parts.push(rest.slice(0, cut).trimEnd());
    rest = rest.slice(cut).trimStart();
  }
  if (rest.length > 0) parts.push(rest);
  return parts;
}

export function createWhatsAppClient({ token, phoneNumberId, graphVersion }, fetchImpl = fetch) {
  const url = `https://graph.facebook.com/${graphVersion}/${phoneNumberId}/messages`;

  async function post(body) {
    const response = await fetchImpl(url, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ messaging_product: "whatsapp", ...body }),
    });
    if (!response.ok) {
      throw new Error(`WhatsApp API error ${response.status}: ${await response.text()}`);
    }
    return response.json();
  }

  return {
    async sendText(to, text) {
      for (const part of splitText(text)) {
        await post({ to, type: "text", text: { body: part } });
      }
    },
    // Shows blue ticks and a "typing…" indicator while Claude works.
    async markReadAndTyping(messageId) {
      await post({ status: "read", message_id: messageId, typing_indicator: { type: "text" } });
    },
  };
}
