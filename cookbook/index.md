# Cookbook

Runnable, end-to-end recipes for building governed agents with ArmorIQ.

The Cookbook is where you go once you know what ArmorIQ does and want to see
a complete, working agent built with it, start to finish, including the
platform setup around the code. Each recipe is self-contained.

## Recipes

- **[Build a GitHub Agent with the ArmorIQ SDK](/cookbook/github-agent)** - a CLI agent that searches, reads, and explores a GitHub repository, with every action checked against policy.
- **[Build a Google ADK Agent with the ArmorIQ SDK](/cookbook/adk-agent)** - a Google Agent Development Kit agent wired with `ArmorIQADK`.
- **[Build a Postgres Agent with the ArmorIQ SDK](/cookbook/postgres-agent)** - a CLI agent that answers questions about a database in plain English, with every SQL query held for human review.
- **[Build a LangChain Agent with the ArmorIQ SDK](/cookbook/langchain-agent)** - a real LangChain tool-calling agent governed by the shipped `ArmorIQLangChain` callback handler, built around a live weather assistant.
- **[Build a Strands Agent with the ArmorIQ SDK](/cookbook/strands-agent)** - an AWS Strands Agents assistant governed by `ArmorIQStrands`, built around a support-desk domain with holds, refund thresholds, and a prompt-injection test you can actually run.
- **[Build a Crypto Prices Agent with the ArmorIQ SDK](/cookbook/crypto-agent)** - a crypto-prices assistant planned by a real Gemini call (not keyword matching), backed by a self-built CoinGecko MCP server.
- **[Build a CrewAI Crew with the ArmorIQ SDK](/cookbook/crewai-agent)** - a two-agent crypto research crew governed by `ArmorIQCrew`, ArmorIQ's narrowest adapter - includes a real, honestly-documented look at its proxy-only limitation.
