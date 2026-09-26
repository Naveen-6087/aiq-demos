import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

// stdio-transport server, so mode:"proxy" dispatch() 502s against it; this module spawns it locally and the caller executes approved calls itself.
export async function connectPostgresServer(databaseUrl) {
  const transport = new StdioClientTransport({
    command: "npx",
    // Takes the connection string as a positional arg, not an env var.
    args: ["-y", "@modelcontextprotocol/server-postgres", databaseUrl],
  });

  const client = new Client(
    { name: "armoriq-postgres-notes-agent", version: "1.0.0" },
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
