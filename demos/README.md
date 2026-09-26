# ArmorIQ Cookbook Demos

Self-contained agents demonstrating ArmorIQ's SDK + policy engine against
different MCP servers and frameworks. Each JS/Python agent follows the same
lifecycle (`startPlan -> check -> execute -> report -> flushObservability ->
completePlan`) - what changes is which MCP server(s) each one talks to, what
its policy allows, and which agent framework (if any) is doing the
tool-calling.

Unlike the original [GitHub agent](../../armoriq) demo, everything here
except `langchain-tool-agent`, `strands-support-agent`, and
`crewai-crypto-crew` (see their own READMEs) runs in `mode: "sdk"`, not
`"proxy"`, and executes the approved tool call itself against a
locally-spawned MCP server rather than letting ArmorIQ's proxy `dispatch()`
it. That's not a style choice: `filesystem`, `memory`, `postgres`, and
`coingecko` are registered on the dashboard as *stdio*-transport servers
(they run as local subprocesses, like every MCP host runs them), and
ArmorIQ's cloud proxy has no network path to a stdio process on this
machine - `dispatch()` 502s against them, confirmed by running it. GitHub's
MCP is remotely reachable over HTTPS, which is why `dispatch()` works for
that one. `crewai-crypto-crew` is the one exception worth reading closely -
CrewAI's adapter is *proxy-only* with no local-execution mode at all, so it
genuinely needs a deployed, reachable MCP server to fully succeed (see its
README for what we actually observed without one). See each demo's README
("Why `mode: "sdk"`") for the detail.

| Demo | MCP server(s) / framework | What it shows |
|---|---|---|
| [`filesystem-notes-agent`](./filesystem-notes-agent) | `filesystem` | Path-scoped tool policy: reads allowed, writes held for approval. Planner is a real Gemini call (falls back to keyword matching with no key) |
| [`memory-knowledge-agent`](./memory-knowledge-agent) | `memory` | Protecting a knowledge graph from unattended writes/wipes (reads allow, new facts hold, deletes block). Gemini-planned like the filesystem agent |
| [`cross-mcp-research-agent`](./cross-mcp-research-agent) | `filesystem` + `memory` | **One signed intent plan spanning two different MCP servers**, each step still checked against its own server's policy |
| [`postgres-notes-agent`](./postgres-notes-agent) | `postgres` (real local Docker Postgres) | A tool surface with exactly one tool (`query`) that can run any SQL - policy holds everything rather than allowlisting by tool name, plus the MCP server's own read-only-transaction defense in depth |
| [`langchain-tool-agent`](./langchain-tool-agent) | `weather-mcp`, via **LangChain** | The real shipped `ArmorIQLangChain` callback handler wired into a live Gemini tool-calling agent - not a hand-rolled loop |
| [`strands-support-agent`](./strands-support-agent) | self-built support-desk server, via **AWS Strands Agents (Python)** | The real shipped `ArmorIQStrands` hooks, a support-desk domain with a refund hold and a runnable prompt-injection test |
| [`coingecko-crypto-agent`](./coingecko-crypto-agent) | self-built `coingecko` server | Fully Gemini-planned from the start - ask genuinely open-ended crypto questions, not a handful of matched phrases. All-allow policy (nothing to gate in a read-only domain) |
| [`crewai-crypto-crew`](./crewai-crypto-crew) | same `coingecko` server, via **CrewAI (Python)** | The real shipped `ArmorIQCrew` adapter - and an honest look at its proxy-only limitation: a real observed proxy error without a deployed MCP server, plus the crew's own fail-closed refusal to fabricate an answer |

## Shared prerequisites

- An ArmorIQ account with the MCP servers each demo needs registered
  (Platform > MCP Servers) - `filesystem`/`memory`/`github` come from
  ArmorIQ's catalog; `postgres` is also catalog-listed but needs a
  `DATABASE_URL` (see `postgres-notes-agent`'s README); `weather`,
  `support-desk`, and `coingecko` are custom entries you add yourself (Add
  MCP Server > name it to match).
- An ArmorIQ API key - either from `npx armoriq login` (interactive OAuth
  device-code flow, bundled with `@armoriq/sdk`) or generated directly on the
  dashboard (Platform → API Keys). Either way it's a single `ak_live_...` /
  `ak_test_...` key, 72 characters, hex after the prefix - ArmorIQ doesn't
  split keys into "publishable" (safe client-side) vs "secret" the way some
  other platforms do. Every ArmorIQ key can mint intent tokens and dispatch
  through your registered MCP servers, so treat whichever one you generate as
  a full secret: keep it server-side, out of git (`.env` is gitignored here),
  and out of any client-side/browser code. Each demo's `.env.example`
  documents where the key goes.
- A Gemini API key (https://aistudio.google.com, free tier) - used by every
  demo except the pure filesystem/memory keyword fallback path,
  `postgres-notes-agent`, and `cross-mcp-research-agent`. If you hit a
  `429 RESOURCE_EXHAUSTED` quota error, try `gemini-flash-lite-latest` -
  it has a separate daily quota from `gemini-3.8-flash` and similar dated
  model ids.
- Docker is needed only for `postgres-notes-agent`.
- A free CoinGecko Demo API key (https://www.coingecko.com/en/api/pricing)
  for `coingecko-crypto-agent` and `crewai-crypto-crew` - optional, keyless
  access also works, just slower.

## Run order

Each JS folder is an independent `npm install` + `npm run demo` (scripted
CLI walkthrough) or `npm start` (HTTP `/agent` endpoint); `strands-support-agent`
and `crewai-crypto-crew` are Python projects with their own venv (see their
READMEs). See each demo's own README for its specific policy file and
prerequisites. Recommended order: `filesystem-notes-agent` and
`memory-knowledge-agent` first (single-MCP, simplest), then
`cross-mcp-research-agent` for the plan-spanning-two-MCPs behavior, then
`postgres-notes-agent` for a real database, then `coingecko-crypto-agent`
for a fully Gemini-planned agent, then `langchain-tool-agent` /
`strands-support-agent` for the real framework adapters that execute
locally, and `crewai-crypto-crew` last, once you understand why its adapter
needs a deployed MCP server to fully succeed.

Every demo here has a matching cookbook page written up in
[`../cookbook/`](../cookbook), ready to paste into docs.armoriq.ai.
