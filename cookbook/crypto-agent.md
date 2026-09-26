# Build a Crypto Prices Agent with the ArmorIQ SDK

A step-by-step guide to a crypto-prices assistant you can ask genuinely
open-ended questions - "what's SOL worth in EUR", "how's Bitcoin doing
today" - answered by a real Gemini planning step, backed by a self-built
CoinGecko MCP server, with every call gated by ArmorIQ.

## What you'll build

```
goal → Gemini picks tool call(s) → ArmorIQ checks each one → execute against a self-built CoinGecko MCP server → answer
```

Crypto market data is read-only public information - there's nothing
destructive to gate here, so unlike this cookbook's Postgres or Strands
recipes, the policy below allows every tool outright rather than tiering
allow/hold/block. The interesting part of this recipe isn't the policy;
it's that the planner is a real LLM call instead of keyword matching, so
the agent can actually answer whatever you ask it, not just a few
hardcoded phrases.

## Before you start

| Requirement | Why |
|---|---|
| Node.js v18 or later, and npm | Runs the agent |
| An ArmorIQ account | Policy enforcement and observability |
| A Gemini API key | Plans tool calls from natural-language goals |
| A CoinGecko API key (optional) | Free Demo tier - keyless access also works, just slower |

## Step 1: Create your ArmorIQ account and API key

