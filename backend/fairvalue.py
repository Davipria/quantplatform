"""Fair value: three independent estimates of what a share is worth, next to today's price.

1. DCF inputs: trailing-12-month free cash flow, net debt, share count and a default discount rate (WACC from CAPM) and
   growth. The DCF itself is computed in the browser so the assumptions can be edited without a round trip.
2. Historical multiples: today's fundamentals x the company's own median P/E, EV/EBITDA, P/FCF and P/S over the last 5 / 10
   years (Finnhub quarterly TTM series). The 25th-75th percentile of each multiple gives the range.
3. Analyst price targets (yfinance consensus): low / mean / median / high.

Every method is optional: one that lacks data returns a `note` instead of values, so the others still show.
"""
import datetime as dt
import re

import numpy as np
import pandas as pd
import yfinance as yf
from cachetools.func import ttl_cache

from data import DataError, _row, finnhub_series, upstream, usd_per_unit

ERP = 0.05  # equity risk premium used in CAPM
TERMINAL_GROWTH = 0.025
MULTIPLES = [  # (key, label, Finnhub quarterly series)
    ("pe", "P/E", "peTTM"),
    ("evEbitda", "EV/EBITDA", "evEbitdaTTM"),
    ("pfcf", "P/FCF", "pfcfTTM"),
    ("ps", "P/S", "psTTM"),
]
# Free cash flow and EV-based figures say nothing about a bank's or insurer's value (debt and cash are its raw material). Credit
# services (Visa), exchanges and data providers keep their DCF.
NO_DCF_INDUSTRY = re.compile(r"Bank|Insurance|Capital Markets|Mortgage|Asset Management|Financial Conglomerates|Shell Companies")
MAX_MULTIPLE = 200  # above this a multiple is noise (earnings near zero), not a valuation


def _num(v):
    return None if v is None or pd.isna(v) else float(v)


def _clamp(v, lo, hi):
    return min(max(v, lo), hi)


def _ttm(df: pd.DataFrame, *names: str) -> float | None:
    """Sum of the last 4 consecutive quarters of a statement row, else None."""
    cols = sorted(df.columns)[-4:] if df is not None and not df.empty else []
    if len(cols) < 4 or cols[-1] - cols[0] > pd.Timedelta(days=290):
        return None
    return _num(_row(df, *names).reindex(cols).sum(min_count=4))


def _latest(df: pd.DataFrame, *names: str) -> float | None:
    if df is None or df.empty:
        return None
    s = _row(df, *names).dropna()
    return _num(s[s.index.max()]) if not s.empty else None


@ttl_cache(maxsize=1, ttl=3600)
def _risk_free() -> float:
    """US 10-year Treasury yield (Yahoo ^TNX is quoted in percent); 4.25% if unavailable."""
    try:
        v = float(yf.Ticker("^TNX").fast_info["lastPrice"])
        return v / 100 if 0 < v < 20 else 0.0425
    except Exception:
        return 0.0425


def _fcf_cagr(cf: pd.DataFrame) -> float | None:
    """Compound growth of annual free cash flow between the oldest and newest fiscal year yfinance has (both must be positive)."""
    if cf is None or cf.empty:
        return None
    s = _row(cf, "Free Cash Flow").dropna().sort_index()
    if len(s) < 3 or s.iloc[0] <= 0 or s.iloc[-1] <= 0:
        return None
    years = (s.index[-1] - s.index[0]).days / 365.25
    return (s.iloc[-1] / s.iloc[0]) ** (1 / years) - 1


