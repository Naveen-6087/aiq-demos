import path from "node:path";
import { fileURLToPath } from "node:url";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Stdio-transport server, so this process spawns and calls it directly; mode:"sdk" leaves the allow/hold/block decision to ArmorIQ.
export async function connectCoingeckoServer(apiKey) {
  const transport = new StdioClientTransport({
    command: "node",
    args: [path.join(__dirname, "..", "coingecko-mcp-server.js")],
    env: apiKey ? { ...process.env, COINGECKO_API_KEY: apiKey } : process.env,
  });

  const client = new Client(
    { name: "armoriq-coingecko-crypto-agent", version: "1.0.0" },
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
