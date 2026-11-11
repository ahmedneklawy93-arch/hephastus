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

const SYSTEM_PROMPT = `You are Hephastus, the AI assistant of an MEP (mechanical, electrical and plumbing) contracting company. You talk with members of the company's team in a private chat page in their web browser.

The company tracks its projects, contracts, variations (change orders), daily site reports with manpower, and site tasks in Hephastus. Use the mep_data tool to answer questions about them; never guess figures. Amounts are in Egyptian pounds (EGP); write them like "EGP 1,250,000". You can only read this data: if someone asks you to add or change a record, tell them which screen to use (Projects or Site).

Reply clearly and to the point, like a helpful friend. You can use simple Markdown: **bold**, *italic*, \`code\`, links, and "- " or "1. " lists. Avoid tables and headings.

Search the web when a question depends on current or specific facts you aren't sure of, and mention where the information came from.

You have a long-term memory. When someone tells you something worth keeping for the team (people, suppliers, preferences, decisions, or anything they ask you to remember), save it with the remember tool. Remove facts that become wrong or that they ask you to forget with the forget tool. Don't announce routine saves.`;

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
    name: "mep_data",
    description:
      "Read the company's MEP project data. view 'summary' gives every project's contract value, approved and pending variations, revised value, progress, earned value, retention held, task and report status, plus company totals. view 'project' gives one project's full record with its variations, tasks and the latest 10 daily reports.",
    strict: true,
    input_schema: {
      type: "object",
      properties: {
        view: { type: "string", enum: ["summary", "project"] },
        project_code: { type: "string", description: "The project code, for view 'project'. Use an empty string for 'summary'." },
      },
      required: ["view", "project_code"],
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

export function buildSystem(facts, now = new Date(), user = null) {
  const memory = facts.length
    ? facts.map((fact, i) => `${i + 1}. ${fact}`).join("\n")
    : "(nothing yet)";
  return `${SYSTEM_PROMPT}

Today's date: ${now.toISOString().slice(0, 10)}
${user ? `\nYou are talking with ${user.displayName} (role: ${user.role}).\n` : ""}
Facts you remember:
${memory}`;
}

export function buildRequest({ model, effort, facts, messages, user }) {
  const webSearch = DYNAMIC_SEARCH_MODELS.includes(model)
    ? { type: "web_search_20260209", name: "web_search", max_uses: 5 }
    : { type: "web_search_20250305", name: "web_search", max_uses: 5 };
  const request = {
    model,
    max_tokens: 16000,
    output_config: { effort },
    cache_control: { type: "ephemeral" },
    system: buildSystem(facts, new Date(), user),
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

async function readMepData(input, ops) {
  if (!ops) return { content: "Project data isn't available.", is_error: true };
  if (input.view === "summary") return { content: JSON.stringify(await ops.summary()) };
  const data = await ops.loadAll();
  const code = String(input.project_code ?? "").trim().toLowerCase();
  const project = data.projects.find((p) => p.code.toLowerCase() === code);
  if (!project) {
    const codes = data.projects.map((p) => p.code).join(", ") || "none yet";
    return { content: `No project with code "${input.project_code}". Known codes: ${codes}.`, is_error: true };
  }
  const mine = (items) => items.filter((item) => item.projectId === project.id);
  return {
    content: JSON.stringify({
      project,
      variations: mine(data.variations),
      tasks: mine(data.tasks),
      latestReports: mine(data.reports).sort((a, b) => b.date.localeCompare(a.date)).slice(0, 10),
    }),
  };
}

// Runs a tool call and returns the text Claude sees as the result.
async function runTool(name, input, store, ops) {
  if (name === "mep_data") return readMepData(input, ops);
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

export function createAssistant({ model, effort, historyLimit }, store, client = new Anthropic(), ops = null) {
  return {
    // Each team member has their own chat history; memory is shared by the team.
    async reply(userText, user = null) {
      const username = user?.username ?? "admin";
      const history = await store.getHistory(username);
      // Only the text of earlier turns is kept, so each request stays small.
      const messages = [...history, { role: "user", content: userText }];
      let answer = "";

      for (let step = 0; step < MAX_STEPS; step++) {
        const facts = await store.getFacts();
        const response = await client.beta.messages.create(buildRequest({ model, effort, facts, messages, user }));

        if (response.stop_reason === "refusal") {
          answer = "Sorry, I can't help with that one.";
          break;
        }
        if (response.stop_reason === "tool_use") {
          messages.push({ role: "assistant", content: response.content });
          const results = [];
          for (const block of response.content) {
            if (block.type !== "tool_use") continue;
            const result = await runTool(block.name, block.input, store, ops);
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
        if (response.stop_reason === "max_tokens") answer += "\n\n*(I ran out of space; ask me to continue.)*";
        break;
      }

      if (!answer) answer = "Sorry, I couldn't finish that. Please try again.";
      const updated = [...history, { role: "user", content: userText }, { role: "assistant", content: answer }];
      await store.setHistory(trimHistory(updated, historyLimit), username);
      return answer;
    },
  };
}
