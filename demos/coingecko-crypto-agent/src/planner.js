import dotenv from "dotenv";

dotenv.config();

const mcp = process.env.COINGECKO_MCP_NAME || "coingecko";

const COINGECKO_MCP_TOOLS = [
  { name: `${mcp}__search_coin`, description: `Resolve a coin name/symbol to its CoinGecko id (args: { query })` },
  { name: `${mcp}__get_price`, description: `Get current price + market cap + 24h change for coin ids (args: { ids, vs_currency })` },
  { name: `${mcp}__get_market_data`, description: `Get fuller market data (rank, 24h high/low, ATH) for coin ids (args: { ids, vs_currency })` },
];

async function planWithGemini(goal, geminiApiKey) {
  const prompt = `Convert this goal into CoinGecko MCP tool calls.
Available tools: ${JSON.stringify(COINGECKO_MCP_TOOLS)}
Goal: "${goal}"
Return ONLY a JSON array like [{ "name": "tool_name", "args": {} }]. No markdown, no extra text.
If you don't already know the coin's CoinGecko id (e.g. "bitcoin", "ethereum"), start with
search_coin to resolve it, then chain a get_price or get_market_data call using that id.
vs_currency defaults to "usd" if the user doesn't specify one.`;

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

// Fallback for no GEMINI_API_KEY; hardcoded to Bitcoin since resolving an arbitrary coin needs an LLM.
function planWithKeywords(goal) {
  const goalLower = (goal || "").toLowerCase();

  if (goalLower.includes("market cap") || goalLower.includes("rank") || goalLower.includes("ath")) {
    return [{ name: `${mcp}__get_market_data`, args: { ids: "bitcoin", vs_currency: "usd" } }];
  }

  if (goalLower.includes("search") || goalLower.includes("find")) {
    return [{ name: `${mcp}__search_coin`, args: { query: "bitcoin" } }];
  }

  return [{ name: `${mcp}__get_price`, args: { ids: "bitcoin", vs_currency: "usd" } }];
}

// Uses Gemini when GEMINI_API_KEY is set, otherwise falls back to the keyword planner.
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
