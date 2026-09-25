"""Seasonality: how an instrument has behaved on average at each time of the year.

Everything is computed from end-of-day prices (yfinance, split-adjusted but NOT dividend-adjusted, so prices are the ones
quoted on the day). Works for stocks, ETFs, indices (^GSPC), futures (GC=F) and currencies (EURUSD=X). With `vs` the
instrument is replaced by the ratio symbol / vs (a "spread": long one, short the other in equal dollar amounts).

Three views:
  * seasonal curve: for each year the % change since the start of the window, averaged over the last N years by calendar date;
  * probabilities: share of years in which a calendar day / weekday / month closed up (daily, weekly, monthly averages);
  * trades: buy on a calendar date, sell on another one, and what that did in every past year.
"""
import calendar
import datetime as dt
import re
import warnings

import numpy as np
import pandas as pd
import yfinance as yf

import data
from data import DataError, upstream

N_YEARS = (3, 5, 7, 10, 15, 20, 25, 30)
DAY = pd.Timedelta(days=1)
SLACK = pd.Timedelta(days=3)  # a window that ended on a weekend still counts as complete
DUMMY_YEAR = 2001  # non-leap year used to lay the 365 calendar days of a seasonal curve on a date axis


@upstream
def _prices(symbol: str) -> tuple[pd.DataFrame, dict]:
    t = yf.Ticker(symbol)
    hist = data.price_history(t)
    if hist.empty or "Close" not in hist:
        raise DataError(404, f"No price history for {symbol}")
    df = hist[["Close", "High", "Low"]].dropna(subset=["Close"])
    df.index = pd.DatetimeIndex(df.index).tz_localize(None).normalize()
    df = df[~df.index.duplicated()].sort_index()
    df = df[df.Close > 0]
    meta = t.get_history_metadata() or {}
    return df, {"name": meta.get("longName") or meta.get("shortName") or symbol, "currency": meta.get("currency")}


def _series(symbol: str, vs: str) -> tuple[pd.DataFrame, dict]:
    """Prices of the instrument, or of the ratio symbol / vs (one price per day, so its high and low are its close)."""
    df, meta = _prices(symbol)
    if not vs:
        return df, meta
    df2, meta2 = _prices(vs)
    both = df[["Close"]].join(df2[["Close"]], how="inner", lsuffix="_a", rsuffix="_b")
    if len(both) < 250:
        raise DataError(422, f"{symbol} and {vs} have less than a year of overlapping price history")
    ratio = both.Close_a / both.Close_b
    warning = None
    if meta["currency"] and meta2["currency"] and meta["currency"] != meta2["currency"]:
        warning = f"{symbol} trades in {meta['currency']} and {vs} in {meta2['currency']}: the spread includes the exchange rate."
    return (
        pd.DataFrame({"Close": ratio, "High": ratio, "Low": ratio}),
        {"name": f"{symbol} / {vs}", "currency": "ratio", "warning": warning},
    )


def _round(a: np.ndarray, digits: int = 3) -> list:
    return [None if np.isnan(v) else round(float(v), digits) for v in a]