def _dcf_inputs(t: yf.Ticker, info: dict, price: float, shares: float, fx: float) -> dict:
    cf, inc, bs = t.quarterly_cashflow, t.quarterly_income_stmt, t.quarterly_balance_sheet
    fcf, basis = _ttm(cf, "Free Cash Flow"), "last 4 quarters"
    if fcf is None:
        fcf, basis = _latest(t.cashflow, "Free Cash Flow"), "last fiscal year"
    debt = _latest(bs, "Total Debt") or _num(info.get("totalDebt")) or 0.0
    cash = _latest(bs, "Cash Cash Equivalents And Short Term Investments", "Cash And Cash Equivalents") or _num(info.get("totalCash")) or 0.0
    # Minority interests: the consolidated cash flow includes the part of subsidiaries other shareholders own (Deutsche Telekom
    # consolidates all of T-Mobile US but owns about half), so their value is subtracted like debt.
    minority = _latest(bs, "Minority Interest") or 0.0

    # WACC: CAPM cost of equity, after-tax cost of debt = interest expense / debt, weighted by market cap and debt.
    rf, beta = _risk_free(), _num(info.get("beta"))
    beta_used = _clamp(beta, 0.5, 2.5) if beta is not None else 1.0
    cost_equity = rf + beta_used * ERP
    interest, pretax, tax = _ttm(inc, "Interest Expense"), _ttm(inc, "Pretax Income"), _ttm(inc, "Tax Provision")
    tax_rate = _clamp(tax / pretax, 0.0, 0.35) if tax is not None and pretax and pretax > 0 else 0.21
    cost_debt = _clamp(abs(interest) / debt, 0.02, 0.12) if interest and debt > 0 else rf + 0.015
    equity_value = price * shares
    debt_px = debt * fx
    wacc = (equity_value * cost_equity + debt_px * cost_debt * (1 - tax_rate)) / (equity_value + debt_px)

    # Growth for years 1-5: analysts' next-year revenue growth, else the historical FCF growth; kept between 0% and 25%.
    growth, growth_src = None, None
    try:
        rev = t.revenue_estimate
        if rev is not None and "+1y" in rev.index:
            growth, growth_src = _num(rev.loc["+1y"].get("growth")), "analysts' revenue growth estimate for next fiscal year"
    except Exception:
        pass
    if growth is None:
        growth, growth_src = _fcf_cagr(t.cashflow), "historical free cash flow growth (yfinance annual statements)"
    if growth is None:
        growth, growth_src = 0.05, "no estimate available: 5% default"

    return {
        "fcf": None if fcf is None else fcf * fx, "fcfBasis": basis, "debt": debt_px, "cash": cash * fx, "minority": minority * fx,
        "netDebt": debt_px - cash * fx + minority * fx, "shares": shares,
        "riskFree": rf, "beta": beta, "betaUsed": beta_used, "erp": ERP, "costEquity": cost_equity,
        "costDebt": cost_debt, "taxRate": tax_rate,
        "debtWeight": debt_px / (equity_value + debt_px),
        "wacc": _clamp(wacc, 0.06, 0.14),
        "growth": _clamp(growth, 0.0, 0.25), "growthRaw": growth, "growthSource": growth_src,
        "terminalGrowth": TERMINAL_GROWTH,
        "note": ("banks, insurers and asset managers are not valued on free cash flow (debt and cash are their raw material)"
                 if NO_DCF_INDUSTRY.search(info.get("industry") or "") else None if fcf is not None else "no free cash flow in the statements"),
    }


def _multiples(symbol: str, info: dict, price: float, shares: float, net_debt: float, fx: float) -> dict:
    """Fair price if each multiple went back to its own historical median (range: 25th-75th percentile)."""
    q = finnhub_series(symbol, "quarterly")
    if q is None:
        return {"note": "Needs FINNHUB_API_KEY in the .env file", "items": []}
    fps = [p["v"] for p in q.get("fcfPerShareTTM", []) if p["v"] is not None]
    ebitda, revenue = _num(info.get("ebitda")), _num(info.get("totalRevenue"))
    eps = _num(info.get("trailingEps"))
    # value of one unit of each multiple, in price currency per share
    per_unit = {
        "pe": eps * fx if eps else None,
        "pfcf": fps[-1] * fx if fps else None,
        "ps": revenue * fx / shares if revenue else None,
    }
    today = pd.Timestamp(dt.date.today())
    items = []
    for key, label, series in MULTIPLES:
        pts = pd.Series({pd.Timestamp(p["period"]): p["v"] for p in q.get(series, []) if p["v"] is not None}, dtype=float)
        pts.index = pd.DatetimeIndex(pts.index)
        pts = pts[(pts > 0) & (pts < MAX_MULTIPLE)]
        item = {"key": key, "label": label, "current": _num(pts.iloc[-1]) if len(pts) else None, "windows": {}}
        base = per_unit.get(key)
        for years in (5, 10):
            w = pts[pts.index >= today - pd.DateOffset(years=years)]
            if len(w) < 8:
                continue
            p25, med, p75 = np.percentile(w.to_numpy(), [25, 50, 75])

            def fair(m):
                if key == "evEbitda":
                    return float((m * ebitda * fx - net_debt) / shares) if ebitda and ebitda > 0 else None
                return float(m * base) if base and base > 0 else None
            if fair(med) is None:
                continue
            if not price / 10 < fair(med) < price * 10:  # e.g. a per-share figure from another share class (BRK-A vs BRK-B)
                item["note"] = "implausible result (share class or data mismatch), left out"
                continue
            item["windows"][str(years)] = {
                "median": float(med), "p25": float(p25), "p75": float(p75), "points": int(len(w)),
                "fair": fair(med), "low": fair(p25), "high": fair(p75),
            }
        if not item["windows"] and not item.get("note"):
            item["note"] = ("not meaningful: earnings, EBITDA or cash flow are negative or missing"
                            if len(pts) >= 8 else "not enough history (needs 2+ years of positive values)")
        items.append(item)
    return {"items": items, "note": None}


