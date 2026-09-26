import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

// stdio-transport MCP server - ArmorIQ's cloud proxy can't reach it (502s), so it's spawned and run locally instead (mode: "sdk").
export async function connectMemoryServer(memoryFilePath) {
  const transport = new StdioClientTransport({
    command: "npx",
    args: ["-y", "@modelcontextprotocol/server-memory"],
    env: memoryFilePath
      ? { ...process.env, MEMORY_FILE_PATH: memoryFilePath }
      : process.env,
  });

  const client = new Client(
    { name: "armoriq-memory-knowledge-agent", version: "1.0.0" },
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
