import os
import re
from pathlib import Path

from dotenv import load_dotenv
from fastapi import FastAPI, Request
from fastapi.responses import JSONResponse, Response
from fastapi.staticfiles import StaticFiles

ROOT = Path(__file__).resolve().parent.parent
load_dotenv(ROOT / ".env")

import data  # noqa: E402  (needs env loaded first: finnhub_series reads the key at call time)
import breadth  # noqa: E402
import calendars  # noqa: E402
import congress  # noqa: E402
import fairvalue  # noqa: E402
import filings  # noqa: E402
import forecast  # noqa: E402
import forward  # noqa: E402
import futures  # noqa: E402
import insiders  # noqa: E402
import massive  # noqa: E402
import macro  # noqa: E402
import market  # noqa: E402
import options  # noqa: E402
import overview  # noqa: E402
import rankings  # noqa: E402
import seasonality  # noqa: E402
import shorts  # noqa: E402
import sentiment  # noqa: E402
import solidity  # noqa: E402

app = FastAPI(title="QuantPlatform")


@app.exception_handler(data.DataError)
async def data_error(_: Request, e: data.DataError):
    return JSONResponse({"error": str(e)}, status_code=e.status)


def symbol_of(raw: str) -> str:
    s = raw.upper()
    if not re.fullmatch(r"[A-Z0-9.^=-]{1,15}", s):
        raise data.DataError(400, "Invalid ticker")
    return s


# Sync endpoints run in FastAPI's threadpool, which suits the blocking yfinance calls.
@app.get("/api/config")
def config():
    return {"finnhub": bool(os.getenv("FINNHUB_API_KEY")), "massive": bool(os.getenv("MASSIVE_API_KEY"))}


@app.get("/api/profile/{symbol}")
def profile(symbol: str):
    return overview.header(symbol_of(symbol))


@app.get("/api/logo/{symbol}")
def logo(symbol: str):
    return Response(massive.logo(symbol_of(symbol)), media_type="image/png", headers={"Cache-Control": "public, max-age=604800"})


@app.get("/api/quote/{symbol}")
def quote(symbol: str):
    return overview.quote(symbol_of(symbol))


WATCHLIST_MAX = 40


@app.get("/api/watchlist")
def watchlist(symbols: str = ""):
    raw = [s.strip() for s in symbols.split(",") if s.strip()]
    if len(raw) > WATCHLIST_MAX:
        raise data.DataError(400, f"At most {WATCHLIST_MAX} symbols")
    bad = [s for s in raw if not re.fullmatch(r"[A-Za-z0-9.^=-]{1,15}", s)]
    if bad:
        raise data.DataError(400, f"Invalid ticker {bad[0]}")
    return overview.watchlist([s.upper() for s in raw])


@app.get("/api/overview/{symbol}")
def overview_view(symbol: str):
    return overview.overview(symbol_of(symbol))


@app.get("/api/overview/{symbol}/intraday")
def overview_intraday(symbol: str, range: str = "1d"):  # noqa: A002  (query parameter name)
    if range not in overview.INTRADAY:
        raise data.DataError(400, f"Unknown range {range}")
    return overview.intraday(symbol_of(symbol), range)


@app.get("/api/overview/{symbol}/overlay/{kind}")
def overview_overlay(symbol: str, kind: str):
    if kind not in overview.OVERLAYS:
        raise data.DataError(400, f"Unknown overlay {kind}")
    return overview.overlay(symbol_of(symbol), kind)


@app.get("/api/forecast/{symbol}")
def forecast_view(symbol: str, horizon: int = 30):
    return forecast.price_forecast(symbol_of(symbol), horizon)


@app.get("/api/forecast/{symbol}/with-market")
def forecast_market_view(symbol: str, horizon: int = 30):
    return forecast.market_forecast(symbol_of(symbol), horizon)


@app.get("/api/yfinance/ev-ebitda/{symbol}")
def ev_ebitda(symbol: str):
    return data.ev_ebitda_history(symbol_of(symbol))


@app.get("/api/ev-ebitda-fy/{symbol}")
def ev_ebitda_fy(symbol: str):
    return data.ev_ebitda_fy_history(symbol_of(symbol))


@app.get("/api/roic/{symbol}")
def roic(symbol: str):
    return data.roic_history(symbol_of(symbol))


@app.get("/api/fcf-yield/{symbol}")
def fcf_yield(symbol: str):
    return data.fcf_yield_history(symbol_of(symbol))


@app.get("/api/peg/{symbol}")
def peg(symbol: str):
    return forward.peg_analysis(symbol_of(symbol))


@app.get("/api/fair-value/{symbol}")
def fair_value(symbol: str):
    return fairvalue.fair_value(symbol_of(symbol))


@app.get("/api/fair-value/{symbol}/summary")
def fair_value_summary(symbol: str):
    return fairvalue.summary(symbol_of(symbol))


@app.get("/api/compare/suggest/{symbol}")
def compare_suggest(symbol: str):
    return rankings.suggest(symbol_of(symbol))


@app.get("/api/compare/search")
def compare_search(q: str = ""):
    q = q.strip()[:60]
    return rankings.search(q) if q else []


