// All settings come from environment variables, so no secret is ever stored in the code.

const REQUIRED = [
  "ANTHROPIC_API_KEY",
  "WHATSAPP_TOKEN",
  "WHATSAPP_PHONE_NUMBER_ID",
  "WHATSAPP_VERIFY_TOKEN",
  "WHATSAPP_APP_SECRET",
  "OWNER_WHATSAPP_NUMBER",
];

export function loadConfig(env = process.env) {
  const missing = REQUIRED.filter((name) => !env[name]);
  if (missing.length > 0) {
    throw new Error(`Missing required settings: ${missing.join(", ")}`);
  }
  return {
    port: Number(env.PORT || 3000),
    model: env.MODEL || "claude-opus-5-5",
    effort: env.EFFORT || "medium",
    historyLimit: Number(env.HISTORY_LIMIT || 40),
    whatsapp: {
      token: env.WHATSAPP_TOKEN,
      phoneNumberId: env.WHATSAPP_PHONE_NUMBER_ID,
      verifyToken: env.WHATSAPP_VERIFY_TOKEN,
      appSecret: env.WHATSAPP_APP_SECRET,
      graphVersion: env.GRAPH_API_VERSION || "v23.0",
    },
    // WhatsApp sends numbers as digits only (no "+", spaces or dashes).
    ownerNumber: env.OWNER_WHATSAPP_NUMBER.replace(/\D/g, ""),
    upstash: env.UPSTASH_REDIS_REST_URL
      ? { url: env.UPSTASH_REDIS_REST_URL, token: env.UPSTASH_REDIS_REST_TOKEN }
      : null,
    dataDir: env.DATA_DIR || "./data",
  };
}
