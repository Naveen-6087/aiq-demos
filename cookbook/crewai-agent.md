# Build a CrewAI Crew with the ArmorIQ SDK

A step-by-step guide to governing a CrewAI crew with `ArmorIQCrew` - the
narrowest of ArmorIQ's four framework adapters, and the one where you
should understand the trade-off before you build anything.

<Callout type="warn">
  **Read this before the other steps.** `ArmorIQCrew` works fundamentally
  differently from the Google ADK, Strands, and LangChain integrations in
  this cookbook. It has no `mode` option and is **proxy-only** - it requires
  a network-reachable MCP server, not a locally-spawned one. See "What
  you'll build" below for what that means in practice.
</Callout>

## What you'll build

A two-agent crew: a **researcher** who looks up live crypto prices, and a
**writer** who turns them into a short daily brief. `ArmorIQCrew` wraps
`crewai.Crew` - on `kickoff()` it derives an intent plan from the crew's
tools and tasks, mints one token for the whole run, and patches any tool
that carries `.mcp`/`.action` attributes so its execution routes through
**ArmorIQ's cloud proxy** instead of calling out directly.

That last part is the thing to understand going in. Google ADK, Strands,
and LangChain all have per-tool-call lifecycle hooks - `mode: "sdk"` lets
those integrations execute the approved call locally, so a stdio MCP server
running on your own machine works fine (every other recipe in this
cookbook uses exactly that). CrewAI has no equivalent hook system, so its
adapter has to intercept the call a different way - by patching the tool
directly to go through ArmorIQ's proxy. That proxy is a cloud service; it
cannot reach a process running on your laptop. **This recipe's tool call
will fail with a proxy error unless you deploy the MCP server it targets
somewhere network-reachable** - we ran it exactly that way, ourselves,
below, so you can see precisely what that looks like before deciding
whether this trade-off works for your use case.

## Before you start

| Requirement | Why |
|---|---|
| Python 3.10 or later | Runs the crew |
| An ArmorIQ account | Intent verification and audit |
| A Gemini API key | Drives both agents |
| A CoinGecko API key (optional) | Free Demo tier - keyless access also works |

## Step 1: Create your ArmorIQ account and API key

