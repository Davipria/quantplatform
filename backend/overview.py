"""Overview page: company header, price history, dividends, upcoming events, and optional overlay series.

Prices are end-of-day closes from yfinance, split-adjusted but not dividend-adjusted (same as the seasonality module, whose
cached download is reused). Performance, drawdown and yearly returns are computed in the browser from these closes.
Overlays (sales, net income, free cash flow, P/E) are loaded on demand:
  * sales / net income / free cash flow: trailing-12-month values from SEC filings via Finnhub (US filers only), one point per
    filing, taken from the same "snapshots" the Solidity tab uses;
  * P/E: daily price / trailing-12-month EPS, where the EPS is backed out of Finnhub's quarterly P/E (price on Finnhub's valuation
    day / P/E) and applied only after the usual filing lag, so there is no look-ahead.
"""
import datetime as dt
from concurrent.futures import ThreadPoolExecutor

import pandas as pd
import yfinance as yf
from cachetools.func import ttl_cache

import data
import seasonality
import solidity
from data import FILING_LAG_DAYS, DataError, upstream

PE_MAX = 200  # a P/E above this is a near-zero-earnings artefact: left out so it does not flatten the chart


@upstream
def header(symbol: str) -> dict:
    info = yf.Ticker(symbol).info
    name = info.get("longName") or info.get("shortName")
    if not name:
        raise DataError(404, f"Unknown ticker {symbol}")
    return {
        "symbol": symbol, "name": name, "exchange": info.get("fullExchangeName") or info.get("exchange"),
        "sector": info.get("sector"), "industry": info.get("industry"), "country": info.get("country"),
        "currency": info.get("currency"), "marketCap": info.get("marketCap"), "website": info.get("website"),
        "price": info.get("regularMarketPrice") or info.get("currentPrice"), "previousClose": info.get("previousClose"),
        "type": info.get("quoteType"),
    }


@ttl_cache(maxsize=256, ttl=10)
def quote(symbol: str) -> dict:
    """Latest price from Yahoo, for the header and the last point of the Overview chart; polled by the browser, so it is cached
    for 10 s only (not an hour like everything else). `live` = the exchange is in its regular session (always for crypto);
    `delay` = minutes Yahoo lags the exchange (0 for US listings, 15-20 for most others); `date` = the trading day in the
    exchange's own time zone, so the browser can tell whether to replace the chart's last close or add a new day."""
    try:
        info = yf.Ticker(symbol).info
    except Exception as e:  # noqa: BLE001
        raise DataError(502, str(e)) from e
    price = info.get("regularMarketPrice") or info.get("currentPrice")
    if not price:
        raise DataError(404, f"No price for {symbol}")
    ts = info.get("regularMarketTime")
    when = pd.Timestamp(ts, unit="s", tz="UTC").tz_convert(info.get("exchangeTimezoneName") or "UTC") if ts else None
    return {
        "symbol": symbol, "price": float(price), "currency": info.get("currency"),
        "previousClose": info.get("regularMarketPreviousClose") or info.get("previousClose"),
        "time": int(ts) if ts else None, "date": when.strftime("%Y-%m-%d") if when is not None else None,
        "marketState": info.get("marketState"), "live": info.get("marketState") == "REGULAR",
        "delay": info.get("exchangeDataDelayedBy") or 0,
    }


INTRADAY = {"1d": ("1d", "1m", 60), "1w": ("5d", "5m", 300)}  # range -> (Yahoo period, bar interval, bar length in seconds)


@ttl_cache(maxsize=256, ttl=60)
def intraday(symbol: str, rng: str) -> dict:
    """Intraday bars for the Overview's "Today" (last session, 1-minute bars) and "1 Week" (last 5 sessions, 5-minute bars) ranges.
    Regular session only. `times` are bar start times in the exchange's own time zone; `last` is the last bar's start (epoch s)."""
    period, interval, step = INTRADAY[rng]
    t = yf.Ticker(symbol)
    try:
        close = t.history(period=period, interval=interval, auto_adjust=False)["Close"].dropna()
    except Exception as e:  # noqa: BLE001
        raise DataError(502, str(e)) from e
    if close.empty:
        raise DataError(404, f"No intraday prices for {symbol}")
    return {
        "symbol": symbol, "range": rng, "step": step, "timezone": str(close.index.tz or "UTC"),
        "times": [d.strftime("%Y-%m-%d %H:%M") for d in close.index], "close": [round(float(v), 4) for v in close],
        "last": int(close.index[-1].timestamp()),
    }


