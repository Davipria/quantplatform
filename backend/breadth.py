"""Market breadth and stock scans, computed from the daily bars market.py collects (US common stocks, up to ~300 sessions).

Universe: common stocks that were liquid (>= $2M traded, price >= $2) on at least 90% of the stored sessions. Time-series measures
(moving averages, highs and lows, momentum, volatility) leave out a stock that had a one-day move below -50% or above +100% in the
window: that is nearly always a split or reverse split that happened after its older days were stored.

- advancers / decliners, up-volume share, the cumulative advance-decline line
- share of stocks above their 20 / 50 / 200-day average
- new highs and new lows: a close above (below) every close of the previous N sessions, N = 252 or fewer while history is short
- top gainers and losers, most active (dollar volume), volume spikes (volume >= 3x its 20-day average)
- momentum: return from N months ago to 1 month ago (12-1 needs 274 sessions, 6-1 needs 148, 3-1 needs 85), the classic factor
  that skips the latest month; low volatility: lowest 60-day volatility, annualised
"""
import datetime as dt
import contextlib

import numpy as np
import pandas as pd
from cachetools.func import ttl_cache

import market
from data import DataError

MIN_COVERAGE = 0.9
SPLIT_DOWN, SPLIT_UP = -0.5, 1.0
LIST_SIZE = 25
MOVER_DOLLAR_VOLUME, RANK_DOLLAR_VOLUME, LOWVOL_DOLLAR_VOLUME, SPIKE_DOLLAR_VOLUME = 5e6, 1e7, 2e7, 1e7
SPIKE_RATIO = 3.0
SKIP = 21  # the latest month (sessions) is left out of the momentum window
MOMENTUM_WINDOWS = [(252, "12-1 months"), (126, "6-1 months"), (63, "3-1 months")]  # (look-back in sessions before the skipped month, label)


@ttl_cache(maxsize=2, ttl=900)
def _frames(stamp: tuple) -> tuple[pd.DataFrame, pd.DataFrame, dict]:
    """Close and volume tables (rows = sessions, columns = tickers) of the universe, and ticker -> company name."""
    with contextlib.closing(market.connect()) as db:
        dates = [r[0] for r in db.execute("SELECT date FROM days WHERE n > 0 ORDER BY date")]
        if len(dates) < 2:
            raise DataError(404, "Not enough market history collected yet")
        names = dict(db.execute("SELECT ticker, name FROM stocks").fetchall())
        marks = ",".join("?" * len(dates))
        rows = db.execute(f"SELECT date, ticker, c, v FROM bars WHERE date IN ({marks}) AND ticker IN (SELECT ticker FROM stocks)", dates).fetchall()
    df = pd.DataFrame(rows, columns=["date", "ticker", "c", "v"])
    close = df.pivot(index="date", columns="ticker", values="c").reindex(dates)
    vol = df.pivot(index="date", columns="ticker", values="v").reindex(dates)
    keep = close.columns[close.notna().mean() >= MIN_COVERAGE]
    return close[keep].ffill(limit=3), vol[keep].ffill(limit=3), names


def _none(v, digits=2):
    return None if v is None or not np.isfinite(v) else round(float(v), digits)


def _series(s: pd.Series, digits=2) -> list:
    return [_none(v, digits) for v in s]


