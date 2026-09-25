"""Altman Z, Piotroski F and Beneish M scores from SEC as-reported statements (Finnhub /stock/financials-reported).

Each filing is turned into a "snapshot" of one period end: balance sheet at that date plus trailing-12-month flows
(10-K: the fiscal year itself; 10-Q: last 10-K + year-to-date now - year-to-date a year ago). Every score compares a snapshot
with the snapshot one year earlier, so the annual, quarterly and TTM views all come from the same machinery.
US SEC filers only (the data are XBRL "us-gaap" tags).
"""
import os

import pandas as pd
import yfinance as yf
from cachetools.func import ttl_cache

import data
from data import DataError, finnhub_get, upstream

# First matching us-gaap tag wins. Companies tag the same line differently, hence the fallbacks.
BS_ITEMS = {
    "assets": ["Assets"],
    "cur_assets": ["AssetsCurrent"],
    "cur_liab": ["LiabilitiesCurrent"],
    "liabilities": ["Liabilities"],
    "liab_and_equity": ["LiabilitiesAndStockholdersEquity"],
    "equity": ["StockholdersEquityIncludingPortionAttributableToNoncontrollingInterest", "StockholdersEquity"],
    "retained": ["RetainedEarningsAccumulatedDeficit"],
    "ltd": ["LongTermDebtNoncurrent", "LongTermDebtAndCapitalLeaseObligations", "LongTermNotesPayable", "LongTermDebt"],
    "receivables": ["AccountsReceivableNetCurrent", "ReceivablesNetCurrent", "AccountsAndOtherReceivablesNetCurrent",
                    "AccountsNotesAndLoansReceivableNetCurrent"],
    "ppe": ["PropertyPlantAndEquipmentNet",
            "PropertyPlantAndEquipmentAndFinanceLeaseRightOfUseAssetAfterAccumulatedDepreciationAndAmortization"],
    "securities": ["MarketableSecuritiesCurrent", "AvailableForSaleSecuritiesDebtSecuritiesCurrent", "ShortTermInvestments",
                   "AvailableForSaleSecuritiesCurrent"],
    "shares": ["CommonStockSharesOutstanding"],
}
FLOW_ITEMS = {  # (statement, tags)
    "revenue": ("ic", ["Revenues", "RevenueFromContractWithCustomerExcludingAssessedTax",
                       "RevenueFromContractWithCustomerIncludingAssessedTax", "SalesRevenueNet", "SalesRevenueGoodsNet",
                       "SalesAndOtherOperatingRevenueIncludingSalesBasedTaxes"]),  # last one: Exxon's own tag
    "cogs": ("ic", ["CostOfGoodsAndServicesSold", "CostOfRevenue", "CostOfGoodsSold", "CostOfServices"]),
    "gross_profit": ("ic", ["GrossProfit"]),
    "sga": ("ic", ["SellingGeneralAndAdministrativeExpense", "GeneralAndAdministrativeExpense"]),
    "ebit": ("ic", ["OperatingIncomeLoss"]),
    "net_income": ("ic", ["NetIncomeLoss", "ProfitLoss", "NetIncomeLossAvailableToCommonStockholdersBasic"]),
    "cfo": ("cf", ["NetCashProvidedByUsedInOperatingActivities", "NetCashProvidedByUsedInOperatingActivitiesContinuingOperations"]),
    "dep": ("cf", ["DepreciationDepletionAndAmortization", "DepreciationAndAmortization", "DepreciationAmortizationAndAccretionNet",
                   "DepreciationAmortizationAndOther", "Depreciation"]),
    # only used to rebuild EBIT for companies that do not report an operating income line (e.g. Exxon)
    "pretax": ("ic", ["IncomeLossFromContinuingOperationsBeforeIncomeTaxesExtraordinaryItemsNoncontrollingInterest",
                      "IncomeLossFromContinuingOperationsBeforeIncomeTaxesMinorityInterestAndIncomeLossFromEquityMethodInvestments"]),
    "interest": ("ic", ["InterestExpense", "InterestExpenseNonoperating", "InterestExpenseDebt"]),
    # only used by the Overview's free cash flow overlay (free cash flow = cfo - capex)
    "capex": ("cf", ["PaymentsToAcquirePropertyPlantAndEquipment", "PaymentsToAcquireProductiveAssets",
                     "PaymentsToAcquireOtherPropertyPlantAndEquipment", "PurchasesOfPropertyAndEquipmentAndIntangibleAssets",
                     "PaymentsToAcquirePropertyPlantAndEquipmentAndIntangibleAssets"]),  # NVIDIA's own tag is the 4th
}
DILUTED_SHARES = ["WeightedAverageNumberOfDilutedSharesOutstanding", "WeightedAverageNumberOfSharesOutstandingBasic"]

