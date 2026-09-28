"""Data access and calculations: yfinance for prices/statements, Finnhub for reported ratio series."""
import collections
import datetime as dt
import email.utils
import functools
import html
import os
import re
import threading
import time

import pandas as pd
import requests
import yfinance as yf
from cachetools.func import ttl_cache

# Fundamentals are only usable once published; 10-K/10-Q land ~45 days after period end.
FILING_LAG_DAYS = 45


class DataError(Exception):
    def __init__(self, status: int, message: str):
        super().__init__(message)
        self.status = status


def upstream(fn):
    """Cache for an hour and map unexpected provider failures to 502 (unknown symbol -> 404)."""
    @ttl_cache(maxsize=128, ttl=3600)
    @functools.wraps(fn)
    def wrapper(*args):
        try:
            return fn(*args)
        except DataError:
            raise
        except Exception as e:
            msg = str(e)
            raise DataError(404 if "not found" in msg.lower() or "delisted" in msg.lower() else 502, msg) from e
    return wrapper


HOURLY_DAYS = 720  # Yahoo serves hourly bars for the last 730 days only


def price_history(t: yf.Ticker) -> pd.DataFrame:
    """Full daily history (Close is split-adjusted, not dividend-adjusted). Yahoo sometimes sends an EMPTY daily bar for a day
    that did trade (2026-09-22 for every US stock: no prices, volume 0), which yfinance silently drops. Such bars are rebuilt from
    that day's hourly bars (recent two years only); the ones that cannot be rebuilt (older, or no trading at all) are dropped."""
    hist = t.history(period="max", auto_adjust=False, keepna=True)
    if hist.empty or "Close" not in hist:
        return hist
    gaps = hist.index[hist["Close"].isna()]
    gaps = gaps[gaps >= hist.index[-1] - pd.Timedelta(days=HOURLY_DAYS)]
    if len(gaps):
        try:
            hourly = t.history(start=gaps.min().strftime("%Y-%m-%d"), end=(gaps.max() + pd.Timedelta(days=1)).strftime("%Y-%m-%d"),
                               interval="1h", auto_adjust=False)
            days = pd.Series(hourly.index.date, index=hourly.index)
            for day in gaps:
                bars = hourly[days == day.date()]
                if bars.empty:
                    continue
                prev = hist.loc[:day, "Close"].dropna()
                adj = hist.loc[prev.index[-1], "Adj Close"] / prev.iloc[-1] if len(prev) and "Adj Close" in hist else 1.0
                hist.loc[day, ["Open", "High", "Low", "Close", "Volume"]] = [
                    bars["Open"].iloc[0], bars["High"].max(), bars["Low"].min(), bars["Close"].iloc[-1], bars["Volume"].sum()]
                if "Adj Close" in hist:
                    hist.loc[day, "Adj Close"] = bars["Close"].iloc[-1] * adj
        except Exception:  # noqa: BLE001  (best effort: without hourly bars the day is simply missing, as before)
            pass
    return hist.dropna(subset=["Close"])


def _row(df: pd.DataFrame, *names: str) -> pd.Series:
    """First matching row of a yfinance statement (labels vary by company), else empty."""
    for n in names:
        if n in df.index:
            return df.loc[n].astype(float)
    return pd.Series(dtype=float)


def _dedupe(s: pd.Series) -> pd.Series:
    return s[~s.index.duplicated()].sort_index()


def _records(df: pd.DataFrame) -> list[dict]:
    """DataFrame -> JSON-safe list of dicts (NaN becomes null)."""
    return df.astype(object).where(df.notna(), None).to_dict("records")


