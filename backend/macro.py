"""Macro view: Treasury yield curve, inflation, inflation expectations, labor market and the Fed's policy rate, all from the
Federal Reserve series Massive serves (see massive.py). Everything derived here is computed from those raw series:

- 2s10s and 3M-10Y spreads (negative = inverted curve)
- CPI year-on-year and 3-month annualised (the API gives the CPI index level, not a percentage)
- real 10-year yield = 10-year yield (last day of the month) - the model's 10-year inflation expectation
- wage growth year-on-year from average hourly earnings
- Sahm rule: 3-month average unemployment minus its lowest value over the last 12 months (0.50 or more has marked every US
  recession start since 1970)

Also here: the CPI index for inflation-adjusted price charts (`cpi`), and a stock's sensitivity to interest rates
(`rate_sensitivity`): monthly returns regressed on the monthly change in the 10-year yield, alone and together with the S&P 500's
return (the second isolates the rate effect from "the whole market moved").
"""
import datetime as dt

import numpy as np
import pandas as pd
import yfinance as yf
from cachetools.func import ttl_cache

import data
import massive
from data import DataError, upstream
from forecast import extrapolate

MATURITIES = [("yield_1_month", "1M"), ("yield_3_month", "3M"), ("yield_1_year", "1Y"), ("yield_2_year", "2Y"),
              ("yield_5_year", "5Y"), ("yield_10_year", "10Y"), ("yield_30_year", "30Y")]
LABOR_SINCE, INFLATION_SINCE, POLICY_SINCE = "1948-01-01", "1947-01-01", "2015-01-01"


def _frame(rows: list[dict]) -> pd.DataFrame:
    df = pd.DataFrame(rows)
    df["date"] = pd.to_datetime(df["date"])
    return df.set_index("date").sort_index()


def _list(s: pd.Series, digits: int = 3) -> list:
    return [None if pd.isna(v) else round(float(v), digits) for v in s]


def _dates(idx) -> list[str]:
    return [d.strftime("%Y-%m-%d") for d in idx]


def _weekly(df: pd.DataFrame) -> pd.DataFrame:
    """Last observation of every week: keeps a 35-year daily series light for the browser."""
    week = df.index.to_period("W")
    return df[~pd.Series(week, index=df.index).duplicated(keep="last")]


def _latest(s: pd.Series):
    s = s.dropna()
    return (None, None) if s.empty else (float(s.iloc[-1]), s.index[-1].strftime("%Y-%m-%d"))


def _on_or_before(df: pd.DataFrame, day: pd.Timestamp) -> pd.Series:
    return df.loc[:day].iloc[-1]


def _yields() -> tuple[dict, pd.DataFrame]:
    df = _frame(massive.treasury_yields())[[c for c, _ in MATURITIES]]
    df = df.dropna(how="all")
    now = df.index[-1]
    rows = {"today": df.iloc[-1], "monthAgo": _on_or_before(df, now - pd.DateOffset(months=1)),
            "yearAgo": _on_or_before(df, now - pd.DateOffset(years=1))}
    curve = [{"maturity": label, **{k: (None if pd.isna(r[col]) else float(r[col])) for k, r in rows.items()}} for col, label in MATURITIES]
    wk = _weekly(df)
    y10, y2, m3 = wk["yield_10_year"], wk["yield_2_year"], wk["yield_3_month"]
    out = {
        "curve": curve, "date": now.strftime("%Y-%m-%d"),
        "dateMonthAgo": rows["monthAgo"].name.strftime("%Y-%m-%d"), "dateYearAgo": rows["yearAgo"].name.strftime("%Y-%m-%d"),
        "dates": _dates(wk.index), "m3": _list(m3), "y2": _list(y2), "y10": _list(y10), "y30": _list(wk["yield_30_year"]),
        "s2s10": _list(y10 - y2), "s3m10": _list(y10 - m3),
    }
    return out, df


