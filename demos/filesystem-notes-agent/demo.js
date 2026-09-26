import path from "node:path";
import dotenv from "dotenv";
import { ArmorIQClient } from "@armoriq/sdk";
import { connectFilesystemServer, callTool } from "./src/mcpClient.js";

dotenv.config();

const apiKey = process.env.ARMORIQ_API_KEY;
if (!apiKey) {
  console.error("[ERROR] ARMORIQ_API_KEY environment variable is required.");
  process.exit(1);
}

const mcp = process.env.FILESYSTEM_MCP_NAME || "filesystem";
const notesDir = path.resolve(process.env.NOTES_DIR || "./notes");
const userEmail = process.env.USER_EMAIL || "developer@armoriq.ai";
const armoriq = new ArmorIQClient({ apiKey });

function actionFromToolName(name) {
  const idx = name.indexOf("__");
  return idx === -1 ? name : name.slice(idx + 2);
}

console.log("=================================================");
console.log("  ARMORIQ SDK + FILESYSTEM NOTES AGENT LIVE DEMO");
console.log(`  Notes directory: ${notesDir}`);
console.log("=================================================\n");

console.log("[1/5] Bootstrapping ArmorIQ Client...");
await armoriq.bootstrap();
console.log("[INFO] ArmorIQ Client Bootstrapped.\n");

console.log("[2/5] Spawning local filesystem MCP server...");
const fsClient = await connectFilesystemServer(notesDir);
console.log("[INFO] Filesystem MCP server connected.\n");

// mode: "sdk" - ArmorIQ only decides allow/hold/block; this process executes the call itself (see src/mcpClient.js).
const session = armoriq.forUser(userEmail).startSession({
  mode: "sdk",
  defaultMcpName: mcp,
  validitySeconds: 2400,
});

const demoPlan = [
  {
    name: `${mcp}__list_directory`,
    args: { path: notesDir },
    description: "Read Operation: List notes directory"
  },
  {
    name: `${mcp}__write_file`,
    args: { path: `${notesDir}/meeting-notes.md`, content: "# Meeting Notes\n\nDrafted by the ArmorIQ agent." },
    description: "Sensitive Operation: Write a new note file"
  },
  {
    name: `${mcp}__move_file`,
    args: { source: `${notesDir}/meeting-notes.md`, destination: `${notesDir}/archive/meeting-notes.md` },
    description: "Sensitive Operation: Move/rename a file"
  }
];

console.log("[3/5] Committing Execution Plan to ArmorIQ (CSRG-IAP)...");
const token = await session.startPlan(demoPlan, `Filesystem notes session for ${userEmail}`);
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
      console.log(`Policy     : ${decision.matchedPolicy || "filesystem-notes-policy"}`);
    } else {
      console.log("STATUS     : [BLOCKED] BY ARMORIQ POLICY");
      console.log(`Action     : ${decision.action}`);
      console.log(`Reason     : ${decision.reason}`);
      console.log(`Policy     : ${decision.matchedPolicy || "default-block"}`);
    }
    continue;
  }

  console.log("STATUS     : [ALLOWED] BY ARMORIQ POLICY");
  console.log(`Policy Match: ${decision.matchedPolicy || "filesystem-notes-policy"}`);

  try {
    const result = await callTool(fsClient, actionFromToolName(call.name), call.args);
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
console.log("[INFO] Observability flushed and plan completed.\n");
console.log("=================================================");
console.log("  DEMO COMPLETED SUCCESSFULLY");
console.log("=================================================");