@upstream
def ev_ebitda_history(symbol: str) -> dict:
    """Daily EV/EBITDA plus the fundamentals table it is built from.

    EV = price * shares + total debt + minority interest - cash & ST investments, using the latest
    fundamentals published as of each day. EBITDA is trailing 12 months: fiscal-year EBITDA, or the
    sum of 4 consecutive quarters where available.
    """
    t = yf.Ticker(symbol)

    hist = price_history(t)  # Close is split-adjusted, not dividend-adjusted
    if hist.empty:
        raise DataError(404, f"No price data for {symbol}")
    px = hist["Close"].dropna()  # today's row can be empty while a market is closed
    px.index = px.index.tz_localize(None).normalize()

    ebitda_names = ("EBITDA", "Normalized EBITDA")
    ebitda_q = _row(t.quarterly_income_stmt, *ebitda_names).sort_index()
    ttm = _dedupe(pd.concat([_row(t.income_stmt, *ebitda_names), ebitda_q.rolling(4).sum().dropna()]))

    bs = pd.concat([t.balance_sheet, t.quarterly_balance_sheet], axis=1)
    bs = bs.loc[:, ~bs.columns.duplicated()]
    fund = pd.DataFrame({
        "ebitda": ttm,
        "debt": _dedupe(_row(bs, "Total Debt")),
        "cash": _dedupe(_row(bs, "Cash Cash Equivalents And Short Term Investments", "Cash And Cash Equivalents")),
        "minority": _dedupe(_row(bs, "Minority Interest")),
        "shares": _dedupe(_row(bs, "Ordinary Shares Number", "Share Issued")),
    }).sort_index()
    fund[["debt", "cash", "minority"]] = fund[["debt", "cash", "minority"]].fillna(0)
    fund["shares"] = fund["shares"].ffill()
    fund = fund.dropna(subset=["ebitda", "shares"])
    if fund.empty:
        raise DataError(422, f"No EBITDA / share count fundamentals for {symbol}")

    fund.index = pd.DatetimeIndex(fund.index).astype("datetime64[ns]")
    fund["available"] = fund.index + pd.Timedelta(days=FILING_LAG_DAYS)
    prices = px.rename("price").rename_axis("date").reset_index()
    prices["date"] = prices["date"].astype("datetime64[ns]")
    daily = pd.merge_asof(
        prices, fund.reset_index(names="period_end"), left_on="date", right_on="available",
    ).dropna(subset=["ebitda"])

    daily["marketCap"] = daily["price"] * daily["shares"]
    daily["ev"] = daily["marketCap"] + daily["debt"] + daily["minority"] - daily["cash"]
    daily["evEbitda"] = (daily["ev"] / daily["ebitda"]).where(daily["ebitda"] > 0)
    daily["date"] = daily["date"].dt.strftime("%Y-%m-%d")

    fund_out = fund.drop(columns="available").rename_axis("date").reset_index()
    fund_out["date"] = fund_out["date"].dt.strftime("%Y-%m-%d")
    return {
        "points": _records(daily[["date", "price", "marketCap", "ev", "ebitda", "evEbitda"]]),
        "fundamentals": _records(fund_out),
        "filingLagDays": FILING_LAG_DAYS,
        "warning": _currency_warning(t),
    }


def _currency_warning(t: yf.Ticker) -> str | None:
    """Warn when statements and prices are in different currencies (ADRs, foreign listings)."""
    try:
        info = t.info
    except Exception:
        return None
    fin, px = info.get("financialCurrency"), info.get("currency")
    if fin and px and fin != px:
        return f"Financials are in {fin} but the price is in {px}: valuation ratios mix currencies (no FX conversion)."
    return None