1. Go to [platform.armoriq.ai](https://platform.armoriq.ai) and sign up/login.
2. Open **Settings → API Keys**.
3. Click **Generate new key** and copy it.

## Step 2: Get a Gemini API key

1. Go to [aistudio.google.com](https://aistudio.google.com).
2. Click **Create API key** and copy it.

## Step 3: Get a CoinGecko API key (optional)

1. Go to [coingecko.com/en/api/pricing](https://www.coingecko.com/en/api/pricing).
2. Register for the free **Demo** plan (30 calls/min) and copy your key.

Keyless access works too (5 calls/min, less stable) - if you skip this
step, just leave `COINGECKO_API_KEY` blank in Step 8.

## Step 4: Register a CoinGecko MCP server with ArmorIQ

1. In the ArmorIQ console, open **MCP Servers**.
2. Click **Add MCP Server**.
3. Name it `coingecko`.
4. Save.

This is a custom entry - `coingecko` isn't one of ArmorIQ's built-in catalog
listings the way `filesystem`/`memory`/`github`/`postgres` are, since this
recipe builds its own small MCP server (Step 7) rather than using a
published one. It's stdio-transport, the way every MCP host runs a local
server, so this guide's agent runs `mode: "sdk"` (Step 9) and spawns the
server itself rather than `mode: "proxy"`, which would try to route the
call through ArmorIQ's cloud proxy and 502 - the proxy has no network path
to a stdio process on your machine.

## Step 5: Write your first policy

1. In the console, open **Policies → Policy Studio → Single Policy**.
2. Set **Target Type** to `mcp_server`, **Target ID** to the `coingecko`
   server you just registered.
3. Set **Default enforcement action** to `block`.
4. Paste this into the YAML editor:

```yaml
name: coingecko-policy
version: v0.1.0
scope:
  target_type: mcp
  target: coingecko   # replace with your registered coingecko MCP server's id
  caller: all
default_action: block
priority: 50
rules:
  - tool: search_coin
    action: allow
  - tool: get_price
    action: allow
  - tool: get_market_data
    action: allow
```

5. Save and activate.

## Step 6: Scaffold the project

```bash
mkdir armoriq-crypto-agent && cd armoriq-crypto-agent
npm init -y
npm install @armoriq/sdk @modelcontextprotocol/sdk dotenv zod
mkdir src
touch .env src/mcpClient.js src/planner.js src/index.js coingecko-mcp-server.js
```

## Step 7: Build the CoinGecko MCP server

Three clean, read-only tools over CoinGecko's public API - deliberately not
a generic "run arbitrary code against the API" tool, so the policy above
stays legible.

```javascript
// coingecko-mcp-server.js
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
  if (!res.ok) throw new Error(`CoinGecko API ${res.status}: ${await res.text().catch(() => res.statusText)}`);
  return res.json();
}

const server = new McpServer({ name: "coingecko", version: "1.0.0" });

server.tool(
  "search_coin",
  "Search for a coin by name or symbol to resolve its CoinGecko coin id.",
  { query: z.string().describe("Coin name or symbol, e.g. 'bitcoin' or 'eth'") },
  async ({ query }) => {
    const data = await coingeckoFetch("/search", { query });
    const coins = (data.coins ?? []).slice(0, 5).map((c) => ({ id: c.id, name: c.name, symbol: c.symbol, market_cap_rank: c.market_cap_rank }));
    return { content: [{ type: "text", text: JSON.stringify(coins) }] };
  }
);

server.tool(
  "get_price",
  "Get the current price (and market cap / 24h change) for coins by CoinGecko id.",
  { ids: z.string().describe("Comma-separated CoinGecko coin ids"), vs_currency: z.string().default("usd") },
  async ({ ids, vs_currency }) => {
    const data = await coingeckoFetch("/simple/price", { ids, vs_currencies: vs_currency, include_market_cap: true, include_24hr_change: true });
    return { content: [{ type: "text", text: JSON.stringify(data) }] };
  }
);

server.tool(
  "get_market_data",
  "Get fuller market data (rank, 24h high/low, ATH) for coins by CoinGecko id.",
  { ids: z.string().describe("Comma-separated CoinGecko coin ids"), vs_currency: z.string().default("usd") },
  async ({ ids, vs_currency }) => {
    const data = await coingeckoFetch("/coins/markets", { ids, vs_currency });
    return { content: [{ type: "text", text: JSON.stringify(data) }] };
  }
);

const transport = new StdioServerTransport();
await server.connect(transport);
```

## Step 8: Configure environment variables

```
# .env

# From platform.armoriq.ai → Settings → API Keys
ARMORIQ_API_KEY=ak_your_key_here

# "sdk" mode: ArmorIQ decides allow/hold/block; this process executes the
# approved call itself against the locally-spawned MCP server.
ARMORIQ_MODE=sdk

# Identifies this session in ArmorIQ's observability logs
USER_EMAIL=you@your-org.com

# Must match the name you registered in Step 4
COINGECKO_MCP_NAME=coingecko

# From coingecko.com/en/api/pricing - optional, leave blank for keyless access
COINGECKO_API_KEY=

# From aistudio.google.com
GEMINI_API_KEY=your_gemini_key_here
GEMINI_MODEL=gemini-flash-lite-latest
```

```bash
echo ".env" >> .gitignore
```

## Step 9: Connect to the MCP server and plan with Gemini

```javascript
// src/mcpClient.js
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export async function connectCoingeckoServer(apiKey) {
  const transport = new StdioClientTransport({
    command: "node",
    args: [path.join(__dirname, "..", "coingecko-mcp-server.js")],
    env: apiKey ? { ...process.env, COINGECKO_API_KEY: apiKey } : process.env,
  });
  const client = new Client({ name: "armoriq-crypto-agent", version: "1.0.0" }, { capabilities: {} });
  await client.connect(transport);
  return client;
}

export async function callTool(client, name, args) {
  const result = await client.callTool({ name, arguments: args ?? {} });
  const text = (result.content ?? []).filter((b) => b.type === "text").map((b) => b.text).join("\n");
  if (result.isError) throw new Error(text || `MCP tool "${name}" reported an error`);
  try { return JSON.parse(text); } catch { return text; }
}
```

```javascript
// src/planner.js
const mcp = process.env.COINGECKO_MCP_NAME || "coingecko";

const TOOLS = [
  { name: `${mcp}__search_coin`, description: "Resolve a coin name/symbol to its CoinGecko id (args: { query })" },
  { name: `${mcp}__get_price`, description: "Get current price + 24h change for coin ids (args: { ids, vs_currency })" },
  { name: `${mcp}__get_market_data`, description: "Get fuller market data for coin ids (args: { ids, vs_currency })" },
];

export async function planWithLlm(goal) {
  const prompt = `Convert this goal into CoinGecko MCP tool calls.
Available tools: ${JSON.stringify(TOOLS)}
Goal: "${goal}"
Return ONLY a JSON array like [{ "name": "tool_name", "args": {} }]. No markdown, no extra text.
If you don't already know the coin's CoinGecko id, start with search_coin, then chain a get_price call.
vs_currency defaults to "usd" if unspecified.`;

  const model = process.env.GEMINI_MODEL || "gemini-flash-lite-latest";
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${process.env.GEMINI_API_KEY}`;
  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }] }),
  });
  const data = await response.json();
  const raw = data.candidates?.[0]?.content?.parts?.[0]?.text?.trim() ?? "";
  return JSON.parse(raw.replace(/```json|```/g, "").trim());
}
```

## Step 10: Build the agent loop

Every step follows the same four moves: **plan → check → execute → report**.

```javascript
// src/index.js
import dotenv from "dotenv";
import { ArmorIQClient } from "@armoriq/sdk";
import { connectCoingeckoServer, callTool } from "./mcpClient.js";
import { planWithLlm } from "./planner.js";

