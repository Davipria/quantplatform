"""Short interest for US-listed companies, from Massive (FINRA data):

- short interest: shares sold short and not yet bought back, reported twice a month since 2017, with days to cover
  (short interest / average daily volume)
- short volume: the share of each day's trading that was short selling (since Feb 2024). It includes market makers' hedging, so it
  is a mood gauge, not a position: the 50% line is not a "bearish" line
- free float: shares available to trade; short interest / free float is the headline "short % of float"

The squeeze checklist is four plain yes/no flags, not a forecast: short interest of 10% of float or more, days to cover of 5 or more,
short interest up 10% or more over the last 3 reports (~6 weeks), and the price above its 50-day average (buyers already winning).
"""
import pandas as pd
import yfinance as yf

import data
import massive
from data import DataError, upstream

PCT_FLOAT_HIGH, DAYS_HIGH, RISE_HIGH = 10.0, 5.0, 0.10


def _load(ticker: str) -> dict:
    si = massive.get("/stocks/v1/short-interest", {"ticker": ticker, "limit": 1000, "sort": "settlement_date.asc"}).get("results", [])
    sv = massive.get("/stocks/v1/short-volume", {"ticker": ticker, "limit": 1000, "sort": "date.asc"}).get("results", [])
    fl = massive.get("/stocks/vX/float", {"ticker": ticker}).get("results", [])
    return {
        "interest": [{k: r.get(k) for k in ("settlement_date", "short_interest", "avg_daily_volume", "days_to_cover")} for r in si],
        "volume": [{"date": r["date"], "ratio": r.get("short_volume_ratio")} for r in sv if r.get("short_volume_ratio") is not None],
        "float": fl[0] if fl else None,
    }


def _prices(symbol: str) -> pd.Series:
    try:
        px = data.price_history(yf.Ticker(symbol))["Close"].dropna()
        px.index = px.index.tz_localize(None).normalize()
        return px
    except Exception:
        return pd.Series(dtype=float)


@upstream
def short_interest(symbol: str) -> dict:
    ticker = symbol.replace("-", ".")
    blob = massive.cached(f"short-{ticker}", 6, lambda: _load(ticker))
    if not blob["interest"]:
        raise DataError(404, f"No short interest data for {symbol} (US-listed companies only)")

    fl = blob["float"]
    float_shares = fl["free_float"] if fl else None
    px = _prices(symbol)

    reports = []
    for r in blob["interest"]:
        if r["short_interest"] is None:
            continue
        near = px[px.index <= pd.Timestamp(r["settlement_date"])] if not px.empty else px
        reports.append({
            "date": r["settlement_date"], "shortInterest": r["short_interest"], "avgVolume": r["avg_daily_volume"], "daysToCover": r["days_to_cover"],
            "pctFloat": r["short_interest"] / float_shares * 100 if float_shares else None,  # today's float for every date: older values are approximate
            "price": float(near.iloc[-1]) if len(near) else None,
        })
    for prev, cur in zip(reports, reports[1:]):
        cur["change"] = (cur["shortInterest"] / prev["shortInterest"] - 1) * 100 if prev["shortInterest"] else None
    if reports:
        reports[0]["change"] = None
    last = reports[-1]

    daily = pd.Series([v["ratio"] for v in blob["volume"]], index=[v["date"] for v in blob["volume"]], dtype=float)
    ma20 = daily.rolling(20, min_periods=10).mean()
    volume = [{"date": d, "ratio": round(float(v), 2), "avg20": None if pd.isna(ma20[d]) else round(float(ma20[d]), 2)} for d, v in daily.items()]

    rise = last["shortInterest"] / reports[-4]["shortInterest"] - 1 if len(reports) >= 4 and reports[-4]["shortInterest"] else None
    ma50 = float(px.tail(50).mean()) if len(px) >= 50 else None
    above50 = float(px.iloc[-1]) > ma50 if ma50 else None
    flags = [
        {"label": f"Short interest at least {PCT_FLOAT_HIGH:.0f}% of float", "on": last["pctFloat"] is not None and last["pctFloat"] >= PCT_FLOAT_HIGH,
         "detail": "no float data" if last["pctFloat"] is None else f"{last['pctFloat']:.1f}%"},
        {"label": f"Days to cover at least {DAYS_HIGH:.0f}", "on": (last["daysToCover"] or 0) >= DAYS_HIGH, "detail": "n/a" if last["daysToCover"] is None else f"{last['daysToCover']:.1f}"},
        {"label": f"Short interest up {RISE_HIGH * 100:.0f}% or more in 3 reports", "on": rise is not None and rise >= RISE_HIGH, "detail": "n/a" if rise is None else f"{rise * 100:+.1f}%"},
        {"label": "Price above its 50-day average", "on": bool(above50), "detail": "no price data" if above50 is None else f"{float(px.iloc[-1]):,.2f} vs {ma50:,.2f}"},
    ]
    score = sum(f["on"] for f in flags)
    return {
        "symbol": symbol, "floatShares": float_shares, "floatDate": fl["effective_date"] if fl else None, "floatPercent": fl["free_float_percent"] if fl else None,
        "tiles": {
            "shortInterest": last["shortInterest"], "date": last["date"], "pctFloat": last["pctFloat"], "daysToCover": last["daysToCover"], "change": last.get("change"),
            "ratio10": None if daily.empty else round(float(daily.tail(10).mean()), 1), "ratioDate": None if daily.empty else daily.index[-1],
        },
        "flags": flags, "score": score, "level": "High" if score >= 3 else "Moderate" if score == 2 else "Low",
        "reports": reports, "volume": volume,
    }