def _inflation() -> dict:
    df = _frame(massive.dataset("inflation", INFLATION_SINCE, 12))
    yoy, core = df["cpi"].pct_change(12) * 100, df["cpi_core"].pct_change(12) * 100
    ann3 = ((df["cpi"] / df["cpi"].shift(3)) ** 4 - 1) * 100
    valid = yoy.notna()
    return {"dates": _dates(df.index[valid]), "cpi": _list(yoy[valid], 2), "core": _list(core[valid], 2), "cpi3m": _list(ann3[valid], 2)}


def _expectations(daily: pd.DataFrame) -> dict:
    df = _frame(massive.dataset("inflation-expectations", "1982-01-01", 12))
    month_end = daily["yield_10_year"].dropna().groupby(daily["yield_10_year"].dropna().index.to_period("M")).last()
    real = pd.Series([month_end.get(d.to_period("M")) for d in df.index], index=df.index, dtype=float) - df["model_10_year"]
    return {"dates": _dates(df.index), "y1": _list(df["model_1_year"], 2), "y5": _list(df["model_5_year"], 2),
            "y10": _list(df["model_10_year"], 2), "y30": _list(df["model_30_year"], 2), "real10": _list(real, 2)}


def _labor() -> dict:
    df = _frame(massive.dataset("labor-market", LABOR_SINCE, 12))
    ma3 = df["unemployment_rate"].rolling(3).mean()
    sahm = ma3 - ma3.rolling(12, min_periods=12).min()
    ahe_yoy = df["avg_hourly_earnings"].pct_change(12, fill_method=None) * 100
    valid = df["unemployment_rate"].notna()
    openings = df["job_openings"].dropna() if "job_openings" in df else pd.Series(dtype=float)
    return {
        "dates": _dates(df.index[valid]), "unemployment": _list(df["unemployment_rate"][valid], 2),
        "participation": _list(df["labor_force_participation_rate"][valid], 2), "aheYoy": _list(ahe_yoy[valid], 2),
        "sahm": _list(sahm[valid], 2),
        "openings": None if openings.empty else {"value": float(openings.iloc[-1]), "date": openings.index[-1].strftime("%Y-%m-%d")},
    }


def _policy() -> tuple[dict, pd.DataFrame]:
    df = _frame(massive.dataset("funding-conditions", POLICY_SINCE, 6))
    keep = df[["fed_funds_target_upper", "fed_funds_target_lower", "effective_fed_funds_rate", "secured_overnight_financing_rate"]]
    wk = _weekly(keep.ffill())  # the newest days lack some fields until they are published; carry the last value
    out = {"dates": _dates(wk.index), "upper": _list(wk["fed_funds_target_upper"], 2), "lower": _list(wk["fed_funds_target_lower"], 2),
           "effr": _list(wk["effective_fed_funds_rate"], 2), "sofr": _list(wk["secured_overnight_financing_rate"], 2)}
    return out, keep


@ttl_cache(maxsize=1, ttl=6 * 3600)
def macro() -> dict:
    yields, daily = _yields()
    inflation, labor, expectations = _inflation(), _labor(), _expectations(daily)
    policy, policy_daily = _policy()
    last = lambda s: next((v for v in reversed(s) if v is not None), None)  # noqa: E731  (lists hold None for gaps)
    y10, y10_date = _latest(daily["yield_10_year"])
    tiles = {
        "y10": {"value": y10, "date": y10_date},
        "s2s10": {"value": last(yields["s2s10"]), "date": yields["dates"][-1]},
        "s3m10": {"value": last(yields["s3m10"]), "date": yields["dates"][-1]},
        "cpi": {"value": last(inflation["cpi"]), "date": inflation["dates"][-1]},
        "core": {"value": last(inflation["core"]), "date": inflation["dates"][-1]},
        "unemployment": {"value": last(labor["unemployment"]), "date": labor["dates"][-1]},
        "sahm": {"value": last(labor["sahm"]), "date": labor["dates"][-1]},
        "wages": {"value": last(labor["aheYoy"]), "date": labor["dates"][-1]},
        "real10": {"value": last(expectations["real10"]), "date": expectations["dates"][-1]},
    }
    upper, upper_date = _latest(policy_daily["fed_funds_target_upper"])
    lower, _ = _latest(policy_daily["fed_funds_target_lower"])
    tiles["policy"] = {"upper": upper, "lower": lower, "date": upper_date}
    return {"asOf": dt.date.today().isoformat(), "tiles": tiles, "yields": yields, "inflation": inflation,
            "expectations": expectations, "labor": labor, "policy": policy}


