import dotenv from "dotenv";
import { ArmorIQClient } from "@armoriq/sdk";
import { connectPostgresServer, callTool } from "./src/mcpClient.js";

dotenv.config();

const apiKey = process.env.ARMORIQ_API_KEY;
if (!apiKey) {
  console.error("[ERROR] ARMORIQ_API_KEY environment variable is required.");
  process.exit(1);
}

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  console.error("[ERROR] DATABASE_URL environment variable is required.");
  process.exit(1);
}

const mcp = process.env.POSTGRES_MCP_NAME || "postgres";
const userEmail = process.env.USER_EMAIL || "developer@armoriq.ai";
const armoriq = new ArmorIQClient({ apiKey });

function actionFromToolName(name) {
  const idx = name.indexOf("__");
  return idx === -1 ? name : name.slice(idx + 2);
}

console.log("=================================================");
console.log("  ARMORIQ SDK + POSTGRES NOTES AGENT LIVE DEMO");
console.log("=================================================\n");

console.log("[1/5] Bootstrapping ArmorIQ Client...");
await armoriq.bootstrap();
console.log("[INFO] ArmorIQ Client Bootstrapped.\n");

console.log("[2/5] Spawning local postgres MCP server...");
const pgClient = await connectPostgresServer(databaseUrl);
console.log("[INFO] Postgres MCP server connected.\n");

// "sdk" mode: ArmorIQ decides allow/hold/block; this process executes the call itself (proxy mode can't reach a stdio server, see mcpClient.js).
const session = armoriq.forUser(userEmail).startSession({
  mode: "sdk",
  defaultMcpName: mcp,
  validitySeconds: 2400,
});

const demoPlan = [
  {
    name: `${mcp}__query`,
    args: { sql: "SELECT id, title, body FROM notes ORDER BY id" },
    description: "Read Operation: SELECT from the notes table"
  },
  {
    name: `${mcp}__query`,
    args: { sql: "SELECT name, department, salary FROM employees ORDER BY salary DESC" },
    description: "Sensitive Read: SELECT includes a salary column"
  },
  {
    name: `${mcp}__query`,
    args: { sql: "DELETE FROM notes WHERE id = 1" },
    description: "Destructive Operation: DELETE a row"
  }
];

console.log("[3/5] Committing Execution Plan to ArmorIQ (CSRG-IAP)...");
const token = await session.startPlan(demoPlan, `Postgres notes session for ${userEmail}`);
console.log("[INFO] Signed Intent Token issued.\n");

console.log("[4/5] Evaluating Live ArmorIQ Policy & Executing Allowed Actions...\n");

for (const call of demoPlan) {
  console.log("--------------------------------------------------");
  console.log(`Tool Target: ${call.name}`);
  console.log(`Description: ${call.description}`);
  console.log(`SQL        : ${call.args.sql}`);

  const decision = await session.check(call.name, call.args, userEmail);

  if (!decision.allowed) {
    if (decision.action === "hold") {
      console.log("STATUS     : [HELD] (HUMAN APPROVAL REQUIRED)");
      console.log(`Delegation : ${decision.delegationId || "pending-approval"}`);
      console.log(`Reason     : ${decision.reason}`);
      console.log(`Policy     : ${decision.matchedPolicy || "postgres-policy"}`);
    } else {
      console.log("STATUS     : [BLOCKED] BY ARMORIQ POLICY");
      console.log(`Action     : ${decision.action}`);
      console.log(`Reason     : ${decision.reason}`);
      console.log(`Policy     : ${decision.matchedPolicy || "default-block"}`);
    }
    continue;
  }

  console.log("STATUS     : [ALLOWED] BY ARMORIQ POLICY");
  console.log(`Policy Match: ${decision.matchedPolicy || "postgres-policy"}`);

  try {
    const result = await callTool(pgClient, actionFromToolName(call.name), call.args);
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
await pgClient.close();
console.log("[INFO] Observability flushed and plan completed.\n");
console.log("=================================================");
console.log("  DEMO COMPLETED SUCCESSFULLY");
console.log("  Note: the DELETE should be HELD or BLOCKED, and");
console.log("  the postgres MCP server itself runs every query");
console.log("  inside a READ ONLY transaction regardless of");
console.log("  policy - two independent layers of defense.");
console.log("=================================================");
