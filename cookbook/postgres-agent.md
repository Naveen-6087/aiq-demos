# Build a Postgres Agent with the ArmorIQ SDK

A step-by-step guide to building a CLI agent that answers questions about a
Postgres database in plain English, with every SQL query checked against
your organization's policy - and held for human review - before it runs.

## What you'll build

A command-line agent that turns a goal like `"show me employee salaries"`
into SQL, and runs it through this loop:

```
goal → pick SQL → check against ArmorIQ policy → execute against Postgres MCP server → show result (or hold/denial)
```

Unlike a GitHub or filesystem MCP server, the reference Postgres MCP server
exposes exactly **one** tool - `query` - that accepts arbitrary SQL. There is
no `select_rows` vs `delete_rows` tool name to allowlist separately, so this
guide's policy holds every query for a human to read the actual SQL text
before approving it, rather than trying to guess intent from a tool name
that can't carry it.

## Before you start

| Requirement | Why |
|---|---|
| Node.js v18 or later, and npm | Runs the agent |
| Docker | Runs a disposable local Postgres to test against |
| An ArmorIQ account | Policy enforcement and observability |

```bash
node --version   # v18.0.0 or higher
npm --version    # v8.0.0 or higher
docker --version
```

## Step 1: Create your ArmorIQ account and API key

