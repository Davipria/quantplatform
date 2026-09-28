"""SEC filings from Massive: what changed in a company's risk factors, and what well-known funds hold (13F).

Risk factors: each 10-K's risk paragraphs are classified by Massive into a 3-level taxonomy. A company's latest filing is compared
with the one before: a tertiary category present now and not before is "new", one that disappeared is "dropped", and the paragraph
count per category shows where the emphasis moved. Coverage follows Massive's processing, so the newest 10-K can be missing.

13F: every US fund with over $100M of US stocks reports its long holdings 45 days after each quarter end. For a fund the latest
quarter is compared with the one before, per CUSIP (share classes and sub-managers summed): new, added, reduced, sold out. Filings
show positions at quarter end, up to 6 weeks old and without short positions or non-US holdings, so a fund may have changed since.
The fund list is fixed to concentrated portfolios whose latest two filings fit in one page (1,000 rows); CIKs were checked against
the SEC's own submissions records.
"""
import datetime as dt

import massive
from data import DataError, upstream

FUNDS = {  # CIK -> (name, manager)
    "0001067983": ("Berkshire Hathaway", "Warren Buffett"), "0001336528": ("Pershing Square", "Bill Ackman"),
    "0001649339": ("Scion Asset Management", "Michael Burry"), "0001656456": ("Appaloosa", "David Tepper"),
    "0001040273": ("Third Point", "Daniel Loeb"), "0001536411": ("Duquesne Family Office", "Stanley Druckenmiller"),
    "0001061768": ("Baupost Group", "Seth Klarman"), "0001079114": ("Greenlight Capital", "David Einhorn"),
    "0000921669": ("Carl Icahn", "Carl Icahn"), "0001029160": ("Soros Fund Management", "George Soros"),
    "0001167483": ("Tiger Global", "Chase Coleman"), "0001061165": ("Lone Pine Capital", "Stephen Mandel"),
    "0001103804": ("Viking Global", "Andreas Halvorsen"), "0001135730": ("Coatue Management", "Philippe Laffont"),
}
CHANGE_TOLERANCE = 0.01  # a share count within 1% of last quarter's counts as unchanged
TEXT_LIMIT = 500
THOUSANDS_BELOW = 2.0  # median implied price per share (top positions) under this = the filing reports in thousands of dollars


def funds() -> list[dict]:
    return [{"cik": c, "name": n, "manager": m} for c, (n, m) in FUNDS.items()]


# ---------- 13F ----------

def _load_fund(cik: str) -> dict:
    since = (dt.date.today() - dt.timedelta(days=230)).isoformat()
    rows, more = massive.pages("/stocks/filings/vX/13-F", {"filer_cik": cik, "filing_date.gte": since, "limit": 1000, "sort": "filing_date.desc"}, 2)
    keep = ("period", "filing_date", "form_type", "issuer_name", "title_of_class", "cusip", "market_value", "shares_or_principal_amount", "shares_or_principal_type", "filing_url")
    return {"rows": [{k: r.get(k) for k in keep} for r in rows], "truncated": more}


