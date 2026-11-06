import Anthropic from "@anthropic-ai/sdk";

const MAX_STEPS = 10;

// Models that support web search with dynamic filtering; older ones get the basic tool.
const DYNAMIC_SEARCH_MODELS = [
  "claude-opus-5-5", "claude-opus-5", "claude-opus-4-8", "claude-opus-4-7", "claude-opus-4-6",
  "claude-sonnet-5-5", "claude-sonnet-5", "claude-sonnet-4-6",
];

// Models whose safety classifiers can decline a request; on these we let the API
// retry a declined request on Anthropic's recommended fallback model.
const FALLBACK_MODELS = ["claude-opus-5-5", "claude-opus-5", "claude-fable-5-1", "claude-sonnet-5-5"];

const SYSTEM_PROMPT = `You are Hephastus, a personal AI assistant. You talk with one person, your owner, over WhatsApp.

Write like a helpful friend texting: short, clear replies. Use WhatsApp formatting only: *bold*, _italic_, ~strikethrough~, and simple "- " lists. Never use Markdown headings, tables, or **double asterisks**.

Search the web when a question depends on current or specific facts you aren't sure of, and mention where the information came from.

You have a long-term memory. When the owner tells you something worth keeping (their name, preferences, important people, plans, or anything they ask you to remember), save it with the remember tool. Remove facts that become wrong or that they ask you to forget with the forget tool. Don't announce routine saves.`;

export const CUSTOM_TOOLS = [
  {
    name: "remember",
    description:
      "Save one fact about the owner to long-term memory, so it is available in all future conversations. Use a short, self-contained sentence.",
    strict: true,
    input_schema: {
      type: "object",
      properties: { fact: { type: "string", description: "The fact to remember, e.g. 'Prefers replies in English.'" } },
      required: ["fact"],
      additionalProperties: false,
    },
  },
  {
    name: "forget",
    description: "Delete a fact from long-term memory by its number in the remembered-facts list.",
    strict: true,
    input_schema: {
      type: "object",
      properties: { fact_number: { type: "integer", description: "The number shown next to the fact." } },
      required: ["fact_number"],
      additionalProperties: false,
    },
  },
];

export function buildSystem(facts, now = new Date()) {
  const memory = facts.length
    ? facts.map((fact, i) => `${i + 1}. ${fact}`).join("\n")
    : "(nothing yet)";
  return `${SYSTEM_PROMPT}

Today's date: ${now.toISOString().slice(0, 10)}

Facts you remember about the owner:
${memory}`;
}

export function buildRequest({ model, effort, facts, messages }) {
  const webSearch = DYNAMIC_SEARCH_MODELS.includes(model)
    ? { type: "web_search_20260209", name: "web_search", max_uses: 5 }
    : { type: "web_search_20250305", name: "web_search", max_uses: 5 };
  const request = {
    model,
    max_tokens: 16000,
    output_config: { effort },
    cache_control: { type: "ephemeral" },
    system: buildSystem(facts),
    tools: [webSearch, ...CUSTOM_TOOLS],
    messages,
  };
  if (FALLBACK_MODELS.includes(model)) {
    request.betas = ["server-side-fallback-2026-07-01"];
    request.fallbacks = "default";
  }
  return request;
}

function textOf(content) {
  return content
    .filter((block) => block.type === "text")
    .map((block) => block.text)
    .join("")
    .trim();
}

// Runs a remember/forget call and returns the text Claude sees as the result.
async function runTool(name, input, store) {
  const facts = await store.getFacts();
  if (name === "remember") {
    const fact = String(input.fact ?? "").trim();
    if (!fact) return { content: "No fact given.", is_error: true };
    facts.push(fact);
    await store.setFacts(facts);
    return { content: `Saved as fact ${facts.length}.` };
  }
  if (name === "forget") {
    const index = Number(input.fact_number) - 1;
    if (!Number.isInteger(index) || index < 0 || index >= facts.length) {
      return { content: `There is no fact ${input.fact_number}.`, is_error: true };
    }
    const [removed] = facts.splice(index, 1);
    await store.setFacts(facts);
    return { content: `Forgot: ${removed}` };
  }
  return { content: `Unknown tool ${name}.`, is_error: true };
}

// Drops the oldest turns so the history stays under the limit and starts with the owner.
export function trimHistory(history, limit) {
  let trimmed = history.slice(-limit);
  while (trimmed.length > 0 && trimmed[0].role !== "user") trimmed = trimmed.slice(1);
  return trimmed;
}

export function createAssistant({ model, effort, historyLimit }, store, client = new Anthropic()) {
  return {
    async reply(userText) {
      const history = await store.getHistory();
      // Only the text of earlier turns is kept, so each request stays small.
      const messages = [...history, { role: "user", content: userText }];
      let answer = "";

      for (let step = 0; step < MAX_STEPS; step++) {
        const facts = await store.getFacts();
        const response = await client.beta.messages.create(buildRequest({ model, effort, facts, messages }));

        if (response.stop_reason === "refusal") {
          answer = "Sorry, I can't help with that one.";
          break;
        }
        if (response.stop_reason === "tool_use") {
          messages.push({ role: "assistant", content: response.content });
          const results = [];
          for (const block of response.content) {
            if (block.type !== "tool_use") continue;
            const result = await runTool(block.name, block.input, store);
            results.push({ type: "tool_result", tool_use_id: block.id, ...result });
          }
          messages.push({ role: "user", content: results });
          continue;
        }
        if (response.stop_reason === "pause_turn") {
          // A long web search paused; sending the turn back lets the server resume it.
          messages.push({ role: "assistant", content: response.content });
          continue;
        }
        answer = textOf(response.content);
        if (response.stop_reason === "max_tokens") answer += "\n\n_(I ran out of space; ask me to continue.)_";
        break;
      }

      if (!answer) answer = "Sorry, I couldn't finish that. Please try again.";
      const updated = [...history, { role: "user", content: userText }, { role: "assistant", content: answer }];
      await store.setHistory(trimHistory(updated, historyLimit));
      return answer;
    },
  };
}
