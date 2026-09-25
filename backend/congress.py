"""Congressional stock trading disclosures (the "politicians tracker" module).

House: a third-party GitHub project (TattooedHead/house-stock-watcher-data) that scrapes the official House Clerk PTR
filings (disclosures-clerk.house.gov) into JSON -- free, no key, full history back to 2012, refreshed daily. The original
housestockwatcher.com / senatestockwatcher.com projects this idea is usually built on are both dead (domains no longer
resolve) as of 2026-09-23.

Senate: no equivalent well-maintained free full-history mirror exists any more. Senate rows come instead from Bargo AI's
free congress-trades API (bargo.ai/free-apis/congress), a third-party service covering only a rolling last-3-months
window of both chambers. Used here for Senate only (House already has full history from the source above). Fair-use
quota: 30 requests/100 rows per day anonymously, 100 requests/1,000 rows per day with the free BARGO_API_KEY (owner
supplied one, 2026-09-23) -- comfortably covers our 6-hour cache cycle (one ~100-row refresh per cycle, up to 4/day).
Best-effort: any failure (no key, rate limit, network error) returns an empty list rather than breaking the view, same
convention as the Benzinga/yfinance news fallbacks in data.py. Bargo's terms require a visible, above-the-fold credit
linking back to them wherever this data is shown (see the attribution line in frontend/src/CongressTab.jsx); bulk
redistribution of the raw records is not permitted, so this only ever fetches on demand and caches short-term for our
own display, never republishes a dump.
"""
import datetime as dt
import html
import os
import re

import pandas as pd
import requests
import yfinance as yf
from cachetools.func import ttl_cache

import data
from data import DataError, upstream

HOUSE_URL = "https://raw.githubusercontent.com/TattooedHead/house-stock-watcher-data/main/data/all_transactions.json"
BARGO_URL = "https://www.bargo.ai/free-apis/congress/v1/trades"
LEGISLATORS_URLS = [f"https://unitedstates.github.io/congress-legislators/legislators-{k}.json" for k in ("current", "historical")]

_TYPE_ALIASES = {"sale (partial)": "sale", "sale (full)": "sale"}


def _clean(text: str | None) -> str | None:
    if not text:
        return None
    return re.sub(r"\s+", " ", text.replace("\x00", "")).strip() or None


def _norm_type(raw: str | None) -> str | None:
    t = (raw or "").strip().lower()
    return _TYPE_ALIASES.get(t, t) or None


@ttl_cache(maxsize=1, ttl=6 * 3600)
def _house_trades() -> list[dict]:
    try:
        r = requests.get(HOUSE_URL, timeout=30)
        r.raise_for_status()
        raw = r.json()
    except (requests.RequestException, ValueError) as e:
        raise DataError(502, f"Could not load House trade data: {e}") from e
    out = []
    for item in raw:
        tx = dt.datetime.strptime(item["transaction_date"], "%m/%d/%Y").date().isoformat() if item.get("transaction_date") else None
        disc = dt.datetime.strptime(item["disclosure_date"], "%m/%d/%Y").date().isoformat() if item.get("disclosure_date") else None
        if not tx:
            continue
        out.append({
            "chamber": "house",
            "politician": item.get("representative"),
            "state": item.get("district"),
            "ticker": (item.get("ticker") or "").strip().upper() or None,
            "asset": _clean(item.get("asset_description")),
            "type": _norm_type(item.get("type")),
            "amountRange": item.get("amount"),
            "amountMid": item.get("amount_mid"),
            "transactionDate": tx,
            "disclosureDate": disc or tx,
            "owner": item.get("owner"),
            "filingUrl": item.get("source_url"),
            "source": "house-clerk",
        })
    return out


@ttl_cache(maxsize=1, ttl=6 * 3600)
def _senate_trades() -> list[dict]:
    key = os.getenv("BARGO_API_KEY")
    headers = {"X-Api-Key": key} if key else {}
    try:
        r = requests.get(BARGO_URL, params={"chamber": "senate", "limit": 250 if key else 100}, headers=headers, timeout=20)
        r.raise_for_status()
        items = r.json().get("trades", [])
    except (requests.RequestException, ValueError):
        return []
    out = []
    for item in items:
        if not item.get("transaction_date"):
            continue
        out.append({
            "chamber": "senate",
            "politician": item.get("member"),
            "state": item.get("state"),
            "ticker": (item.get("ticker") or "").strip().upper() or None,
            "asset": _clean(html.unescape(item.get("asset") or "")),
            "type": _norm_type(item.get("type")),
            "amountRange": item.get("amount_range"),
            "amountMid": _mid(item.get("amount_low"), item.get("amount_high")),
            "transactionDate": item["transaction_date"],
            "disclosureDate": item.get("disclosure_date") or item["transaction_date"],
            "owner": None,
            "filingUrl": item.get("filing_portal"),
            "source": "bargo",
        })
    return out


def _mid(low, high) -> float | None:
    if low is None and high is None:
        return None
    if low is None:
        return float(high)
    if high is None:
        return float(low)
    return (low + high) / 2


_TITLES = {"hon", "mr", "mrs", "ms", "dr", "jr", "sr", "ii", "iii", "iv"}
_PARTY = {"Democrat": "D", "Republican": "R", "Independent": "I"}


def _tokens(name: str) -> list[str]:
    name = name.lower().replace("'", "").replace("’", "")
    return [t for t in re.sub(r"[^a-z\s-]", " ", name).replace("-", " ").split() if t not in _TITLES]


