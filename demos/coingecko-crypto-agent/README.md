# CoinGecko Crypto Agent

A crypto-prices assistant you can ask genuinely open-ended questions -
"what's SOL worth in INR", "how's Bitcoin doing today" - answered by a real
Gemini planning step, backed by a self-built CoinGecko MCP server, with
every call gated by ArmorIQ.

## What it demonstrates

- **Gemini-first planning, not keyword matching.** Unlike this cookbook's
  earlier filesystem/memory demos (which started as keyword-matched
  fallbacks), this agent's planner (`src/planner.js`) calls Gemini directly
  to turn any natural-language goal into the right MCP tool call(s) -
  including multi-step plans like "resolve the coin id, then fetch its
  price" when the model doesn't already know the id. The keyword fallback
  only kicks in if `GEMINI_API_KEY` isn't set.
- **A domain with nothing to hold.** Crypto market data is read-only public
  information - there's no destructive or sensitive operation to gate, so
  (like the weather demo) the policy here allows every tool outright. Not
  every MCP needs tiered enforcement.
- **A self-built MCP server wrapping a real third-party API**
  (`coingecko-mcp-server.js`) - three clean tools (`search_coin`,
  `get_price`, `get_market_data`) instead of a generic "run arbitrary code"
  tool, so the policy story stays legible.

## Prerequisites

1. A `coingecko` MCP server registered on your ArmorIQ dashboard (Platform >
   MCP Servers) - a custom entry you create yourself (Add MCP Server > name
   it `coingecko`), since it's a small server this demo builds itself.
2. An ArmorIQ API key (`armoriq login` via the SDK's bundled CLI, or from the
   dashboard).
3. A Gemini API key (free tier) from https://aistudio.google.com - optional
   but recommended; without it the agent only answers Bitcoin questions via
   the keyword fallback.
4. A CoinGecko Demo API key (free) from
   https://www.coingecko.com/en/api/pricing - optional; keyless access works
   too, just capped at 5 calls/min instead of 30.
5. The `coingecko-policy` created against the registered server: open
   **Platform → Policies → Policy Studio → Single Policy** on the dashboard,
   set Target Type `mcp_server` / Target ID to your registered coingecko
   server's id, paste `policy.yaml`'s rules into the YAML editor, and Save.

## Run

```bash
cp .env.example .env      # fill in ARMORIQ_API_KEY, GEMINI_API_KEY, COINGECKO_API_KEY
npm install
npm run demo "how's Solana doing today, in EUR?"
# or
npm start                  # POST http://localhost:3005/agent {"goal": "..."}
```

## Try different goals

Anything works once `GEMINI_API_KEY` is set - "what's the market cap of
Ethereum", "search for Dogecoin", "compare Bitcoin and Solana's 24h change".
Without a Gemini key, `src/planner.js`'s keyword fallback only recognizes
`"market cap"`/`"rank"`/`"ath"` (routes to `get_market_data`),
`"search"`/`"find"` (routes to `search_coin`), and defaults to Bitcoin's
price otherwise.
