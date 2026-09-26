import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

export async function connectGithubServer(githubToken) {
  const transport = new StdioClientTransport({
    command: "npx",
    args: ["-y", "@modelcontextprotocol/server-github"],
    env: { ...process.env, GITHUB_PERSONAL_ACCESS_TOKEN: githubToken },
  });

  const client = new Client(
    { name: "armoriq-github-agent", version: "1.0.0" },
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
