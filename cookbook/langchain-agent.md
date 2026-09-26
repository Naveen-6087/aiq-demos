# Build a LangChain Agent with the ArmorIQ SDK

A step-by-step guide to dropping ArmorIQ into a real LangChain tool-calling
agent using the SDK's shipped `ArmorIQLangChain` integration - not a
hand-rolled enforcement loop. Every tool call the agent's model chooses goes
through ArmorIQ's plan / token / policy / audit pipeline via one extra
callback passed at invocation time.

## What you'll build

A weather assistant: ask it what the weather's like somewhere, and it
searches for the place, then fetches current conditions for the coordinates
it gets back - two real, sequential tool calls chosen by the model itself,
each independently checked by ArmorIQ before it runs.

```
goal → model picks a tool call → ArmorIQ checks it → execute → result fed back to model → repeat until done
```

This is the "drop ArmorIQ into the framework you already use" pattern: the
agent, the tools, and the prompt are all plain LangChain. ArmorIQ is one
extra callback.

## Before you start

| Requirement | Why |
|---|---|
| Node.js v18 or later, and npm | Runs the agent |
| An ArmorIQ account | Policy enforcement and observability |
| A Gemini API key | Drives the LangChain agent's model calls |

```bash
node --version   # v18.0.0 or higher
npm --version    # v8.0.0 or higher
```

## Step 1: Create your ArmorIQ account and API key

