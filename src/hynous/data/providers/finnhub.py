"""
FinnHub — Macro Economic Calendar

Lightweight wrapper for the FinnHub economic calendar (free tier).
Returns upcoming macro events: FOMC, CPI, NFP, GDP, etc.

API docs: https://finnhub.io/docs/api/economic-calendar
Auth: token query param from FINNHUB_API_KEY env var.
Free tier: 60 calls/min.
"""

import os
import logging
from datetime import datetime, timedelta, timezone

import requests

logger = logging.getLogger(__name__)


def get_economic_calendar() -> list[dict]:
    """Fetch upcoming macro economic events from FinnHub.

    Returns list of dicts with keys:
        event, date, country, impact, estimate, previous, actual, unit
    Returns empty list on any error (non-critical data).
    """
    api_key = os.environ.get("FINNHUB_API_KEY", "")
    if not api_key:
        return []

    try:
        today = datetime.now(timezone.utc).strftime("%Y-%m-%d")
        end = (datetime.now(timezone.utc) + timedelta(days=7)).strftime("%Y-%m-%d")

        resp = requests.get(
            "https://finnhub.io/api/v1/calendar/economic",
            params={"from": today, "to": end, "token": api_key},
            timeout=15,
        )
        resp.raise_for_status()
        data = resp.json()

        raw = data.get("economicCalendar", [])
        if not raw:
            return []

        # Filter to high/medium impact, dedupe, sort by time
        events = []
        seen = set()
        for item in raw:
            event_name = item.get("event", "")
            impact = item.get("impact", "").lower()
            time_str = item.get("time", "")
            country = item.get("country", "")

            # Skip low impact
            if impact == "low":
                continue

            # Dedupe by event name + date
            key = f"{event_name}:{time_str[:10]}"
            if key in seen:
                continue
            seen.add(key)

            # Parse date for display
            date_display = ""
            if time_str:
                try:
                    dt = datetime.fromisoformat(time_str.replace("Z", "+00:00"))
                    date_display = dt.strftime("%b %d")
                except Exception:
                    date_display = time_str[:10]

            estimate = item.get("estimate")
            previous = item.get("prev")
            actual = item.get("actual")
            unit = item.get("unit", "")

            events.append({
                "name": event_name,
                "date": date_display,
                "country": country,
                "impact": impact,
                "estimate": f"{estimate}{unit}" if estimate is not None else "",
                "previous": f"{previous}{unit}" if previous is not None else "",
                "actual": f"{actual}{unit}" if actual is not None else "",
            })

        return events[:15]

    except Exception as e:
        logger.debug("FinnHub calendar failed: %s", e)
        return []
