import fs from "node:fs/promises";
import path from "node:path";

// Hephastus keeps the recent chat history of each team member, the facts it
// has been asked to remember, and named collections of records (team accounts,
// projects, variations, daily reports, tasks).
//
// Two backends with the same interface:
// - Upstash Redis (free tier) for hosts whose disk is wiped on restart, like Render's free plan.
// - A JSON file for running on your own computer or a host with a persistent disk.

export function createStore(config, fetchImpl = fetch) {
  return config.upstash ? createUpstashStore(config.upstash, fetchImpl) : createFileStore(config.dataDir);
}

// The admin keeps the original history key, so chats from before team accounts stay.
function historyKey(user = "admin") {
  return user === "admin" ? "hephastus:history" : `hephastus:history:${user}`;
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
    getHistory: (user) => getJson(historyKey(user), []),
    setHistory: (history, user) => command("SET", historyKey(user), JSON.stringify(history)),
    getCollection: (name) => getJson(`hephastus:${name}`, []),
    setCollection: (name, items) => command("SET", `hephastus:${name}`, JSON.stringify(items)),
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
      if (error.code === "ENOENT") return { history: [], facts: [], histories: {}, collections: {} };
      throw error;
    }
  }

  async function save(change) {
    const state = await load();
    change(state);
    await fs.mkdir(dataDir, { recursive: true });
    const tmp = `${file}.tmp`;
    await fs.writeFile(tmp, JSON.stringify(state, null, 2));
    await fs.rename(tmp, file);
  }

  return {
    getHistory: async (user = "admin") => {
      const state = await load();
      return (user === "admin" ? state.history : state.histories?.[user]) ?? [];
    },
    setHistory: (history, user = "admin") =>
      save((state) => {
        if (user === "admin") state.history = history;
        else state.histories = { ...state.histories, [user]: history };
      }),
    getCollection: async (name) => (await load()).collections?.[name] ?? [],
    setCollection: (name, items) => save((state) => { state.collections = { ...state.collections, [name]: items }; }),
    getFacts: async () => (await load()).facts ?? [],
    setFacts: (facts) => save((state) => { state.facts = facts; }),
  };
}