1. Go to [platform.armoriq.ai](https://platform.armoriq.ai) and sign up/login.
2. Open **Settings → API Keys**.
3. Click **Generate new key** and copy it.

## Step 2: Get a Gemini API key

1. Go to [aistudio.google.com](https://aistudio.google.com).
2. Click **Create API key** and copy it.

Only the model construction in `agent.js` is Gemini-specific. Swap in
`@langchain/openai`'s `ChatOpenAI`, `@langchain/anthropic`'s
`ChatAnthropic`, or any other `@langchain/core`-compatible chat model and
everything else - the tools, `ArmorIQLangChain`, the agent - is unchanged.

## Step 3: Register a weather MCP server with ArmorIQ

1. In the ArmorIQ console, open **MCP Servers**.
2. Click **Add MCP Server**.
3. Name it `weather`.
4. Save.

This guide uses [`weather-mcp`](https://github.com/weather-mcp/weather-mcp),
a real, published, **keyless** MCP server (17 tools over NOAA/Open-Meteo) -
nothing to sign up for beyond the ArmorIQ and Gemini keys above. It's also
stdio-transport, the way every MCP host runs it, so this guide's agent runs
`mode: "sdk"` and spawns the server itself (Step 8) rather than
`mode: "proxy"`, which would try to route the call through ArmorIQ's cloud
proxy and 502 - the proxy has no network path to a stdio process on your
machine.

## Step 4: Write your first policy

1. In the console, open **Policies → Policy Studio → Single Policy**.
2. Set **Target Type** to `mcp_server`, **Target ID** to the `weather` server
   you just registered.
3. Set **Default enforcement action** to `block`.
4. Paste this into the YAML editor:

```yaml
name: weather-policy
version: v0.1.0
scope:
  target_type: mcp
  target: weather   # replace with your registered weather MCP server's id
  caller: all
default_action: block
priority: 50
rules:
  - tool: search_location
    action: allow
  - tool: get_current_conditions
    action: allow
```

5. Save and activate.

`weather-mcp` only exposes read-only public-data lookups - there's nothing
destructive or sensitive to gate, so this policy allows both tools outright,
unlike the tiered allow/hold/block policies in this cookbook's other
recipes. Not every integration needs holds; match the policy to what the
tool can actually do.

## Step 5: Scaffold the project

```bash
mkdir armoriq-langchain-agent && cd armoriq-langchain-agent
npm init -y
npm install @armoriq/sdk @modelcontextprotocol/sdk dotenv zod \
  langchain@^0.3 @langchain/core@^0.3 @langchain/google-genai@^0.2
mkdir src
touch .env src/mcpClient.js src/tools.js agent.js
```

<Callout type="warn">
  Pin `langchain`/`@langchain/core` to the 0.3.x line as shown above.
  `langchain@1.x` restructured the package and dropped
  `langchain/agents` (`createToolCallingAgent`/`AgentExecutor`) in favor of a
  new `createAgent` API - either works, but this guide's code targets the
  0.3.x shape, which is also what ArmorIQ's own integration docs show.
</Callout>

| Package | Purpose |
|---|---|
| `@armoriq/sdk` | The `ArmorIQLangChain` callback handler |
| `@modelcontextprotocol/sdk` | Spawns and talks to the local weather MCP server |
| `langchain`, `@langchain/core` | The tool-calling agent executor |
| `@langchain/google-genai` | Gemini chat model |
| `zod` | Tool argument schemas |

## Step 6: Configure environment variables

```
# .env

# From platform.armoriq.ai → Settings → API Keys
ARMORIQ_API_KEY=ak_your_key_here

# From aistudio.google.com
GEMINI_API_KEY=your_gemini_key_here
GEMINI_MODEL=gemini-flash-lite-latest

# Identifies this session in ArmorIQ's observability logs
USER_EMAIL=you@your-org.com

# Must match the name you registered in Step 3
WEATHER_MCP_NAME=weather
```

```bash
echo ".env" >> .gitignore
```

## Step 7: Connect to weather-mcp

```javascript
// src/mcpClient.js
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

export async function connectWeatherServer() {
  const transport = new StdioClientTransport({
    command: "npx",
    args: ["-y", "@dangahagan/weather-mcp@latest"],
  });

  const client = new Client(
    { name: "armoriq-langchain-weather-agent", version: "1.0.0" },
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

The first run downloads `weather-mcp` via `npx` - expect a short delay.

## Step 8: Wrap the MCP tools as LangChain tools

```javascript
// src/tools.js
import { tool } from "@langchain/core/tools";
import { z } from "zod";
import { callTool } from "./mcpClient.js";

// Tool names use ArmorIQ's "<mcp>__<action>" convention directly, so
// ArmorIQLangChain's plan/policy lookups resolve to the registered MCP
// server with no extra mapping.
export function buildWeatherTools(client) {
  const searchLocation = tool(
    async ({ query }) => {
      const result = await callTool(client, "search_location", { query, limit: 3 });
      return typeof result === "string" ? result : JSON.stringify(result);
    },
    {
      name: "weather__search_location",
      description: "Search for a place by name and get its latitude/longitude.",
      schema: z.object({ query: z.string().describe("Place name, e.g. a city or town") }),
    }
  );

  const getCurrentConditions = tool(
    async ({ latitude, longitude }) => {
      const result = await callTool(client, "get_current_conditions", { latitude, longitude });
      return typeof result === "string" ? result : JSON.stringify(result);
    },
    {
      name: "weather__get_current_conditions",
      description: "Get the most recent weather observation for a latitude/longitude.",
      schema: z.object({ latitude: z.number(), longitude: z.number() }),
    }
  );

  return [searchLocation, getCurrentConditions];
}
```

## Step 9: Build the agent

```javascript
// agent.js
import dotenv from "dotenv";
import { ChatGoogleGenerativeAI } from "@langchain/google-genai";
import { ChatPromptTemplate } from "@langchain/core/prompts";
import { AgentExecutor, createToolCallingAgent } from "langchain/agents";
import { ArmorIQClient } from "@armoriq/sdk";
import { ArmorIQLangChain } from "@armoriq/sdk/dist/integrations/langchain.js";
import { connectWeatherServer } from "./src/mcpClient.js";
import { buildWeatherTools } from "./src/tools.js";

dotenv.config();

const userEmail = process.env.USER_EMAIL || "developer@armoriq.ai";

const weatherClient = await connectWeatherServer();
const tools = buildWeatherTools(weatherClient);

// Once per process. "sdk" mode gets a real allow/hold/block decision from
// the backend (holds create an approvable delegation); this process
// executes each approved tool call itself against the locally-spawned MCP
// server - LangChain just supplies the tool-calling loop around it.
const armoriq = new ArmorIQLangChain({
  client: new ArmorIQClient({ apiKey: process.env.ARMORIQ_API_KEY }),
  mode: "sdk",
  defaultMcpName: process.env.WEATHER_MCP_NAME || "weather",
  validitySeconds: 2400,
});

const model = new ChatGoogleGenerativeAI({
  apiKey: process.env.GEMINI_API_KEY,
  model: process.env.GEMINI_MODEL || "gemini-flash-lite-latest",
  temperature: 0,
});

const prompt = ChatPromptTemplate.fromMessages([
  ["system", "You are a weather assistant. Search for the place first to get its coordinates, then fetch current conditions for those coordinates. Answer in one or two sentences."],
  ["human", "{input}"],
  ["placeholder", "{agent_scratchpad}"],
]);

const agent = await createToolCallingAgent({ llm: model, tools, prompt });
const agentExecutor = new AgentExecutor({ agent, tools, returnIntermediateSteps: true });

const goal = process.argv[2] || "What's the weather like right now in Bengaluru, India?";

// Per request: every tool call this invocation makes goes through ArmorIQ's
// plan / token / policy / audit pipeline via this one extra callback - no
// changes to the agent, the tools, or the prompt above.
const handler = await armoriq.forUser(userEmail, {
  goal,
  onEvent: (kind, payload) => console.log(`[ARMORIQ EVENT] ${kind}:`, JSON.stringify(payload)),
});

try {
  const result = await agentExecutor.invoke({ input: goal }, { callbacks: [handler] });
  console.log("\nFinal answer:", result.output);
} finally {
  await weatherClient.close();
}
```

## Step 10: Run it

```bash
node agent.js "What's the weather like in Tokyo right now?"
```

Sample output once the policy is active and both tools are allowed:

```
[ARMORIQ EVENT] block: {"tool":"weather__search_location","reason":"no_matching_policy"}
```

That's what you'll see *before* Step 4's policy is active - fail-closed by
default. Once the policy is saved and activated on the dashboard, the same
run instead executes both tool calls and prints a real answer.

## Step 11: See it in the ArmorIQ dashboard

Open **Intent** in the console, filtered by your `USER_EMAIL`. Each run shows
the two tool calls the model chose, in order, each with its own
allow/hold/block decision and matched policy - even though they came from a
single `agentExecutor.invoke()` call and a single LangChain callback
handler.

## Troubleshooting

| Symptom | Likely cause |
|---|---|
| `ERR_PACKAGE_PATH_NOT_EXPORTED: './agents'` | You installed `langchain@1.x`, which dropped that subpath. Pin to `^0.3` as shown in Step 5, or port to the new `createAgent` API |
| Model call fails with "no longer available to new users" | Some Gemini 2.x model ids are deprecated for new API keys; use `gemini-flash-lite-latest` or check `models.list` for what's currently available to your key |
| Everything gets blocked | Default policy is `block` with no matching rule; confirm Step 4's policy is saved *and* activated, and that its `target` matches the registered server's actual id |
| `dispatch()`/`mode: "proxy"` returns a 502 | `weather-mcp` is stdio-transport; ArmorIQ's cloud proxy cannot reach it. Use `mode: "sdk"`, as shown in Step 9 |
| Agent replies that it's "unable to retrieve" data after a block | Working as intended - the `ArmorIQLangChain` handler throws on block/hold-denied, LangChain surfaces it as a tool error, and the model explains the failure instead of crashing |

## What's next

- **Add live approval UI.** The `onEvent` callback streams `hold` / `approved` / `rejected` / `timeout` / `block` / `error` - wire it into a real UI instead of `console.log`.
- **Try the Strands recipe** for the Python side of the same pattern, with a domain built around holds and amount-threshold policy instead of an all-read-only tool surface.
- **Try the Postgres recipe** for a tool surface with exactly one tool that can do anything - a different, equally real policy problem.
