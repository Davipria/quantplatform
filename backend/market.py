"""Whole-US-market daily bars, collected in the background from Massive's "grouped daily" endpoint (one call = every US stock for one day).

The free plan allows 5 calls a minute, so a thread started with the backend collects the last ~300 sessions newest first at 2 calls a
minute (3 stay free for the pages you open), which takes about 2.5 hours in total; the market tab unlocks its features as history
accumulates. Everything is kept in a SQLite file (backend/cache/massive/grouped.db, git-ignored), so a restart resumes where it stopped.

Stored per session: open, close, volume of every ticker with a price of at least $2 and a dollar volume of at least $2M that day
(about 5,000 of the 12,600). Which of them are common stocks comes from a separate list (Massive's ticker reference, refreshed weekly).
Prices are split-adjusted as of the day they were downloaded: a split that happens later leaves a jump in the stored history, which
breadth.py screens out. "Today" is not available on the free plan (403 before the end of day), so the newest session is yesterday's.
Set NO_BACKFILL=1 to stop the collector; BACKFILL_RESERVE sets how many of the 5 calls a minute it leaves free (default 3).
"""
import contextlib
import datetime as dt
import os
import sqlite3
import threading
import time

import massive
from data import DataError

DB = massive.CACHE_DIR / "grouped.db"
TARGET_SESSIONS = 300
LOOKBACK_DAYS = 460  # calendar days: 300 sessions plus holidays
MIN_PRICE, MIN_DOLLAR_VOLUME = 2.0, 2e6
STOCKS_MAX_AGE = 7 * 86400
RESERVE = int(os.getenv("BACKFILL_RESERVE", "3"))

_state = {"phase": "not started", "message": "", "started": None}
_thread: threading.Thread | None = None


def connect() -> sqlite3.Connection:
    massive.CACHE_DIR.mkdir(parents=True, exist_ok=True)
    db = sqlite3.connect(DB, timeout=60)
    db.execute("PRAGMA journal_mode=WAL")
    db.executescript(
        "CREATE TABLE IF NOT EXISTS bars (date TEXT, ticker TEXT, o REAL, c REAL, v REAL, PRIMARY KEY (date, ticker)) WITHOUT ROWID;"
        "CREATE TABLE IF NOT EXISTS days (date TEXT PRIMARY KEY, n INTEGER);"  # n = tickers the exchange sent; 0 = a holiday
        "CREATE TABLE IF NOT EXISTS stocks (ticker TEXT PRIMARY KEY, name TEXT, exchange TEXT);"
        "CREATE TABLE IF NOT EXISTS meta (name TEXT PRIMARY KEY, value TEXT);"
    )
    return db


def _newest_possible() -> dt.date:
    d = dt.date.today() - dt.timedelta(days=1)
    while d.weekday() >= 5:
        d -= dt.timedelta(days=1)
    return d


def progress() -> dict:
    with contextlib.closing(connect()) as db:
        sessions, newest, oldest = db.execute("SELECT COUNT(*), MAX(date), MIN(date) FROM days WHERE n > 0").fetchone()
        stocks = db.execute("SELECT COUNT(*) FROM stocks").fetchone()[0]
    return {"sessions": sessions, "target": TARGET_SESSIONS, "newest": newest, "oldest": oldest, "commonStocks": stocks,
            "phase": _state["phase"], "message": _state["message"]}


def _ensure_stocks(db: sqlite3.Connection) -> None:
    row = db.execute("SELECT value FROM meta WHERE name = 'stocks_at'").fetchone()
    if row and time.time() - float(row[0]) < STOCKS_MAX_AGE:
        return
    _state.update(phase="stocks", message="Downloading the list of US common stocks")
    found: list[tuple] = []
    body = massive.get("/v3/reference/tickers", {"market": "stocks", "type": "CS", "active": "true", "limit": 1000, "sort": "ticker", "order": "asc"}, 3600, RESERVE)
    for _ in range(15):
        found += [(r["ticker"], r.get("name"), r.get("primary_exchange")) for r in body.get("results", [])]
        if not body.get("next_url"):
            break
        body = massive.get(body["next_url"], None, 3600, RESERVE)
    if len(found) < 1000:
        raise DataError(502, "Massive returned an incomplete list of stocks")
    db.execute("DELETE FROM stocks")
    db.executemany("INSERT OR REPLACE INTO stocks VALUES (?, ?, ?)", found)
    db.execute("INSERT OR REPLACE INTO meta VALUES ('stocks_at', ?)", (str(time.time()),))
    db.commit()


def _missing(db: sqlite3.Connection) -> list[str]:
    have = {r[0] for r in db.execute("SELECT date FROM days")}
    out, d, end = [], _newest_possible(), dt.date.today() - dt.timedelta(days=LOOKBACK_DAYS)
    while d >= end:
        if d.weekday() < 5 and d.isoformat() not in have:
            out.append(d.isoformat())
        d -= dt.timedelta(days=1)
    return out  # newest first


def _fetch_day(db: sqlite3.Connection, date: str) -> None:
    body = massive.get(f"/v2/aggs/grouped/locale/us/market/stocks/{date}", {"adjusted": "true"}, 3600, RESERVE)
    results = body.get("results", [])
    rows = [(date, r["T"], r.get("o"), r["c"], r["v"]) for r in results if r["c"] >= MIN_PRICE and r["c"] * r["v"] >= MIN_DOLLAR_VOLUME]
    db.executemany("INSERT OR REPLACE INTO bars VALUES (?, ?, ?, ?, ?)", rows)
    db.execute("INSERT OR REPLACE INTO days VALUES (?, ?)", (date, len(results)))
    db.commit()


def _collect_once(db: sqlite3.Connection) -> bool:
    """Downloads missing sessions newest first. True when it stopped because there was nothing (more) to do."""
    _ensure_stocks(db)
    for date in _missing(db):
        sessions, newest = db.execute("SELECT COUNT(*), MAX(date) FROM days WHERE n > 0").fetchone()
        if sessions >= TARGET_SESSIONS and newest and date < newest:
            return True  # enough history; only sessions newer than the newest one are still wanted
        _state.update(phase="sessions", message=f"Downloading {date} ({sessions} of {TARGET_SESSIONS} sessions stored)")
        try:
            _fetch_day(db, date)
        except DataError as e:
            if e.status == 422 and date == _newest_possible().isoformat():
                continue  # the newest session is not published yet: try again later
            raise
    return True


def _run() -> None:
    while True:
        try:
            with contextlib.closing(connect()) as db:
                _collect_once(db)
            _state.update(phase="idle", message="Up to date")
            time.sleep(1800)
        except Exception as e:  # noqa: BLE001 - the collector must never die: report and try again in a minute
            _state.update(phase="waiting", message=str(e)[:160])
            time.sleep(60)


def start() -> None:
    global _thread
    if _thread and _thread.is_alive():
        return
    if not os.getenv("MASSIVE_API_KEY"):
        _state.update(phase="disabled", message="No MASSIVE_API_KEY")
        return
    if os.getenv("NO_BACKFILL") == "1":
        _state.update(phase="disabled", message="Stopped by NO_BACKFILL=1")
        return
    _state["started"] = time.time()
    _thread = threading.Thread(target=_run, name="market-collector", daemon=True)
    _thread.start()
