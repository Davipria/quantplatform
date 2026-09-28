"""Market calendars from Massive: upcoming ex-dividend dates for the whole market, and IPOs.

Dividends: every cash dividend with an ex-date in the next 30 days (up to 4 pages of 1,000). When the Market tab's database exists
(market.py) the list is limited to US common stocks and shows each company's name and an estimated yield = the amount x payments
a year / the latest stored close; without it every listed ticker appears and there is no yield. Regular dividends only have a yield
when their frequency is known (monthly, quarterly, semi-annual, annual); special dividends are marked and have none.
IPOs: pending, postponed and recently priced offerings.
"""
import contextlib
import datetime as dt

import massive
import market
from data import upstream

DIVIDEND_DAYS = 30
PER_YEAR = {1: 1, 2: 2, 4: 4, 12: 12}
FREQUENCY = {1: "Annual", 2: "Semi-annual", 4: "Quarterly", 12: "Monthly", 24: "Twice a month", 52: "Weekly", 0: "One time"}
STATUS_ORDER = {"pending": 0, "new": 0, "postponed": 1, "history": 2}


def _load_dividends() -> list[dict]:
    today = dt.date.today()
    rows, _ = massive.pages("/v3/reference/dividends", {
        "ex_dividend_date.gte": today.isoformat(), "ex_dividend_date.lte": (today + dt.timedelta(days=DIVIDEND_DAYS)).isoformat(),
        "limit": 1000, "order": "asc", "sort": "ex_dividend_date",
    }, 4)
    keep = ("ticker", "cash_amount", "currency", "ex_dividend_date", "pay_date", "record_date", "declaration_date", "frequency", "dividend_type")
    return [{k: r.get(k) for k in keep} for r in rows]


def _stock_info() -> tuple[dict, dict]:
    """(ticker -> name for US common stocks, ticker -> latest stored close); both empty when the market database has nothing yet."""
    try:
        with contextlib.closing(market.connect()) as db:
            names = dict(db.execute("SELECT ticker, name FROM stocks").fetchall())
            closes = dict(db.execute("SELECT ticker, c FROM bars WHERE date = (SELECT MAX(date) FROM bars)").fetchall())
        return names, closes
    except Exception:  # noqa: BLE001 - the enrichment is optional
        return {}, {}


def dividends() -> dict:
    rows = massive.cached("dividend-calendar", 6, _load_dividends)
    names, closes = _stock_info()
    today = dt.date.today()
    out = []
    for r in rows:
        if r["currency"] != "USD" or not r["cash_amount"] or not r["ex_dividend_date"]:
            continue
        if names and r["ticker"] not in names:
            continue
        price = closes.get(r["ticker"])
        special = r["dividend_type"] == "SC"
        per_year = PER_YEAR.get(r["frequency"])
        out.append({
            "ticker": r["ticker"].replace(".", "-"), "name": names.get(r["ticker"]) or "", "amount": r["cash_amount"], "exDate": r["ex_dividend_date"],
            "payDate": r["pay_date"], "recordDate": r["record_date"], "declared": r["declaration_date"], "special": special,
            "frequency": FREQUENCY.get(r["frequency"]), "price": price,
            "yield": r["cash_amount"] * per_year / price * 100 if per_year and price and not special else None,
            "days": (dt.date.fromisoformat(r["ex_dividend_date"]) - today).days,
        })
    out.sort(key=lambda r: (r["exDate"], r["ticker"]))
    return {"rows": out, "commonStocksOnly": bool(names), "days": DIVIDEND_DAYS}


def _load_ipos() -> list[dict]:
    rows, _ = massive.pages("/vX/reference/ipos", {"limit": 300, "order": "desc", "sort": "last_updated"}, 1)
    keep = ("ticker", "issuer_name", "ipo_status", "announced_date", "last_updated", "lowest_offer_price", "highest_offer_price", "final_issue_price",
            "max_shares_offered", "total_offer_size", "primary_exchange", "security_description", "currency_code", "security_type")
    return [{k: r.get(k) for k in keep} for r in rows]


def ipos() -> list[dict]:
    rows = massive.cached("ipo-calendar", 6, _load_ipos)
    return sorted(rows, key=lambda r: (STATUS_ORDER.get(r["ipo_status"], 3), r["last_updated"] or ""), reverse=False)[:200]


@upstream
def calendar() -> dict:
    return {"dividends": dividends(), "ipos": ipos()}