def _positions(rows: list[dict], period: str) -> tuple[dict, str | None]:
    """{cusip: position} for one quarter, from that quarter's original filing (its latest one if there is no original)."""
    of = [r for r in rows if r["period"] == period]
    originals = [r for r in of if r["form_type"] == "13F-HR"]
    chosen = originals or of
    latest = max(r["filing_date"] for r in chosen)
    out: dict[str, dict] = {}
    for r in (r for r in chosen if r["filing_date"] == latest):
        p = out.setdefault(r["cusip"] or r["issuer_name"], {"name": r["issuer_name"], "class": r["title_of_class"], "shares": 0.0, "value": 0.0, "principal": r["shares_or_principal_type"] == "PRN", "big": 0})
        p["shares"] += r["shares_or_principal_amount"] or 0
        p["value"] += r["market_value"] or 0
        if (r["market_value"] or 0) > p["big"]:
            p["big"], p["name"] = r["market_value"] or 0, r["issuer_name"]
    url = next((r["filing_url"] for r in chosen if r["filing_date"] == latest and r.get("filing_url")), None)
    # Some filers still report values in thousands of dollars (Amazon at $0.24 a share instead of $238): when the biggest share
    # positions imply a median price under $2, every value in this filing is multiplied by 1,000.
    implied = sorted(p["value"] / p["shares"] for p in sorted(out.values(), key=lambda p: -p["value"])[:10] if p["shares"] and not p["principal"] and p["value"])
    scaled = bool(implied) and implied[len(implied) // 2] < THOUSANDS_BELOW
    if scaled:
        for p in out.values():
            p["value"] *= 1000
    return out, url, scaled


@upstream
def fund_portfolio(cik: str) -> dict:
    if cik not in FUNDS:
        raise DataError(404, f"Unknown fund {cik}")
    name, manager = FUNDS[cik]
    blob = massive.cached(f"13f-{cik}", 24, lambda: _load_fund(cik))
    all_rows = blob["rows"]
    rows = [r for r in all_rows if (r["form_type"] or "").startswith("13F-HR") and r["cusip"]]  # holdings reports; a 13F-NT is a notice with no positions
    periods = sorted({r["period"] for r in rows if r["period"]}, reverse=True)
    if not periods:
        raise DataError(404, f"No 13F holdings report for {name} in the last 8 months (the fund may have stopped filing or reports through another entity)")
    notices = sorted({r["period"] for r in all_rows if r["form_type"] == "13F-NT" and r["period"] > periods[0]}, reverse=True)
    now, url, scaled = _positions(rows, periods[0])
    before = _positions(rows, periods[1])[0] if len(periods) > 1 else {}
    total = sum(p["value"] for p in now.values())
    holdings = []
    for key, p in sorted(now.items(), key=lambda kv: -kv[1]["value"]):
        prev = before.get(key)
        if not before:
            status, change = None, None
        elif prev is None:
            status, change = "new", None
        else:
            change = p["shares"] / prev["shares"] - 1 if prev["shares"] else None
            status = "unchanged" if change is None or abs(change) < CHANGE_TOLERANCE else "added" if change > 0 else "reduced"
        holdings.append({"name": p["name"], "class": p["class"], "shares": p["shares"], "value": p["value"], "weight": p["value"] / total * 100 if total else None,
                         "status": status, "change": change, "bonds": p["principal"]})
    sold = sorted(((k, p) for k, p in before.items() if k not in now), key=lambda kv: -kv[1]["value"])
    counts = {s: sum(1 for h in holdings if h["status"] == s) for s in ("new", "added", "reduced", "unchanged")}
    return {
        "cik": cik, "name": name, "manager": manager, "noticePeriod": notices[0] if notices else None, "period": periods[0], "previousPeriod": periods[1] if len(periods) > 1 else None,
        "filingUrl": url, "valuesScaled": scaled, "truncated": blob["truncated"], "totalValue": total, "positions": len(holdings),
        "top10Share": sum(h["weight"] or 0 for h in holdings[:10]), "counts": counts,
        "holdings": holdings[:80], "soldOut": [{"name": p["name"], "value": p["value"], "shares": p["shares"]} for _, p in sold[:20]], "soldOutCount": len(sold),
    }


# ---------- risk factors ----------

def _load_risk(ticker: str) -> list[dict]:
    rows, _ = massive.pages("/stocks/filings/vX/risk-factors", {"ticker": ticker, "limit": 1000, "sort": "filing_date.desc"}, 2)
    return [{k: (r.get(k)[:TEXT_LIMIT] if k == "supporting_text" and r.get(k) else r.get(k)) for k in ("filing_date", "primary_category", "secondary_category", "tertiary_category", "supporting_text")} for r in rows]


def _by_category(rows: list[dict]) -> dict:
    out: dict[str, dict] = {}
    for r in rows:
        c = out.setdefault(r["tertiary_category"], {"primary": r["primary_category"], "secondary": r["secondary_category"], "tertiary": r["tertiary_category"], "count": 0, "texts": []})
        c["count"] += 1
        if r["supporting_text"] and len(c["texts"]) < 3:
            c["texts"].append(r["supporting_text"])
    return out


@upstream
def risk_changes(symbol: str) -> dict:
    ticker = symbol.replace("-", ".")
    rows = massive.cached(f"risk-{ticker}", 24, lambda: _load_risk(ticker))
    dates = sorted({r["filing_date"] for r in rows if r["filing_date"]}, reverse=True)
    if not dates:
        raise DataError(404, f"No risk-factor filings found for {symbol} (US-listed companies only)")
    now = _by_category([r for r in rows if r["filing_date"] == dates[0]])
    before = _by_category([r for r in rows if r["filing_date"] == dates[1]]) if len(dates) > 1 else None
    primaries = sorted({c["primary"] for c in now.values()} | ({c["primary"] for c in before.values()} if before else set()))
    return {
        "symbol": symbol, "filings": [{"date": d, "paragraphs": sum(1 for r in rows if r["filing_date"] == d)} for d in dates],
        "latest": dates[0], "previous": dates[1] if before is not None else None,
        "new": [c for c in now.values() if before is not None and c["tertiary"] not in before],
        "dropped": [c for c in (before or {}).values() if c["tertiary"] not in now],
        "changed": [{"tertiary": k, "primary": c["primary"], "secondary": c["secondary"], "before": before[k]["count"], "after": c["count"]}
                    for k, c in now.items() if before is not None and k in before and before[k]["count"] != c["count"]],
        "categories": sorted(now.values(), key=lambda c: (-c["count"], c["tertiary"])),
        "byPrimary": [{"primary": p, "after": sum(c["count"] for c in now.values() if c["primary"] == p),
                       "before": None if before is None else sum(c["count"] for c in before.values() if c["primary"] == p)} for p in primaries],
    }
