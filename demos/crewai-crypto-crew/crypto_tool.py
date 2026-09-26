"""CoinGecko-backed tool, built as a BaseTool subclass so it can carry the `mcp`/`action` fields ArmorIQCrew looks for."""

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
            params={
                "ids": coin_id,
                "vs_currencies": vs_currency,
                "include_market_cap": "true",
                "include_24hr_change": "true",
            },
            headers=headers,
            timeout=15,
        )
        response.raise_for_status()
        data = response.json()
        if coin_id not in data:
            return f"No price data found for coin id '{coin_id}'."
        return str(data[coin_id])