@upstream
def seasonality(symbol: str, vs: str, start_month: int) -> dict:
    df, meta = _series(symbol, vs)
    close = df.Close
    first, last = close.index[0], close.index[-1]
    if (last - first).days < 400:
        raise DataError(422, f"{symbol} has less than about 15 months of price history: not enough for seasonality")
    full = close.reindex(pd.date_range(first, last, freq="D")).ffill()  # one value per calendar day

    # ---- seasonal curve: windows of 12 months that start on the 1st of `start_month`
    def bounds(y: int, sm: int):
        start = pd.Timestamp(y, sm, 1)
        return start, start + pd.DateOffset(years=1) - DAY

    def complete(y: int, sm: int) -> bool:
        start, end = bounds(y, sm)
        return first <= start + 7 * DAY and end <= last + SLACK

    dummy = pd.date_range(f"{DUMMY_YEAR}-{start_month:02d}-01", periods=365)  # the 365 calendar days of a window, Feb 29 left out
    grid = {(d.month, d.day): i for i, d in enumerate(dummy)}
    per_year: dict[int, np.ndarray] = {}

    def year_curve(y: int) -> np.ndarray:
        if y not in per_year:
            start, end = bounds(y, start_month)
            seg = full.loc[start:min(end, last)]
            before = full.get(start - DAY)
            base = seg.iloc[0] if before is None else before  # the close before the window starts, so the first day counts
            vals = np.full(365, np.nan)
            for d, v in zip(seg.index, (seg / base - 1) * 100):
                if (d.month, d.day) in grid:
                    vals[grid[(d.month, d.day)]] = v
            per_year[y] = vals
        return per_year[y]

    ys = [y for y in range(first.year, last.year + 1) if complete(y, start_month)]
    cur = last.year if last.month >= start_month else last.year - 1
    curve_sets = {"current": [cur] if bounds(cur, start_month)[0] >= first - 7 * DAY else [], "last": ys[-1:]}
    curve_sets |= {str(n): ys[-n:] for n in N_YEARS if len(ys) >= n}

    keep = [i for i, d in enumerate(dummy) if d.weekday() < 5]
    series = {}
    for key, years in curve_sets.items():
        if not years:
            continue
        with warnings.catch_warnings():
            warnings.simplefilter("ignore", RuntimeWarning)  # all-NaN columns (before the first price) are fine
            avg = np.nanmean(np.stack([year_curve(y) for y in years]), axis=0)
        series[key] = {"years": years, "values": _round(avg[keep])}

    # ---- probabilities by calendar year: last N complete calendar years (independent of the chart's start month)
    cal = [y for y in range(first.year, last.year + 1) if complete(y, 1)]
    stat_sets = {"current": [last.year], "last": cal[-1:]} | {str(n): cal[-n:] for n in N_YEARS if len(cal) >= n}

    ret = close.pct_change().dropna()
    days = pd.DataFrame({"year": ret.index.year, "month": ret.index.month, "day": ret.index.day, "wd": ret.index.weekday, "ret": ret.values})
    days["up"] = days.ret > 0
    days["n"] = days.ret != 0
    # a month counts as up when its last close is above its first close (the reference tool measures months this way)
    per = close.groupby(close.index.to_period("M"))
    dates = close.index.to_series().groupby(close.index.to_period("M"))
    months = pd.DataFrame({"ret": per.last() / per.first() - 1, "d0": dates.first(), "d1": dates.last()})
    whole = (months.d0 - months.index.start_time <= 5 * DAY) & (months.index.end_time.normalize() - months.d1 <= SLACK)  # not cut off by the data
    months = pd.DataFrame({"year": months.index.year, "month": months.index.month, "ret": months.ret.values})[whole.values]
    months["up"] = months.ret > 0

    stats = {}
    for key, years in stat_sets.items():
        if not years:
            continue
        d, m = days[days.year.isin(years)], months[months.year.isin(years)]
        up, n = np.zeros((12, 31), int), np.zeros((12, 31), int)
        np.add.at(up, (d.month.values - 1, d.day.values - 1), d.up.values.astype(int))
        np.add.at(n, (d.month.values - 1, d.day.values - 1), d.n.values.astype(int))
        wd = d.groupby("wd").agg(up=("up", "sum"), n=("n", "sum"), avg=("ret", "mean")).reindex(range(7))
        mo = m.groupby("month").agg(up=("up", "sum"), n=("up", "size"), avg=("ret", "mean")).reindex(range(1, 13))
        stats[key] = {
            "years": years,
            "daily": {"up": up.tolist(), "n": n.tolist()},
            "weekday": {"up": wd.up.fillna(0).astype(int).tolist(), "n": wd.n.fillna(0).astype(int).tolist(), "avg": _round(wd.avg.values * 100, 3)},
            "monthly": {"up": mo.up.fillna(0).astype(int).tolist(), "n": mo.n.fillna(0).astype(int).tolist(), "avg": _round(mo.avg.values * 100, 3)},
        }

    return {
        "symbol": symbol, "vs": vs or None, "name": meta["name"], "currency": meta["currency"], "warning": meta.get("warning"),
        "firstDate": first.strftime("%Y-%m-%d"), "lastDate": last.strftime("%Y-%m-%d"), "startMonth": start_month,
        "curveYearsAvailable": len(ys), "statYearsAvailable": len(cal),
        "dates": [dummy[i].strftime("%Y-%m-%d") for i in keep], "series": series, "stats": stats,
    }


def _month_day(s: str) -> tuple[int, int]:
    m = re.fullmatch(r"(\d{2})-(\d{2})", s or "")
    try:
        if not m:
            raise ValueError
        month, day = int(m[1]), int(m[2])
        dt.date(2024, month, day)  # a leap year, so 02-29 is accepted
    except ValueError:
        raise DataError(400, "Dates must look like MM-DD") from None
    return month, day


def _on(year: int, month: int, day: int) -> pd.Timestamp:
    return pd.Timestamp(year, month, min(day, calendar.monthrange(year, month)[1]))


def _nearest(idx: pd.DatetimeIndex, day: pd.Timestamp) -> int:
    """Position of the trading day closest to `day` (a Saturday goes back to Friday, a Sunday forward to Monday)."""
    after = int(idx.searchsorted(day, side="left"))
    if after == 0:
        return 0
    if after == len(idx):
        return len(idx) - 1
    return after if (idx[after] - day) < (day - idx[after - 1]) else after - 1


@upstream
def trades(symbol: str, vs: str, start: str, end: str) -> dict:
    """Buy at the close on `start` (MM-DD), sell at the close on `end` (nearest trading day), in every past year; the last 30 finished trades."""
    (sm, sd), (em, ed) = _month_day(start), _month_day(end)
    df, meta = _series(symbol, vs)
    idx, last = df.index, df.index[-1]
    rows = []
    for y in range(idx[0].year, last.year + 1):
        opened, closed = _on(y, sm, sd), _on(y + ((em, ed) < (sm, sd)), em, ed)  # a window like 11-15 -> 02-15 crosses New Year
        i0, i1 = _nearest(idx, opened), _nearest(idx, closed)
        if i1 <= i0 or closed > last + SLACK:
            continue
        if abs((idx[i0] - opened).days) > 6 or abs((closed - idx[i1]).days) > 6:  # the history starts late or has a hole here
            continue
        o, c = float(df.Close.iloc[i0]), float(df.Close.iloc[i1])
        path = df.iloc[i0 + 1:i1 + 1]  # the days after entry: intraday extremes decide how far the trade went against or for you
        rows.append({
            "year": y, "openDate": idx[i0].strftime("%Y-%m-%d"), "closeDate": idx[i1].strftime("%Y-%m-%d"), "open": round(o, 4), "close": round(c, 4),
            "ret": (c / o - 1) * 100, "maxDrop": min(0.0, float(path.Low.min()) / o * 100 - 100), "maxRise": max(0.0, float(path.High.max()) / o * 100 - 100),
        })
    if not rows:
        raise DataError(422, f"No finished trades between {start} and {end} in the price history of {meta['name']}")
    return {"symbol": symbol, "vs": vs or None, "start": start, "end": end, "spread": bool(vs), "rows": rows[::-1][:30]}