FORECAST_SERIES = {  # key -> (label, step, horizon, context cap)
    "y10": ("10-year Treasury yield", "week", 26, 520),
    "cpi": ("CPI, year on year", "month", 12, 240),
    "unemployment": ("Unemployment rate", "month", 12, 240),
}


def _series_values(series: str) -> tuple[list[str], list[float]]:
    m = macro()
    if series == "y10":
        return m["yields"]["dates"], m["yields"]["y10"]
    if series == "cpi":
        return m["inflation"]["dates"], m["inflation"]["cpi"]
    return m["labor"]["dates"], m["labor"]["unemployment"]


@ttl_cache(maxsize=8, ttl=6 * 3600)
def forecast(series: str) -> dict:
    """Zero-shot forecast (TimesFM, see `forecast.py`) of one macro series, at its own natural step (weekly for yields,
    monthly for inflation/labor). A statistical extrapolation of the recent pattern, not an economic model or a Fed
    projection -- treat it the same way as the Overview price forecast."""
    if series not in FORECAST_SERIES:
        raise DataError(400, f"Unknown series {series}")
    label, step, horizon, cap = FORECAST_SERIES[series]
    dates, values = _series_values(series)
    pairs = [(d, v) for d, v in zip(dates, values) if v is not None][-cap:]
    if len(pairs) < 30:
        raise DataError(422, f"Not enough history for {series} to forecast")
    clean_dates, clean_values = zip(*pairs)
    out = extrapolate(list(clean_values), horizon)
    last = pd.Timestamp(clean_dates[-1])
    step_offset = pd.DateOffset(weeks=1) if step == "week" else pd.DateOffset(months=1)
    future = [(last + step_offset * i).strftime("%Y-%m-%d") for i in range(1, horizon + 1)]
    return {"series": series, "label": label, "lastDate": clean_dates[-1], "lastValue": clean_values[-1], "dates": future, **out}


@ttl_cache(maxsize=1, ttl=6 * 3600)
def cpi() -> dict:
    """Monthly CPI index level (first day of each month), for converting prices into today's dollars."""
    rows = [r for r in massive.dataset("inflation", INFLATION_SINCE, 12) if r.get("cpi") is not None]
    return {"dates": [r["date"] for r in rows], "cpi": [r["cpi"] for r in rows]}


INFLATION_HIGH = 4.0  # CPI year on year, % (the regime split)
ROLL_MONTHS = 36


def _month_end(s: pd.Series) -> pd.Series:
    s = s.dropna()
    return s.groupby(s.index.to_period("M")).last()


def _closes(symbol: str) -> pd.Series:
    px = data.price_history(yf.Ticker(symbol))["Close"].dropna()
    if px.empty:
        raise DataError(404, f"No price history for {symbol}")
    px.index = px.index.tz_localize(None)
    return px


def _ols(y: np.ndarray, x: np.ndarray) -> tuple[np.ndarray, np.ndarray, float]:
    """Coefficients (constant first), their t-statistics and R squared."""
    X = np.column_stack([np.ones(len(y)), x])
    beta, *_ = np.linalg.lstsq(X, y, rcond=None)
    resid = y - X @ beta
    dof = len(y) - X.shape[1]
    se = np.sqrt(np.diag(resid @ resid / dof * np.linalg.inv(X.T @ X)))
    r2 = 1 - resid @ resid / ((y - y.mean()) @ (y - y.mean()))
    return beta, beta / se, float(r2)


