// All settings come from environment variables, so no secret is ever stored in the code.

const REQUIRED = ["ANTHROPIC_API_KEY", "APP_PASSWORD", "SESSION_SECRET"];

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
    password: env.APP_PASSWORD,
    sessionSecret: env.SESSION_SECRET,
    upstash: env.UPSTASH_REDIS_REST_URL
      ? { url: env.UPSTASH_REDIS_REST_URL, token: env.UPSTASH_REDIS_REST_TOKEN }
      : null,
    dataDir: env.DATA_DIR || "./data",
  };
}
