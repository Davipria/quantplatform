# Massive API: what it offers and what QuantPlatform can do with it

Written 2026-09-25. Everything marked **tested** was called live with the owner's key on the **free (Basic) plan** that day.
Nothing in the app uses Massive yet; the key is only stored in `.env` as `MASSIVE_API_KEY`.

> **Status (2026-09-25):** everything in sections 5.1-5.10 that fits the free plan is built except these: the equity risk premium, the P/E versus 10-year yield chart, the inflation-linked DCF terminal growth, a party-style
> "who owns this stock" 13F search (the API filters by filer, not by held company), an options chain scanner (needs a paid plan), and short-interest columns in Rankings/Compare (quota). Built: Macro, Insiders, logos and AI news
> sentiment, Short interest, inflation-adjusted prices and rate sensitivity, Futures, Market breadth (with the background collector), Calendar (dividends, IPOs), Filings (13F funds, risk-factor changes) and Options (contract analysis,
> expected move, strategy builder). See the tracker in `CLAUDE.md` for details and validation.

## 1. What Massive is

Massive (massive.com) is the new name of **Polygon.io**. Base URL `https://api.massive.com`, key as `?apiKey=...` or an
`Authorization: Bearer` header. Responses are JSON, paginated with a `next_url` cursor. (Payloads still contain old
`api.polygon.io` links; ignore them.)

It sells **market data by asset class**: stocks, options, indices, forex, crypto, futures, plus economy (Federal Reserve data),
SEC filings, and partner feeds (Benzinga, ETF Global, TMX/Wall Street Horizon). Real-time WebSockets and bulk "flat files" exist
on paid plans only.

## 2. The free plan, and the one number that decides everything