@upstream
def statement_ratios(symbol: str) -> dict:
    """Annual ratios computed from yfinance statements (about 4-5 fiscal years)."""
    t = yf.Ticker(symbol)
    inc, bs = t.income_stmt, t.balance_sheet
    revenue = _row(inc, "Total Revenue")
    equity = _row(bs, "Stockholders Equity", "Common Stock Equity")
    ebitda = _row(inc, "EBITDA", "Normalized EBITDA")
    out = pd.DataFrame({
        "Gross margin": _row(inc, "Gross Profit") / revenue,
        "Operating margin": _row(inc, "Operating Income") / revenue,
        "Net margin": _row(inc, "Net Income") / revenue,
        "ROE": _row(inc, "Net Income") / equity,
        "Current ratio": _row(bs, "Current Assets") / _row(bs, "Current Liabilities"),
        "Debt / equity": _row(bs, "Total Debt") / equity,
        "Net debt / EBITDA": _row(bs, "Net Debt") / ebitda,
    })
    out = out.sort_index().dropna(how="all").dropna(axis=1, how="all")
    if out.empty:
        raise DataError(404, f"No fundamentals found for {symbol}")
    out.index = pd.DatetimeIndex(out.index)
    return {
        "periods": list(out.index.strftime("%Y-%m-%d")),
        "ratios": {name: [None if pd.isna(v) else float(v) for v in out[name]] for name in out.columns},
    }


@upstream
def ev_ebitda_fy_history(symbol: str) -> dict:
    """Long-history daily EV/EBITDA on a fiscal-year basis, plus the price (the "Forecaster" style chart).

    EBITDA is the last completed fiscal year's (Finnhub annual `ebitda`), applied from the fiscal year-end date, so the
    multiple climbs through the year and steps down when the next year's EBITDA arrives. EV is rebuilt daily as
    price x shares + net debt. Finnhub does not publish shares or net debt directly, so both are backed out of its own
    annual EV: net debt = netDebtToTotalEquity x bookValue, and shares = (EV - net debt) / close on the first trading day on
    or after the period end (the day Finnhub values EV on; this reproduces its EV to ~0.1%).
    """
    fh = finnhub_series(symbol, "annual")
    if fh is None:
        raise DataError(503, "This view needs FINNHUB_API_KEY in the .env file")
    need = ("ev", "ebitda", "bookValue", "netDebtToTotalEquity")
    if any(k not in fh for k in need):
        raise DataError(422, f"Finnhub has no annual EBITDA / EV / net debt series for {symbol}")
    fy = pd.DataFrame({k: pd.Series({pd.Timestamp(p["period"]): p["v"] for p in fh[k]}) for k in need})
    fy = fy.dropna().sort_index()
    fy.index = pd.DatetimeIndex(fy.index).astype("datetime64[ns]")
    if fy.empty:
        raise DataError(422, f"Finnhub has no usable fiscal-year data for {symbol}")

    hist = price_history(yf.Ticker(symbol))  # Close is split-adjusted, not dividend-adjusted
    if hist.empty:
        raise DataError(404, f"No price data for {symbol}")
    px = hist["Close"].dropna()  # today's row can be empty while a market is closed
    px.index = px.index.tz_localize(None).normalize().astype("datetime64[ns]")

    pos = px.index.searchsorted(fy.index)  # first trading day on or after each period end
    fy = fy[pos < len(px)]
    pos = pos[pos < len(px)]
    fy["net_debt"] = fy["netDebtToTotalEquity"] * fy["bookValue"]
    fy["valuation_date"] = px.index[pos]
    fy["shares"] = (fy["ev"] - fy["net_debt"]) / px.iloc[pos].to_numpy()  # millions, on today's split basis
    fy["label"] = "FY" + (fy.index.year % 100).astype(str).str.zfill(2)

    prices = px.rename("price").rename_axis("date").reset_index()
    daily = pd.merge_asof(
        prices, fy.reset_index(names="period_end")[["period_end", "ebitda", "net_debt", "shares"]],
        left_on="date", right_on="period_end",
    ).dropna(subset=["ebitda"])
    daily["evEbitda"] = ((daily["price"] * daily["shares"] + daily["net_debt"]) / daily["ebitda"]).where(daily["ebitda"] > 0)
    daily["date"] = daily["date"].dt.strftime("%Y-%m-%d")

    out = fy.rename_axis("date").reset_index()
    out["date"] = out["date"].dt.strftime("%Y-%m-%d")
    out["valuationDate"] = out["valuation_date"].dt.strftime("%Y-%m-%d")
    out = out.rename(columns={"net_debt": "netDebt"})[["date", "label", "ebitda", "ev", "netDebt", "shares", "valuationDate"]]
    return {"points": _records(daily[["date", "price", "evEbitda"]].round(4)), "fiscalYears": _records(out)}