dotenv.config();

function actionFromToolName(name) {
  const idx = name.indexOf("__");
  return idx === -1 ? name : name.slice(idx + 2);
}

async function main() {
  const armoriq = new ArmorIQClient({ apiKey: process.env.ARMORIQ_API_KEY });
  await armoriq.bootstrap();
  const cgClient = await connectCoingeckoServer(process.env.COINGECKO_API_KEY);

  const userEmail = process.env.USER_EMAIL;
  const session = armoriq.forUser(userEmail).startSession({
    mode: process.env.ARMORIQ_MODE || "sdk",
    defaultMcpName: process.env.COINGECKO_MCP_NAME || "coingecko",
    validitySeconds: 2400,
  });

  const goal = process.argv.slice(2).join(" ") || "What's the price of Bitcoin and Ethereum right now?";
  const toolCalls = await planWithLlm(goal);
  console.log(`Goal: ${goal}`);
  console.log(`Plan: ${toolCalls.map((c) => c.name).join(" -> ")}\n`);

  const token = await session.startPlan(toolCalls, goal);

  for (const call of toolCalls) {
    const decision = await session.check(call.name, call.args, userEmail);
    if (!decision.allowed) {
      console.log(`[${decision.action.toUpperCase()}] ${call.name}: ${decision.reason}`);
      continue;
    }

    try {
      const result = await callTool(cgClient, actionFromToolName(call.name), call.args);
      await session.report(call.name, call.args, result, { status: "success" });
      console.log(`[ALLOW] ${call.name}:`, JSON.stringify(result));
    } catch (error) {
      await session.report(call.name, call.args, { error: error.message }, { status: "failed", errorMessage: error.message });
      console.error(`[ERROR] ${call.name}:`, error.message);
    }
  }

  await session.flushObservability();
  if (token?.planId) await armoriq.completePlan(token.planId).catch(() => {});
  await cgClient.close();
}

main();
```

## Step 11: Run it

```bash
node src/index.js "how's Solana doing today, in EUR?"
```

Sample output once the policy is active:

```
Goal: how's Solana doing today, in EUR?
Plan: coingecko__search_coin -> coingecko__get_price

[ALLOW] coingecko__search_coin: [{"id":"solana","name":"Solana","symbol":"SOL","market_cap_rank":7}]
[ALLOW] coingecko__get_price: {"solana":{"eur":142.31,"eur_market_cap":78331902841,"eur_24h_change":-1.2}}
```

Notice Gemini chose to resolve the coin id first, then chain the price
lookup - it wasn't told to do that in two steps for this specific question,
it inferred it from the tool descriptions.

## Step 12: See it in the ArmorIQ dashboard

Open **Intent** in the console, filtered by your `USER_EMAIL` - each run
shows both tool calls the model chose, in the order it chose them, each
independently checked and audited even though they came from one goal and
one Gemini call.

## Troubleshooting

| Symptom | Likely cause |
|---|---|
| Gemini call fails with "Unexpected end of JSON input" | The Gemini API returned an error body (check for a `503 high demand` or similar) instead of a candidates array - log the raw response before parsing to see the real error |
| A specific Gemini model id 404s | Some dated model ids get deprecated for new API keys; use `gemini-flash-lite-latest` or a `-latest` alias, or check `GET /v1beta/models` for what's currently available to your key |
| Everything gets blocked | Default policy is `block` with no matching rule; confirm Step 5's policy is saved *and* activated, and its `target` matches the registered server's actual id |
| `dispatch()`/`mode: "proxy"` returns a 502 | The coingecko MCP server is stdio-transport; ArmorIQ's cloud proxy cannot reach it. Use `mode: "sdk"`, as shown in Step 10 |
| CoinGecko returns `429` | Rate limit exceeded - keyless is capped at 5 calls/min, Demo at 30/min; get/upgrade a key at coingecko.com/en/api/pricing |

## What's next

- **Try the CrewAI recipe** for a multi-agent take on the same CoinGecko data - a researcher agent and a writer agent turning prices into a market brief.
- **Add more tools.** CoinGecko's API covers exchanges, NFTs, DeFi, and on-chain data via GeckoTerminal - `coingecko-mcp-server.js` only wraps three endpoints; the pattern extends to any of them.
