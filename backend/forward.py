"""Forward-looking valuation from analyst estimates: the PEG ratio.

PEG = P/E / expected EPS growth (in percent). Analyst EPS estimates come from yfinance for the current and the next fiscal year
only, so there is no history: the result is one PEG per forecast year. Alternative PEGs (Yahoo's, Finnhub's) are returned for
reference because providers use different growth bases.
"""
import os

import pandas as pd
import yfinance as yf

from data import DataError, _finnhub_metric, upstream

PERIODS = [("0y", 0), ("+1y", 1)]  # current fiscal year, next fiscal year


def _num(v):
    return None if v is None or pd.isna(v) else float(v)


def _finnhub_extras(symbol: str) -> dict:
    """Finnhub's own PEG and 5-year historical EPS growth; optional, so any failure just leaves them out."""
    key = os.getenv("FINNHUB_API_KEY")
    if not key:
        return {}
    try:
        m = _finnhub_metric(symbol, key).get("metric", {})
    except Exception:
        return {}
    return {"finnhubPeg": _num(m.get("pegTTM")), "epsGrowth5y": _num(m.get("epsGrowth5Y"))}


@upstream
def peg_analysis(symbol: str) -> dict:
    t = yf.Ticker(symbol)
    est = t.earnings_estimate
    if est is None or est.empty or "0y" not in est.index:
        raise DataError(422, f"No analyst EPS estimates for {symbol}")
    info = t.info
    price = _num(info.get("currentPrice")) or _num(info.get("regularMarketPrice"))
    if not price:
        raise DataError(404, f"No current price for {symbol}")

    fy_end = info.get("nextFiscalYearEnd")  # end of the fiscal year in progress
    base_year = pd.Timestamp(fy_end, unit="s").year if fy_end else None

    periods = []
    for key, offset in PERIODS:
        if key not in est.index:
            continue
        row = est.loc[key]
        eps, prior = _num(row.get("avg")), _num(row.get("yearAgoEps"))
        growth = _num(row.get("growth"))
        if growth is None and eps is not None and prior and prior > 0:
            growth = eps / prior - 1
        pe = price / eps if eps and eps > 0 else None
        peg, note = None, None
        if pe is None:
            note = "expected EPS is not positive, so P/E is undefined"
        elif growth is None or prior is None or prior <= 0:
            note = "the base-year EPS is not positive, so growth is not meaningful"
        elif growth <= 0:
            note = "analysts expect no EPS growth, so PEG is not meaningful"
        else:
            peg = pe / (growth * 100)
        periods.append({
            "key": key, "label": str(base_year + offset) if base_year else ("Current year" if offset == 0 else "Next year"),
            "epsAvg": eps, "epsLow": _num(row.get("low")), "epsHigh": _num(row.get("high")),
            "analysts": _num(row.get("numberOfAnalysts")), "priorEps": prior,
            "growthPct": None if growth is None else growth * 100, "pe": pe, "peg": peg, "note": note,
        })
    if not periods:
        raise DataError(422, f"No analyst EPS estimates for {symbol}")

    warnings = []
    est_currency, px_currency = est["currency"].iloc[0] if "currency" in est.columns else None, info.get("currency")
    if est_currency and px_currency and est_currency != px_currency:
        warnings.append(f"EPS estimates are in {est_currency} but the price is in {px_currency}: P/E and PEG mix currencies (no FX conversion).")
    if any(p["growthPct"] is not None and p["growthPct"] > 100 for p in periods):
        warnings.append("Expected growth above 100% (often a rebound from a very low base) makes PEG tiny and not very informative.")

    return {
        "price": price, "currency": px_currency,
        "periods": periods,
        "reference": {
            "trailingPe": _num(info.get("trailingPE")), "forwardPe": _num(info.get("forwardPE")),
            "yahooPeg": _num(info.get("trailingPegRatio")) or _num(info.get("pegRatio")), **_finnhub_extras(symbol),
        },
        "warning": " ".join(warnings) or None,
    }
