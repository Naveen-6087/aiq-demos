# Memory Knowledge-Graph Agent

A "remember this / what do you know about X" assistant backed by a `memory`
MCP server (knowledge graph), with ArmorIQ protecting the agent's long-term
memory from unattended writes and wipes.

## What it demonstrates

- Tiered policy on a single MCP server: reads (`search_nodes`, `open_nodes`,
  `read_graph`) are allowed; new-fact writes (`create_entities`,
  `create_relations`, `add_observations`) are held for human review before
  they're trusted; destructive calls (`delete_entities`, `delete_relations`,
  `delete_observations`) are blocked outright.
- The exact "malicious prompt tries to wipe agent memory" scenario the
  ArmorIQ SDK docs call out under Security Model - `demo.js` intentionally
  includes a `delete_entities` step to show it getting stopped.

### Why `mode: "sdk"` and not `"proxy"`

The `memory` MCP server registered on the ArmorIQ dashboard is
stdio-transport - it runs as a local subprocess, the way every MCP host
(including this one) normally runs it. ArmorIQ's cloud proxy has no network
path to a stdio process on your machine, so `session.dispatch()` (which
routes the actual tool call through the proxy) 502s against it - confirmed by
running it, not assumed. `mode: "sdk"` asks ArmorIQ only for the allow/hold/
block *decision*; `src/mcpClient.js` spawns the real MCP server locally and
this agent executes the approved call itself. The dashboard registration
still matters for policy scope, vulnerability scans, and audit metadata -
just not for who actually runs the process.

## Prerequisites

1. A `memory` MCP server registered on your ArmorIQ dashboard (Platform >
   MCP Servers) - this agent spawns the actual
   `@modelcontextprotocol/server-memory` process itself (see
   `src/mcpClient.js`).
2. An ArmorIQ API key (`armoriq login` via the SDK's bundled CLI, or from the
   dashboard).
3. The `memory-knowledge-policy` created against that server: open
   **Platform → Policies → Policy Studio → Single Policy** on the dashboard,
   set Target Type `mcp_server` / Target ID to your registered memory
   server's id, paste `policy.yaml`'s rules into the YAML editor (it's
   bidirectional with the form), and Save. (The `armoriq policy propose` CLI
   command stages a *different*, org-wide policy - the one that governs
   coding-agent products like ArmorClaude/ArmorCodex - not per-MCP-server
   policies like this one.)

## Run

```bash
cp .env.example .env      # fill in ARMORIQ_API_KEY
npm install
npm run demo               # scripted CLI walkthrough
# or
npm start                  # POST http://localhost:3002/agent {"goal": "remember that ..."}
```

## Try different goals

`goal` strings the planner (`src/planner.js`) recognizes: `"remember that ..."`,
`"forget ..."` / `"wipe ..."`, `"what do you know about ..."` / `"recall"`, or
anything else falls back to a full graph read. Swap `planWithLlm` for a real
LLM call once you're ready - the enforcement loop in `src/index.js` doesn't
change.
