"""Insider activity: SEC Form 4 open-market purchases (code P) and sales (code S) from Massive, for US-listed companies.

Grants (A), option exercises (M), tax withholding (F) and gifts (G) are left out on purpose: they are pay and housekeeping, not a view on
the share price. Calculations: quarterly buy / sell dollars (with the stock price line), the last 12 months in tiles, the share of
sales made under a Rule 10b5-1 plan (pre-scheduled, so a weaker signal), and "cluster buying" = 3 or more different insiders buying
within 30 days, a stronger signal than a single purchase.
"""
import datetime as dt

import massive
from congress import _with_prices
from data import DataError, upstream

SELL_PAGES = 3  # 1,000 sales per page; heavy sellers (NVDA: ~3 years in 3 pages) are cut off, and flagged
SINCE_YEARS = 10
CLUSTER_DAYS, CLUSTER_MIN_INSIDERS = 30, 3
MAX_TRADES = 1500  # rows sent to the browser


def _role(r: dict) -> str:
    if r.get("is_officer"):
        return r.get("officer_title") or "Officer"
    if r.get("is_director"):
        return "Director"
    return "10% owner" if r.get("is_ten_percent_owner") else "Other"


def _trim(r: dict) -> dict | None:
    price, shares = r.get("transaction_price_per_share"), r.get("transaction_shares")
    value = r.get("transaction_value") or (price * shares if price and shares else None)
    if not value or value <= 0 or not r.get("transaction_date"):
        return None
    cik, acc = (r.get("issuer_cik") or "").lstrip("0"), (r.get("accession_number") or "").replace("-", "")
    return {
        "date": r["transaction_date"], "filed": r.get("filing_date"), "insider": r.get("owner_name"), "role": _role(r),
        "director": bool(r.get("is_director")), "type": "buy" if r.get("transaction_code") == "P" else "sell",
        "shares": shares, "price": price, "value": value, "owned": r.get("shares_owned_following_transaction"),
        "plan": bool(r.get("aff_10b5_one")), "late": r.get("transaction_timeliness") == "L",
        "url": f"https://www.sec.gov/Archives/edgar/data/{cik}/{acc}/" if cik and acc else None,
    }


def _load(ticker: str) -> dict:
    since = (dt.date.today() - dt.timedelta(days=365 * SINCE_YEARS)).isoformat()
    base = {"tickers": ticker, "security_type": "non_derivative", "sort": "filing_date.desc", "limit": 1000, "filing_date.gte": since}
    buys, _ = massive.pages("/stocks/filings/vX/form-4", {**base, "transaction_code": "P"}, 2)
    sells, truncated = massive.pages("/stocks/filings/vX/form-4", {**base, "transaction_code": "S"}, SELL_PAGES)
    rows = [t for t in map(_trim, buys + sells) if t]
    return {"rows": rows, "truncated": truncated}


def _clusters(buys: list[dict]) -> list[dict]:
    """Stretches where at least 3 different insiders bought within 30 days of each other, overlapping windows merged."""
    buys = sorted(buys, key=lambda t: t["date"])
    spans: list[list[str]] = []
    for i, first in enumerate(buys):
        end = (dt.date.fromisoformat(first["date"]) + dt.timedelta(days=CLUSTER_DAYS)).isoformat()
        window = [t for t in buys[i:] if t["date"] <= end]
        if len({t["insider"] for t in window}) >= CLUSTER_MIN_INSIDERS:
            last = window[-1]["date"]
            if spans and first["date"] <= spans[-1][1]:
                spans[-1][1] = max(spans[-1][1], last)
            else:
                spans.append([first["date"], last])
    out = []
    for start, end in spans:
        inside = [t for t in buys if start <= t["date"] <= end]
        out.append({"start": start, "end": end, "insiders": len({t["insider"] for t in inside}), "value": sum(t["value"] for t in inside)})
    return out


@upstream
def insider_activity(symbol: str) -> dict:
    ticker = symbol.replace("-", ".")  # Yahoo BRK-B is BRK.B at Massive
    blob = massive.cached(f"insiders-{ticker}", 6, lambda: _load(ticker))
    rows = sorted(blob["rows"], key=lambda t: t["date"], reverse=True)
    if not rows:
        raise DataError(404, f"No open-market insider purchases or sales found for {symbol} (US-listed companies only)")

    today = dt.date.today()
    year_ago = (today - dt.timedelta(days=365)).isoformat()
    last12 = [t for t in rows if t["date"] >= year_ago]
    buys12, sells12 = [t for t in last12 if t["type"] == "buy"], [t for t in last12 if t["type"] == "sell"]
    sell_value = sum(t["value"] for t in sells12)
    clusters = _clusters([t for t in rows if t["type"] == "buy"])
    recent_cluster_from = (today - dt.timedelta(days=90)).isoformat()
    last_buy = next((t for t in rows if t["type"] == "buy"), None)

    by_q: dict[tuple[int, int], dict[str, float]] = {}
    for t in rows:
        d = dt.date.fromisoformat(t["date"])
        by_q.setdefault((d.year, (d.month - 1) // 3 + 1), {"buy": 0.0, "sell": 0.0})[t["type"]] += t["value"]

    return {
        "symbol": symbol, "truncated": blob["truncated"], "oldest": rows[-1]["date"],
        "tiles": {
            "buyValue": sum(t["value"] for t in buys12), "sellValue": sell_value,
            "buyers": len({t["insider"] for t in buys12}), "sellers": len({t["insider"] for t in sells12}),
            "buyCount": len(buys12), "sellCount": len(sells12),
            "planShare": sum(t["value"] for t in sells12 if t["plan"]) / sell_value if sell_value else None,
            "clusterRecent": any(c["end"] >= recent_cluster_from for c in clusters),
            "lastBuy": {"date": last_buy["date"], "insider": last_buy["insider"], "value": last_buy["value"]} if last_buy else None,
        },
        "quarters": _with_prices(by_q, symbol),
        "clusters": clusters,
        "trades": rows[:MAX_TRADES],
    }