def _ttm_roic(symbol: str) -> dict | None:
    """Trailing-12-month ROIC from yfinance quarterlies: NOPAT / (equity + total debt) at the latest quarter.

    NOPAT = 4-quarter operating income x (1 - effective tax rate). This is the same basis Finnhub's annual `roic` follows
    (within a few points for most companies), which keeps the TTM bar comparable with the fiscal-year bars. Returns None
    when the data is incomplete instead of raising, so the fiscal-year bars still show.
    """
    try:
        t = yf.Ticker(symbol)
        inc = t.quarterly_income_stmt
        cols = sorted(inc.columns)[-4:]
        if len(cols) < 4 or cols[-1] - cols[0] > pd.Timedelta(days=290):  # need 4 consecutive quarters
            return None
        total = lambda name: _row(inc, name).reindex(cols).sum(min_count=4)
        op, tax, pretax = total("Operating Income"), total("Tax Provision"), total("Pretax Income")
        if pd.isna(op) or pd.isna(pretax) or pretax <= 0:
            return None
        rate = 0.0 if pd.isna(tax) else min(max(tax / pretax, 0.0), 0.4)
        bs = t.quarterly_balance_sheet
        bs_col = next((c for c in bs.columns if abs(c - cols[-1]) <= pd.Timedelta(days=6)), None)
        if bs_col is None:
            return None
        equity = _row(bs, "Stockholders Equity", "Common Stock Equity").get(bs_col)
        debt = _row(bs, "Total Debt").get(bs_col)
        if equity is None or debt is None or pd.isna(equity) or pd.isna(debt) or equity + debt <= 0:
            return None
        return {"date": cols[-1].strftime("%Y-%m-%d"), "value": float(op * (1 - rate) / (equity + debt) * 100)}
    except Exception:
        return None


@upstream
def roic_history(symbol: str) -> dict:
    """Return on invested capital per fiscal year (Finnhub `roic`, long history) plus a TTM figure. Values are percent."""
    annual = finnhub_series(symbol, "annual")
    if annual is None:
        raise DataError(503, "This view needs FINNHUB_API_KEY in the .env file")
    years = [{"date": p["period"], "value": p["v"] * 100} for p in annual.get("roic", []) if p["v"] is not None]
    if not years:
        raise DataError(422, f"Finnhub has no ROIC series for {symbol}")
    fh_ttm = [p for p in (finnhub_series(symbol, "quarterly") or {}).get("roicTTM", []) if p["v"] is not None]
    return {
        "years": years,
        "ttm": _ttm_roic(symbol),
        "finnhubTtm": {"date": fh_ttm[-1]["period"], "value": fh_ttm[-1]["v"] * 100} if fh_ttm else None,
    }