def _r(v, d=3):
    return None if v is None or not np.isfinite(v) else round(float(v), d)


@upstream
def rate_sensitivity(symbol: str) -> dict:
    stock = _month_end(_closes(symbol))
    market = _month_end(_closes("^GSPC"))
    daily = _frame(massive.treasury_yields())
    y10 = _month_end(daily["yield_10_year"])
    infl = _frame(massive.dataset("inflation", INFLATION_SINCE, 12))["cpi"]
    cpi_yoy = infl.groupby(infl.index.to_period("M")).last().pct_change(12) * 100

    df = pd.DataFrame({"ret": stock.pct_change() * 100, "mkt": market.pct_change() * 100, "dy": y10.diff(), "cpi": cpi_yoy})
    df = df[df.index < pd.Timestamp.today().to_period("M")]  # the current month is not finished
    df = df.dropna(subset=["ret", "mkt", "dy"])
    if len(df) < 24:
        raise DataError(422, f"Not enough monthly history for {symbol} (at least 2 years needed)")

    windows = []
    for label, months in (("5 years", 60), ("10 years", 120), ("all", len(df))):
        w = df.tail(months)
        if len(w) < months or label == "all":
            label = f"Since {w.index[0].strftime('%b %Y')}"
        if len(w) < 24 or (windows and len(w) == windows[-1]["months"]):
            continue
        (_, b), (_, t), r2 = _ols(w["ret"].to_numpy(), w["dy"].to_numpy())
        (_, bn, bm), (_, tn, _), r2n = _ols(w["ret"].to_numpy(), w[["dy", "mkt"]].to_numpy())
        windows.append({
            "label": label, "months": len(w), "from": str(w.index[0]), "to": str(w.index[-1]),
            "rateBeta": _r(b), "rateT": _r(t, 2), "corr": _r(w["ret"].corr(w["dy"])), "r2": _r(r2),
            "rateBetaNet": _r(bn), "rateNetT": _r(tn, 2), "marketBeta": _r(bm), "r2Net": _r(r2n),
        })

    rolling = {"dates": [], "beta": []}
    arr = df[["ret", "dy", "mkt"]].to_numpy()
    for i in range(ROLL_MONTHS, len(df) + 1):
        chunk = arr[i - ROLL_MONTHS:i]
        (_, bn, _), _, _ = _ols(chunk[:, 0], chunk[:, 1:])
        rolling["dates"].append(df.index[i - 1].strftime("%Y-%m"))
        rolling["beta"].append(_r(bn))

    def regime(label: str, mask: pd.Series) -> dict:
        r = df.loc[mask.fillna(False), "ret"]
        return {"label": label, "months": int(len(r)), "avg": _r(r.mean(), 2) if len(r) else None, "up": _r((r > 0).mean() * 100, 1) if len(r) else None}

    recent = df.tail(120)
    return {
        "symbol": symbol, "from": str(df.index[0]), "to": str(df.index[-1]), "windows": windows, "rolling": rolling,
        "scatter": {"dates": [str(p) for p in recent.index], "dy": [_r(v) for v in recent["dy"]], "ret": [_r(v, 2) for v in recent["ret"]]},
        "regimes": [
            regime("10Y yield rose that month", df["dy"] > 0), regime("10Y yield fell that month", df["dy"] < 0),
            regime(f"CPI inflation {INFLATION_HIGH:.0f}% or more", df["cpi"] >= INFLATION_HIGH), regime(f"CPI inflation below {INFLATION_HIGH:.0f}%", df["cpi"] < INFLATION_HIGH),
            regime("All months", pd.Series(True, index=df.index)),
        ],
    }
