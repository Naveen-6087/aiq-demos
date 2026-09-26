import path from "node:path";
import dotenv from "dotenv";

dotenv.config();

const mcp = process.env.FILESYSTEM_MCP_NAME || "filesystem";
// Must be absolute - a relative path resolves against the MCP server's cwd, not this file's.
const notesDir = path.resolve(process.env.NOTES_DIR || "./notes");

const FILESYSTEM_MCP_TOOLS = [
  { name: `${mcp}__list_directory`, description: `List entries in a directory (args: { path })` },
  { name: `${mcp}__read_file`, description: `Read a file's contents (args: { path })` },
  { name: `${mcp}__write_file`, description: `Write/overwrite a file (args: { path, content })` },
  { name: `${mcp}__move_file`, description: `Move or rename a file (args: { source, destination })` },
  { name: `${mcp}__search_files`, description: `Glob-search a directory (args: { path, pattern })` },
];

async function planWithGemini(goal, geminiApiKey) {
  const prompt = `Convert this goal into filesystem MCP tool calls.
Available tools: ${JSON.stringify(FILESYSTEM_MCP_TOOLS)}
The notes directory (use this as the base for every path) is: ${notesDir}
Goal: "${goal}"
Return ONLY a JSON array like [{ "name": "tool_name", "args": {} }]. No markdown, no extra text.`;

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

  if (goalLower.includes("write") || goalLower.includes("save") || goalLower.includes("create")) {
    return [
      { name: `${mcp}__list_directory`, args: { path: notesDir } },
      {
        name: `${mcp}__write_file`,
        args: { path: `${notesDir}/meeting-notes.md`, content: "# Meeting Notes\n\nDrafted by the ArmorIQ filesystem agent." }
      }
    ];
  }

  if (goalLower.includes("move") || goalLower.includes("rename") || goalLower.includes("archive")) {
    return [{ name: `${mcp}__move_file`, args: { source: `${notesDir}/meeting-notes.md`, destination: `${notesDir}/archive/meeting-notes.md` } }];
  }

  if (goalLower.includes("search") || goalLower.includes("find")) {
    return [{ name: `${mcp}__search_files`, args: { path: notesDir, pattern: "*.md" } }];
  }

  return [
    { name: `${mcp}__list_directory`, args: { path: notesDir } },
    { name: `${mcp}__read_file`, args: { path: `${notesDir}/meeting-notes.md` } }
  ];
}

// Uses Gemini when GEMINI_API_KEY is set, otherwise falls back to keyword matching.
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