@upstream
def fcf_yield_history(symbol: str) -> dict:
    """Free cash flow yield = trailing-12-month FCF per share / share price, in percent.

    Uses Finnhub's quarterly `fcfPerShareTTM` (it keeps negative values, unlike its annual FCF margin / P-FCF) divided by the
    close on the first trading day on or after each period end (the day Finnhub values on). Fiscal-year bars are the values at
    each fiscal year end; the TTM bar divides the latest TTM FCF per share by the latest close (today's yield). Validated
    against Oracle's published yields for FY2022-26 (within 0.03 points).
    """
    quarterly = finnhub_series(symbol, "quarterly")
    if quarterly is None:
        raise DataError(503, "This view needs FINNHUB_API_KEY in the .env file")
    fps = pd.Series({pd.Timestamp(p["period"]): p["v"] for p in quarterly.get("fcfPerShareTTM", []) if p["v"] is not None}).sort_index()
    if fps.empty:
        raise DataError(422, f"Finnhub has no free cash flow series for {symbol}")
    fps.index = pd.DatetimeIndex(fps.index).astype("datetime64[ns]")

    t = yf.Ticker(symbol)
    hist = price_history(t)  # Close is split-adjusted, like Finnhub's per-share figures
    if hist.empty:
        raise DataError(404, f"No price data for {symbol}")
    px = hist["Close"].dropna()  # today's row can be empty while a market is closed
    px.index = px.index.tz_localize(None).normalize().astype("datetime64[ns]")

    pos = px.index.searchsorted(fps.index)  # first trading day on or after each period end
    ok = pos < len(px)
    yq = pd.Series(fps[ok].to_numpy() / px.iloc[pos[ok]].to_numpy() * 100, index=fps.index[ok])
    if yq.empty:
        raise DataError(404, f"No price history overlaps the fundamentals for {symbol}")

    annual_series = finnhub_series(symbol, "annual") or {}  # only its period dates are used: they mark the fiscal year ends
    fy_dates = next(([pd.Timestamp(p["period"]) for p in annual_series[k]] for k in ("salesPerShare", "eps", "bookValue", "roe", "pb") if annual_series.get(k)), [])
    annual = []
    for d in fy_dates:
        near = yq.index[abs(yq.index - d) <= pd.Timedelta(days=6)]
        if len(near):
            annual.append((near[0], yq[near[0]]))

    def pts(items):
        return [{"date": d.strftime("%Y-%m-%d"), "value": float(v)} for d, v in items]

    ttm_value = float(fps.iloc[-1] / px.iloc[-1] * 100)
    warnings = [_currency_warning(t)]
    if max(abs(ttm_value), abs(annual[-1][1]) if annual else 0) > 50:
        warnings.append(
            "The yield is implausibly large: Finnhub's free cash flow per share is probably not comparable with this price "
            "(different share class, e.g. Berkshire A/B, or a bank/insurer where free cash flow is not meaningful)."
        )

    return {
        "annual": pts(annual),
        "quarterly": pts(yq.items()),
        "ttm": {"date": px.index[-1].strftime("%Y-%m-%d"), "periodEnd": fps.index[-1].strftime("%Y-%m-%d"), "value": ttm_value},
        "prices": _records(px[px.index >= yq.index[0]].rename("price").rename_axis("date").reset_index().assign(
            date=lambda d: d["date"].dt.strftime("%Y-%m-%d")).round(4)),
        "warning": " ".join(w for w in warnings if w) or None,
    }


def _ttm_fcf_yield(symbol: str) -> dict | None:
    """TTM free cash flow yield from yfinance only (4 consecutive quarters of "Free Cash Flow" / market cap); None if unavailable
    or if the statements and the price are in different currencies. Used when Finnhub has no data for the company."""
    try:
        t = yf.Ticker(symbol)
        cf = t.quarterly_cashflow
        cols = sorted(cf.columns)[-4:]
        if len(cols) < 4 or cols[-1] - cols[0] > pd.Timedelta(days=290):
            return None
        fcf = _row(cf, "Free Cash Flow").reindex(cols).sum(min_count=4)
        info = t.info
        cap = info.get("marketCap")
        if pd.isna(fcf) or not cap or info.get("financialCurrency") != info.get("currency"):
            return None
        return {"date": cols[-1].strftime("%Y-%m-%d"), "value": float(fcf / cap * 100)}
    except Exception:
        return None


