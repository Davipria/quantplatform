"""Massive (ex-Polygon.io) client. The free plan allows 5 calls per minute, so every call goes through one limiter and the
results are kept on disk (a backend restart must not burn the quota again). Notes on the plan: docs/MASSIVE_API.md."""
import collections
import datetime as dt
import json
import os
import threading
import time
from pathlib import Path

import requests

from data import DataError

BASE = "https://api.massive.com"
CALLS_PER_MINUTE = 5
CACHE_DIR = Path(__file__).resolve().parent / "cache" / "massive"
TREASURY_SINCE = "1990-01-01"  # one shared download for the Macro tab and the Fair value risk-free rate

_calls: collections.deque = collections.deque()
_lock = threading.Lock()


def _take_slot(max_wait: float, reserve: int = 0) -> None:
    """Block until one of the 5 calls per minute is free; give up (DataError 429) if that would take longer than max_wait s.
    `reserve` calls per minute are left free for other callers: the background collector (market.py) uses 3, so it never
    takes more than 2 calls a minute and a page the user opens is not stuck behind it."""
    allowed = CALLS_PER_MINUTE - reserve
    while True:
        with _lock:
            now = time.monotonic()
            while _calls and now - _calls[0] > 61:  # 1 s margin over the provider's minute
                _calls.popleft()
            if len(_calls) < allowed:
                _calls.append(now)
                return
            wait = 61 - (now - _calls[len(_calls) - allowed])
        if wait > max_wait:
            raise DataError(429, "Massive's free plan allows 5 calls per minute; try again in a minute")
        time.sleep(wait + 0.1)


def get(path: str, params: dict | None = None, max_wait: float = 90, reserve: int = 0) -> dict:
    key = os.getenv("MASSIVE_API_KEY")
    if not key:
        raise DataError(503, "Set MASSIVE_API_KEY in .env to use Massive data")
    for attempt in range(2):
        _take_slot(max_wait, reserve)
        try:
            r = requests.get(path if path.startswith("http") else BASE + path, params={**(params or {}), "apiKey": key}, timeout=60)
        except requests.RequestException as e:
            raise DataError(502, f"Massive request failed: {e}") from e
        if r.status_code != 429:
            break
        if attempt == 0 and max_wait >= 20:
            time.sleep(20)  # the provider counts calls we did not (another program, a restart): let its minute pass
    if r.status_code == 429:
        raise DataError(429, "Massive's free plan allows 5 calls per minute; try again in a minute")
    if r.status_code == 404:
        raise DataError(404, "Massive has no data for this request")
    if r.status_code in (401, 403):
        raise DataError(422 if r.status_code == 403 else 502, "Massive: this data is not included in the free plan" if r.status_code == 403 else "Massive returned 401 (invalid API key)")
    if not r.ok:
        raise DataError(502, f"Massive returned {r.status_code}")
    return r.json()


def _read(path: Path, ttl: float):
    try:
        blob = json.loads(path.read_text())
    except (OSError, ValueError):
        return None, None
    return blob.get("rows"), time.time() - blob.get("t", 0) < ttl


def cached(name: str, ttl_hours: float, load):
    """`load()`'s result kept on disk for `ttl_hours`; if loading fails the stale copy is used instead of an error."""
    path = CACHE_DIR / f"{name}.json"
    rows, fresh = _read(path, ttl_hours * 3600)
    if fresh:
        return rows
    try:
        rows = load()
    except DataError:
        if rows is not None:
            return rows
        raise
    CACHE_DIR.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps({"t": time.time(), "rows": rows}))
    return rows


def pages(path: str, params: dict, max_pages: int, max_wait: float = 90) -> tuple[list[dict], bool]:
    """Rows of up to `max_pages` pages (following next_url) and whether more pages exist."""
    rows: list[dict] = []
    body = get(path, params, max_wait)
    for n in range(max_pages):
        rows += body.get("results", [])
        if not body.get("next_url"):
            return rows, False
        if n + 1 < max_pages:
            body = get(body["next_url"], None, max_wait)
    return rows, True


def dataset(name: str, since: str, ttl_hours: float, max_wait: float = 90) -> list[dict]:
    """All rows of a /fed/v1/{name} series from `since` on, oldest first."""
    return cached(
        f"{name}-{since}", ttl_hours,
        lambda: get(f"/fed/v1/{name}", {"date.gte": since, "sort": "date.asc", "limit": 50000}, max_wait).get("results", []),
    )


def treasury_yields(max_wait: float = 90) -> list[dict]:
    return dataset("treasury-yields", TREASURY_SINCE, 6, max_wait)


def _ticker(symbol: str) -> str:
    return symbol.replace("-", ".")  # Yahoo BRK-B is BRK.B at Massive


def news(symbol: str, days: int) -> list[dict]:
    """Articles from Massive's news feed (Motley Fool, Zacks, press releases...) with its AI sentiment for this ticker, in the
    shape of data.company_news plus `ai` = {label, reason}. Always downloads 30 days once (1 hour on disk), then filters."""
    ticker = _ticker(symbol)

    def load() -> list[dict]:
        since = (dt.date.today() - dt.timedelta(days=30)).isoformat()
        rows = get("/v2/reference/news", {"ticker": ticker, "published_utc.gte": since, "limit": 100, "order": "desc", "sort": "published_utc"}, 8).get("results", [])
        out = []
        for r in rows:
            insight = next((i for i in r.get("insights") or [] if i.get("ticker") == ticker), None)
            if not r.get("title") or not r.get("article_url"):
                continue
            out.append({
                "headline": r["title"], "summary": (r.get("description") or "")[:400] or None, "source": (r.get("publisher") or {}).get("name"),
                "url": r["article_url"], "image": r.get("image_url"), "datetime": (r.get("published_utc") or "")[:10] or None,
                "ai": {"label": insight["sentiment"], "reason": insight.get("sentiment_reasoning")} if insight and insight.get("sentiment") else None,
            })
        return out

    cutoff = (dt.date.today() - dt.timedelta(days=days)).isoformat()
    return [a for a in cached(f"news-{ticker}", 1, load) if (a["datetime"] or "") >= cutoff]


LOGO_DIR = CACHE_DIR / "logos"


def logo(symbol: str) -> bytes:
    """PNG icon of a US-listed company. The image URLs need the API key, so the backend fetches them (never the browser) and keeps
    the file on disk. Raises DataError 404 when there is none. Waits at most 5 s for call quota: the browser shows a letter instead."""
    ticker = _ticker(symbol)

    def find() -> dict:
        try:
            brand = (get(f"/v3/reference/tickers/{ticker}", None, 5).get("results") or {}).get("branding") or {}
        except DataError as e:
            if e.status != 404:
                raise
            brand = {}
        return {"url": brand.get("icon_url")}  # PNG only: an SVG served from our own origin could carry script

    url = cached(f"brand-{ticker}", 24 * 7, find)["url"]
    if not url:
        raise DataError(404, "No logo")
    path = LOGO_DIR / f"{ticker}.png"
    if not path.exists():
        _take_slot(5)
        try:
            r = requests.get(url, params={"apiKey": os.getenv("MASSIVE_API_KEY")}, timeout=30)
        except requests.RequestException as e:
            raise DataError(502, f"Massive request failed: {e}") from e
        if not r.ok or not r.headers.get("content-type", "").startswith("image/"):
            raise DataError(404, "No logo")
        LOGO_DIR.mkdir(parents=True, exist_ok=True)
        path.write_bytes(r.content)
    return path.read_bytes()
