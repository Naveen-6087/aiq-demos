import dotenv from "dotenv";
import { ArmorIQClient } from "@armoriq/sdk";
import { connectGithubServer, callTool } from "./src/mcpClient.js";
import { planWithLlm } from "./src/planner.js";

dotenv.config();

const apiKey = process.env.ARMORIQ_API_KEY;
const githubToken = process.env.GITHUB_PERSONAL_ACCESS_TOKEN;
if (!apiKey || !githubToken) {
  console.error("[ERROR] ARMORIQ_API_KEY and GITHUB_PERSONAL_ACCESS_TOKEN are required.");
  process.exit(1);
}

const mcp = process.env.GITHUB_MCP_NAME || "github";
const userEmail = process.env.USER_EMAIL || "developer@armoriq.ai";
const armoriq = new ArmorIQClient({ apiKey });

function actionFromToolName(name) {
  const idx = name.indexOf("__");
  return idx === -1 ? name : name.slice(idx + 2);
}

console.log("=================================================");
console.log("  ARMORIQ SDK + GITHUB AGENT LIVE DEMO");
console.log("=================================================\n");

await armoriq.bootstrap();
const ghClient = await connectGithubServer(githubToken);
console.log("[INFO] GitHub MCP server connected.\n");

const session = armoriq.forUser(userEmail).startSession({ mode: "sdk", defaultMcpName: mcp, validitySeconds: 2400 });

const goal = process.argv.slice(2).join(" ") || `Search repositories for ${process.env.GITHUB_USER || "octocat"}`;
const toolCalls = await planWithLlm(goal);
console.log(`Goal: ${goal}`);
console.log(`Plan: ${toolCalls.map((c) => c.name).join(" -> ")}\n`);

const token = await session.startPlan(toolCalls, goal);

for (const call of toolCalls) {
  console.log("--------------------------------------------------");
  console.log(`Tool Target: ${call.name}`);
  console.log(`Args       : ${JSON.stringify(call.args)}`);

  const decision = await session.check(call.name, call.args, userEmail);

  if (!decision.allowed) {
    console.log(decision.action === "hold" ? "STATUS     : [HELD]" : "STATUS     : [BLOCKED]");
    console.log(`Reason     : ${decision.reason}`);
    if (decision.delegationId) console.log(`Delegation : ${decision.delegationId}`);
    continue;
  }

  console.log(`STATUS     : [ALLOWED] (${decision.matchedPolicy || "github-policy"})`);

  try {
    const result = await callTool(ghClient, actionFromToolName(call.name), call.args);
    await session.report(call.name, call.args, result, { status: "success" });
    console.log("Result     :", JSON.stringify(result, null, 2).slice(0, 500));
  } catch (execError) {
    await session.report(call.name, call.args, { error: execError.message }, { status: "failed", errorMessage: execError.message });
    console.error("Execution Error:", execError.message);
  }
}

console.log("--------------------------------------------------\n");
await session.flushObservability();
if (token?.planId) await armoriq.completePlan(token.planId).catch(() => {});
await ghClient.close();
console.log("DEMO COMPLETED");