@ttl_cache(maxsize=64, ttl=6 * 3600)
def usd_per_unit(currency: str | None) -> float | None:
    """USD value of one unit of `currency` (Yahoo FX pairs); None if unknown."""
    if not currency:
        return None
    if currency == "USD":
        return 1.0
    scale = {"GBp": ("GBP", 0.01), "ZAc": ("ZAR", 0.01), "ILA": ("ILS", 0.01)}.get(currency, (currency, 1.0))
    try:
        price = yf.Ticker(f"{scale[0]}USD=X").fast_info["lastPrice"]
        return float(price) * scale[1] if price and price > 0 else None
    except Exception:
        return None


_finnhub_calls: collections.deque = collections.deque()
_finnhub_lock = threading.Lock()


def finnhub_get(path: str, params: dict, key: str, timeout: int = 30) -> requests.Response:
    """GET a Finnhub endpoint while staying under the free tier's 60 calls per minute (we allow 50). Its statements endpoint can
    still answer 429 under load, so retry up to twice more, waiting 5 s then 15 s."""
    for attempt in range(3):
        with _finnhub_lock:
            while True:
                now = time.monotonic()
                while _finnhub_calls and now - _finnhub_calls[0] > 60:
                    _finnhub_calls.popleft()
                if len(_finnhub_calls) < 50:
                    break
                time.sleep(60 - (now - _finnhub_calls[0]) + 0.1)
            _finnhub_calls.append(time.monotonic())
        r = requests.get("https://finnhub.io/api/v1" + path, params=params, headers={"X-Finnhub-Token": key}, timeout=timeout)
        if r.status_code != 429:
            return r
        time.sleep(5 if attempt == 0 else 15)
    return r


@ttl_cache(maxsize=128, ttl=3600)
def _finnhub_metric(symbol: str, key: str) -> dict:
    r = finnhub_get("/stock/metric", {"symbol": symbol, "metric": "all"}, key, timeout=20)
    if r.status_code == 401:
        raise DataError(502, "Finnhub returned 401 (invalid API key)")
    if r.status_code == 403:
        raise DataError(422, "Finnhub's free tier does not cover this symbol (US listings only)")
    r.raise_for_status()
    return r.json()


def finnhub_series(symbol: str, freq: str) -> dict | None:
    """Historical ratio series from Finnhub /stock/metric, oldest first; None if no API key is set."""
    key = os.getenv("FINNHUB_API_KEY")
    if not key:
        return None
    try:
        series = _finnhub_metric(symbol, key).get("series", {}).get(freq, {})
    except DataError:
        raise
    except requests.RequestException as e:
        raise DataError(502, f"Finnhub request failed: {e}") from e
    return {name: sorted(pts, key=lambda p: p["period"]) for name, pts in series.items()}


def _finnhub_news(symbol: str, days: int) -> list[dict]:
    key = os.getenv("FINNHUB_API_KEY")
    if not key:
        raise DataError(503, "This view needs FINNHUB_API_KEY in the .env file")
    today = dt.date.today()
    r = finnhub_get(
        "/company-news",
        {"symbol": symbol, "from": (today - dt.timedelta(days=days)).isoformat(), "to": today.isoformat()},
        key, timeout=20,
    )
    if r.status_code == 401:
        raise DataError(502, "Finnhub returned 401 (invalid API key)")
    if r.status_code == 403:
        raise DataError(422, "Finnhub's free tier does not cover this symbol (US listings only)")
    r.raise_for_status()
    out = []
    for item in r.json():
        headline, url = item.get("headline"), item.get("url")
        if not headline or not url:
            continue
        out.append({
            "headline": headline,
            "summary": item.get("summary") or None,
            "source": item.get("source") or None,
            "url": url,
            "image": item.get("image") or None,
            "datetime": dt.datetime.utcfromtimestamp(item["datetime"]).strftime("%Y-%m-%d") if item.get("datetime") else None,
        })
    return out


