"""Two-agent CrewAI crew (crypto researcher + writer) governed by ArmorIQCrew; see README.md for limitations."""

import os

from crewai import Agent, Crew, Process, Task
from crewai.llm import LLM
from dotenv import load_dotenv

from armoriq_sdk import ArmorIQClient
from armoriq_sdk.integrations.crewai import ArmorIQCrew

from crypto_tool import CryptoPriceTool

load_dotenv()


def build_crew(coins: list[str]):
    model = LLM(
        model=f"gemini/{os.environ.get('GEMINI_MODEL', 'gemini-flash-lite-latest')}",
        api_key=os.environ["GEMINI_API_KEY"],
    )

    price_tool = CryptoPriceTool()

    researcher = Agent(
        role="Crypto Market Researcher",
        goal=f"Fetch the current price, market cap, and 24h change for: {', '.join(coins)}",
        backstory="A meticulous analyst who only reports numbers it actually looked up, never guesses.",
        tools=[price_tool],
        llm=model,
        verbose=True,
    )

    writer = Agent(
        role="Crypto Market Writer",
        goal="Turn raw price data into a short, readable daily brief",
        backstory="A financial writer who turns numbers into a two-paragraph summary a non-trader can understand.",
        llm=model,
        verbose=True,
    )

    research_task = Task(
        description=f"Look up current price data for each of these coins: {', '.join(coins)}. "
                    "Use the get_crypto_price tool once per coin.",
        expected_output="A list of {coin: price, market_cap, 24h_change} for each coin.",
        agent=researcher,
    )

    write_task = Task(
        description="Write a short 'Daily Crypto Brief' (2 short paragraphs) summarizing the "
                    "price data the researcher found - mention which coins are up and which are down.",
        expected_output="A 2-paragraph markdown brief.",
        agent=writer,
        context=[research_task],
    )

    # ArmorIQCrew wraps crewai.Crew, forwarding all args except armoriq_client/llm/token_validity_seconds.
    return ArmorIQCrew(
        agents=[researcher, writer],
        tasks=[research_task, write_task],
        process=Process.sequential,
        armoriq_client=ArmorIQClient(api_key=os.environ["ARMORIQ_API_KEY"]),
        llm=f"gemini/{os.environ.get('GEMINI_MODEL', 'gemini-flash-lite-latest')}",
        verbose=True,
    )


def main():
    coins = os.environ.get("COINS", "bitcoin,ethereum,solana").split(",")
    crew = build_crew(coins)
    result = crew.kickoff()
    print("\n--------------------------------------------------")
    print("FINAL BRIEF:\n")
    print(result)


if __name__ == "__main__":
    main()
