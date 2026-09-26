import express from "express";
import dotenv from "dotenv";
import { ArmorIQClient } from "@armoriq/sdk";
import { planWithLlm } from "./planner.js";
import { connectPostgresServer, callTool } from "./mcpClient.js";

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

console.log("[INFO] Spawning local postgres MCP server...");
const pgClient = await connectPostgresServer(databaseUrl);
console.log("[INFO] Postgres MCP server connected.");

// Strips the "<mcp>__" prefix ArmorIQ's plan uses to get the raw MCP tool name.
function actionFromToolName(name) {
  const idx = name.indexOf("__");
  return idx === -1 ? name : name.slice(idx + 2);
}

app.get("/health", (req, res) => {
  res.json({
    status: "ok",
    service: "armoriq-postgres-notes-agent",
    apiKeyConfigured: !!apiKey
  });
});

app.post("/agent", async (req, res) => {
  const {
    userEmail = process.env.USER_EMAIL || "developer@armoriq.ai",
    goal = "Show my notes",
    // "sdk" mode: ArmorIQ decides allow/hold/block; this process executes the call itself.
    mode = process.env.ARMORIQ_MODE || "sdk",
    defaultMcpName = process.env.POSTGRES_MCP_NAME || "postgres",
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
        result = await callTool(pgClient, actionFromToolName(call.name), call.args ?? {});
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

const port = process.env.PORT || 3004;
app.listen(port, () => {
  console.log(`[INFO] Postgres notes agent running on http://localhost:${port}`);
});

process.on("SIGINT", async () => {
  await pgClient.close();
  process.exit(0);
});