| Limit | Free (Basic) | Paid stocks plans (from the pricing page) |
|---|---|---|
| Calls | **5 per minute** (a 6th call in a minute gets HTTP 429) | Starter $29, Developer $79, Advanced $199: unlimited |
| History | 2 years for prices | 5 / 10 / 20+ years |
| Freshness | End of day (yesterday's bars) | 15 min delayed (Starter, Developer), real time (Advanced) |
| WebSocket, flat files | No | Yes |
| Financial ratios endpoint, quotes | No | Advanced only |

Prices for options, indices, forex, crypto and futures plans were not readable on the pricing page, so they are **not verified**.

**Consequence.** Finnhub's free tier allows 60 calls/minute; Massive's allows 5. So Massive is the wrong tool for anything that
loops over many companies (Rankings rows, Compare, Fair value scans: each of those needs 5-10 calls per company). It is the right
tool for **one symbol, one page, cached for a long time**, for **whole-market snapshots in a single call**, and for **data
that changes monthly** (macro). Every proposal below is built around that.

## 3. What the free plan really gives (tested 2026-09-25)

### Works (HTTP 200)

| Area | Endpoint | Notes from the live test |
|---|---|---|
| Stock prices | `/v2/aggs/ticker/AAPL/range/1/day/{from}/{to}` | Daily and 1-minute bars, split-adjusted, includes `vw` (VWAP) and `n` (trade count). Sep 22 is present (yfinance drops it). |
| Whole market, one call | `/v2/aggs/grouped/locale/us/market/stocks/{date}` | **12,625 tickers with OHLCV for one day in a single call.** |
| Company profile | `/v3/reference/tickers/AAPL` | Market cap, employees, SIC code, list date, shares outstanding, CIK, FIGI, **logo and icon URLs (`branding`)**. |
| Related companies | `/v1/related-companies/AAPL` | MSFT, AMZN, GOOGL, NVDA, TSLA, META... |
| Dividends, splits | `/v3/reference/dividends`, `/splits` | Declaration, ex, record and pay dates, frequency, type. |
| IPOs | `/vX/reference/ipos` | Pending IPOs: price range, shares, offer size, exchange, status. |
| Ticker events | `/vX/reference/tickers/AAPL/events` | Ticker renames. |
| News | `/v2/reference/news?ticker=` | Each article carries **per-ticker AI sentiment (`positive`/`negative`/`neutral`) with a written reason** and keywords. |
| Financial statements | `/vX/reference/financials` | Quarterly, annual and **TTM**. Fields: revenues, gross profit, operating income, net income, EPS, diluted shares, total assets/liabilities/equity, current assets/liabilities, long-term debt, inventory, operating/investing/financing cash flow. |
| Float | `/stocks/vX/float` | AAPL: 13.52 B shares, 92.1% free float. |
| Short interest | `/stocks/v1/short-interest` | FINRA bi-weekly since 2017: shares short, average volume, days to cover. |
| Short volume | `/stocks/v1/short-volume` | Daily short volume vs total, ratio, split by venue. |
| Insider trades | `/stocks/filings/vX/form-4` | SEC Form 4: insider name, officer title, director flag, transaction code, shares, price, date, timeliness. |
| Institutional holdings | `/stocks/filings/vX/13-F` | Quarterly holdings of a fund (filter by filer CIK): issuer, value, shares, voting authority. |
| Risk factors | `/stocks/filings/vX/risk-factors` | 10-K risk paragraphs classified in a 3-level taxonomy, with the quote. |
| Technical indicators | `/v1/indicators/sma|rsi|macd/AAPL` | SMA, RSI, MACD (EMA exists too, untested). |
| Options (reference + history) | `/v3/reference/options/contracts`, `/v2/aggs/ticker/O:AAPL260925C00320000/...` | Contract list (strike, expiry, type) and **daily bars per contract**. No chain snapshot. |
| Futures | `/futures/v1/aggs/ESZ6`, `/contracts`, `/products` | Bars per contract (day, minute, session), settlement price, dollar volume. CME, CBOT, COMEX, NYMEX. |
| Forex, crypto | `/v2/aggs/ticker/C:EURUSD/...`, `X:BTCUSD` | Daily bars. |
| Market calendar | `/v1/marketstatus/now`, `/upcoming` | Holidays and early closes. |
| **Economy** | `/fed/v1/treasury-yields` | 1M, 3M, 1Y, 2Y, 5Y, 10Y, 30Y, daily since 1962 (latest 10Y: 5.11%). |
| | `/fed/v1/inflation` | **CPI and core CPI index levels** monthly since 1947 (not year-on-year %; we compute it). |
| | `/fed/v1/inflation-expectations` | Model 1/5/10/30-year expectations since 1982. |
| | `/fed/v1/labor-market` | Unemployment rate, participation rate, average hourly earnings, job openings since 1948. |
| | `/fed/v1/funding-conditions` | Interest on reserves, fed funds, SOFR, repo, commercial paper. Latest row had only the IORB (3.9%); other fields may lag. |

### Locked on the free plan (HTTP 403 "not entitled")

Single-stock snapshot, top gainers/losers, **options chain snapshot (Greeks, implied volatility, open interest)**, **all index data
(`I:SPX` and others)**, the new `/stocks/financials/v1/*` (income statements, ratios), currency conversion endpoint, trades and quotes
(bid/ask), ETF Global (ETF holdings, fund flows), TMX corporate events, and Benzinga partner feeds (analyst ratings, earnings,
guidance).

### Not verified
8-K text, 10-K sections, Form 3, exchanges list, condition codes, the two paths that returned 404 (my guesses, not proof they are
locked). The `vX` prefix means "experimental": those endpoints may change.

## 4. Where Massive is better than what we use today

| Today | Problem | With Massive | Recommendation |
|---|---|---|---|
| Company logo = a letter | Real logos were listed as a known limitation | `branding.icon_url` / `logo_url` from ticker overview (1 call, cache for weeks) | **Replace** for US stocks; keep the letter as fallback. |
| Risk-free rate = Yahoo `^TNX` in Fair value | Unofficial ticker, one maturity only | `/fed/v1/treasury-yields` (official, all maturities) | **Replace** in `fairvalue.py`; also opens the whole yield curve. |
| News sentiment = word counting (Loughran-McDonald) | Cannot understand context, many headlines score neutral | Per-ticker AI sentiment and reasoning on each article | **Add as a third news source**, prefer its label when present, keep the local score as fallback. Caveat: much of the volume is press releases (GlobeNewswire); compare against Benzinga/Finnhub before trusting. |
| Dividends and splits from Yahoo | Fewer fields | Declaration, record and pay dates, frequency, type | **Replace** in Overview's dividend block. |
| Missing Yahoo daily bars, patched with hourly rebuilds (`data.price_history`) | Hack; a rebuilt close can be a few cents off | Complete daily bars, official closes, VWAP | **Use as the repair source for the last 720 days** (one call), or as a nightly cross-check. Keep yfinance for full history (Massive stops at 2 years). |
| FX conversion via Yahoo pairs (`KRWUSD=X`) | A few exotic currencies have no pair | `C:XXXUSD` daily bars | Try as a **fallback** only; exotic pair coverage untested. |
| Rankings "largest companies" via Yahoo screener | Yahoo rate limits, region quirks | Grouped daily bars = real dollar volume for the whole US market in one call | **Add** as a US universe ("most traded today"), see 5.7. |
| Solidity / Overview overlays from Finnhub as-reported filings | (works well) | Massive statements lack receivables, retained earnings, D&A, capex, so Beneish and Altman cannot be built | **Do not replace.** Use Massive only as a cross-check for revenue, net income, assets. |

Not worth doing: Massive's SMA/RSI/MACD endpoints. We already hold the prices, so computing them locally costs zero calls.
Indices, Rankings rows and any per-company loop stay on yfinance/Finnhub.

## 5. New things we could build

Ordered roughly by value for effort. "Calls" = Massive calls on the free plan (5/min).

### 5.1 Macro tab (all free, biggest new capability, ~1 call per chart)
- **Yield curve** chart (today, 1 month ago, 1 year ago) from 1M to 30Y; **2s10s** and **3M-10Y** spreads with the inversion periods shaded.
- **Inflation year-on-year** and **core** from the CPI index: `CPI_t / CPI_{t-12} - 1`; 3-month annualised trend.
- **Real yield** = 10Y yield - 10Y inflation expectation.
- **Labor**: unemployment, participation, wage growth (`AHE_t / AHE_{t-12} - 1`), and the **Sahm rule** recession signal
  (3-month average unemployment minus its lowest 3-month average of the past 12 months; at or above 0.5 pts = warning).
- **Funding**: IORB / fed funds line.
- **Equity risk premium** = S&P earnings yield - 10Y yield; **Rule of 20** = P/E + inflation. Uses the S&P from yfinance (`^GSPC`, indices are locked on Massive).
- Cache: macro data changes monthly/daily, cache 12 hours. Cost is a handful of calls per page open, then none.

### 5.2 Macro layers on the pages we already have
- **Overview: "Real (inflation-adjusted)" toggle**: price / CPI rebased to today. Shows what a 20-year NVDA or KO chart looks like after inflation; same for the Years Performance bars.
- **Fair value**: DCF uses the live 10Y yield and the inflation expectation for terminal growth instead of the fixed 2.5%.
- **Rate sensitivity**: regress the stock's monthly returns on 10Y yield changes and on inflation surprises; show "this stock falls X% per +1 pt in yields".
- **P/E versus the 10Y yield** chart on Overview's P/E overlay.

### 5.3 Insider activity tab (the reference site had one and we never built it)
Form 4 is free with the filer's title. Calculations:
- Open-market buys (`P`) and sales (`S`) only; exclude grants (`A`), option exercises (`M`), tax withholding (`F`), which are noise.
- **Net insider $ per quarter** as buy/sell bars with the stock price line, the same design as the Politicians chart.
- **Cluster buying**: 3 or more different insiders buying within 30 days (a known, stronger signal than one trade).
- Split by role (CEO/CFO vs directors), value-weighted average price versus today's price, late-filing flag.
- A combined "smart money" view next to Politicians, and a column "insider net buying 6M" for Compare.
- Cost: 1-2 calls per company, cache 6 hours.

### 5.4 Short interest and squeeze indicators
- **Short % of float** = short interest / free float (both free), **days to cover**, trend over the last 2 years.
- **Daily short-volume ratio** (a 10-day average; note it is short *volume*, not short *interest*, and includes market-maker hedging).
- **Squeeze score**: high % of float + rising days to cover + price above its 50-day average. A screening flag, not a signal.
- Cost: 3 calls per company.

### 5.5 Futures (free daily bars, real contracts)
- **Futures curve / term structure**: pull every active contract of a product (ES, CL, GC, NG, ZC...) and plot price by expiry.
  **Contango vs backwardation**, and **annualised roll yield** = `(front - next) / front x 365 / days between expiries`.
- **Calendar spreads** and a proper continuous series (yfinance's `GC=F` has roll jumps).
- Commodity page: settlement price, dollar volume, session high/low.
- Cost: one call per contract, so 6-10 calls per curve (about 2 minutes on the free plan); cache aggressively (a curve is stable for hours). Data lags about 8 hours.

### 5.6 Options: a calculator, not a scanner
Without the chain snapshot (locked) we get contract lists and each contract's daily bars, but no Greeks, implied volatility or open interest.
What is still possible with our own maths:
- **Implied volatility** for one chosen contract: solve Black-Scholes for the volatility that gives the contract's last close, using the underlying close, the strike, days to expiry, the Treasury rate from 5.1 and the dividend yield.
- **Greeks** (delta, gamma, theta, vega) from that IV.
- **Expected move** = at-the-money straddle price; **IV vs 30-day realised volatility** for the underlying (from our prices).
- **Strategy builder / payoff diagram** (covered call, spreads, straddles): pure maths, no data needed except the premium.
- **Put/call volume ratio** from the daily volume of a handful of near-the-money contracts.
- Honest limit: at 5 calls a minute we cannot scan a full chain (hundreds of contracts). A real options chain page needs a paid Options plan.

### 5.7 Market breadth and a real US universe (one call = the whole market)
Because one grouped-daily call returns all ~12,600 tickers, a nightly job can store every day of the last 2 years
(about 500 calls, 100 minutes once, then 1 call a day; closed days are immutable so cache forever on disk).
From that local store, with no more API calls:
- **Advance/decline line**, up vs down volume, **% of stocks above their 50 and 200-day average**, **new 52-week highs and lows** (the free plan locks the movers endpoint; we rebuild it).
- **Top gainers, losers and most active** (by dollar volume) for any day.
- **Momentum rank** (12-month return skipping the last month) and **low-volatility rank** across the whole market.
- **"Most traded 100/500 US companies"** as a Rankings universe (fills the missing S&P-500-membership gap in a data-driven way). Filter to common stock with the tickers list (`type=CS`).
- Unusual **volume spikes** (today's volume / 20-day average) and **gap scanners**.

### 5.8 Calendars
- **Dividend calendar** for the whole market: the dividends endpoint filters by ex-date, so "who goes ex-dividend this week" is one call.
- **Dividend growth streaks**: consecutive years of increases (aristocrat check) from a company's dividend history, and payout ratio using our EPS.
- **IPO calendar**: pending and recent IPOs with price range, offer size, exchange.

### 5.9 Filings
- **13F "guru" portfolios**: choose a fund (Berkshire, Bridgewater...), see its holdings and the quarter-over-quarter changes: new, added, reduced, exited. Limit: the endpoint filters by *filer*, not by held company, so "who owns AAPL" would mean reading whole funds' books. Fine for a fixed list of funds.
- **Risk-factor changes**: compare this year's 10-K risk categories with last year's and list the **new** ones, with the quote. A unique, cheap "what changed" view (1 call per year).

### 5.10 Smaller improvements
- Company profile block: employees, **revenue per employee** (our TTM sales / employees), share count and market cap cross-check, list date (company age).
- **Related companies** as a fourth suggestion group in Compare (Massive's are "companies mentioned together", different from Yahoo's industry peers).
- Forex and crypto daily history for the Watchlist's currencies/crypto lists and a small **correlation matrix** (stock vs EURUSD, BTC, 10Y yield).
- **Data-quality check**: a hidden endpoint comparing the last 30 closes from yfinance and Massive per symbol, flagging differences above 0.5%.

## 6. How to integrate it safely

1. **One module `backend/massive.py`** with a shared rate limiter (max 5 calls per minute, retry on 429 after the wait), same pattern as `data.finnhub_get`. Treat "not entitled" (403) as a clear message, like Finnhub's US-only note.
2. **Disk cache** (SQLite or JSON under `backend/cache/`, git-ignored): macro 12 h, profile and logo weeks, Form 4 6 h, grouped-daily days forever. The in-memory 1-hour cache is too short for a 5-calls-a-minute budget.
3. **Priority**: a page the user just opened jumps the queue; background backfills (grouped daily, futures curves) use only idle capacity.
4. Keep Massive **optional**, like Benzinga: no key or a 403 hides that block instead of breaking the tab.
5. The key stays in `.env` only (it was pasted in chat once; regenerate it in the Massive dashboard if that chat is ever shared).

## 7. Suggested order

| # | Step | Why first | Calls per use |
|---|---|---|---|
| 1 | Macro tab (5.1) + risk-free swap in Fair value | Everything free, nothing like it in the app | ~6 |
| 2 | Insider activity (5.3) | Was on the reference site, free | 1-2 |
| 3 | Logos (5.10) + AI news sentiment (section 4) | Fixes two known limitations | 1 each |
| 4 | Short interest (5.4) | Free, fits the Overview/Compare pattern | 3 |
| 5 | Real-price toggle and rate sensitivity (5.2) | Reuses step 1 data | 0 extra |
| 6 | Futures curves (5.5) | New asset class, free | 6-10 |
| 7 | Breadth and universe (5.7) | Largest build (needs the nightly store) | 1/day after backfill |
| 8 | Options calculator (5.6), calendars (5.8), 13F and risk changes (5.9) | Nice extras | 1-3 |

## 8. When paying would change the picture

- **Stocks Starter, $29/month**: removes the 5-per-minute limit (unlimited calls), 5 years of history, minute/second bars, snapshots, WebSocket. That alone would make Massive usable inside Rankings and Compare.
- **Stocks Advanced, $199/month**: real-time prices and the ratios endpoint (P/E, EV/EBITDA, ROE... for every stock in one query, which could replace much of our per-company Finnhub work).
- **Options / Indices plans** (prices not verified): needed for the options chain with Greeks and for index data (S&P 500, VIX) that yfinance already covers for free.
- I would **not** pay yet: build steps 1-4 on the free plan first, and see whether the 5-per-minute limit actually hurts.
