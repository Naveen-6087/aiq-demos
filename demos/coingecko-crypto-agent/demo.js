import dotenv from "dotenv";
import { ArmorIQClient } from "@armoriq/sdk";
import { connectCoingeckoServer, callTool } from "./src/mcpClient.js";
import { planWithLlm } from "./src/planner.js";

dotenv.config();

const apiKey = process.env.ARMORIQ_API_KEY;
if (!apiKey) {
  console.error("[ERROR] ARMORIQ_API_KEY environment variable is required.");
  process.exit(1);
}

const mcp = process.env.COINGECKO_MCP_NAME || "coingecko";
const userEmail = process.env.USER_EMAIL || "developer@armoriq.ai";
const armoriq = new ArmorIQClient({ apiKey });

function actionFromToolName(name) {
  const idx = name.indexOf("__");
  return idx === -1 ? name : name.slice(idx + 2);
}

console.log("=================================================");
console.log("  ARMORIQ SDK + COINGECKO CRYPTO AGENT LIVE DEMO");
console.log("=================================================\n");

console.log("[1/5] Bootstrapping ArmorIQ Client...");
await armoriq.bootstrap();
console.log("[INFO] ArmorIQ Client Bootstrapped.\n");

console.log("[2/5] Spawning local CoinGecko MCP server...");
const cgClient = await connectCoingeckoServer(process.env.COINGECKO_API_KEY);
console.log("[INFO] CoinGecko MCP server connected.\n");

const session = armoriq.forUser(userEmail).startSession({
  mode: "sdk",
  defaultMcpName: mcp,
  validitySeconds: 2400,
});

const goal = process.argv.slice(2).join(" ") || "What's the price of Bitcoin and Ethereum right now, and how are they doing over the last 24 hours?";

console.log("[3/5] Planning with Gemini...");
const toolCalls = await planWithLlm(goal);
console.log(`[INFO] Goal: ${goal}`);
console.log(`[INFO] Plan: ${toolCalls.map((c) => c.name).join(" -> ")}\n`);

console.log("[4/5] Committing Execution Plan to ArmorIQ (CSRG-IAP)...");
const token = await session.startPlan(toolCalls, goal);
console.log("[INFO] Signed Intent Token issued.\n");

console.log("Evaluating Live ArmorIQ Policy & Executing Allowed Actions...\n");

for (const call of toolCalls) {
  console.log("--------------------------------------------------");
  console.log(`Tool Target: ${call.name}`);
  console.log(`Args       : ${JSON.stringify(call.args)}`);

  const decision = await session.check(call.name, call.args, userEmail);

  if (!decision.allowed) {
    if (decision.action === "hold") {
      console.log("STATUS     : [HELD] (HUMAN APPROVAL REQUIRED)");
      console.log(`Delegation : ${decision.delegationId || "pending-approval"}`);
      console.log(`Reason     : ${decision.reason}`);
    } else {
      console.log("STATUS     : [BLOCKED] BY ARMORIQ POLICY");
      console.log(`Reason     : ${decision.reason}`);
    }
    continue;
  }

  console.log("STATUS     : [ALLOWED] BY ARMORIQ POLICY");
  console.log(`Policy Match: ${decision.matchedPolicy || "coingecko-policy"}`);

  try {
    const result = await callTool(cgClient, actionFromToolName(call.name), call.args);
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
await cgClient.close();
console.log("[INFO] Observability flushed and plan completed.\n");
console.log("=================================================");
console.log("  DEMO COMPLETED SUCCESSFULLY");
console.log("=================================================");