ALTMAN_SAFE, ALTMAN_DISTRESS = 2.99, 1.81  # Altman's zones for public manufacturers
BENEISH_THRESHOLD = -1.78  # above this: likely earnings manipulator


@ttl_cache(maxsize=32, ttl=3600)
def _reported(symbol: str, freq: str) -> list[dict]:
    key = os.getenv("FINNHUB_API_KEY")
    if not key:
        raise DataError(503, "This view needs FINNHUB_API_KEY in the .env file")
    r = finnhub_get("/stock/financials-reported", {"symbol": symbol, "freq": freq}, key, timeout=60)
    if r.status_code == 401:
        raise DataError(502, "Finnhub returned 401 (invalid API key)")
    if r.status_code == 403:
        raise DataError(422, "Finnhub's free tier does not cover this symbol (US listings only)")
    r.raise_for_status()
    return r.json().get("data") or []


def _flat(section) -> dict[str, float]:
    """Tag name -> value, ignoring the namespace: older filings have bare tags ("Assets"), newer ones "us-gaap_Assets" and
    company extensions "xom_Something". Standard tags are listed before custom fallbacks in the candidate lists, and none of the
    standard names contains an underscore, so the local name is everything after the first "_" (or ":")."""
    out: dict[str, float] = {}
    for x in section or []:
        c, v = x.get("concept", ""), x.get("value")
        if isinstance(v, (int, float)) and not pd.isna(v):
            out.setdefault(c.split(":")[-1].split("_", 1)[-1], float(v))
    return out


def _pick(d: dict, names: list[str]):
    return next((d[n] for n in names if n in d), None)


def _parse(f: dict) -> dict:
    sections = {k: _flat(f["report"].get(k)) for k in ("bs", "ic", "cf")}
    bs = {k: _pick(sections["bs"], names) for k, names in BS_ITEMS.items()}
    bs["diluted_shares"] = _pick(sections["ic"], DILUTED_SHARES)
    if bs["diluted_shares"] is None:  # no share tags (e.g. Exxon): implied by net income / diluted EPS
        ni, eps = sections["ic"].get("NetIncomeLoss"), sections["ic"].get("EarningsPerShareDiluted")
        bs["diluted_shares"] = ni / eps if ni is not None and eps else None
    return {
        "start": pd.Timestamp(f["startDate"]), "end": pd.Timestamp(f["endDate"]), "form": f.get("form"),
        "quarter": f.get("quarter"), "filed": f.get("filedDate") or "", "bs": bs,
        "flow": {k: _pick(sections[st], names) for k, (st, names) in FLOW_ITEMS.items()},
    }


def _dedupe(parsed: list[dict]) -> list[dict]:
    """One filing per period end (the latest filed, so amendments win)."""
    by_end = {}
    for p in sorted(parsed, key=lambda p: (p["end"], p["filed"])):
        by_end[p["end"]] = p
    return sorted(by_end.values(), key=lambda p: p["end"])


def _near(items: list[dict], target: pd.Timestamp, days: int):
    best = min(items, key=lambda s: abs(s["end"] - target), default=None)
    return best if best is not None and abs(best["end"] - target) <= pd.Timedelta(days=days) else None


def _snapshots(symbol: str) -> list[dict]:
    annual = [p for p in _dedupe([_parse(f) for f in _reported(symbol, "annual")]) if 340 <= (p["end"] - p["start"]).days <= 380]
    interim = [p for p in _dedupe([_parse(f) for f in _reported(symbol, "quarterly")]) if (p["end"] - p["start"]).days < 340]
    if not annual:
        raise DataError(404, f"Finnhub has no SEC annual filings for {symbol} (US filers only)")

    snaps = [{"end": a["end"], "form": "10-K", "bs": a["bs"], "flow": dict(a["flow"])} for a in annual]
    for q in interim:
        fy_prev = _near([a for a in annual if a["end"] <= q["start"] + pd.Timedelta(days=10)], q["start"], 10)
        q_prev = _near([i for i in interim if i["quarter"] == q["quarter"] and i["end"] < q["end"]], q["end"] - pd.DateOffset(years=1), 15)
        if fy_prev is None or q_prev is None:
            continue
        flow = {}
        for k in FLOW_ITEMS:
            parts = (fy_prev["flow"][k], q["flow"][k], q_prev["flow"][k])
            flow[k] = parts[0] + parts[1] - parts[2] if all(p is not None for p in parts) else None
        snaps.append({"end": q["end"], "form": "10-Q", "bs": q["bs"], "flow": flow})
    return sorted(snaps, key=lambda s: s["end"])


