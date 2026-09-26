import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

// ArmorIQ's cloud proxy can't reach this stdio-transport server (session.dispatch() 502s, confirmed empirically) - so this module spawns it locally and mode: "sdk" is used instead.
export async function connectFilesystemServer(allowedDir) {
  const transport = new StdioClientTransport({
    command: "npx",
    args: ["-y", "@modelcontextprotocol/server-filesystem", allowedDir],
  });

  const client = new Client(
    { name: "armoriq-filesystem-notes-agent", version: "1.0.0" },
    { capabilities: {} }
  );

  await client.connect(transport);
  return client;
}

// Unwraps the MCP content-block result into a plain JS value.
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
