# Filesystem Notes Agent

A minimal natural-language notes assistant that talks to a `filesystem` MCP
server, with every tool call gated by an ArmorIQ intent plan and policy.

## What it demonstrates

- Path-scoped tool policy: reads (`read_file`, `list_directory`, `search_files`, ...)
  are allowed automatically; writes (`write_file`, `edit_file`, `move_file`,
  `create_directory`) are held for human approval.
- The full ArmorIQ lifecycle: `startPlan` (mint a signed intent token for the
  whole multi-step plan) -> `check` (evaluate policy per tool call, `mode:
  "sdk"`) -> this agent executes the allowed call itself against a locally
  spawned MCP server -> `report` (log the result) -> `flushObservability` ->
  `completePlan`.

### Why `mode: "sdk"` and not `"proxy"`

The `filesystem` MCP server registered on the ArmorIQ dashboard is
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

1. A `filesystem` MCP server registered on your ArmorIQ dashboard
   (Platform > MCP Servers) - this agent spawns the actual
   `@modelcontextprotocol/server-filesystem` process itself (see
   `src/mcpClient.js`), pointed at `NOTES_DIR` (see below).
2. An ArmorIQ API key (`armoriq login` via the SDK's bundled CLI, or from the
   dashboard).
3. The `filesystem-notes-policy` created against that server: open
   **Platform → Policies → Policy Studio → Single Policy** on the dashboard,
   set Target Type `mcp_server` / Target ID to your registered filesystem
   server's id, paste `policy.yaml`'s rules into the YAML editor (it's
   bidirectional with the form), and Save. (The `armoriq policy propose` CLI
   command stages a *different*, org-wide policy - the one that governs
   coding-agent products like ArmorClaude/ArmorCodex - not per-MCP-server
   policies like this one.)

## Run

```bash
cp .env.example .env      # fill in ARMORIQ_API_KEY
npm install
mkdir -p notes/archive
npm run demo               # scripted CLI walkthrough
# or
npm start                  # POST http://localhost:3001/agent {"goal": "write a note"}
```

## Try different goals

`goal` strings the planner (`src/planner.js`) recognizes: `"write a note"`,
`"archive my notes"`, `"search my notes"`, or anything else falls back to a
read-only listing. Swap `planWithLlm` for a real LLM call once you're ready -
the enforcement loop in `src/index.js` doesn't change.