1. Go to [platform.armoriq.ai](https://platform.armoriq.ai) and sign up/login.
2. Open **Settings → API Keys**.
3. Click **Generate new key** and copy it.

## Step 2: Get a Gemini API key

1. Go to [aistudio.google.com](https://aistudio.google.com).
2. Click **Create API key** and copy it.

CrewAI natively supports Gemini (`pip install "crewai[google-genai]"`) -
also OpenAI, Anthropic, Bedrock, and anything else via LiteLLM.

## Step 3: Scaffold the project

```bash
mkdir armoriq-crewai-crew && cd armoriq-crewai-crew
python -m venv .venv
.venv\Scripts\activate          # Windows; use `source .venv/bin/activate` on macOS/Linux
```

```
# requirements.txt
crewai[tools,google-genai]
armoriq-sdk[crewai]
requests
python-dotenv
```

```bash
pip install -r requirements.txt
touch .env crypto_tool.py crew.py crew_unwrapped.py
```

## Step 4: Build a tool ArmorIQ can actually see

`ArmorIQCrew` only wraps tools that expose **both** an `.mcp` and an
`.action` attribute - a plain `@tool`-decorated function has nowhere to put
them, so this has to be a `BaseTool` subclass:

```python
# crypto_tool.py
import os
from typing import Type

import requests
from crewai.tools import BaseTool
from pydantic import BaseModel, Field

COINGECKO_BASE_URL = "https://api.coingecko.com/api/v3"


class CryptoPriceInput(BaseModel):
    coin_id: str = Field(..., description="CoinGecko coin id, e.g. 'bitcoin' or 'ethereum'")
    vs_currency: str = Field(default="usd", description="Currency to price in, e.g. 'usd'")


class CryptoPriceTool(BaseTool):
    name: str = "get_crypto_price"
    description: str = (
        "Get the current price, market cap, and 24h change for a cryptocurrency "
        "by its CoinGecko coin id (e.g. 'bitcoin', 'ethereum', 'solana')."
    )
    args_schema: Type[BaseModel] = CryptoPriceInput

    # The two fields ArmorIQCrew's adapter looks for on every agent tool.
    mcp: str = "coingecko"
    action: str = "get_price"

    def _run(self, coin_id: str, vs_currency: str = "usd") -> str:
        headers = {}
        api_key = os.environ.get("COINGECKO_API_KEY")
        if api_key:
            headers["x-cg-demo-api-key"] = api_key

        response = requests.get(
            f"{COINGECKO_BASE_URL}/simple/price",
            params={"ids": coin_id, "vs_currencies": vs_currency, "include_market_cap": "true", "include_24hr_change": "true"},
            headers=headers,
            timeout=15,
        )
        response.raise_for_status()
        data = response.json()
        if coin_id not in data:
            return f"No price data found for coin id '{coin_id}'."
        return str(data[coin_id])
```

<Callout type="error">
  **It fails open when it finds nothing to protect.** If no tool on any
  agent has both `.mcp` and `.action`, `ArmorIQCrew` logs a WARNING and
  runs the crew anyway, unenforced - remove those two fields above and the
  crew runs exactly the same, just with no ArmorIQ involvement at all. A
  misconfigured tool looks identical to a successfully-protected run unless
  you're watching the logs.
</Callout>

## Step 5: Build the crew, unwrapped first

Verify the tool and agents work before ArmorIQ is anywhere near them:

```python
# crew_unwrapped.py
import os

from crewai import Agent, Crew, Process, Task
from crewai.llm import LLM
from dotenv import load_dotenv

from crypto_tool import CryptoPriceTool

load_dotenv()

model = LLM(model=f"gemini/{os.environ.get('GEMINI_MODEL', 'gemini-flash-lite-latest')}", api_key=os.environ["GEMINI_API_KEY"])
price_tool = CryptoPriceTool()

researcher = Agent(
    role="Crypto Market Researcher",
    goal="Fetch the current price, market cap, and 24h change for bitcoin and ethereum",
    backstory="A meticulous analyst who only reports numbers it actually looked up.",
    tools=[price_tool],
    llm=model,
)

writer = Agent(
    role="Crypto Market Writer",
    goal="Turn raw price data into a short, readable daily brief",
    backstory="A financial writer who turns numbers into a two-paragraph summary.",
    llm=model,
)

research_task = Task(
    description="Look up current price data for bitcoin and ethereum. Use the get_crypto_price tool once per coin.",
    expected_output="A list of {coin: price, market_cap, 24h_change} for each coin.",
    agent=researcher,
)

write_task = Task(
    description="Write a short 'Daily Crypto Brief' (2 short paragraphs) summarizing the price data.",
    expected_output="A 2-paragraph markdown brief.",
    agent=writer,
    context=[research_task],
)

crew = Crew(agents=[researcher, writer], tasks=[research_task, write_task], process=Process.sequential)
print(crew.kickoff())
```

```bash
python crew_unwrapped.py
```

We ran this exactly as written and got a real, correctly-written brief from
live data:

```
Bitcoin (BTC) continued its steady march today, edging up a modest 0.097%
to trade at $84,018. This slight upward tick brings the pioneering
cryptocurrency's towering market capitalization to an impressive $1.69
trillion, signaling ongoing investor resilience...

Meanwhile, Ethereum (ETH) experienced a minor cooling-off period, slipping
0.262% over the past 24 hours to hover at $2,685.26. Despite this slight
dip, the leading altcoin maintains a robust market cap of roughly $327.8
billion...
```

That confirms the crew mechanics are correct, independent of ArmorIQ. Now
wrap it.

## Step 6: Register a coingecko MCP server with ArmorIQ

1. In the ArmorIQ console, open **MCP Servers**.
2. Click **Add MCP Server**.
3. Name it `coingecko`.
4. Save.

If you want the wrapped crew below to actually complete a successful tool
call rather than reproduce our proxy error, this needs to point at a
**deployed, network-reachable** copy of an MCP server exposing a
`get_price` tool - see the [CoinGecko recipe](/cookbook/crypto-agent) for
the server code, and the [MCP Format Requirements
guide](https://docs.armoriq.ai/sdk/mcp-directory/mcp-format) for what
"deployed" needs to look like (JSON-RPC 2.0 over HTTP with SSE responses,
not stdio). We did not deploy one for this guide - see Step 8 for exactly
what happens without it, which is itself worth seeing.

## Step 7: Wrap it with ArmorIQCrew

```python
# crew.py
import os

from crewai import Agent, Process, Task
from crewai.llm import LLM
from dotenv import load_dotenv

from armoriq_sdk import ArmorIQClient
from armoriq_sdk.integrations.crewai import ArmorIQCrew

from crypto_tool import CryptoPriceTool

load_dotenv()


def build_crew(coins: list[str]):
    model = LLM(model=f"gemini/{os.environ.get('GEMINI_MODEL', 'gemini-flash-lite-latest')}", api_key=os.environ["GEMINI_API_KEY"])
    price_tool = CryptoPriceTool()

    researcher = Agent(
        role="Crypto Market Researcher",
        goal=f"Fetch the current price, market cap, and 24h change for: {', '.join(coins)}",
        backstory="A meticulous analyst who only reports numbers it actually looked up, never guesses.",
        tools=[price_tool],
        llm=model,
    )

    writer = Agent(
        role="Crypto Market Writer",
        goal="Turn raw price data into a short, readable daily brief",
        backstory="A financial writer who turns numbers into a two-paragraph summary a non-trader can understand.",
        llm=model,
    )

    research_task = Task(
        description=f"Look up current price data for each of these coins: {', '.join(coins)}. Use the get_crypto_price tool once per coin.",
        expected_output="A list of {coin: price, market_cap, 24h_change} for each coin.",
        agent=researcher,
    )

    write_task = Task(
        description="Write a short 'Daily Crypto Brief' (2 short paragraphs) summarizing the price data.",
        expected_output="A 2-paragraph markdown brief.",
        agent=writer,
        context=[research_task],
    )

    # Every argument other than armoriq_client, llm, and
    # token_validity_seconds is forwarded to crewai.Crew unchanged, so an
    # existing crew definition moves over as-is.
    return ArmorIQCrew(
        agents=[researcher, writer],
        tasks=[research_task, write_task],
        process=Process.sequential,
        armoriq_client=ArmorIQClient(api_key=os.environ["ARMORIQ_API_KEY"]),
        llm=f"gemini/{os.environ.get('GEMINI_MODEL', 'gemini-flash-lite-latest')}",
    )


if __name__ == "__main__":
    coins = os.environ.get("COINS", "bitcoin,ethereum").split(",")
    crew = build_crew(coins)
    print(crew.kickoff())
```

## Step 8: Run it - and read what actually happens

```bash
python crew.py
```

Without a deployed, reachable `coingecko` MCP server, here's what we
actually got:

```
I encountered an error while trying to use the tool. This was the error:
MCP invocation failed: {'success': False, 'error': 'Internal Proxy Error', ...}
```

**This is the documented limitation, not a bug** - ArmorIQ's cloud proxy
genuinely cannot reach a stdio process on your machine, and `ArmorIQCrew`
has no local-execution mode to fall back to. The interesting part: because
the writer agent's backstory says it "only reports numbers it actually
looked up," the crew doesn't fabricate a price when the tool fails - it
explains that it couldn't get real data instead:

```
Today's crypto market data is temporarily unavailable due to a technical
glitch with our price-tracking tools... Because we rely strictly on
verified live data rather than estimates, we cannot confirm whether the
major coins are currently trading in the green or the red.
```

Fail-closed behavior, one level up: even when the infrastructure isn't
fully wired, the crew still refuses to guess.

## Limitations

| | Google ADK / Strands / LangChain | CrewAI |
|---|---|---|
| Enforcement point | Lifecycle hooks | Patches the tool call directly |
| Works with a local stdio MCP server | Yes (`mode: "sdk"`) | **No** - proxy-only |
| Per-user scoping | Yes | No - the whole crew runs as one identity |
| Per-call policy (allow/hold/block) | Yes | No |
| Holds and approvals | Yes | No |
| Behavior with no `.mcp`/`.action` tools found | n/a | Runs **unenforced**, logs a warning |

If you need per-call enforcement, holds, or approvals on a CrewAI-style
multi-agent setup, drive `ArmorIQSession` directly from inside a custom
tool's `_run` instead of using `ArmorIQCrew` - see the Strands or LangChain
recipes in this cookbook for that lower-level pattern.

## Troubleshooting

| Symptom | Likely cause |
|---|---|
| `Internal Proxy Error` on every tool call | Expected without a deployed, reachable MCP server - see Step 6 |
| The crew runs but nothing shows up in ArmorIQ's dashboard | No tool has both `.mcp` and `.action` set - the adapter fails open silently (a WARNING in the logs, easy to miss) |
| `429 RESOURCE_EXHAUSTED` from Gemini | Free-tier daily quota per model - try `gemini-flash-lite-latest`, which has a separate quota from `gemini-3.8-flash` and similar |
| `ModuleNotFoundError` for `crewai.tools` | You're on an old `crewai` version; reinstall with `pip install -U "crewai[tools,google-genai]"` |
| Windows console shows `'charmap' codec can't encode character` warnings | Cosmetic - CrewAI's own event-logging tries to print emoji your terminal's code page can't render. Harmless, safe to ignore |

## What's next

- **See the enforced version of this domain.** The [CoinGecko recipe](/cookbook/crypto-agent) uses the same MCP server with `mode: "sdk"` (via a plain agent loop, not a framework adapter) and gets real allow/hold/block decisions with no deployment required.
- **Deploy the MCP server for real.** Wrap `coingecko-mcp-server.js` in an HTTP+SSE transport per the [MCP Format Requirements](https://docs.armoriq.ai/sdk/mcp-directory/mcp-format) guide, deploy it, and re-point Step 6's registration at the deployed URL to see this recipe's tool call actually succeed.