def _analysts(t: yf.Ticker, info: dict) -> dict:
    try:
        tg = t.analyst_price_targets or {}
    except Exception:
        tg = {}
    out = {k: _num(tg.get(k)) for k in ("low", "mean", "median", "high")}
    if out["mean"] is None:
        return {"note": "No analyst price targets for this company"}
    out.update(analysts=_num(info.get("numberOfAnalystOpinions")), recommendation=info.get("recommendationKey"), note=None)
    return out


@upstream
def fair_value(symbol: str) -> dict:
    t = yf.Ticker(symbol)
    info = t.info
    price = _num(info.get("currentPrice")) or _num(info.get("regularMarketPrice"))
    cap = _num(info.get("marketCap"))
    if not price or not cap:
        raise DataError(404, f"No price or market cap for {symbol}")
    shares = cap / price  # consistent with the quoted share class, unlike sharesOutstanding for multi-class companies

    warnings = []
    fin_cur, px_cur = info.get("financialCurrency"), info.get("currency")
    fx = 1.0
    if fin_cur and px_cur and fin_cur != px_cur:
        a, b = usd_per_unit(fin_cur), usd_per_unit(px_cur)
        if a and b:
            fx = a / b
            warnings.append(f"Statements are in {fin_cur}, the price in {px_cur}: statement figures converted at today's rate ({fx:.4g}).")
        else:
            warnings.append(f"Statements are in {fin_cur}, the price in {px_cur}, and no FX rate was found: fair values mix currencies.")
    if NO_DCF_INDUSTRY.search(info.get("industry") or ""):
        warnings.append("For banks, insurers and asset managers, free cash flow and EV/EBITDA are not meaningful: rely on P/E, P/S and analyst targets.")

    dcf = _dcf_inputs(t, info, price, shares, fx)
    if dcf["minority"] > 0.1 * cap:
        warnings.append("Large minority interests (other shareholders own part of big subsidiaries): the balance sheet carries them at book value, "
                        "usually far below their market value, so the DCF and EV/EBITDA fair values are probably too high.")
    try:
        multiples = _multiples(symbol, info, price, shares, dcf["netDebt"], fx)
    except DataError as e:
        multiples = {"note": str(e), "items": []}

    return {
        "symbol": symbol, "name": info.get("shortName") or info.get("longName"), "sector": info.get("sector"),
        "industry": info.get("industry"), "country": info.get("country"), "price": price, "currency": px_cur, "marketCap": cap,
        "dcf": dcf, "multiples": multiples, "analysts": _analysts(t, info),
        "warning": " ".join(warnings) or None,
    }


def dcf_per_share(fcf, growth, wacc, terminal_growth, net_debt, shares) -> float | None:
    """Same two-stage DCF as `dcf()` in FairValueTab.jsx: growth for years 1-5, linear fade to the terminal rate by year 10,
    Gordon terminal value; (EV - net debt) / shares."""
    if not fcf or fcf <= 0 or wacc <= terminal_growth:
        return None
    f, pv = fcf, 0.0
    for y in range(1, 11):
        g = growth if y <= 5 else growth + (terminal_growth - growth) * (y - 5) / 5
        f *= 1 + g
        pv += f / (1 + wacc) ** y
    tv = f * (1 + terminal_growth) / (wacc - terminal_growth)
    return (pv + tv / (1 + wacc) ** 10 - net_debt) / shares


@upstream
def summary(symbol: str) -> dict:
    """One row for the Rankings "most under/overvalued" lists: the same median-of-methods fair value the Fair value tab shows with
    its defaults (DCF with default assumptions, each multiple at its 10-year median, analysts' mean target)."""
    r = fair_value(symbol)
    d, price = r["dcf"], r["price"]
    dcf_v = None if d["note"] else dcf_per_share(d["fcf"], d["growth"], d["wacc"], d["terminalGrowth"], d["netDebt"], d["shares"])
    dcf_v = dcf_v if dcf_v and dcf_v > 0 else None
    mult = {it["key"]: it["windows"]["10"]["fair"] for it in r["multiples"].get("items", []) if "10" in it["windows"]}
    analyst = r["analysts"].get("mean")
    values = [v for v in [dcf_v, *mult.values(), analyst] if v is not None]
    fair = float(np.median(values)) if values else None
    return {
        "symbol": symbol, "name": r["name"], "sector": r["sector"], "industry": r["industry"], "country": r["country"],
        "price": price, "currency": r["currency"], "marketCap": r["marketCap"],
        "fairValue": fair, "upside": None if fair is None else fair / price - 1, "estimates": len(values),
        "dcf": dcf_v, "multiples": float(np.median(list(mult.values()))) if mult else None, "analysts": analyst,
        "warning": r["warning"],
    }