@app.get("/api/compare/prices")
def compare_prices(symbols: str, years: int = 5):
    tickers = tuple(dict.fromkeys(symbol_of(s) for s in symbols.split(",") if s.strip()))[:8]
    if len(tickers) < 2:
        raise data.DataError(400, "Give at least two tickers")
    return rankings.compare_prices(tickers, max(1, min(years, 20)))


@app.get("/api/rankings/options")
def rankings_options():
    return rankings.options()


@app.get("/api/rankings/universe")
def rankings_universe(kind: str = "peers", key: str = "", size: int = 10, market: str = "us", sector: str = "", industry: str = ""):
    key = symbol_of(key) if kind == "peers" else key.strip()
    return rankings.universe(kind, key, size, market, sector.strip(), industry.strip())


@app.get("/api/rankings/row/{symbol}")
def rankings_row(symbol: str):
    return rankings.ranking_row(symbol_of(symbol))


@app.get("/api/solidity/{symbol}")
def solidity_scores(symbol: str):
    return solidity.solidity_history(symbol_of(symbol))


def spread_of(raw: str) -> str:
    return symbol_of(raw) if raw.strip() else ""


@app.get("/api/seasonality/{symbol}")
def seasonality_view(symbol: str, vs: str = "", start_month: int = 1):
    return seasonality.seasonality(symbol_of(symbol), spread_of(vs), max(1, min(start_month, 12)))


@app.get("/api/seasonality/{symbol}/trades")
def seasonality_trades(symbol: str, start: str, end: str, vs: str = ""):
    return seasonality.trades(symbol_of(symbol), spread_of(vs), start, end)


@app.get("/api/yfinance/ratios/{symbol}")
def ratios(symbol: str):
    return data.statement_ratios(symbol_of(symbol))


@app.get("/api/finnhub/{symbol}")
def finnhub(symbol: str, freq: str = "annual"):
    return data.finnhub_series(symbol_of(symbol), "quarterly" if freq == "quarterly" else "annual")


@app.get("/api/news/{symbol}")
def news(symbol: str):
    return sentiment.tag(data.company_news(symbol_of(symbol)))


@app.get("/api/insiders/{symbol}")
def insider_view(symbol: str):
    return insiders.insider_activity(symbol_of(symbol))


@app.get("/api/short-interest/{symbol}")
def short_interest_view(symbol: str):
    return shorts.short_interest(symbol_of(symbol))


@app.get("/api/futures/products")
def futures_products():
    return futures.products()


@app.get("/api/futures/{code}")
def futures_curve(code: str):
    return futures.curve(code.upper()[:6])


@app.on_event("startup")
def start_collector():
    market.start()  # background download of the whole-market daily bars (see market.py)


@app.get("/api/breadth")
def breadth_view():
    return breadth.breadth()


@app.get("/api/calendar")
def calendar_view():
    return calendars.calendar()


@app.get("/api/options/{symbol}/expirations")
def options_expirations(symbol: str):
    return options.expirations(symbol_of(symbol))


@app.get("/api/options/{symbol}/contract")
def options_contract(symbol: str, expiry: str, type: str, strike: float):  # noqa: A002  (query parameter name)
    return options.contract(symbol_of(symbol), expiry, type.lower(), strike)


@app.get("/api/options/{symbol}/expected-move")
def options_expected_move(symbol: str, expiry: str):
    return options.expected_move(symbol_of(symbol), expiry)


@app.get("/api/funds")
def funds_list():
    return filings.funds()


@app.get("/api/funds/{cik}")
def fund_view(cik: str):
    return filings.fund_portfolio(cik if re.fullmatch(r"\d{10}", cik) else "")


@app.get("/api/risk-factors/{symbol}")
def risk_view(symbol: str):
    return filings.risk_changes(symbol_of(symbol))


@app.get("/api/macro")
def macro_view():
    return macro.macro()


@app.get("/api/macro/cpi")
def macro_cpi():
    return macro.cpi()


@app.get("/api/macro/forecast/{series}")
def macro_forecast_view(series: str):
    if series not in macro.FORECAST_SERIES:
        raise data.DataError(400, f"Unknown series {series}")
    return macro.forecast(series)


@app.get("/api/rate-sensitivity/{symbol}")
def rate_sensitivity_view(symbol: str):
    return macro.rate_sensitivity(symbol_of(symbol))


@app.get("/api/congress/trades")
def congress_trades(page: int = 0, pageSize: int = 50, chamber: str = "", type: str = "", q: str = "", ticker: str = "", minAmount: str = ""):
    return congress.trades(
        max(0, page), pageSize, chamber.strip().lower(), type.strip().lower(), q.strip()[:60],
        ticker.strip().upper()[:16], float(minAmount) if minAmount else None,
    )


@app.get("/api/congress/summary")
def congress_summary(ticker: str = ""):
    return congress.company_summary(symbol_of(ticker)) if ticker else congress.summary()


# After `npm run build` in frontend/, serve the compiled UI from the same port.
dist = ROOT / "frontend" / "dist"
if dist.exists():
    app.mount("/", StaticFiles(directory=dist, html=True), name="frontend")
