import path from "node:path";
import dotenv from "dotenv";
import { ArmorIQClient } from "@armoriq/sdk";
import { connectFilesystemServer, connectMemoryServer, makeRouter } from "./src/mcpClient.js";

dotenv.config();

const apiKey = process.env.ARMORIQ_API_KEY;
if (!apiKey) {
  console.error("[ERROR] ARMORIQ_API_KEY environment variable is required.");
  process.exit(1);
}

const fsMcp = process.env.FILESYSTEM_MCP_NAME || "filesystem";
const memMcp = process.env.MEMORY_MCP_NAME || "memory";
const sourceFile = process.env.SOURCE_FILE || "./research/source.md";
const researchDir = path.resolve(path.dirname(sourceFile));
const userEmail = process.env.USER_EMAIL || "developer@armoriq.ai";
const armoriq = new ArmorIQClient({ apiKey });

console.log("=================================================");
console.log("  ARMORIQ SDK + CROSS-MCP RESEARCH ASSISTANT DEMO");
console.log(`  filesystem MCP: ${fsMcp}   memory MCP: ${memMcp}`);
console.log("=================================================\n");

console.log("[1/5] Bootstrapping ArmorIQ Client...");
await armoriq.bootstrap();
console.log("[INFO] ArmorIQ Client Bootstrapped.\n");

console.log("[2/5] Spawning local filesystem + memory MCP servers...");
const fsClient = await connectFilesystemServer(researchDir);
const memClient = await connectMemoryServer(process.env.MEMORY_FILE_PATH);
console.log("[INFO] Both MCP servers connected.\n");

const callRoutedTool = makeRouter({
  filesystemMcpName: fsMcp,
  filesystemClient: fsClient,
  memoryMcpName: memMcp,
  memoryClient: memClient,
});

// mode: "sdk" - ArmorIQ decides allow/hold/block, this process executes the call.
const session = armoriq.forUser(userEmail).startSession({
  mode: "sdk",
  defaultMcpName: fsMcp,
  validitySeconds: 2400,
});

const demoPlan = [
  {
    name: `${fsMcp}__read_file`,
    // Must be absolute: a relative path resolves against the server's cwd, not this file's.
    args: { path: path.resolve(sourceFile) },
    description: "Read Operation (filesystem MCP): Read the source document"
  },
  {
    name: `${memMcp}__create_entities`,
    args: {
      entities: [
        { name: "research-source", entityType: "document", observations: [`Summarized from ${sourceFile}`] }
      ]
    },
    description: "Sensitive Operation (memory MCP): Store a summary as a new fact"
  },
  {
    name: `${memMcp}__search_nodes`,
    args: { query: "research-source" },
    description: "Read Operation (memory MCP): Recall what was just stored"
  }
];

console.log("[3/5] Committing ONE cross-MCP Execution Plan to ArmorIQ (CSRG-IAP)...");
const token = await session.startPlan(demoPlan, `Cross-MCP research session for ${userEmail}`);
console.log("[INFO] Signed Intent Token issued - covers both MCP servers in one plan.\n");

console.log("[4/5] Evaluating Live ArmorIQ Policy & Executing Allowed Actions...\n");

for (const call of demoPlan) {
  console.log("--------------------------------------------------");
  console.log(`Tool Target: ${call.name}`);
  console.log(`Description: ${call.description}`);

  const decision = await session.check(call.name, call.args, userEmail);

  if (!decision.allowed) {
    if (decision.action === "hold") {
      console.log("STATUS     : [HELD] (HUMAN APPROVAL REQUIRED)");
      console.log(`Delegation : ${decision.delegationId || "pending-approval"}`);
      console.log(`Reason     : ${decision.reason}`);
      console.log(`Policy     : ${decision.matchedPolicy || "cross-mcp-research-policy"}`);
    } else {
      console.log("STATUS     : [BLOCKED] BY ARMORIQ POLICY");
      console.log(`Action     : ${decision.action}`);
      console.log(`Reason     : ${decision.reason}`);
      console.log(`Policy     : ${decision.matchedPolicy || "default-block"}`);
    }
    continue;
  }

  console.log("STATUS     : [ALLOWED] BY ARMORIQ POLICY");
  console.log(`Policy Match: ${decision.matchedPolicy || "cross-mcp-research-policy"}`);

  try {
    const result = await callRoutedTool(call.name, call.args);
    await session.report(call.name, call.args, result, { status: "success" });
    console.log("Result     :", JSON.stringify(result, null, 2));
  } catch (execError) {
    await session.report(call.name, call.args, { error: execError.message }, {
      status: "failed",
      errorMessage: execError.message,
    });
    console.error("Execution Error:", execError.message);
  }
}

console.log("--------------------------------------------------\n");
console.log("[5/5] Draining Observability Traces & Completing Plan...");
await session.flushObservability();
if (token?.planId) {
  await armoriq.completePlan(token.planId).catch((err) => {
    console.warn("[WARNING] completePlan failed:", err.message);
  });
}
await fsClient.close();
await memClient.close();
console.log("[INFO] Observability flushed and plan completed.\n");
console.log("=================================================");
console.log("  DEMO COMPLETED SUCCESSFULLY");
console.log("  One signed plan, two MCP servers, one policy check");
console.log("  per step regardless of which server it targets.");
console.log("=================================================");
