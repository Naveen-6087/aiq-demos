import dotenv from "dotenv";

dotenv.config();

const mcp = process.env.POSTGRES_MCP_NAME || "postgres";

const SCHEMA_HINT = `Tables: employees(id, name, department, salary), notes(id, title, body, created_at)`;

async function planWithGemini(goal, geminiApiKey) {
  const prompt = `Convert this goal into a SQL query for a postgres MCP tool call.
${SCHEMA_HINT}
Goal: "${goal}"
Return ONLY a JSON array like [{ "name": "${mcp}__query", "args": { "sql": "..." } }]. No markdown, no extra text.`;

  const model = process.env.GEMINI_MODEL || "gemini-flash-lite-latest";
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${geminiApiKey}`;
  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }] }),
  });

  const data = await response.json();
  const raw = data.candidates?.[0]?.content?.parts?.[0]?.text?.trim() ?? "";
  return JSON.parse(raw.replace(/```json|```/g, "").trim());
}

// Keyword fallback so the demo still runs with no GEMINI_API_KEY configured.
function planWithKeywords(goal) {
  const goalLower = (goal || "").toLowerCase();

  if (goalLower.includes("salary") || goalLower.includes("payroll")) {
    return [{ name: `${mcp}__query`, args: { sql: "SELECT name, department, salary FROM employees ORDER BY salary DESC" } }];
  }

  if (goalLower.includes("employee") || goalLower.includes("department")) {
    return [{ name: `${mcp}__query`, args: { sql: "SELECT id, name, department FROM employees ORDER BY id" } }];
  }

  if (goalLower.includes("delete") || goalLower.includes("drop") || goalLower.includes("update")) {
    return [{ name: `${mcp}__query`, args: { sql: "DELETE FROM notes WHERE id = 1" } }];
  }

  return [{ name: `${mcp}__query`, args: { sql: "SELECT id, title, body FROM notes ORDER BY id" } }];
}

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
