# CrewAI Crypto Research Crew

A two-agent CrewAI crew - a researcher who pulls live crypto prices, a
writer who turns them into a daily brief - governed by `ArmorIQCrew`, the
narrowest of ArmorIQ's four framework adapters. This is the one recipe in
this cookbook where you should read the whole README before running
anything, because CrewAI's adapter genuinely works differently from the
other three.

## What it demonstrates - and its real limitation

Google ADK, Strands, and LangChain all have per-tool-call lifecycle hooks
ArmorIQ can attach to. CrewAI doesn't. So `ArmorIQCrew` works around that by
directly patching the `_run` method of any tool that carries `.mcp` and
`.action` attributes (see `crypto_tool.py`) so its execution routes through
**ArmorIQ's cloud proxy** instead of calling out directly.

That's a real architectural difference from every other recipe in this
cookbook:

| | Google ADK / Strands / LangChain | CrewAI |
|---|---|---|
| Enforcement point | Lifecycle hooks, works with `mode: "sdk"` (local execution) | Patches the tool call itself, **proxy-only** |
| Needs a network-reachable MCP server | No - `mode: "sdk"` runs it locally | **Yes** - the proxy has to actually reach it |
| Per-user scoping | Yes | No - the whole crew runs as one identity |
| Per-call policy (allow/hold/block) | Yes | No - see [Limitations](#limitations) below |

We tested this against our own `coingecko` MCP server (a local stdio
process, same as every other demo in this cookbook) and got exactly what
that table predicts:

```
I encountered an error while trying to use the tool. This was the error:
MCP invocation failed: {'success': False, 'error': 'Internal Proxy Error', ...}
```

**This isn't a bug - it's the documented limitation, observed.** ArmorIQ's
cloud proxy has no network path to a stdio process running on your laptop.
To get a real allow instead of that error, you'd need to deploy
`coingecko-mcp-server.js` somewhere the proxy can actually reach it (an
HTTP-wrapped version on Render, Cloud Run, or similar - see [MCP Format
Requirements](https://docs.armoriq.ai/sdk/mcp-directory/mcp-format)) and
register *that* URL instead of relying on local stdio spawn.

What you get without deploying anything: intent verification (a plan is
captured and a token minted from your crew's tools/tasks before anything
runs) and an audit trail - not live policy gating. If you need per-call
enforcement, holds, or approvals on a CrewAI-style multi-agent setup, drive
`ArmorIQSession` directly from inside a custom tool instead (see the
Strands or LangChain recipes in this cookbook for that pattern) rather than
using `ArmorIQCrew`.

## What actually happens when you run it

Because the writer agent's backstory says "only reports numbers it actually
looked up, never guesses," the crew doesn't hallucinate a fake price when
the tool call fails - it explains that it couldn't get real data:

> Today's crypto market data is temporarily unavailable due to a technical
> glitch with our price-tracking tools... Because we rely strictly on
> verified live data rather than estimates, we cannot confirm whether the
> major coins are currently trading in the green or the red.

That's the fail-closed behavior working as intended, one level up: even
when the *infrastructure* isn't fully wired (no deployed MCP server), the
crew still refuses to fabricate an answer.

## Prerequisites

1. Python 3.10+.
2. A `coingecko` MCP server registered on your ArmorIQ dashboard, matching
   the [CoinGecko recipe](/cookbook/crypto-agent)'s server - to get a real
   `allow` instead of the proxy error above, it needs to be deployed
   somewhere network-reachable, not run as a local stdio process.
3. An ArmorIQ API key and a Gemini API key (same as the other recipes).
4. Optionally, a CoinGecko API key (free Demo tier) - keyless access works
   for the unwrapped comparison script, just slower.

## Run

```bash
python -m venv .venv
.venv\Scripts\activate          # Windows; use `source .venv/bin/activate` on macOS/Linux
pip install -r requirements.txt
cp .env.example .env             # fill in ARMORIQ_API_KEY, GEMINI_API_KEY

python crew_unwrapped.py          # step 1: confirm the crew works with no ArmorIQ involved
python crew.py                    # step 2: see what changes once ArmorIQCrew wraps it
```

## Limitations

Straight from ArmorIQ's own SDK docs, and confirmed by the run above:

- No per-user scoping (`for_user(email)`) - the whole crew runs as one identity.
- No per-call policy enforcement, holds, or approvals.
- One token covers the whole `kickoff()` run, so its validity has to span the entire crew run (default: 1 hour, not the SDK's usual 60 seconds).
- **It fails open when it finds nothing to protect.** If no tool on any agent has both `.mcp` and `.action`, the adapter logs a warning and runs the crew anyway, unenforced. `crypto_tool.py`'s `CryptoPriceTool` deliberately sets both so this demo *doesn't* fail open - remove them and watch the crew run ungoverned instead.