def _prices(symbol: str):
    hist = data.price_history(yf.Ticker(symbol))  # Close is split-adjusted
    if hist.empty:
        return None, None
    idx = hist.index.tz_localize(None).normalize().astype("datetime64[ns]")
    px = pd.Series(hist["Close"].to_numpy(), index=idx).dropna()
    splits = pd.Series(hist["Stock Splits"].to_numpy(), index=idx)
    return px, splits[splits > 0]


def _market_cap(s: dict, px, splits, on=None):
    """Price x shares as reported at the time: undo the split adjustment of yfinance's close so both are on the same basis."""
    shares = s["bs"]["shares"] or s["bs"]["diluted_shares"]
    if px is None or not shares:
        return None
    d = on if on is not None else s["end"]
    price = px.asof(d)
    if pd.isna(price):
        return None
    return float(price * splits[splits.index > d].prod() * shares)


def _div(a, b):
    return a / b if a is not None and b not in (None, 0) else None


def _derived(s: dict) -> dict:
    """Ratios shared by the three scores, for one snapshot."""
    b, f = s["bs"], s["flow"]
    ta = b["assets"]
    tl = b["liabilities"]
    if tl is None and b["liab_and_equity"] is not None and b["equity"] is not None:
        tl = b["liab_and_equity"] - b["equity"]
    gross = f["gross_profit"] if f["gross_profit"] is not None else (
        f["revenue"] - f["cogs"] if f["revenue"] is not None and f["cogs"] is not None else None)
    ltd = b["ltd"] or 0.0  # an unreported long-term debt line means none
    ebit = f["ebit"]
    if ebit is None and f["pretax"] is not None:
        ebit = f["pretax"] + (f["interest"] or 0.0)  # no operating income line: pre-tax income plus interest
    return {
        "ta": ta, "tl": tl, "sales": f["revenue"], "ebit": ebit, "ni": f["net_income"], "cfo": f["cfo"],
        "wc": b["cur_assets"] - b["cur_liab"] if b["cur_assets"] is not None and b["cur_liab"] is not None else None,
        "re": b["retained"], "gm": _div(gross if gross is not None else ebit, f["revenue"]),  # operating margin if no gross margin
        "ltd_ratio": _div(ltd, ta),
        "cr": _div(b["cur_assets"], b["cur_liab"]), "turn": _div(f["revenue"], ta),
        "shares": b["shares"] or b["diluted_shares"],
        "rec_sales": _div(b["receivables"], f["revenue"]), "sga_sales": _div(f["sga"], f["revenue"]),
        "dep_rate": _div(f["dep"], (f["dep"] + b["ppe"]) if f["dep"] is not None and b["ppe"] is not None else None),
        "aq": (1 - (b["cur_assets"] + b["ppe"] + (b["securities"] or 0.0)) / ta)
        if None not in (b["cur_assets"], b["ppe"], ta) and ta else None,
        "lev": _div((b["cur_liab"] + ltd) if b["cur_liab"] is not None else None, ta),
    }


def _altman(c: dict, mcap) -> dict:
    x = {
        "x1": _div(c["wc"], c["ta"]), "x2": _div(c["re"], c["ta"]), "x3": _div(c["ebit"], c["ta"]),
        "x4": _div(mcap, c["tl"]), "x5": _div(c["sales"], c["ta"]),
    }
    z = None if any(v is None for v in x.values()) else 1.2 * x["x1"] + 1.4 * x["x2"] + 3.3 * x["x3"] + 0.6 * x["x4"] + 1.0 * x["x5"]
    return {"z": z, **x}


