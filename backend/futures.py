"""Futures term structure from Massive (CME, CBOT, COMEX, NYMEX; free plan: end-of-day bars).

For a product (ES, CL, GC...) the first CONTRACTS unexpired contracts are downloaded with about a year and a half of daily bars each
(one call per contract, so a cold product costs ~7 of the 5-per-minute quota and is kept on disk for 6 hours). Everything below is
computed from those bars:

- the curve today and 1 / 3 / 12 months ago (each contract's last price on or before that day)
- contango (later contracts dearer than the front) or backwardation (cheaper)
- annualised roll yield of the front contract = (front / next - 1) x 365 / days between the two expiries. Positive in backwardation
  (a long position gains when it rolls into the next contract), negative in contango (it loses)
- calendar spreads between consecutive contracts, and the front-to-next spread over time
Prices are the settlement price when the exchange has published one, else the last close of the session.
"""
import datetime as dt

import massive
from data import DataError, upstream

CONTRACTS = 6  # contracts downloaded per product (each is one API call)
BARS = 400  # daily sessions per contract
STALE_DAYS = 10  # a contract whose last bar is older than this (compared with the newest) barely trades: dropped
FLAT = 0.25  # % slope below which a curve counts as flat

# code -> (name, group, price unit)
PRODUCTS = {
    "ES": ("E-mini S&P 500", "Equity indices", "index points"), "NQ": ("E-mini Nasdaq-100", "Equity indices", "index points"),
    "YM": ("E-mini Dow Jones", "Equity indices", "index points"), "RTY": ("E-mini Russell 2000", "Equity indices", "index points"),
    "CL": ("Crude oil (WTI)", "Energy", "$ per barrel"), "BZ": ("Brent crude oil", "Energy", "$ per barrel"),
    "NG": ("Natural gas", "Energy", "$ per MMBtu"), "HO": ("Heating oil (NY Harbor ULSD)", "Energy", "$ per gallon"),
    "RB": ("Gasoline (RBOB)", "Energy", "$ per gallon"),
    "GC": ("Gold", "Metals", "$ per troy ounce"), "SI": ("Silver", "Metals", "$ per troy ounce"),
    "HG": ("Copper", "Metals", "$ per pound"), "PL": ("Platinum", "Metals", "$ per troy ounce"),
    "ZC": ("Corn", "Agriculture", "cents per bushel"), "ZW": ("Wheat", "Agriculture", "cents per bushel"),
    "ZS": ("Soybeans", "Agriculture", "cents per bushel"), "LE": ("Live cattle", "Agriculture", "cents per pound"),
    "HE": ("Lean hogs", "Agriculture", "cents per pound"),
    "ZN": ("10-year Treasury note", "Rates and currencies", "points"), "ZB": ("30-year Treasury bond", "Rates and currencies", "points"),
    "6E": ("Euro / US dollar", "Rates and currencies", "USD per EUR"),
}
SNAPSHOTS = [("Latest", 0), ("1 month ago", 1), ("3 months ago", 3), ("12 months ago", 12)]


def products() -> list[dict]:
    return [{"code": c, "name": n, "group": g, "unit": u} for c, (n, g, u) in PRODUCTS.items()]


def _last_weekday() -> str:
    d = dt.date.today() - dt.timedelta(days=1)
    while d.weekday() >= 5:
        d -= dt.timedelta(days=1)
    return d.isoformat()


def _load(code: str) -> dict:
    today = dt.date.today().isoformat()
    rows = massive.get("/futures/v1/contracts", {"product_code": code, "type": "single", "date": _last_weekday(), "limit": 1000}).get("results", [])
    live = sorted({r["ticker"]: r["last_trade_date"] for r in rows if r.get("last_trade_date") and r["last_trade_date"] >= today}.items(), key=lambda kv: (kv[1], kv[0]))
    if not live:
        raise DataError(404, f"No active {code} futures contracts found")
    contracts = []
    for ticker, expiry in live[:CONTRACTS]:
        bars = massive.get(f"/futures/v1/aggs/{ticker}", {"resolution": "1day", "limit": BARS}).get("results", [])
        series = sorted(
            [b["session_end_date"], b.get("settlement_price") or b.get("close"), b.get("volume")] for b in bars if b.get("session_end_date") and (b.get("settlement_price") or b.get("close"))
        )
        contracts.append({"ticker": ticker, "expiry": expiry, "bars": series})
    return {"contracts": contracts}


