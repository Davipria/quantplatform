"""Options analysis on Massive's free data: the list of contracts and each contract's daily bars (no live chain, Greeks or implied volatility are
on the free plan, so they are computed here).

- implied volatility: the volatility at which the Black-Scholes price (with the Treasury rate for that maturity and the stock's trailing
  dividend yield) equals the contract's LAST TRADED price, found by bisection. The underlying price used is its close on the day of that
  last trade, so the two prices belong together.
- Greeks from that volatility: delta, gamma, theta per calendar day, vega per volatility point, rho per rate point.
- expected move: the price of the at-the-money straddle (call + put with the strike nearest the stock price, both from the same day) is what
  the market charges for a +/- move of the stock until expiry.
Equity options are American; Black-Scholes prices European ones, so deep in-the-money puts and options before a dividend are approximate.
A last trade can be days old and thin volumes give unreliable prices: the response carries warnings for both.
"""
import datetime as dt
import math

import massive
import numpy as np
import yfinance as yf

import data
import overview
from data import DataError, upstream

MAX_CONTRACT_PAGES = 3  # 1,000 contracts a page, soonest expiry first
STALE_DAYS = 5
THIN_VOLUME = 10
IV_LOW, IV_HIGH = 0.01, 5.0
FALLBACK_RATE = 0.04


def _cdf(x: float) -> float:
    return 0.5 * (1 + math.erf(x / math.sqrt(2)))


def _pdf(x: float) -> float:
    return math.exp(-x * x / 2) / math.sqrt(2 * math.pi)


def bs_price(kind: str, s: float, k: float, t: float, r: float, q: float, sigma: float) -> float:
    if t <= 0 or sigma <= 0:
        return max(s - k, 0) if kind == "call" else max(k - s, 0)
    d1 = (math.log(s / k) + (r - q + sigma * sigma / 2) * t) / (sigma * math.sqrt(t))
    d2 = d1 - sigma * math.sqrt(t)
    if kind == "call":
        return s * math.exp(-q * t) * _cdf(d1) - k * math.exp(-r * t) * _cdf(d2)
    return k * math.exp(-r * t) * _cdf(-d2) - s * math.exp(-q * t) * _cdf(-d1)


def greeks(kind: str, s: float, k: float, t: float, r: float, q: float, sigma: float) -> dict:
    d1 = (math.log(s / k) + (r - q + sigma * sigma / 2) * t) / (sigma * math.sqrt(t))
    d2 = d1 - sigma * math.sqrt(t)
    eq, er = math.exp(-q * t), math.exp(-r * t)
    call = kind == "call"
    theta = -s * eq * _pdf(d1) * sigma / (2 * math.sqrt(t))
    theta += (-r * k * er * _cdf(d2) + q * s * eq * _cdf(d1)) if call else (r * k * er * _cdf(-d2) - q * s * eq * _cdf(-d1))
    return {
        "delta": eq * _cdf(d1) if call else -eq * _cdf(-d1), "gamma": eq * _pdf(d1) / (s * sigma * math.sqrt(t)),
        "vega": s * eq * _pdf(d1) * math.sqrt(t) / 100, "theta": theta / 365,
        "rho": (k * t * er * _cdf(d2) if call else -k * t * er * _cdf(-d2)) / 100,
    }


def implied_vol(kind: str, price: float, s: float, k: float, t: float, r: float, q: float) -> float | None:
    """None when the price cannot come from any volatility (below the no-volatility value, or above the upper bound)."""
    if t <= 0 or price <= 0:
        return None
    if price < bs_price(kind, s, k, t, r, q, IV_LOW) - 1e-9 or price > bs_price(kind, s, k, t, r, q, IV_HIGH):
        return None
    lo, hi = IV_LOW, IV_HIGH
    for _ in range(80):
        mid = (lo + hi) / 2
        if bs_price(kind, s, k, t, r, q, mid) < price:
            lo = mid
        else:
            hi = mid
    return (lo + hi) / 2