def _piotroski(c: dict, p: dict) -> dict:
    roa, roa_p = _div(c["ni"], c["ta"]), _div(p["ni"], p["ta"])
    lt = lambda a, b: None if a is None or b is None else int(a < b)
    signals = [
        None if c["ni"] is None else int(c["ni"] > 0),  # 1 positive net income (ROA > 0)
        None if c["cfo"] is None else int(c["cfo"] > 0),  # 2 positive operating cash flow
        lt(roa_p, roa),  # 3 ROA improved
        None if c["cfo"] is None or c["ni"] is None else int(c["cfo"] > c["ni"]),  # 4 cash flow above net income (accruals)
        None if c["ltd_ratio"] is None or p["ltd_ratio"] is None else int(c["ltd_ratio"] <= p["ltd_ratio"]),  # 5 leverage did not rise
        lt(p["cr"], c["cr"]),  # 6 current ratio improved
        None if c["shares"] is None or p["shares"] is None else int(c["shares"] <= p["shares"]),  # 7 no dilution
        lt(p["gm"], c["gm"]),  # 8 gross margin improved
        lt(p["turn"], c["turn"]),  # 9 asset turnover improved
    ]
    return {"f": None if None in signals else sum(signals), "signals": signals}


def _beneish(cs: dict, ps: dict, c: dict, p: dict) -> dict:
    imputed = []

    def index(name, num, den, neutral_ok=True):
        v = _div(num, den)
        if v is None and neutral_ok:
            imputed.append(name)
            return 1.0  # Beneish's neutral value when an input is not reported
        return v

    dsri = index("DSRI", c["rec_sales"], p["rec_sales"])
    gmi = index("GMI", p["gm"], c["gm"])
    aqi = index("AQI", c["aq"], p["aq"], neutral_ok=False)
    sgi = index("SGI", c["sales"], p["sales"], neutral_ok=False)
    depi = index("DEPI", p["dep_rate"], c["dep_rate"])
    sgai = index("SGAI", c["sga_sales"], p["sga_sales"])
    lvgi = index("LVGI", c["lev"], p["lev"], neutral_ok=False)
    tata = _div(c["ni"] - c["cfo"], c["ta"]) if c["ni"] is not None and c["cfo"] is not None else None
    idx = {"DSRI": dsri, "GMI": gmi, "AQI": aqi, "SGI": sgi, "DEPI": depi, "SGAI": sgai, "TATA": tata, "LVGI": lvgi}
    m = None if any(v is None for v in idx.values()) else (
        -4.84 + 0.920 * dsri + 0.528 * gmi + 0.404 * aqi + 0.892 * sgi + 0.115 * depi - 0.172 * sgai + 4.679 * tata - 0.327 * lvgi)
    return {"m": m, "indices": idx, "imputed": imputed}


def _score(s: dict, prior: dict, mcap) -> dict:
    c, p = _derived(s), _derived(prior)
    alt, pio, ben = _altman(c, mcap), _piotroski(c, p), _beneish(s, prior, c, p)
    return {"date": s["end"].strftime("%Y-%m-%d"), "form": s["form"], "altman": alt, "piotroski": pio, "beneish": ben}


def _clean(o):
    """Round floats and turn NaN into None so the payload is valid JSON."""
    if isinstance(o, dict):
        return {k: _clean(v) for k, v in o.items()}
    if isinstance(o, list):
        return [_clean(v) for v in o]
    if isinstance(o, float):
        return None if pd.isna(o) else round(o, 4)
    return o


@upstream
def solidity_history(symbol: str) -> dict:
    """Altman Z, Piotroski F and Beneish M per fiscal year, per quarter and TTM, with all their components."""
    snaps = _snapshots(symbol)
    px, splits = _prices(symbol)
    rows = []
    for s in snaps:
        prior = _near([x for x in snaps if x["end"] < s["end"]], s["end"] - pd.DateOffset(years=1), 15)
        if prior is not None:
            rows.append(_score(s, prior, _market_cap(s, px, splits)))
    if not rows:
        raise DataError(422, f"Not enough filings to compare consecutive years for {symbol}")

    # TTM = the newest snapshot that has a comparable year-earlier snapshot (Finnhub's filing list has gaps), valued at today's price
    ttm = None
    for latest in reversed(snaps):
        prior = _near([x for x in snaps if x["end"] < latest["end"]], latest["end"] - pd.DateOffset(years=1), 15)
        if prior is not None:
            today = px.index[-1] if px is not None else None
            ttm = _score(latest, prior, _market_cap(latest, px, splits, on=today))
            ttm["asOf"] = today.strftime("%Y-%m-%d") if today is not None else None
            break
    return _clean({
        "annual": [r for r in rows if r["form"] == "10-K"],
        "quarterly": rows,
        "ttm": ttm,
        "thresholds": {"altmanSafe": ALTMAN_SAFE, "altmanDistress": ALTMAN_DISTRESS, "beneish": BENEISH_THRESHOLD},
    })
