"""
CryptoCompare News Provider

REST wrapper for the CryptoCompare News API v2.
Provides crypto news articles filtered by coin/topic.

Key decisions:
- Singleton pattern via get_provider() (same as Coinglass/Hyperliquid)
- API key optional — works without one (lower rate limit but sufficient for 5min polling)
- 100K calls/month on free tier with API key
- Returns cleaned dicts — callers never see raw API response
"""

import os
import logging
import time
from typing import Optional

import requests

logger = logging.getLogger(__name__)


_provider: Optional["CryptoCompareProvider"] = None


def get_provider() -> "CryptoCompareProvider":
    """Get or create the singleton CryptoCompareProvider."""
    global _provider
    if _provider is None:
        api_key = os.environ.get("CRYPTOCOMPARE_API_KEY", "")
        _provider = CryptoCompareProvider(api_key)
    return _provider


class CryptoCompareProvider:
    """CryptoCompare News API v2 client."""

    BASE_URL = "https://min-api.cryptocompare.com/data/v2"

    def __init__(self, api_key: str = ""):
        self._session = requests.Session()
        if api_key:
            self._session.headers["authorization"] = f"Apikey {api_key}"
        self._session.headers["Accept"] = "application/json"

    def _get(self, path: str, params: dict | None = None) -> list | dict:
        """Make a GET request and return the Data field."""
        resp = self._session.get(
            f"{self.BASE_URL}{path}",
            params=params,
            timeout=15,
        )
        resp.raise_for_status()
        body = resp.json()
        return body.get("Data", [])

    def get_news(
        self,
        categories: list[str] | None = None,
        limit: int = 20,
    ) -> list[dict]:
        """Fetch latest crypto news articles.

        Args:
            categories: Filter by coin/topic (e.g., ["BTC", "ETH", "Regulation"])
            limit: Max articles (1-50)

        Returns list of dicts with keys:
            id, title, body (truncated), source, published_on (unix),
            categories (pipe-separated), url
        """
        params: dict = {"lang": "EN", "sortOrder": "latest"}
        if categories:
            params["categories"] = ",".join(categories)

        try:
            data = self._get("/news/", params)
        except Exception as e:
            logger.debug("CryptoCompare news fetch failed: %s", e)
            return []

        articles = []
        for a in (data or [])[:limit]:
            articles.append({
                "id": str(a.get("id", "")),
                "title": a.get("title", ""),
                "body": (a.get("body", "") or "")[:200],
                "source": a.get("source_info", {}).get("name", a.get("source", "")),
                "published_on": a.get("published_on", 0),
                "categories": a.get("categories", ""),
                "url": a.get("url", ""),
            })

        return articles
