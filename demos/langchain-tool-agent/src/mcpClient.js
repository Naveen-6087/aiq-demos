import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

// ArmorIQ only makes the allow/hold/block decision (agent.js); this process spawns the MCP server and executes approved calls itself.
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

export async function listTools(client) {
  const result = await client.listTools();
  return result.tools;
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
