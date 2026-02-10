"""
CoinMarketCal — Crypto Events Calendar

Lightweight wrapper for the CoinMarketCal API (free tier).
Returns upcoming crypto events: token unlocks, protocol upgrades,
exchange listings, airdrops, hard forks, etc.

API docs: https://coinmarketcal.com/en/api
Auth: x-api-key header from COINMARKETCAL_API_KEY env var.
"""

import os
import logging
from datetime import datetime, timezone

import requests

logger = logging.getLogger(__name__)


def get_crypto_events(limit: int = 15) -> list[dict]:
    """Fetch upcoming crypto events from CoinMarketCal.

    Returns list of dicts with keys:
        title, date, coins (list of symbol strings), category
    Returns empty list on any error (non-critical data).
    """
    api_key = os.environ.get("COINMARKETCAL_API_KEY", "")
    if not api_key:
        return []

    try:
        resp = requests.get(
            "https://developers.coinmarketcal.com/v1/events",
            headers={"x-api-key": api_key, "Accept": "application/json"},
            params={"max": limit},
            timeout=15,
        )
        resp.raise_for_status()
        data = resp.json()

        body = data.get("body", data) if isinstance(data, dict) else data
        if not isinstance(body, list):
            return []

        events = []
        for item in body[:limit]:
            coins = []
            for c in item.get("coins", []):
                sym = c.get("symbol", c.get("name", ""))
                if sym:
                    coins.append(sym)

            categories = []
            for cat in item.get("categories", []):
                name = cat.get("name", "") if isinstance(cat, dict) else str(cat)
                if name:
                    categories.append(name)

            date_str = item.get("date_event", "")
            # Normalize date to YYYY-MM-DD
            if "T" in date_str:
                date_str = date_str.split("T")[0]

            events.append({
                "title": item.get("title", {}).get("en", "") if isinstance(item.get("title"), dict) else str(item.get("title", "")),
                "date": date_str,
                "coins": coins,
                "category": categories[0] if categories else "",
            })

        return events

    except Exception as e:
        logger.debug("CoinMarketCal fetch failed: %s", e)
        return []
