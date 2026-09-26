import express from "express";
import dotenv from "dotenv";
import { ArmorIQClient } from "@armoriq/sdk";
import { planWithLlm } from "./planner.js";
import { connectMemoryServer, callTool } from "./mcpClient.js";

dotenv.config();

const apiKey = process.env.ARMORIQ_API_KEY;
if (!apiKey) {
  console.error("[ERROR] ARMORIQ_API_KEY environment variable is required.");
  process.exit(1);
}

const app = express();
app.use(express.json());

const armoriq = new ArmorIQClient({ apiKey });

console.log("[INFO] Initializing ArmorIQ Client...");
try {
  await armoriq.bootstrap();
  console.log("[INFO] ArmorIQ Client bootstrapped successfully.");
} catch (err) {
  console.warn("[WARNING] Bootstrap warning:", err.message);
}

console.log("[INFO] Spawning local memory MCP server...");
const memClient = await connectMemoryServer(process.env.MEMORY_FILE_PATH);
console.log("[INFO] Memory MCP server connected.");

// Strips the "<mcp>__" prefix ArmorIQ's plan uses back to the raw MCP tool name.
function actionFromToolName(name) {
  const idx = name.indexOf("__");
  return idx === -1 ? name : name.slice(idx + 2);
}

app.get("/health", (req, res) => {
  res.json({
    status: "ok",
    service: "armoriq-memory-knowledge-agent",
    apiKeyConfigured: !!apiKey
  });
});

app.post("/agent", async (req, res) => {
  const {
    userEmail = process.env.USER_EMAIL || "developer@armoriq.ai",
    goal = "What do you know about me?",
    // mode: "sdk" - ArmorIQ decides allow/hold/block, this process executes the call (see mcpClient.js).
    mode = process.env.ARMORIQ_MODE || "sdk",
    defaultMcpName = process.env.MEMORY_MCP_NAME || "memory",
    toolCalls: customToolCalls
  } = req.body;

  try {
    const session = armoriq.forUser(userEmail).startSession({
      mode,
      defaultMcpName,
      validitySeconds: 2400,
    });

    const toolCalls = await planWithLlm(goal, customToolCalls);

    const token = await session.startPlan(toolCalls, goal);

    const results = [];
    for (const call of toolCalls) {
      const decision = await session.check(call.name, call.args ?? {}, userEmail);

      if (!decision.allowed) {
        results.push({
          tool: call.name,
          action: decision.action,
          reason: decision.reason,
          matchedPolicy: decision.matchedPolicy,
          delegationId: decision.delegationId,
        });
        continue;
      }

      let result;
      try {
        result = await callTool(memClient, actionFromToolName(call.name), call.args ?? {});
        await session.report(call.name, call.args ?? {}, result, { status: "success" });
      } catch (execError) {
        result = { error: execError.message };
        await session.report(call.name, call.args ?? {}, result, {
          status: "failed",
          errorMessage: execError.message,
        });
      }

      results.push({ tool: call.name, action: "allow", matchedPolicy: decision.matchedPolicy, result });
    }

    await session.flushObservability();

    // Without this the plan stays open indefinitely in Plans Governance.
    if (token?.planId) {
      await armoriq.completePlan(token.planId).catch((err) => {
        console.warn("[WARNING] completePlan failed:", err.message);
      });
    }

    res.json({ goal, mode, results });
  } catch (error) {
    console.error("[ERROR] Agent execution error:", error);
    res.status(500).json({ error: error.message });
  }
});

const port = process.env.PORT || 3002;
app.listen(port, () => {
  console.log(`[INFO] Memory knowledge agent running on http://localhost:${port}`);
});

process.on("SIGINT", async () => {
  await memClient.close();
  process.exit(0);
});