@ttl_cache(maxsize=512, ttl=60)
def watch_row(symbol: str) -> dict:
    """One watchlist row from a single Yahoo chart request: name, latest price, change vs the previous close, whether the market is
    open now, and a sparkline of the last two sessions in 15-minute bars. `split` = number of bars before the last session (drawn
    grey, the last session in colour). `open` = now is inside today's regular session AND the last bar is from today (so holidays
    count as closed)."""
    t = yf.Ticker(symbol)
    try:
        close = t.history(period="2d", interval="15m", auto_adjust=False)["Close"].dropna()
        meta = t.history_metadata or {}
    except Exception as e:  # noqa: BLE001
        raise DataError(502, str(e)) from e
    price = meta.get("regularMarketPrice")
    if close.empty or not price:
        raise DataError(404, f"No prices for {symbol}")
    days = close.index.date
    last_day = days[-1]
    split = int((days < last_day).sum())
    prev = meta.get("previousClose") or (float(close.iloc[split - 1]) if split else None)
    regular = (meta.get("currentTradingPeriod") or {}).get("regular") or {}
    try:
        now = pd.Timestamp.now(tz=close.index.tz)
        is_open = regular["start"] <= now <= regular["end"] and regular["start"].date() == last_day
    except (KeyError, TypeError):
        is_open = False
    when = meta.get("regularMarketTime")
    return {
        "symbol": symbol, "name": (meta.get("longName") or meta.get("shortName") or symbol).strip(),
        "type": meta.get("instrumentType"), "currency": meta.get("currency"), "price": float(price),
        "previousClose": prev, "change": (price / prev - 1) * 100 if prev else None, "open": bool(is_open),
        "time": int(when.timestamp()) if hasattr(when, "timestamp") else None,
        "spark": [round(float(v), 4) for v in close], "split": split,
    }


def watchlist(symbols: list[str]) -> list[dict]:
    """Rows in the order asked; a symbol that fails gives {"symbol", "error"} instead of failing the whole list."""
    def row(s):
        try:
            return watch_row(s)
        except DataError as e:
            return {"symbol": s, "error": str(e)}
    with ThreadPoolExecutor(8) as ex:
        return list(ex.map(row, symbols))


def _events(t: yf.Ticker) -> list[dict]:
    """Upcoming ex-dividend / payment / earnings dates (Yahoo's calendar); empty when Yahoo has none."""
    try:
        cal = t.calendar or {}
    except Exception:  # noqa: BLE001  (Yahoo returns nothing useful for ETFs, indices, crypto ...)
        return []
    today = dt.date.today()
    labels = [("Ex-Dividend Date", "Ex-dividend date"), ("Dividend Date", "Dividend payment date"), ("Earnings Date", "Earnings report")]
    out = []
    for key, label in labels:
        v = cal.get(key)
        d = (v[0] if isinstance(v, list) and v else v)
        if isinstance(d, dt.datetime):
            d = d.date()
        if isinstance(d, dt.date) and d >= today:
            out.append({"label": label, "date": d.isoformat(), "days": (d - today).days})
    return sorted(out, key=lambda e: e["date"])


@upstream
def overview(symbol: str) -> dict:
    df, meta = seasonality._prices(symbol)
    t = yf.Ticker(symbol)
    div = t.dividends
    dividends = []
    if len(div):
        idx = pd.DatetimeIndex(div.index).tz_localize(None).normalize()
        dividends = [{"date": d.strftime("%Y-%m-%d"), "value": round(float(v), 6)} for d, v in zip(idx, div.to_numpy()) if v > 0]
    return {
        "symbol": symbol, "currency": meta["currency"],
        "dates": [d.strftime("%Y-%m-%d") for d in df.index], "close": [round(float(v), 4) for v in df.Close],
        "dividends": dividends, "events": _events(t),
    }


def _pe(symbol: str) -> dict:
    series = data.finnhub_series(symbol, "quarterly")
    if series is None:
        raise DataError(503, "This overlay needs FINNHUB_API_KEY in the .env file")
    pe = {p["period"]: p["v"] for p in series.get("peTTM", []) if p["v"] and p["v"] > 0}
    if not pe:
        raise DataError(422, f"No trailing P/E history for {symbol} (loss-making, or not covered by Finnhub's free tier)")
    df, _ = seasonality._prices(symbol)
    close = df.Close
    periods = sorted({p["period"] for p in series.get("eps", [])} | set(pe))
    steps = []  # (date the EPS became public, trailing EPS); None EPS = loss-making period: no P/E
    for period in periods:
        d = pd.Timestamp(period)
        i = close.index.searchsorted(d)  # Finnhub values a quarter on the first trading day on or after its end
        eps = float(close.iloc[i] / pe[period]) if period in pe and i < len(close) else None
        steps.append((d + pd.Timedelta(days=FILING_LAG_DAYS), eps))
    eps_by_day = pd.merge_asof(
        pd.DataFrame({"day": close.index, "close": close.to_numpy()}),
        pd.DataFrame(steps, columns=["day", "eps"]).astype({"day": close.index.dtype}),
        on="day",
    )
    ratio = eps_by_day.close / eps_by_day.eps
    ok = eps_by_day.eps.notna() & (ratio > 0) & (ratio <= PE_MAX)
    kept = eps_by_day[ok]
    return {"dates": [d.strftime("%Y-%m-%d") for d in kept.day], "values": [round(float(v), 2) for v in ratio[ok]]}


def _fundamental(symbol: str, kind: str) -> dict:
    points = []
    for s in solidity._snapshots(symbol):
        f = s["flow"]
        if kind == "fcf":
            v = f["cfo"] - f["capex"] if f["cfo"] is not None and f["capex"] is not None else None
        else:
            v = f["revenue" if kind == "sales" else "net_income"]
        if v is not None:
            points.append((s["end"].strftime("%Y-%m-%d"), float(v)))
    if len(points) < 2:
        raise DataError(422, f"Not enough reported {kind} data for {symbol}")
    return {"dates": [p[0] for p in points], "values": [p[1] for p in points]}


OVERLAYS = ("sales", "income", "fcf", "pe")


@upstream
def overlay(symbol: str, kind: str) -> dict:
    return {"kind": kind, **(_pe(symbol) if kind == "pe" else _fundamental(symbol, kind))}