def _rate(t: float) -> float:
    """Treasury yield for a maturity of t years (1M / 3M / 1Y / 2Y, the nearest), from the Macro tab's cached download."""
    try:
        row = next(r for r in reversed(massive.treasury_yields(max_wait=3)) if r.get("yield_3_month") is not None)
    except (DataError, StopIteration):
        return FALLBACK_RATE
    col = "yield_1_month" if t <= 0.125 else "yield_3_month" if t <= 0.375 else "yield_1_year" if t <= 1.5 else "yield_2_year"
    v = row.get(col) or row.get("yield_3_month")
    return v / 100 if v else FALLBACK_RATE


def _stock(symbol: str) -> dict:
    """Closes, trailing dividend yield and 30-day realised volatility of the underlying (yfinance)."""
    t = yf.Ticker(symbol)
    close = data.price_history(t)["Close"].dropna()
    if close.empty:
        raise DataError(404, f"No price history for {symbol}")
    close.index = close.index.tz_localize(None).normalize()
    try:
        div = t.dividends
        div = float(div[div.index >= div.index.max() - dt.timedelta(days=365)].sum()) if len(div) else 0.0
    except Exception:  # noqa: BLE001
        div = 0.0
    logret = np.log(close.tail(31)).diff().dropna()
    return {"close": close, "divYield": div / float(close.iloc[-1]), "realised": float(logret.std() * math.sqrt(252)) if len(logret) > 5 else None}


def _close_on(close, day: str) -> float:
    near = close[close.index <= np.datetime64(day)]
    return float((near if len(near) else close).iloc[-1])


def _option_ticker(symbol: str, expiry: str, kind: str, strike: float) -> str:
    root = "".join(c for c in symbol.upper() if c.isalnum())
    return f"O:{root}{dt.date.fromisoformat(expiry):%y%m%d}{'C' if kind == 'call' else 'P'}{int(round(strike * 1000)):08d}"


def _load_contracts(ticker: str) -> list[dict]:
    rows, _ = massive.pages("/v3/reference/options/contracts", {
        "underlying_ticker": ticker, "expiration_date.gte": dt.date.today().isoformat(), "limit": 1000, "order": "asc", "sort": "expiration_date",
    }, MAX_CONTRACT_PAGES)
    return [{"expiry": r["expiration_date"], "type": r["contract_type"], "strike": r["strike_price"]} for r in rows if r.get("contract_type") in ("call", "put")]


@upstream
def expirations(symbol: str) -> dict:
    ticker = "".join(c for c in symbol if c.isalnum())
    rows = massive.cached(f"opt-contracts-{ticker}", 6, lambda: _load_contracts(ticker))
    if not rows:
        raise DataError(404, f"No listed options found for {symbol} (US-listed stocks and ETFs only)")
    q, s = overview.quote(symbol), _stock(symbol)
    today = dt.date.today()
    by: dict[str, dict] = {}
    for r in rows:
        e = by.setdefault(r["expiry"], {"date": r["expiry"], "calls": set(), "puts": set()})
        e["calls" if r["type"] == "call" else "puts"].add(r["strike"])
    exps = [{"date": e["date"], "days": (dt.date.fromisoformat(e["date"]) - today).days, "calls": sorted(e["calls"]), "puts": sorted(e["puts"])} for e in sorted(by.values(), key=lambda e: e["date"])]
    return {
        "symbol": symbol, "spot": q.get("price") or float(s["close"].iloc[-1]), "expirations": exps, "divYield": s["divYield"], "realisedVol": s["realised"],
        "rate": _rate(0.25), "loaded": len(rows), "note": None if len(rows) < 3000 else "Only the nearest expirations are loaded (Massive's contract list is paged and the free plan is limited).",
    }


def _bars(opt: str) -> list[dict]:
    today = dt.date.today()
    rows = massive.get(f"/v2/aggs/ticker/{opt}/range/1/day/{(today - dt.timedelta(days=90)).isoformat()}/{today.isoformat()}", {"adjusted": "true", "sort": "asc", "limit": 200}, 60).get("results", [])
    return [{"date": dt.datetime.fromtimestamp(b["t"] / 1000, dt.timezone.utc).date().isoformat(), "close": b["c"], "volume": b.get("v"), "vwap": b.get("vw"), "n": b.get("n")} for b in rows]


