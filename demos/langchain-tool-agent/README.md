# LangChain Weather Agent

A real LangChain tool-calling agent (Gemini model, two live weather tools)
governed end-to-end by ArmorIQ's actual shipped `ArmorIQLangChain` callback
handler - not a hand-rolled enforcement loop like the other cookbook demos.
This is the "drop ArmorIQ into the framework you already use" story: the
agent, the tools, and the prompt are all plain LangChain; ArmorIQ is one
extra callback passed at invocation time.

## What it demonstrates

- **The real adapter, not a re-implementation.** Every other demo in this
  cookbook builds its own `check -> execute -> report` loop directly against
  `ArmorIQSession`. This one imports `ArmorIQLangChain` from
  `@armoriq/sdk/dist/integrations/langchain.js` and passes the handler it
  returns via `{ callbacks: [handler] }` on `agentExecutor.invoke(...)` -
  the exact pattern in ArmorIQ's own [LangChain integration
  docs](https://docs.armoriq.ai) - two LangChain callbacks
  (`handleLLMEnd`, `handleToolStart`) do all the plan-capture and
  enforcement work.
- **A genuinely multi-step agentic turn.** The prompt tells the model to
  search for the place first, then fetch current conditions for the
  coordinates it gets back - two real, sequential tool calls chosen by the
  LLM itself (not hardcoded), each independently checked by ArmorIQ before
  it runs.
- **A policy that's allowed on purpose.** Unlike the filesystem/memory/
  postgres demos, this MCP has nothing destructive to gate - both tools are
  read-only public-data lookups - so `policy.yaml` allows them outright.
  Not every integration needs holds; match the policy to what the tool can
  actually do.
- **Live enforcement events.** `armoriq.forUser(..., { onEvent })` streams
  `hold` / `approved` / `rejected` / `timeout` / `block` / `error` as they
  happen - wire this into a UI instead of console.log for a real app.

## Why weather-mcp

[`weather-mcp`](https://github.com/weather-mcp/weather-mcp) is a real,
published, keyless MCP server (17 tools over NOAA/Open-Meteo) - no API key
to request, nothing to sign up for, so this demo has zero external
dependencies beyond `npx` itself. It's also stdio-transport, same as every
other MCP server in this cookbook, so the same `mode: "sdk"` +
locally-spawned-server pattern applies (see the filesystem/memory/postgres
demos' READMEs for why `mode: "proxy"` doesn't work here).

## Prerequisites

1. A `weather` MCP server registered on your ArmorIQ dashboard (Platform >
   MCP Servers) - this is a custom entry you create yourself (Add MCP Server
   > name it `weather`), since `weather-mcp` isn't one of ArmorIQ's built-in
   catalog listings the way filesystem/memory/postgres are. This agent
   spawns the actual server process itself (see `src/mcpClient.js`).
2. An ArmorIQ API key (`armoriq login` via the SDK's bundled CLI, or from the
   dashboard).
3. A Gemini API key (free tier) from https://aistudio.google.com.
4. The `weather-policy` created against the registered server: open
   **Platform → Policies → Policy Studio → Single Policy** on the dashboard,
   set Target Type `mcp_server` / Target ID to your registered weather
   server's id, paste `policy.yaml`'s rules into the YAML editor, and Save.

## Run

```bash
cp .env.example .env      # fill in ARMORIQ_API_KEY and GEMINI_API_KEY
npm install
npm start                  # runs the default goal
# or
node agent.js "What's the weather like in Tokyo right now?"
```

The first run downloads `weather-mcp` via `npx` - expect a short delay
before the "weather-mcp connected" line prints.

## Swapping the model

Only `agent.js`'s `ChatGoogleGenerativeAI` construction is Gemini-specific.
Swap in `@langchain/openai`'s `ChatOpenAI`, `@langchain/anthropic`'s
`ChatAnthropic`, or any other `@langchain/core`-compatible chat model and
everything else - the tools, `ArmorIQLangChain`, the agent executor - is
unchanged.
