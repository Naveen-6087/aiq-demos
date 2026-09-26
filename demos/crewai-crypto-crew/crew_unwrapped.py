"""Same crew as crew.py but with plain crewai.Crew, no ArmorIQ - run this first to confirm the crew itself works."""

import os

from crewai import Agent, Crew, Process, Task
from crewai.llm import LLM
from dotenv import load_dotenv

from crypto_tool import CryptoPriceTool

load_dotenv()

model = LLM(model=f"gemini/{os.environ.get('GEMINI_MODEL', 'gemini-3.8-flash')}", api_key=os.environ["GEMINI_API_KEY"])
price_tool = CryptoPriceTool()

researcher = Agent(
    role="Crypto Market Researcher",
    goal="Fetch the current price, market cap, and 24h change for bitcoin and ethereum",
    backstory="A meticulous analyst who only reports numbers it actually looked up.",
    tools=[price_tool],
    llm=model,
    verbose=True,
)

writer = Agent(
    role="Crypto Market Writer",
    goal="Turn raw price data into a short, readable daily brief",
    backstory="A financial writer who turns numbers into a two-paragraph summary.",
    llm=model,
    verbose=True,
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

crew = Crew(agents=[researcher, writer], tasks=[research_task, write_task], process=Process.sequential, verbose=True)
result = crew.kickoff()
print("\n=== RESULT ===")
print(result)
