import fs from "node:fs/promises";
import path from "node:path";

// Hephastus keeps two things: the recent chat history and the facts it has
// been asked to remember.
//
// Two backends with the same interface:
// - Upstash Redis (free tier) for hosts whose disk is wiped on restart, like Render's free plan.
// - A JSON file for running on your own computer or a host with a persistent disk.

export function createStore(config, fetchImpl = fetch) {
  return config.upstash ? createUpstashStore(config.upstash, fetchImpl) : createFileStore(config.dataDir);
}

export function createUpstashStore({ url, token }, fetchImpl = fetch) {
  async function command(...args) {
    const response = await fetchImpl(url, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}` },
      body: JSON.stringify(args),
    });
    const body = await response.json();
    if (!response.ok || body.error) {
      throw new Error(`Upstash error: ${body.error ?? response.status}`);
    }
    return body.result;
  }

  async function getJson(key, fallback) {
    const value = await command("GET", key);
    return value == null ? fallback : JSON.parse(value);
  }

  return {
    getHistory: () => getJson("hephastus:history", []),
    setHistory: (history) => command("SET", "hephastus:history", JSON.stringify(history)),
    getFacts: () => getJson("hephastus:facts", []),
    setFacts: (facts) => command("SET", "hephastus:facts", JSON.stringify(facts)),
  };
}

export function createFileStore(dataDir) {
  const file = path.join(dataDir, "state.json");

  async function load() {
    try {
      return JSON.parse(await fs.readFile(file, "utf8"));
    } catch (error) {
      if (error.code === "ENOENT") return { history: [], facts: [] };
      throw error;
    }
  }

  async function save(patch) {
    const state = { ...(await load()), ...patch };
    await fs.mkdir(dataDir, { recursive: true });
    const tmp = `${file}.tmp`;
    await fs.writeFile(tmp, JSON.stringify(state, null, 2));
    await fs.rename(tmp, file);
  }

  return {
    getHistory: async () => (await load()).history ?? [],
    setHistory: (history) => save({ history }),
    getFacts: async () => (await load()).facts ?? [],
    setFacts: (facts) => save({ facts }),
  };
}
