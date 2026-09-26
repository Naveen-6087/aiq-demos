import path from "node:path";
import dotenv from "dotenv";

dotenv.config();

const fsMcp = process.env.FILESYSTEM_MCP_NAME || "filesystem";
const memMcp = process.env.MEMORY_MCP_NAME || "memory";
const sourceFile = process.env.SOURCE_FILE || "./research/source.md";
// Must be absolute: a relative path resolves against the server's cwd, not this file's.
const absoluteSourceFile = path.resolve(sourceFile);
const absoluteResearchDir = path.dirname(absoluteSourceFile);

export async function planWithLlm(goal, providedToolCalls = null) {
  if (Array.isArray(providedToolCalls) && providedToolCalls.length > 0) {
    return providedToolCalls;
  }

  const goalLower = (goal || "").toLowerCase();

  if (goalLower.includes("research") || goalLower.includes("summarize") || goalLower.includes("read")) {
    return [
      {
        name: `${fsMcp}__read_file`,
        args: { path: absoluteSourceFile }
      },
      {
        name: `${memMcp}__create_entities`,
        args: {
          entities: [
            {
              name: "research-source",
              entityType: "document",
              observations: [`Summarized from ${sourceFile}`]
            }
          ]
        }
      },
      {
        name: `${memMcp}__search_nodes`,
        args: { query: "research-source" }
      }
    ];
  }

  return [
    {
      name: `${fsMcp}__list_directory`,
      args: { path: absoluteResearchDir }
    },
    {
      name: `${memMcp}__read_graph`,
      args: {}
    }
  ];
}
