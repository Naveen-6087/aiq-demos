import dotenv from "dotenv";
import { ChatGoogleGenerativeAI } from "@langchain/google-genai";
import { createAgent } from "langchain";
import { ArmorIQClient } from "@armoriq/sdk";
import { ArmorIQLangChain } from "@armoriq/sdk/dist/integrations/langchain.js";
import { connectWeatherServer } from "./src/mcpClient.js";
import { buildWeatherTools } from "./src/tools.js";

dotenv.config();

const armoriqApiKey = process.env.ARMORIQ_API_KEY;
const geminiApiKey = process.env.GEMINI_API_KEY;
if (!armoriqApiKey) {
  console.error("[ERROR] ARMORIQ_API_KEY environment variable is required.");
  process.exit(1);
}
if (!geminiApiKey) {
  console.error("[ERROR] GEMINI_API_KEY environment variable is required.");
  process.exit(1);
}

const userEmail = process.env.USER_EMAIL || "developer@armoriq.ai";

console.log("=================================================");
console.log("  ARMORIQ SDK + LANGCHAIN WEATHER AGENT DEMO");
console.log("=================================================\n");

console.log("[1/5] Spawning the real weather-mcp server locally...");
const weatherClient = await connectWeatherServer();
const tools = buildWeatherTools(weatherClient);
console.log("[INFO] weather-mcp connected (search_location, get_current_conditions).\n");

console.log("[2/5] Setting up ArmorIQLangChain (once per process)...");
// mode: "sdk" (not "proxy") since this agent executes each approved tool call itself.
const armoriq = new ArmorIQLangChain({
  client: new ArmorIQClient({ apiKey: armoriqApiKey }),
  mode: "sdk",
  defaultMcpName: process.env.WEATHER_MCP_NAME || "weather",
  validitySeconds: 2400,
});
console.log("[INFO] ArmorIQLangChain ready.\n");

console.log("[3/5] Building the LangChain agent (createAgent)...");
const model = new ChatGoogleGenerativeAI({
  apiKey: geminiApiKey,
  model: process.env.GEMINI_MODEL || "gemini-flash-lite-latest",
  temperature: 0,
});

const agent = createAgent({
  model,
  tools,
  prompt: "You are a weather assistant. Search for the place first to get its coordinates, then fetch current conditions for those coordinates. Answer in one or two sentences.",
});
console.log("[INFO] Agent built.\n");

const goal = process.argv[2] || "What's the weather like right now in Bengaluru, India?";

console.log("[4/5] Per-request: minting an ArmorIQ-governed callback handler...");
// Every tool call goes through ArmorIQ's plan/token/policy/audit pipeline via this one callback.
const handler = await armoriq.forUser(userEmail, {
  goal,
  onEvent: (kind, payload) => console.log(`[ARMORIQ EVENT] ${kind}:`, JSON.stringify(payload)),
});
console.log(`[INFO] Goal: ${goal}\n`);

console.log("[5/5] Running the agent (every tool call is checked by ArmorIQ before it executes)...\n");
try {
  const result = await agent.invoke(
    { messages: [{ role: "user", content: goal }] },
    { callbacks: [handler] }
  );

  console.log("--------------------------------------------------");
  for (const message of result.messages) {
    if (message.getType?.() === "tool" || message._getType?.() === "tool") {
      console.log(`Tool result (${message.name}):`, String(message.content).slice(0, 300));
    }
  }
  const final = result.messages[result.messages.length - 1];
  console.log("--------------------------------------------------\n");
  console.log("Final answer:", final?.content ?? final);
} catch (error) {
  console.error("[ERROR] Agent run failed:", error.message);
} finally {
  await weatherClient.close();
}

console.log("\n=================================================");
console.log("  DEMO COMPLETED");
console.log("=================================================");
