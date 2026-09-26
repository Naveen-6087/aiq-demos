import dotenv from "dotenv";

dotenv.config();

const mcp = process.env.MEMORY_MCP_NAME || "memory";

const MEMORY_MCP_TOOLS = [
  { name: `${mcp}__search_nodes`, description: `Search the knowledge graph by keyword (args: { query })` },
  { name: `${mcp}__open_nodes`, description: `Open specific named entities (args: { names: string[] })` },
  { name: `${mcp}__read_graph`, description: `Read the entire knowledge graph (args: {})` },
  { name: `${mcp}__create_entities`, description: `Add new entities (args: { entities: [{ name, entityType, observations: string[] }] })` },
  { name: `${mcp}__add_observations`, description: `Add facts to an existing entity (args: { observations: [{ entityName, contents: string[] }] })` },
  { name: `${mcp}__delete_entities`, description: `Permanently delete entities (args: { entityNames: string[] })` },
];

async function planWithGemini(goal, geminiApiKey) {
  const prompt = `Convert this goal into memory (knowledge graph) MCP tool calls.
Available tools: ${JSON.stringify(MEMORY_MCP_TOOLS)}
Goal: "${goal}"
Return ONLY a JSON array like [{ "name": "tool_name", "args": {} }]. No markdown, no extra text.
If the goal mentions a new fact about someone/something, use create_entities or add_observations.
If it asks what's known, use search_nodes or read_graph. If it asks to forget/delete, use delete_entities.`;

  const model = process.env.GEMINI_MODEL || "gemini-flash-lite-latest";
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${geminiApiKey}`;
  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }] }),
  });

  const data = await response.json();
  const raw = data.candidates?.[0]?.content?.parts?.[0]?.text?.trim() ?? "";
  const clean = raw.replace(/```json|```/g, "").trim();
  return JSON.parse(clean);
}

// Keyword fallback so the demo still runs with no GEMINI_API_KEY configured.
function planWithKeywords(goal) {
  const goalLower = (goal || "").toLowerCase();

  if (goalLower.includes("remember") || goalLower.includes("save") || goalLower.includes("note that")) {
    return [{
      name: `${mcp}__create_entities`,
      args: { entities: [{ name: "Isha", entityType: "person", observations: ["Works on the ArmorIQ cookbook demos"] }] }
    }];
  }

  if (goalLower.includes("forget") || goalLower.includes("delete") || goalLower.includes("wipe")) {
    return [{ name: `${mcp}__delete_entities`, args: { entityNames: ["Isha"] } }];
  }

  if (goalLower.includes("what do you know") || goalLower.includes("recall") || goalLower.includes("search")) {
    return [{ name: `${mcp}__search_nodes`, args: { query: "Isha" } }];
  }

  return [{ name: `${mcp}__read_graph`, args: {} }];
}

// Uses Gemini when GEMINI_API_KEY is set, else falls back to keyword matching.
export async function planWithLlm(goal, providedToolCalls = null) {
  if (Array.isArray(providedToolCalls) && providedToolCalls.length > 0) {
    return providedToolCalls;
  }

  const geminiApiKey = process.env.GEMINI_API_KEY;
  if (geminiApiKey) {
    try {
      return await planWithGemini(goal, geminiApiKey);
    } catch (err) {
      console.warn("[WARNING] Gemini planning failed, falling back to keyword planner:", err.message);
    }
  }

  return planWithKeywords(goal);
}
