// Read-only market-data tools, so policy here is allow-everything (no allow/hold/block tiers).
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";

const API_KEY = process.env.COINGECKO_API_KEY;
const BASE_URL = "https://api.coingecko.com/api/v3";

async function coingeckoFetch(path, params = {}) {
  const url = new URL(`${BASE_URL}${path}`);
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined) url.searchParams.set(key, String(value));
  }

  const headers = {};
  if (API_KEY) headers["x-cg-demo-api-key"] = API_KEY;

  const res = await fetch(url, { headers });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`CoinGecko API ${res.status}: ${body || res.statusText}`);
  }
  return res.json();
}

const server = new McpServer({ name: "coingecko", version: "1.0.0" });

server.tool(
  "search_coin",
  "Search for a coin by name or symbol to resolve its CoinGecko coin id (needed by the other tools).",
  { query: z.string().describe("Coin name or symbol, e.g. 'bitcoin' or 'eth'") },
  async ({ query }) => {
    const data = await coingeckoFetch("/search", { query });
    const coins = (data.coins ?? []).slice(0, 5).map((c) => ({
      id: c.id,
      name: c.name,
      symbol: c.symbol,
      market_cap_rank: c.market_cap_rank,
    }));
    return { content: [{ type: "text", text: JSON.stringify(coins) }] };
  }
);

server.tool(
  "get_price",
  "Get the current price (and optionally market cap / 24h change) for one or more coins by CoinGecko id.",
  {
    ids: z.string().describe("Comma-separated CoinGecko coin ids, e.g. 'bitcoin,ethereum'"),
    vs_currency: z.string().default("usd").describe("Currency to price in, e.g. 'usd'"),
  },
  async ({ ids, vs_currency }) => {
    const data = await coingeckoFetch("/simple/price", {
      ids,
      vs_currencies: vs_currency,
      include_market_cap: true,
      include_24hr_change: true,
    });
    return { content: [{ type: "text", text: JSON.stringify(data) }] };
  }
);

server.tool(
  "get_market_data",
  "Get fuller market data (price, market cap, rank, 24h high/low, ATH) for one or more coins by CoinGecko id.",
  {
    ids: z.string().describe("Comma-separated CoinGecko coin ids, e.g. 'bitcoin,ethereum'"),
    vs_currency: z.string().default("usd").describe("Currency to price in, e.g. 'usd'"),
  },
  async ({ ids, vs_currency }) => {
    const data = await coingeckoFetch("/coins/markets", { ids, vs_currency });
    return { content: [{ type: "text", text: JSON.stringify(data) }] };
  }
);

const transport = new StdioServerTransport();
await server.connect(transport);