1. Go to [platform.armoriq.ai](https://platform.armoriq.ai) and sign up/login.
2. Open **Settings → API Keys**.
3. Click **Generate new key** and copy it.

Keep this key handy; you'll add it to your `.env` file in Step 5. It's a
single secret credential - ArmorIQ does not split keys into a "publishable"
(safe client-side) tier and a "secret" tier the way some other platforms do.
Treat whichever key you generate as fully sensitive.

## Step 2: Start a local Postgres

```bash
mkdir armoriq-postgres-agent && cd armoriq-postgres-agent
mkdir db
```

Save this as `docker-compose.yml`:

```yaml
services:
  postgres:
    image: postgres:16-alpine
    container_name: armoriq-postgres-notes-demo
    restart: unless-stopped
    environment:
      POSTGRES_USER: armoriq
      POSTGRES_PASSWORD: armoriq_demo_password
      POSTGRES_DB: armoriq_notes
    ports:
      - "55432:5432"
    volumes:
      - ./db/init.sql:/docker-entrypoint-initdb.d/init.sql:ro
      - pgdata:/var/lib/postgresql/data

volumes:
  pgdata:
```

Save this as `db/init.sql` - a small seed schema with a `salary` column, so
the demo has a realistic reason to gate SQL access rather than just showing
an empty table:

```sql
CREATE TABLE IF NOT EXISTS employees (
    id SERIAL PRIMARY KEY,
    name TEXT NOT NULL,
    department TEXT NOT NULL,
    salary NUMERIC(10, 2) NOT NULL
);

INSERT INTO employees (name, department, salary) VALUES
    ('Isha Parekh', 'Engineering', 145000.00),
    ('Rohan Iyer', 'Engineering', 138000.00),
    ('Priya Shah', 'Sales', 92000.00),
    ('Arjun Mehta', 'Sales', 98000.00),
    ('Divya Rao', 'Support', 68000.00)
ON CONFLICT DO NOTHING;

CREATE TABLE IF NOT EXISTS notes (
    id SERIAL PRIMARY KEY,
    title TEXT NOT NULL,
    body TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

INSERT INTO notes (title, body) VALUES
    ('Welcome', 'This is a seeded note for the ArmorIQ Postgres cookbook demo.')
ON CONFLICT DO NOTHING;
```

```bash
docker compose up -d
```

## Step 3: Register the Postgres MCP server with ArmorIQ

1. In the ArmorIQ console, open **MCP Servers**.
2. Click **Add MCP Server**.
3. Name it `postgres`.
4. Save.

**Important**: the Postgres MCP server is stdio-transport - it runs as a
local subprocess, the way every MCP host runs it. ArmorIQ's cloud proxy has
no network path to a stdio process on your machine, so this guide's agent
runs `mode: "sdk"` and spawns the server itself (Step 7) rather than
`mode: "proxy"`, which would try to route the call through ArmorIQ's proxy
and 502. The dashboard registration still matters for policy scope,
vulnerability scans, and audit metadata - just not for who actually runs the
process.

## Step 4: Write your first policy

1. In the console, open **Policies → Policy Studio → Single Policy**.
2. Set **Target Type** to `mcp_server`, **Target ID** to the `postgres`
   server you just registered.
3. Set **Default enforcement action** to `block`.
4. Paste this into the YAML editor:

```yaml
name: postgres-policy
version: v0.1.0
scope:
  target_type: mcp
  target: postgres   # replace with your registered postgres MCP server's id
  caller: all
default_action: block
priority: 50
rules:
  - tool: query
    action: hold
```

5. Save and activate.

With this policy, every `query` call is held for a human to approve after
reading the actual SQL. There's nothing to allowlist by tool name here - the
whole surface is one tool that can run anything.

<Callout type="info">
  Defense in depth: even if a query were approved, the reference Postgres MCP
  server runs every statement inside a read-only transaction, so a stray
  `DELETE`/`UPDATE`/`DROP` fails at the database layer regardless of what
  ArmorIQ decided. Policy and the MCP server are two independent controls.
</Callout>

## Step 5: Scaffold the project

```bash
npm init -y
npm install @armoriq/sdk @modelcontextprotocol/sdk dotenv
mkdir src
touch .env src/mcpClient.js src/planner.js agent.js
```

| Package | Purpose |
|---|---|
| `@armoriq/sdk` | Policy checks, plan capture, observability |
| `@modelcontextprotocol/sdk` | Spawns and talks to the local Postgres MCP server |
| `dotenv` | Loads your `.env` file |

## Step 6: Configure environment variables

```
# .env

# From platform.armoriq.ai → Settings → API Keys
ARMORIQ_API_KEY=ak_your_key_here

# "sdk" mode: ArmorIQ decides allow/hold/block; this process executes the
# approved call itself against the locally-spawned MCP server.
ARMORIQ_MODE=sdk

# Identifies this session in ArmorIQ's observability logs
USER_EMAIL=you@your-org.com

# Must match the name you registered in Step 3
POSTGRES_MCP_NAME=postgres

# Matches the docker-compose.yml service above
DATABASE_URL=postgresql://armoriq:armoriq_demo_password@localhost:55432/armoriq_notes
```

```bash
echo ".env" >> .gitignore
```

## Step 7: Connect to the Postgres MCP server

```javascript
// src/mcpClient.js
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

export async function connectPostgresServer(databaseUrl) {
  const transport = new StdioClientTransport({
    command: "npx",
    // The reference postgres MCP server takes the connection string as a
    // positional argument, not an env var.
    args: ["-y", "@modelcontextprotocol/server-postgres", databaseUrl],
  });

  const client = new Client(
    { name: "armoriq-postgres-agent", version: "1.0.0" },
    { capabilities: {} }
  );

  await client.connect(transport);
  return client;
}

export async function callTool(client, name, args) {
  const result = await client.callTool({ name, arguments: args ?? {} });

  const text = (result.content ?? [])
    .filter((block) => block.type === "text")
    .map((block) => block.text)
    .join("\n");

  if (result.isError) {
    throw new Error(text || `MCP tool "${name}" reported an error`);
  }

  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}
```

The first time this runs, `npx` downloads the Postgres MCP server package,
so expect a short delay on the very first call.

## Step 8: Pick SQL from a goal

```javascript
// src/planner.js
const mcp = process.env.POSTGRES_MCP_NAME || "postgres";

// The reference postgres MCP server exposes exactly one tool, "query", so
// "planning" here just means picking the SQL - swap this for a real
// LLM-to-SQL step later (see the GitHub agent recipe's planWithGemini for
// the pattern), the ArmorIQ enforcement loop in agent.js doesn't change.
export async function planWithLlm(goal, providedToolCalls = null) {
  if (Array.isArray(providedToolCalls) && providedToolCalls.length > 0) {
    return providedToolCalls;
  }

  const goalLower = (goal || "").toLowerCase();

  if (goalLower.includes("salary") || goalLower.includes("payroll")) {
    return [{
      name: `${mcp}__query`,
      args: { sql: "SELECT name, department, salary FROM employees ORDER BY salary DESC" }
    }];
  }

  if (goalLower.includes("employee") || goalLower.includes("department")) {
    return [{
      name: `${mcp}__query`,
      args: { sql: "SELECT id, name, department FROM employees ORDER BY id" }
    }];
  }

  return [{
    name: `${mcp}__query`,
    args: { sql: "SELECT id, title, body FROM notes ORDER BY id" }
  }];
}
```

## Step 9: Build the agent loop

Every step follows the same four moves: **plan → check → execute → report**.

```javascript
// agent.js
import dotenv from "dotenv";
import { ArmorIQClient } from "@armoriq/sdk";
import { connectPostgresServer, callTool } from "./src/mcpClient.js";
import { planWithLlm } from "./src/planner.js";

dotenv.config();

const userEmail = process.env.USER_EMAIL;

function actionFromToolName(name) {
  const idx = name.indexOf("__");
  return idx === -1 ? name : name.slice(idx + 2);
}

async function runStep(armoriq, session, pgClient, goal, overrides) {
  const [call] = await planWithLlm(goal, overrides);

  // 1. Commit this step to the plan ArmorIQ is tracking, mint the intent token.
  const token = await session.startPlan([call], goal);

  // 2. Check policy before anything executes.
  const decision = await session.check(call.name, call.args, userEmail);
  if (!decision.allowed) {
    console.log(`[${decision.action.toUpperCase()}] ${call.name}: ${decision.reason}`);
    if (decision.delegationId) console.log(`  delegation: ${decision.delegationId}`);
    return null;
  }

  // 3. Execute the tool call yourself; this is what "sdk" mode means -
  // ArmorIQ's cloud proxy can't reach a stdio MCP server on this machine.
  let result;
  try {
    result = await callTool(pgClient, actionFromToolName(call.name), call.args);
    await session.report(call.name, call.args, result, { status: "success" });
  } catch (error) {
    result = { error: error.message };
    await session.report(call.name, call.args, result, { status: "failed", errorMessage: error.message });
  }

  // 4. Close the plan - nothing else does this for you.
  if (token?.planId) {
    await armoriq.completePlan(token.planId).catch((err) => console.warn("completePlan failed:", err.message));
  }
  return result;
}

async function main() {
  const armoriq = new ArmorIQClient({ apiKey: process.env.ARMORIQ_API_KEY });
  await armoriq.bootstrap();
  const pgClient = await connectPostgresServer(process.env.DATABASE_URL);

  const session = armoriq.forUser(userEmail).startSession({
    mode: process.env.ARMORIQ_MODE || "sdk",
    defaultMcpName: process.env.POSTGRES_MCP_NAME || "postgres",
    validitySeconds: 2400,
  });

  const goal = process.argv.slice(2).join(" ") || "show me employee salaries";
  console.log(`Goal: ${goal}\n`);

  const result = await runStep(armoriq, session, pgClient, goal, {});
  if (result) console.log(JSON.stringify(result, null, 2));

  await session.flushObservability();
  await pgClient.close();
}

main();
```

## Step 10: Run it

```bash
node agent.js "show me employee salaries"
```

Sample output once the policy holds the query for review:

```
Goal: show me employee salaries

[HOLD] postgres__query: rule_action_hold
  delegation: 5cca8bf7-0bd6-439f-bea4-0d7f2c1116fb
```

Approve the delegation on the dashboard (or via the SDK's
`session.awaitApproval(delegationId)`), then run it again - or point the
agent at a goal the policy allows outright once you've reviewed the query
pattern and decided it's safe to loosen.

Try the destructive path too:

```bash
node agent.js "delete the welcome note"
```

```
[BLOCK] postgres__query: no_matching_policy
```

## Step 11: See it in the ArmorIQ dashboard

Open **Intent** in the console, filtered by your `USER_EMAIL`. Each run shows
up as a plan with its outcome (`Completed`, `Held`, `Blocked`) and the exact
SQL text that was submitted for review - this is what makes holding
arbitrary SQL actually usable: a reviewer isn't approving "a query", they're
reading the query.

## Troubleshooting

| Symptom | Likely cause |
|---|---|
| Every query is blocked, never held | Policy not yet activated, or the `target` in `policy.yaml` doesn't match the registered server's actual id |
| `dispatch()`/`mode: "proxy"` returns a 502 | The Postgres MCP server is stdio-transport; ArmorIQ's cloud proxy cannot reach it. Use `mode: "sdk"` and execute the call yourself, as in Step 9 |
| `ECONNREFUSED` connecting to Postgres | `docker compose up -d` hasn't finished starting, or `DATABASE_URL`'s port doesn't match `docker-compose.yml` |
| `npx` hangs on the first call | It's downloading `@modelcontextprotocol/server-postgres` for the first time; wait it out once, it's cached after |
| A `DELETE`/`UPDATE` fails even though the policy allowed it | The MCP server runs every statement in a read-only transaction by design - this is a second, independent control, not a bug |

## What's next

- **Tier the policy differently.** This guide holds every query uniformly because the tool surface can't distinguish safe from unsafe SQL by name. If your team is comfortable pre-approving read-only patterns, look at ArmorIQ's amount-threshold and time-restriction rule types in Policy Studio's Member Rules section for finer-grained control.
- **Swap in a real LLM-to-SQL planner.** See the [GitHub agent recipe](/cookbook/github-agent)'s `planWithGemini` for the pattern - only `src/planner.js` changes.
- **Combine with another MCP server.** A single ArmorIQ intent plan can span multiple MCP servers in one signed token - see the filesystem + memory cross-MCP pattern in the SDK docs for how a single plan/session targets more than one registered server.
