import path from "node:path";
import express from "express";
import dotenv from "dotenv";
import { ArmorIQClient } from "@armoriq/sdk";
import { planWithLlm } from "./planner.js";
import { connectFilesystemServer, connectMemoryServer, makeRouter } from "./mcpClient.js";

dotenv.config();

const apiKey = process.env.ARMORIQ_API_KEY;
if (!apiKey) {
  console.error("[ERROR] ARMORIQ_API_KEY environment variable is required.");
  process.exit(1);
}

const fsMcp = process.env.FILESYSTEM_MCP_NAME || "filesystem";
const memMcp = process.env.MEMORY_MCP_NAME || "memory";
const researchDir = path.resolve(path.dirname(process.env.SOURCE_FILE || "./research/source.md"));

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

console.log("[INFO] Spawning local filesystem + memory MCP servers...");
const fsClient = await connectFilesystemServer(researchDir);
const memClient = await connectMemoryServer(process.env.MEMORY_FILE_PATH);
console.log("[INFO] Both MCP servers connected.");

const callRoutedTool = makeRouter({
  filesystemMcpName: fsMcp,
  filesystemClient: fsClient,
  memoryMcpName: memMcp,
  memoryClient: memClient,
});

app.get("/health", (req, res) => {
  res.json({
    status: "ok",
    service: "armoriq-cross-mcp-research-agent",
    apiKeyConfigured: !!apiKey
  });
});

app.post("/agent", async (req, res) => {
  const {
    userEmail = process.env.USER_EMAIL || "developer@armoriq.ai",
    goal = "Research and remember the source file",
    // mode: "sdk" - ArmorIQ decides allow/hold/block, this process executes the call.
    mode = process.env.ARMORIQ_MODE || "sdk",
    defaultMcpName = fsMcp,
    toolCalls: customToolCalls
  } = req.body;

  try {
    const session = armoriq.forUser(userEmail).startSession({
      mode,
      defaultMcpName,
      validitySeconds: 2400,
    });

    const toolCalls = await planWithLlm(goal, customToolCalls);

    // One signed intent token covers every step below, across both MCP servers.
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
        result = await callRoutedTool(call.name, call.args ?? {});
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

const port = process.env.PORT || 3003;
app.listen(port, () => {
  console.log(`[INFO] Cross-MCP research agent running on http://localhost:${port}`);
});

process.on("SIGINT", async () => {
  await fsClient.close();
  await memClient.close();
  process.exit(0);
});
