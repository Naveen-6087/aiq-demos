# Postgres Notes Agent

A natural-language database assistant that talks to a `postgres` MCP server,
with every SQL query gated by an ArmorIQ intent plan and held for human
review before it runs.

## What it demonstrates

- Holding *everything*, not tiering by tool name: the reference postgres MCP
  server exposes exactly one tool, `query`, that accepts arbitrary SQL - there
  is no `select_rows` vs `delete_rows` tool ArmorIQ could allowlist
  separately. The policy here holds every `query` call for a human to read
  the actual SQL text before approving, which is the right default whenever
  a tool's surface can't distinguish safe from unsafe calls by name alone.
- Defense in depth: even if a query were approved, the postgres MCP server
  itself runs every statement inside a read-only transaction, so a stray
  `DELETE`/`UPDATE`/`DROP` fails at the database layer regardless of what
  ArmorIQ decided. Policy and the MCP server are two independent controls.
- The same `startPlan -> check -> execute -> report -> flushObservability ->
  completePlan` lifecycle as the other cookbook demos.

### Why `mode: "sdk"` and not `"proxy"`

The `postgres` MCP server registered on the ArmorIQ dashboard is
stdio-transport - it runs as a local subprocess, the way every MCP host
(including this one) normally runs it. ArmorIQ's cloud proxy has no network
path to a stdio process on your machine, so `session.dispatch()` (which
routes the actual tool call through the proxy) 502s against it. `mode: "sdk"`
asks ArmorIQ only for the allow/hold/block *decision*; `src/mcpClient.js`
spawns the real MCP server locally and this agent executes the approved call
itself. The dashboard registration still matters for policy scope,
vulnerability scans, and audit metadata - just not for who actually runs the
process.

## Prerequisites

1. Docker, for a disposable local Postgres (see below) - or point
   `DATABASE_URL` at any Postgres you already have.
2. A `postgres` MCP server registered on your ArmorIQ dashboard (Platform >
   MCP Servers) - this agent spawns the actual
   `@modelcontextprotocol/server-postgres` process itself (see
   `src/mcpClient.js`), pointed at `DATABASE_URL`.
3. An ArmorIQ API key (`armoriq login` via the SDK's bundled CLI, or from the
   dashboard).
4. The `postgres-policy` created against that server: open
   **Platform → Policies → Policy Studio → Single Policy** on the dashboard,
   set Target Type `mcp_server` / Target ID to your registered postgres
   server's id, paste `policy.yaml`'s rules into the YAML editor, and Save.

## Run

```bash
docker compose up -d          # starts Postgres on localhost:55432, seeded via db/init.sql
cp .env.example .env          # fill in ARMORIQ_API_KEY (DATABASE_URL already matches docker-compose.yml)
npm install
npm run demo                   # scripted CLI walkthrough
# or
npm start                      # POST http://localhost:3004/agent {"goal": "show employee salaries"}
```

To tear down the local database: `docker compose down` (add `-v` to also
drop the seeded data volume).

## Try different goals

`goal` strings the planner (`src/planner.js`) recognizes: `"salary"` /
`"payroll"`, `"employee"` / `"department"`, `"delete"` / `"drop"` /
`"update"`, or anything else falls back to reading the `notes` table. Swap
`planWithLlm` for a real natural-language-to-SQL model once you're ready -
the enforcement loop in `src/index.js` doesn't change.