@ttl_cache(maxsize=1, ttl=24 * 3600)
def _legislators() -> dict[str, list[tuple]]:
    """unitedstates/congress-legislators (public domain), indexed by last-name token: (last tokens, states, first-name
    tokens, party letter, bioguide id). Best-effort: {} when it cannot be loaded (trades then just have no party/photo)."""
    idx: dict[str, list[tuple]] = {}
    try:
        for url in LEGISLATORS_URLS:
            r = requests.get(url, timeout=30)
            r.raise_for_status()
            for L in r.json():
                n = L["name"]
                last = _tokens(n["last"])
                if not last:
                    continue
                firsts = {w for k in ("first", "nickname", "middle") if n.get(k) for w in _tokens(n[k])}
                states = {t["state"] for t in L["terms"]}
                party = _PARTY.get(L["terms"][-1].get("party"))
                entry = (last, states, firsts, party, L["id"].get("bioguide"))
                for w in last:
                    idx.setdefault(w, []).append(entry)
    except (requests.RequestException, ValueError, KeyError):
        return {}
    return idx


def _member(name: str | None, state: str | None) -> tuple[str | None, str | None]:
    """(party letter, bioguide id) of the legislator a trade's name refers to; (None, None) when unknown or ambiguous."""
    if not name:
        return None, None
    ts = _tokens(name)
    st = state[:2] if state else None
    idx = _legislators()
    cands = {e[4]: e for w in set(ts) for e in idx.get(w, []) if all(x in ts for x in e[0]) and (not st or st in e[1])}
    if len(cands) > 1:  # several people share the last name: keep those whose first/nick/middle name starts alike
        same = {k: e for k, e in cands.items() if any(a[:3] == b[:3] for a in e[2] for b in ts if b not in e[0])}
        cands = same or cands
    if len(cands) != 1:
        return None, None
    e = next(iter(cands.values()))
    return e[3], e[4]


@ttl_cache(maxsize=1, ttl=6 * 3600)
def _all_trades() -> list[dict]:
    rows = _house_trades() + _senate_trades()
    members: dict[tuple, tuple] = {}
    for r in rows:
        key = (r["politician"], r["state"])
        if key not in members:
            members[key] = _member(*key)
        r["party"], r["bioguide"] = members[key]
    return sorted(rows, key=lambda t: t["disclosureDate"], reverse=True)


@upstream
def trades(page: int, page_size: int, chamber: str, trade_type: str, q: str, ticker: str, min_amount: float | None) -> dict:
    """Paginated, filterable trade feed, newest disclosure first."""
    page_size = max(1, min(page_size, 200))
    rows = _all_trades()
    if chamber in ("house", "senate"):
        rows = [r for r in rows if r["chamber"] == chamber]
    if trade_type in ("purchase", "sale", "exchange"):
        rows = [r for r in rows if r["type"] == trade_type]
    if ticker:
        rows = [r for r in rows if r["ticker"] == ticker]
    if min_amount:
        rows = [r for r in rows if (r["amountMid"] or 0) >= min_amount]
    if q:
        needle = q.strip().lower()
        rows = [r for r in rows if needle in (r["politician"] or "").lower() or needle in (r["ticker"] or "").lower()]
    total = len(rows)
    pages = max(1, -(-total // page_size))
    page = max(0, min(page, pages - 1))
    return {
        "trades": rows[page * page_size:(page + 1) * page_size],
        "page": page,
        "pages": pages,
        "total": total,
        "senateAvailable": bool(_senate_trades()),
    }


def _quarterly(rows: list[dict]) -> dict[tuple[int, int], dict[str, float]]:
    by_q: dict[tuple[int, int], dict[str, float]] = {}
    for r in rows:
        d = dt.date.fromisoformat(r["transactionDate"])
        key = (d.year, (d.month - 1) // 3 + 1)
        bucket = by_q.setdefault(key, {"buy": 0.0, "sell": 0.0})
        bucket["buy" if r["type"] == "purchase" else "sell"] += r["amountMid"]
    return by_q


def _with_prices(by_q: dict, symbol: str) -> list[dict]:
    """Quarter rows (buy/sell totals) plus `symbol`'s closing price on or before each quarter end (yfinance)."""
    try:
        px = data.price_history(yf.Ticker(symbol))["Close"].dropna()
        px.index = px.index.tz_localize(None).normalize()
    except Exception:
        px = pd.Series(dtype=float)

    quarters = []
    for (y, q), v in sorted(by_q.items()):
        price = None
        if not px.empty:
            near = px[px.index <= pd.Period(year=y, quarter=q, freq="Q").end_time]
            if len(near):
                price = float(near.iloc[-1])
        quarters.append({"year": y, "quarter": q, "label": f"Q{q} {y}", "buy": v["buy"], "sell": v["sell"], "price": price})
    return quarters


@upstream
def summary() -> dict:
    """Quarterly buy vs. sell dollar totals (all chambers, all history), with the S&P 500 (^GSPC) as the price line."""
    rows = [r for r in _all_trades() if r["type"] in ("purchase", "sale") and r["amountMid"]]
    if not rows:
        raise DataError(404, "No congressional trade data available")
    return {"quarters": _with_prices(_quarterly(rows), "^GSPC"), "priceLabel": "S&P 500", "senateAvailable": bool(_senate_trades())}


@upstream
def company_summary(ticker: str) -> dict:
    """Quarterly buy vs. sell dollar totals for one ticker, with that company's own quarter-end closing price
    (yfinance) overlaid -- the reference's per-company "Political" tab."""
    ticker = ticker.upper()
    rows = [r for r in _all_trades() if r["ticker"] == ticker and r["type"] in ("purchase", "sale") and r["amountMid"]]
    if not rows:
        raise DataError(404, f"No congressional trades found for {ticker}")
    return {"quarters": _with_prices(_quarterly(rows), ticker), "priceLabel": "Stock price", "senateAvailable": bool(_senate_trades())}
