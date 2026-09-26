# GitHub Agent

A GitHub assistant, Gemini-planned, governed by ArmorIQ. Reads (search,
list, get file contents) are allowed; writes (PRs, file edits) are held;
`delete_repository` is blocked.

## Prerequisites

1. A `github` MCP server registered on your ArmorIQ dashboard.
2. An ArmorIQ API key.
3. A GitHub personal access token with `repo` scope.
4. A Gemini API key (optional - falls back to a small keyword planner).
5. The `github-policy` created against the registered server (see `policy.yaml`).

## Run

```bash
cp .env.example .env
npm install
npm run demo "search my repositories"
# or
npm start
```