def _at(bars: list, day: str, max_gap: int = 7) -> float | None:
    """Last price on or before `day`, only if that bar is at most `max_gap` days older (a contract that had not started trading, or
    stopped, has no honest price for that day)."""
    near = [b for b in bars if b[0] <= day]
    if not near:
        return None
    gap = (dt.date.fromisoformat(day) - dt.date.fromisoformat(near[-1][0])).days
    return near[-1][1] if gap <= max_gap else None


def _months_before(day: str, months: int) -> str:
    d = dt.date.fromisoformat(day)
    y, m = divmod(d.year * 12 + d.month - 1 - months, 12)
    first = dt.date(y, m + 1, 1)
    nxt = dt.date(y + (m + 1) // 12, (m + 1) % 12 + 1, 1)
    return dt.date(y, m + 1, min(d.day, (nxt - first).days)).isoformat()


@upstream
def curve(code: str) -> dict:
    if code not in PRODUCTS:
        raise DataError(404, f"Unknown futures product {code}")
    name, group, unit = PRODUCTS[code]
    blob = massive.cached(f"futures-{code}", 6, lambda: _load(code))
    newest = max((c["bars"][-1][0] for c in blob["contracts"] if c["bars"]), default=None)
    if not newest:
        raise DataError(404, f"No price data for {code} futures")
    limit = (dt.date.fromisoformat(newest) - dt.timedelta(days=STALE_DAYS)).isoformat()
    cs = [c for c in blob["contracts"] if c["bars"] and c["bars"][-1][0] >= limit]
    today = dt.date.today()
    for c in cs:
        c["days"] = (dt.date.fromisoformat(c["expiry"]) - today).days

    curves = []
    for label, months in SNAPSHOTS:
        day = _months_before(newest, months)
        pts = [{"ticker": c["ticker"], "expiry": c["expiry"], "days": c["days"], "price": _at(c["bars"], day)} for c in cs]
        pts = [p for p in pts if p["price"] is not None]
        if len(pts) >= 2 or months == 0:
            curves.append({"label": label, "date": day, "points": pts})

    latest = {p["ticker"]: p["price"] for p in curves[0]["points"]}
    contracts = [
        {"ticker": c["ticker"], "expiry": c["expiry"], "days": c["days"], "price": latest.get(c["ticker"]), "volume": c["bars"][-1][2], "last": c["bars"][-1][0]}
        for c in cs if c["ticker"] in latest
    ]
    spreads = []
    for a, b in zip(contracts, contracts[1:]):
        gap = b["days"] - a["days"]
        pct = (b["price"] / a["price"] - 1) * 100 if a["price"] else None
        spreads.append({"from": a["ticker"], "to": b["ticker"], "diff": b["price"] - a["price"], "pct": pct, "gapDays": gap,
                        "rollYield": -pct * 365 / gap if pct is not None and gap > 0 else None})

    history = {"dates": [], "pct": []}
    if len(cs) >= 2:
        second = {b[0]: b[1] for b in cs[1]["bars"]}
        for date, price, _ in cs[0]["bars"]:
            if date in second and price:
                history["dates"].append(date)
                history["pct"].append(round((second[date] / price - 1) * 100, 3))

    shape = None
    if len(contracts) >= 2 and contracts[0]["price"]:
        slope = (contracts[-1]["price"] / contracts[0]["price"] - 1) * 100
        shape = {"slope": slope, "label": "Flat" if abs(slope) < FLAT else "Contango" if slope > 0 else "Backwardation"}
    front = contracts[0] if contracts else None
    return {
        "code": code, "name": name, "group": group, "unit": unit, "asOf": newest, "shape": shape,
        "front": front, "rollYield": spreads[0]["rollYield"] if spreads else None, "spreadPct": spreads[0]["pct"] if spreads else None,
        "contracts": contracts, "curves": curves, "spreads": spreads, "history": history,
    }
