import dotenv from "dotenv";

dotenv.config();

const mcp = process.env.GITHUB_MCP_NAME || "github";
const githubUser = process.env.GITHUB_USER || "octocat";

const GITHUB_MCP_TOOLS = [
  { name: `${mcp}__search_repositories`, description: "Search repositories (args: { query })" },
  { name: `${mcp}__list_commits`, description: "List commits in a repository (args: { owner, repo })" },
  { name: `${mcp}__list_issues`, description: "List issues in a repository (args: { owner, repo })" },
  { name: `${mcp}__get_file_contents`, description: "Get a file or directory (args: { owner, repo, path })" },
  { name: `${mcp}__create_pull_request`, description: "Open a PR (args: { owner, repo, title, head, base, body })" },
  { name: `${mcp}__delete_repository`, description: "Delete a repository (args: { owner, repo })" },
];

async function planWithGemini(goal, geminiApiKey) {
  const prompt = `Convert this goal into GitHub MCP tool calls.
Available tools: ${JSON.stringify(GITHUB_MCP_TOOLS)}
Default owner if none is mentioned: ${githubUser}
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
  return JSON.parse(raw.replace(/```json|```/g, "").trim());
}

function planWithKeywords(goal) {
  const goalLower = (goal || "").toLowerCase();

  if (goalLower.includes("pull request") || goalLower.includes("pr")) {
    return [{
      name: `${mcp}__create_pull_request`,
      args: { owner: githubUser, repo: "sample-repo", title: "Update documentation", head: "patch-1", base: "main", body: "Automated PR" }
    }];
  }

  if (goalLower.includes("delete")) {
    return [{ name: `${mcp}__delete_repository`, args: { owner: githubUser, repo: "sample-repo" } }];
  }

  return [{ name: `${mcp}__search_repositories`, args: { query: `user:${githubUser}` } }];
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