def breadth() -> dict:
    prog = market.progress()
    if prog["sessions"] < 2 or not prog["commonStocks"]:
        return {"status": prog, "ready": False}
    close, vol, names = _frames((prog["newest"], prog["sessions"], prog["commonStocks"]))
    n = len(close)
    dates = list(close.index)
    ret = close.pct_change()
    clean = ret.columns[~((ret < SPLIT_DOWN).any() | (ret > SPLIT_UP).any())]

    adv, dec = (ret > 0).sum(axis=1), (ret < 0).sum(axis=1)
    up_vol = vol.where(ret > 0).sum(axis=1)
    dn_vol = vol.where(ret < 0).sum(axis=1)
    net = (adv - dec).where(ret.notna().any(axis=1))
    net.iloc[0] = 0  # the first stored session has no previous close
    above = {}
    for w in (20, 50, 200):
        ma = close[clean].rolling(w, min_periods=w).mean()
        ok = ma.notna().sum(axis=1)
        above[w] = ((close[clean] > ma).sum(axis=1) / ok.where(ok > 0) * 100)
    win = min(252, n - 1)
    hi = lo = pd.Series(np.nan, index=close.index)
    if win >= 20:
        prev_max = close[clean].shift(1).rolling(win, min_periods=win).max()
        prev_min = close[clean].shift(1).rolling(win, min_periods=win).min()
        hi, lo = (close[clean] > prev_max).sum(axis=1).where(prev_max.notna().any(axis=1)), (close[clean] < prev_min).sum(axis=1).where(prev_min.notna().any(axis=1))

    last = dates[-1]
    tot_vol = up_vol.iloc[-1] + dn_vol.iloc[-1]
    # tables for the latest session
    px, r1, v1 = close.iloc[-1], ret.iloc[-1], vol.iloc[-1]
    dv = px * v1
    avg_dv = (close * vol).tail(20).mean()
    liquid = lambda floor: dv[dv >= floor].index  # noqa: E731

    def row(t, **extra):
        return {"symbol": t.replace(".", "-"), "name": names.get(t) or "", "price": _none(px[t]), "change": _none(r1[t] * 100), "dollarVolume": _none(dv[t], 0), **extra}

    movers = r1[liquid(MOVER_DOLLAR_VOLUME)].dropna()
    lists = {
        "gainers": [row(t) for t in movers.nlargest(LIST_SIZE).index],
        "losers": [row(t) for t in movers.nsmallest(LIST_SIZE).index],
        "active": [row(t) for t in dv.nlargest(LIST_SIZE).index],
    }
    if n >= 22:
        ratio = (v1 / vol.iloc[-21:-1].mean())[liquid(SPIKE_DOLLAR_VOLUME)].replace([np.inf, -np.inf], np.nan).dropna()
        lists["spikes"] = [row(t, volumeRatio=_none(ratio[t], 1)) for t in ratio[ratio >= SPIKE_RATIO].nlargest(LIST_SIZE).index]
    if win >= 20:
        cl = close[clean]
        is_hi = (cl.iloc[-1] > cl.shift(1).rolling(win, min_periods=win).max().iloc[-1])
        is_lo = (cl.iloc[-1] < cl.shift(1).rolling(win, min_periods=win).min().iloc[-1])
        lists["highs"] = [row(t) for t in avg_dv[is_hi[is_hi].index].nlargest(LIST_SIZE).index]
        lists["lows"] = [row(t) for t in avg_dv[is_lo[is_lo].index].nlargest(LIST_SIZE).index]
    momentum = next(((back, label) for back, label in MOMENTUM_WINDOWS if n >= back + SKIP + 1), None)  # e.g. 12-1 needs 274 sessions
    if momentum:
        back, label = momentum
        m = (close[clean].iloc[-1 - SKIP] / close[clean].iloc[-1 - SKIP - back] - 1) * 100
        m = m[avg_dv[clean] >= RANK_DOLLAR_VOLUME].replace([np.inf, -np.inf], np.nan).dropna()
        lists["momentumTop"] = [row(t, momentum=_none(m[t], 1)) for t in m.nlargest(LIST_SIZE).index]
        lists["momentumBottom"] = [row(t, momentum=_none(m[t], 1)) for t in m.nsmallest(LIST_SIZE).index]
    if n >= 61:
        vol60 = ret[clean].tail(60).std() * np.sqrt(252) * 100
        vol60 = vol60[avg_dv[clean] >= LOWVOL_DOLLAR_VOLUME].dropna()
        lists["lowVolatility"] = [row(t, volatility=_none(vol60[t], 1)) for t in vol60.nsmallest(LIST_SIZE).index]

    return {
        "ready": True, "status": prog, "asOf": last, "universe": int(close.shape[1]), "cleanUniverse": int(len(clean)), "highWindow": win if win >= 20 else None,
        "momentumLabel": momentum[1] if momentum else None,
        "latest": {
            "advancers": int(adv.iloc[-1]), "decliners": int(dec.iloc[-1]), "unchanged": int(ret.iloc[-1].notna().sum() - adv.iloc[-1] - dec.iloc[-1]),
            "upVolumeShare": _none(up_vol.iloc[-1] / tot_vol * 100, 1) if tot_vol else None,
            "above20": _none(above[20].iloc[-1], 1), "above50": _none(above[50].iloc[-1], 1), "above200": _none(above[200].iloc[-1], 1),
            "highs": _none(hi.iloc[-1], 0), "lows": _none(lo.iloc[-1], 0),
        },
        "series": {
            "dates": dates, "net": _series(net, 0), "adLine": _series(net.fillna(0).cumsum(), 0),
            "above20": _series(above[20], 1), "above50": _series(above[50], 1), "above200": _series(above[200], 1),
            "highs": _series(hi, 0), "lows": _series(lo, 0),
        },
        "lists": lists,
    }


def traded_universe(size: int) -> list[dict]:
    """The `size` US common stocks with the highest average dollar volume over the last 20 stored sessions (symbols in Yahoo form)."""
    prog = market.progress()
    if prog["sessions"] < 2 or not prog["commonStocks"]:
        raise DataError(503, "The market data is still being collected (see the Market tab)")
    close, vol, names = _frames((prog["newest"], prog["sessions"], prog["commonStocks"]))
    top = (close * vol).tail(20).mean().nlargest(size).index
    return [{"symbol": t.replace(".", "-"), "name": names.get(t) or ""} for t in top]
