import { tool } from "@langchain/core/tools";
import { z } from "zod";
import { callTool } from "./mcpClient.js";

// Tool names use ArmorIQ's "<mcp>__<action>" convention so plan/policy lookups resolve without extra mapping.
export function buildWeatherTools(client) {
  const searchLocation = tool(
    async ({ query }) => {
      const result = await callTool(client, "search_location", { query, limit: 3 });
      return typeof result === "string" ? result : JSON.stringify(result);
    },
    {
      name: "weather__search_location",
      description: "Search for a place by name and get its latitude/longitude.",
      schema: z.object({
        query: z.string().describe("Place name, e.g. a city or town"),
      }),
    }
  );

  const getCurrentConditions = tool(
    async ({ latitude, longitude }) => {
      const result = await callTool(client, "get_current_conditions", { latitude, longitude });
      return typeof result === "string" ? result : JSON.stringify(result);
    },
    {
      name: "weather__get_current_conditions",
      description: "Get the most recent weather observation for a latitude/longitude.",
      schema: z.object({
        latitude: z.number(),
        longitude: z.number(),
      }),
    }
  );

  return [searchLocation, getCurrentConditions];
}
