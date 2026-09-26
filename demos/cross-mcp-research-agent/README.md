# Cross-MCP Research Assistant

The flagship demo: **one agent, one signed ArmorIQ intent plan, spanning two
different MCP servers** - `filesystem` (read a source document) and `memory`
(store + recall a summary in the knowledge graph).

## What it demonstrates

This is the thing a single-MCP agent (like the [filesystem](../filesystem-notes-agent)
or [memory](../memory-knowledge-agent) demos, or the original GitHub agent)
can't show on its own:

- **One plan, multiple targets.** `session.startPlan()` is called once with a
  plan whose steps are namespaced `filesystem__read_file`,
  `memory__create_entities`, `memory__search_nodes` - the SDK's
  `<mcp>__<action>` convention (see `plan_builder.ts`) routes each step to
  the right registered MCP server from a single signed intent token.
- **Policy merging across servers.** Each step is still checked against the
  policy scoped to *its own* MCP server - the filesystem read is allowed by
  `filesystem-policy`, the memory write is held by `memory-policy` - but it's
  all part of one auditable plan/token, not three disconnected sessions.
- The same `startPlan -> check -> execute -> report -> flushObservability ->
  completePlan` lifecycle as the other demos, proving the pattern
  generalizes - here routed to whichever of two locally-spawned MCP servers
  each step actually targets (see "Why `mode: "sdk"`" below).

### Why `mode: "sdk"` and not `"proxy"`

Both registered MCP servers here are stdio-transport - they run as local
subprocesses, the way every MCP host (including this one) normally runs
them. ArmorIQ's cloud proxy has no network path to a stdio process on your
machine, so `session.dispatch()` (which routes the actual tool call through
the proxy) 502s against them - confirmed by running it, not assumed. `mode:
"sdk"` asks ArmorIQ only for the allow/hold/block *decision* for each step,
regardless of which MCP it targets; `src/mcpClient.js` spawns both real MCP
servers locally and routes each approved call to whichever one owns it. The
dashboard registrations still matter for policy scope, vulnerability scans,
and audit metadata - just not for who actually runs the process.

## Prerequisites

1. Both the `filesystem` and `memory` MCP servers registered on your ArmorIQ
   dashboard (Platform > MCP Servers) - this agent spawns both actual server
   processes itself (see `src/mcpClient.js`), the same way the other two
   demos in this cookbook do individually.
2. An ArmorIQ API key (`armoriq login` via the SDK's bundled CLI, or from the
   dashboard).
3. Both `../filesystem-notes-agent/policy.yaml` and
   `../memory-knowledge-agent/policy.yaml` created against their respective
   servers via **Platform → Policies → Policy Studio** (see those demos'
   READMEs) - this demo reuses them rather than defining a third policy,
   since policy scope is per-MCP-server, not per-agent.

## Run

```bash
cp .env.example .env      # fill in ARMORIQ_API_KEY
npm install
mkdir -p research && echo "# Notes on ArmorIQ" > research/source.md
npm run demo               # scripted CLI walkthrough
# or
npm start                  # POST http://localhost:3003/agent {"goal": "research the source file"}
```

## Try different goals

`goal` strings the planner (`src/planner.js`) recognizes: `"research ..."` /
`"summarize ..."` / `"read ..."` runs the full read -> store -> recall plan;
anything else falls back to listing the research directory and reading the
full memory graph.