def _benzinga_news(symbol: str, days: int) -> list[dict]:
    """Benzinga's own reporting (not a Yahoo re-post, unlike most of the free Finnhub feed). Best-effort: an empty list if no
    key is set or the request fails, since Finnhub alone already satisfies this view."""
    key = os.getenv("BENZINGA_API_KEY")
    if not key:
        return []
    today = dt.date.today()
    try:
        r = requests.get(
            "https://api.benzinga.com/api/v2/news",
            params={
                "token": key, "tickers": symbol, "pageSize": 100, "displayOutput": "abstract",
                "dateFrom": (today - dt.timedelta(days=days)).isoformat(), "dateTo": today.isoformat(),
            },
            headers={"Accept": "application/json"},  # the API defaults to XML otherwise
            timeout=20,
        )
        r.raise_for_status()
        items = r.json()
    except (requests.RequestException, ValueError):
        return []
    out = []
    for item in items:
        title, url = item.get("title"), item.get("url")
        if not title or not url:
            continue
        teaser = html.unescape(re.sub(r"<[^>]+>", "", item.get("teaser") or ""))
        images = item.get("image") or []
        when = None
        if item.get("created"):
            try:
                when = email.utils.parsedate_to_datetime(item["created"]).strftime("%Y-%m-%d")
            except (TypeError, ValueError):
                pass
        out.append({
            "headline": title, "summary": teaser or None, "source": "Benzinga", "url": url,
            "image": images[0]["url"] if images else None, "datetime": when,
        })
    return out


def _yfinance_news(symbol: str, days: int) -> list[dict]:
    """Yahoo's own news feed via yfinance, for symbols Finnhub's free tier does not cover (no US listing). Best-effort like
    _benzinga_news: an empty list on any failure rather than an error, since this is itself a fallback."""
    cutoff = dt.datetime.now(dt.timezone.utc) - dt.timedelta(days=days)
    try:
        items = yf.Ticker(symbol).news
    except Exception:
        return []
    out = []
    for raw in items or []:
        item = raw.get("content") or {}
        title = item.get("title")
        url = (item.get("canonicalUrl") or {}).get("url") or (item.get("clickThroughUrl") or {}).get("url")
        if not title or not url:
            continue
        when = None
        pub = item.get("pubDate")
        if pub:
            try:
                parsed = dt.datetime.fromisoformat(pub.replace("Z", "+00:00"))
            except ValueError:
                parsed = None
            if parsed and parsed < cutoff:
                continue
            when = parsed.strftime("%Y-%m-%d") if parsed else None
        resolutions = (item.get("thumbnail") or {}).get("resolutions") or []
        image = next((r["url"] for r in resolutions if r.get("tag") != "original"), resolutions[0]["url"] if resolutions else None)
        out.append({
            "headline": title, "summary": item.get("summary") or None,
            "source": (item.get("provider") or {}).get("displayName") or "Yahoo", "url": url,
            "image": image, "datetime": when,
        })
    return out


@ttl_cache(maxsize=64, ttl=1800)
def company_news(symbol: str, days: int = 30) -> list[dict]:
    """Recent headlines: Massive (with AI sentiment), Finnhub's /company-news plus Benzinga's own reporting for symbols Finnhub covers (US listings); for
    symbols outside Finnhub's free tier (no US listing), falls back to yfinance's own news feed instead. Newest first,
    deduplicated by headline."""
    import massive  # here, not at the top: massive imports DataError from this module

    try:
        articles = _finnhub_news(symbol, days) + _benzinga_news(symbol, days)
        try:  # first in the list, so its AI-scored copy wins the headline de-duplication below
            articles = massive.news(symbol, days) + articles
        except DataError:
            pass  # optional source: no key, no quota right now, or a non-US symbol
    except DataError as e:
        if e.status != 422:
            raise
        articles = _yfinance_news(symbol, days)
    seen: set[str] = set()
    out = []
    for item in articles:
        if item["headline"] in seen:
            continue
        seen.add(item["headline"])
        out.append(item)
    return sorted(out, key=lambda a: a["datetime"] or "", reverse=True)