def _contract(symbol: str, expiry: str, kind: str, strike: float, stock: dict) -> dict:
    opt = _option_ticker(symbol, expiry, kind, strike)
    bars = massive.cached(f"opt-bars-{opt}", 1, lambda: _bars(opt))
    if not bars:
        raise DataError(404, "This contract had no trades in the last 90 days (too illiquid to price)")
    last = bars[-1]
    under = _close_on(stock["close"], last["date"])
    t = max((dt.date.fromisoformat(expiry) - dt.date.fromisoformat(last["date"])).days, 0) / 365
    r = _rate(t)
    iv = implied_vol(kind, last["close"], under, strike, t, r, stock["divYield"])
    intrinsic = max(under - strike, 0) if kind == "call" else max(strike - under, 0)
    warnings = []
    if (dt.date.today() - dt.date.fromisoformat(last["date"])).days > STALE_DAYS:
        warnings.append(f"The last trade was on {last['date']}: the price is stale.")
    if (last["volume"] or 0) < THIN_VOLUME:
        warnings.append(f"Only {int(last['volume'] or 0)} contracts traded that day: the price may not be reliable.")
    if iv is None:
        warnings.append("The price is below the option's minimum value (or above its maximum): no volatility fits, so it is stale or a data error.")
    if t <= 0:
        warnings.append("The contract expires on the day of its last trade: no time value left.")
    return {
        "optionTicker": opt, "type": kind, "strike": strike, "expiry": expiry, "lastPrice": last["close"], "lastDate": last["date"], "volume": last["volume"],
        "underlying": under, "years": t, "rate": r, "divYield": stock["divYield"], "iv": iv, "intrinsic": intrinsic, "timeValue": last["close"] - intrinsic,
        "breakeven": strike + last["close"] if kind == "call" else strike - last["close"],
        "greeks": greeks(kind, under, strike, t, r, stock["divYield"], iv) if iv and t > 0 else None,
        "bars": bars[-60:], "warnings": warnings,
    }


@upstream
def contract(symbol: str, expiry: str, kind: str, strike: float) -> dict:
    if kind not in ("call", "put"):
        raise DataError(400, "type must be call or put")
    try:
        dt.date.fromisoformat(expiry)
    except ValueError as e:
        raise DataError(400, "Invalid expiry date") from e
    stock = _stock(symbol)
    out = _contract(symbol, expiry, kind, strike, stock)
    out["symbol"], out["realisedVol"] = symbol, stock["realised"]
    return out


@upstream
def expected_move(symbol: str, expiry: str) -> dict:
    exp = expirations(symbol)
    e = next((x for x in exp["expirations"] if x["date"] == expiry), None)
    if not e:
        raise DataError(404, f"{expiry} is not among the loaded expirations")
    common = sorted(set(e["calls"]) & set(e["puts"]))
    if not common:
        raise DataError(404, "No strike has both a call and a put")
    stock = _stock(symbol)
    spot = exp["spot"]
    strike = min(common, key=lambda k: abs(k - spot))
    call, put = _contract(symbol, expiry, "call", strike, stock), _contract(symbol, expiry, "put", strike, stock)
    day = min(call["lastDate"], put["lastDate"])
    cb = next((b for b in call["bars"] if b["date"] == day), None)
    pb = next((b for b in put["bars"] if b["date"] == day), None)
    if not cb or not pb:
        raise DataError(404, "The call and the put did not trade on a common day")
    straddle = cb["close"] + pb["close"]
    under = _close_on(stock["close"], day)
    days = (dt.date.fromisoformat(expiry) - dt.date.fromisoformat(day)).days
    return {
        "symbol": symbol, "expiry": expiry, "strike": strike, "date": day, "underlying": under, "callPrice": cb["close"], "putPrice": pb["close"], "straddle": straddle,
        "move": straddle, "movePct": straddle / under * 100, "low": under - straddle, "high": under + straddle, "days": days,
        "realisedMove": under * stock["realised"] * math.sqrt(days / 365) if stock["realised"] else None, "callIv": call["iv"], "putIv": put["iv"],
        "warnings": call["warnings"] + [w for w in put["warnings"] if w not in call["warnings"]] + (
            [f"The call and the put imply volatilities {abs(call['iv'] - put['iv']) * 100:.0f} points apart: their last trades were probably at different times of the day, so treat the straddle as approximate."]
            if call["iv"] and put["iv"] and abs(call["iv"] - put["iv"]) > 0.03 else []),
    }
