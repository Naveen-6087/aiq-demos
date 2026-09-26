import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

// Stdio servers must be spawned locally: ArmorIQ's cloud proxy can't reach a
// stdio process on this machine, so session.dispatch() 502s against them.
export async function connectFilesystemServer(allowedDir) {
  const transport = new StdioClientTransport({
    command: "npx",
    args: ["-y", "@modelcontextprotocol/server-filesystem", allowedDir],
  });
  const client = new Client(
    { name: "armoriq-cross-mcp-research-agent-fs", version: "1.0.0" },
    { capabilities: {} }
  );
  await client.connect(transport);
  return client;
}

export async function connectMemoryServer(memoryFilePath) {
  const transport = new StdioClientTransport({
    command: "npx",
    args: ["-y", "@modelcontextprotocol/server-memory"],
    env: memoryFilePath
      ? { ...process.env, MEMORY_FILE_PATH: memoryFilePath }
      : process.env,
  });
  const client = new Client(
    { name: "armoriq-cross-mcp-research-agent-mem", version: "1.0.0" },
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

// Routes a "<mcp>__<action>" tool name to the right locally-connected client.
export function makeRouter({ filesystemMcpName, filesystemClient, memoryMcpName, memoryClient }) {
  return async function callRoutedTool(toolName, args) {
    const idx = toolName.indexOf("__");
    const mcp = idx === -1 ? null : toolName.slice(0, idx);
    const action = idx === -1 ? toolName : toolName.slice(idx + 2);

    if (mcp === filesystemMcpName) return callTool(filesystemClient, action, args);
    if (mcp === memoryMcpName) return callTool(memoryClient, action, args);
    throw new Error(`No local MCP client wired up for "${toolName}" (mcp="${mcp}")`);
  };
}
