import dotenv from "dotenv";
import { ArmorIQClient } from "@armoriq/sdk";
import { connectMemoryServer, callTool } from "./src/mcpClient.js";

dotenv.config();

const apiKey = process.env.ARMORIQ_API_KEY;
if (!apiKey) {
  console.error("[ERROR] ARMORIQ_API_KEY environment variable is required.");
  process.exit(1);
}

const mcp = process.env.MEMORY_MCP_NAME || "memory";
const userEmail = process.env.USER_EMAIL || "developer@armoriq.ai";
const armoriq = new ArmorIQClient({ apiKey });

function actionFromToolName(name) {
  const idx = name.indexOf("__");
  return idx === -1 ? name : name.slice(idx + 2);
}

console.log("=================================================");
console.log("  ARMORIQ SDK + MEMORY KNOWLEDGE-GRAPH AGENT DEMO");
console.log("=================================================\n");

console.log("[1/5] Bootstrapping ArmorIQ Client...");
await armoriq.bootstrap();
console.log("[INFO] ArmorIQ Client Bootstrapped.\n");

console.log("[2/5] Spawning local memory MCP server...");
const memClient = await connectMemoryServer(process.env.MEMORY_FILE_PATH);
console.log("[INFO] Memory MCP server connected.\n");

// mode: "sdk" - ArmorIQ decides allow/hold/block, this process executes the call (see mcpClient.js).
const session = armoriq.forUser(userEmail).startSession({
  mode: "sdk",
  defaultMcpName: mcp,
  validitySeconds: 2400,
});

const demoPlan = [
  {
    name: `${mcp}__create_entities`,
    args: {
      entities: [
        { name: "Isha", entityType: "person", observations: ["Building the ArmorIQ cookbook demos"] }
      ]
    },
    description: "Sensitive Operation: Write new facts into long-term memory"
  },
  {
    name: `${mcp}__search_nodes`,
    args: { query: "Isha" },
    description: "Read Operation: Recall what the agent knows"
  },
  {
    name: `${mcp}__delete_entities`,
    args: { entityNames: ["Isha"] },
    description: "Destructive Operation: Simulated prompt-injection attempt to wipe memory"
  }
];

console.log("[3/5] Committing Execution Plan to ArmorIQ (CSRG-IAP)...");
const token = await session.startPlan(demoPlan, `Memory session for ${userEmail}`);
console.log("[INFO] Signed Intent Token issued.\n");

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
      console.log(`Policy     : ${decision.matchedPolicy || "memory-knowledge-policy"}`);
    } else {
      console.log("STATUS     : [BLOCKED] BY ARMORIQ POLICY");
      console.log(`Action     : ${decision.action}`);
      console.log(`Reason     : ${decision.reason}`);
      console.log(`Policy     : ${decision.matchedPolicy || "default-block"}`);
    }
    continue;
  }

  console.log("STATUS     : [ALLOWED] BY ARMORIQ POLICY");
  console.log(`Policy Match: ${decision.matchedPolicy || "memory-knowledge-policy"}`);

  try {
    const result = await callTool(memClient, actionFromToolName(call.name), call.args);
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
await memClient.close();
console.log("[INFO] Observability flushed and plan completed.\n");
console.log("=================================================");
console.log("  DEMO COMPLETED SUCCESSFULLY");
console.log("  Note: delete_entities should be BLOCKED or HELD -");
console.log("  this is the point of the demo (protecting agent");
console.log("  memory from unattended wipes/prompt injection).");
console.log("=================================================");
