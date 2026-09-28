# QuantPlatform

A local web app for analysing listed companies. A Python backend (FastAPI) pulls data from **Yahoo Finance (yfinance)**, **Finnhub**, and optionally **Benzinga** and **Bargo AI**, does the calculations, and serves a React frontend (Vite, Tailwind CSS v4, Plotly.js).

It is an analysis and learning tool, not investment advice. Every figure rests on third-party data and stated assumptions; the limits of each feature are listed below.

## Contents

- [Requirements](#requirements)
- [Setup](#setup)
- [Running](#running)
- [Data sources and keys](#data-sources-and-keys)
- [Features](#features)
- [API reference](#api-reference)
- [Project layout](#project-layout)
- [General limitations](#general-limitations)

## Requirements

- Python 3.10+
- Node.js 20+ (with npm)
- A free Finnhub API key (https://finnhub.io). Benzinga and Bargo keys are optional.

## Setup

```
cp .env.example .env        # then fill in your keys (see "Data sources and keys")

cd backend
python -m venv .venv
.venv\Scripts\python -m pip install -r requirements.txt

cd ..\frontend
npm install
```

On Windows machines where the `.exe` launchers in `.venv\Scripts` are blocked by policy, always run tools as modules (`python -m uvicorn ...`, `python -m pip ...`), as shown here.

## Running

**Development** (two terminals):

```
cd backend
.venv\Scripts\python -m uvicorn main:app --reload --port 8000

cd frontend
npm run dev        # http://localhost:5173, proxies /api to :8000
```

**Single port** (the backend serves the built frontend):

```
cd frontend
npm run build
cd ..\backend
.venv\Scripts\python -m uvicorn main:app --port 8000     # http://localhost:8000
```

Restart the backend after pulling changes when you run without `--reload`.

## Data sources and keys

Keys live only in `.env` at the project root (git-ignored). Never commit them.

| Variable | Required | Used for |
|---|---|---|
| `FINNHUB_API_KEY` | Yes for most fundamentals | Long histories of ratios, ROIC, FCF yield, EV/EBITDA vs price, Solidity (SEC filings), Overview overlays, historical multiples, company news. Free tier: 60 calls/min, US listings only; the backend limits itself to 50/min and retries on HTTP 429. |
| `BENZINGA_API_KEY` | No | Extra headlines merged into the News tab. Without it the tab still works from Finnhub. |
| `MASSIVE_API_KEY` | No | Macro, Insiders, Short interest, Futures, Market tabs, company logos and AI news sentiment (see below). Free plan: **5 calls per minute**, 2 years of prices, end-of-day data; the backend keeps a queue and a disk cache in `backend/cache/` (git-ignored). Details of what the free plan includes: `docs/MASSIVE_API.md`. |
| `BARGO_API_KEY` | No | Recent Senate trades on the Politicians tab. Without it only House trades show. Bargo's free-tier terms require the credit line the tab displays. |

yfinance needs no key and supplies prices, statements, estimates, profiles, calendars, search and screeners. Prices come from Yahoo only. Responses are cached in memory (1 hour for most data, 10 s for quotes, 60 s for intraday and watchlist).

## Features

The app opens on a **landing page** (search box with live suggestions, example tickers, a watchlist card). Search accepts a ticker or a company name. Once a company is loaded, every page shows a **company header** (name, ticker and exchange, sector, industry, country, currency, market cap, price, change today, a star to add it to the watchlist, and a live-status badge). Clicking the "QuantPlatform" title returns to the landing page. Light and dark mode follow the operating system. The last company is remembered in the browser.

Top-level tabs: **Overview, Seasonality, Fundamentals, Fair value, Compare, Rankings, News, Politicians, Watchlist**.

### Overview
- Price chart (area, dotted line to a last-price label, log-scale option) with range tiles: Today, 1 Week, 1 Month, 6 Months, This Year, 1, 3, 5, 10, 20 Years, All history. Each tile shows its return and selects the chart range. Returns run from the first close on or after the start date to the last close.
- Today and 1 Week draw intraday bars (1-minute and 5-minute, regular hours, in the exchange's time zone) with a previous-close line.
- Overlay pills on the price chart, one at a time: Sales, Net Income, Free Cash Flow (trailing 12 months, from SEC filings), P/E (TTM) and Dividends.
- Drawdown chart (decline from the running peak, current and worst in range).
- Years Performance bars (last 10 / 20 / all years, current year pale).
- Dividends: status badge (increasing / decreasing / stable / none), last-12-month total, yield, last and next ex-dividend dates, bars per payment or per year.
- Event strip for upcoming dividend payments and earnings (within 60 days).
- **Live prices:** the header and the Overview chart's last point update by polling Yahoo (every 15 s for real-time US quotes, 60 s for delayed exchanges, 5 min when the market is closed; paused in a hidden browser tab). The badge shows LIVE, Delayed N min or Market closed. Pre-market and after-hours prices are not shown.

### Seasonality
Works for any Yahoo symbol (stocks, ETFs, indices such as `^GSPC`, futures like `GC=F`, FX like `EURUSD=X`, crypto).
- Seasonal curve: the average % change since the start of the window, by calendar date, over the last N complete years. Period pills Current, Last year, 3, 5, 7, 10, 15, 20, 25, 30 years (several at once, each its own colour). Choose the month the chart starts in. "Detrended" view subtracts a centred moving average (10/20/40/60 days).
- Daily, weekly and monthly averages: the share of years that closed up (shown as % long or % short) with the count and average return on hover.
- Trade statistics: pick a window by dragging on the curve or with From/To selects; long or short; success ring per period plus a table of each year's open/close price, return, max drop and max rise (last 30 years).
- Spread: seasonality of the ratio of two symbols (long one, short the other, equal dollar amounts).
- High-probability days scanner: upcoming days where the up- (or down-) share reaches a threshold (default 70%) in all chosen periods.
- Historical tendency only; daily bars rest on few observations. Prices are split- but not dividend-adjusted.

### Fundamentals (sub tabs)
- **EV/EBITDA:** two sources. Finnhub series at fiscal quarter ends, or a daily line built from yfinance (price x shares + debt + minority interests - cash, over TTM EBITDA; statements applied 45 days after period end). Ranges 1Y/3Y/5Y/10Y/Max, median line, tiles (current, median, range, percentile), data table. Undefined for banks and negative EBITDA.
- **EV/EBITDA vs price:** EV/EBITDA (left axis) against the stock price (right axis) with fiscal-year lines, about 26 years of history. Uses the last completed fiscal year's EBITDA from the fiscal year end date.
- **ROIC:** one bar per fiscal year (Finnhub) plus a TTM bar computed from yfinance (NOPAT / (equity + debt)); compare up to 6 companies side by side; per-company table. Not meaningful for banks. The definition differs from other terminals, so levels can differ.
- **FCF yield:** annual, quarterly (TTM at each quarter end) or TTM bars with the stock price overlaid; years selector 3/5/10/20/Max, chips to show/hide series, CSV download. Banks are not meaningful.
- **Solidity:** Altman Z, Piotroski F and Beneish M per fiscal year, quarter and TTM, computed from SEC as-reported filings (US filers only). Click a row to chart it with threshold lines; "Show components" reveals the inputs; warning marks on weak cells. Not meaningful for banks and insurers.
- **PEG:** PEG for the current and next fiscal year from consensus EPS estimates (price / EPS divided by expected EPS growth in %), with an inputs table and reference figures from Yahoo and Finnhub. Shown as n/a when EPS or growth is not positive.
- **Historical ratios:** small charts of margins, ROE, current ratio, debt/equity and net debt/EBITDA, plus a picker for any Finnhub metric series (annual or quarterly).

### Fair value
- Tiles (price, fair value, upside, a reading: under- or over-valued beyond 10%) and a football-field chart of each method's low-to-high range against today's price.
- **DCF** computed in the browser with editable inputs (FCF growth years 1-5, WACC, terminal growth). Two-stage projection over 10 years, Gordon terminal value, a projection table and a 5x5 WACC / terminal-growth sensitivity table. Defaults: TTM free cash flow, CAPM WACC (10-year Treasury yield, beta clamped 0.5-2.5, 5% equity premium), growth from analysts' revenue estimate. No DCF for banks, insurers and asset managers.
- **Historical multiples:** today's EPS, EBITDA, FCF and sales per share times the company's own median P/E, EV/EBITDA, P/FCF and P/S over 5 or 10 years (range = 25th to 75th percentile). Needs Finnhub, so US listings only.
- **Analyst targets:** low, mean, median, high and analyst count from Yahoo.
- The fair value is the median of all available estimates. Very sensitive to growth and WACC: edit the inputs rather than trust the defaults.

### Compare
Up to 6 companies, any of them removable. Add by name search or from three suggestion groups: same industry worldwide (e.g. Apple gives Samsung, Sony, Xiaomi), Yahoo's "often viewed together", and the largest companies of the sector. Output: price performance rebased to 100 (1/3/5/10Y, each in its own currency), bar charts for EV/EBITDA, ROIC, FCF yield, PEG, Altman Z and Piotroski F, and a table with price change and all metrics (best value per column in bold). The selection persists across reloads.

### Rankings
- **Metrics table:** rank a group by market cap, EV/EBITDA, ROIC, FCF yield, PEG, Altman Z, Piotroski F, Beneish M and 14-day news sentiment. Click a column to sort (best first, missing values last), with a median row and the current company marked. Groups: direct competitors (worldwide, from the ticker's Yahoo industry), largest companies by market and sector/industry (US, EU, Europe, UK, Japan, China & Hong Kong, worldwide), or your own typed list. 6 to 30 companies; rows load progressively.
- **Most undervalued / Most overvalued:** top 20 from a scan of the largest 30, 50 or 100 companies, filtered by market (including single countries such as Germany, France, Italy, Spain, Netherlands, Switzerland, Sweden, Canada, Australia, India, South Korea, Taiwan, Brazil), sector and industry. Ranks by upside to the Fair value tab's default fair value, with the gap per method, number of estimates and caveats. Large scans are slow and can hit Yahoo's rate limit.

### News
Card grid (thumbnail, headline, summary, source, date, link) paginated 9 per page, last 30 days, from Finnhub plus Benzinga (optional). Non-US listings fall back to Yahoo's own news. Each article gets a Positive / Neutral / Negative label from a local word-count model using the Loughran-McDonald finance dictionary with a 3-word negation window (no external service, not a language model). A tally strip, a daily net-sentiment bar chart and a "Hide Yahoo re-posts" checkbox (on by default) sit above the grid.

### Politicians
Congressional stock trades disclosed under the STOCK Act.
- Quarterly buy vs sell dollar totals (range midpoint of each disclosed amount range) with 2Y/5Y/10Y/Max pills.
- Filters: chamber (House / Senate), trade type, minimum amount ($15K to $1M+), and a politician or ticker search. Paginated table with filing links.
- "This company only" switches the chart and table to the current ticker and adds its quarter-end price on a second axis.
- Sources: House from the `TattooedHead/house-stock-watcher-data` GitHub dataset (full history from 2012); Senate from Bargo AI (rolling last ~3 months, needs `BARGO_API_KEY`). Filings lag trades by up to 45 days and amounts are ranges. Third-party mirrors, not official government feeds.

### Macro
Federal Reserve data through Massive, not tied to the company in the header. 10 tiles (10-year yield, 10Y-2Y and 10Y-3M spreads, fed funds target, CPI and core CPI year on year, real 10-year yield, unemployment, Sahm indicator with a recession-signal mark at 0.50, wage growth) and 9 charts with 5Y/10Y/20Y/Max pills: the yield curve today / 1 month / 1 year ago, yields over time with inverted-curve periods shaded, spreads, the policy rate, inflation, inflation expectations, real yield, unemployment with the Sahm bars, wages vs inflation. Below them, "How {symbol} reacts to interest rates": monthly returns regressed on the change in the 10-year yield, alone and with the S&P 500 removed, over 5 years / 10 years / all history, with a rolling 36-month chart, a scatter and average returns by regime. The same 10-year yield is the risk-free rate of the Fair value tab. Overview has an "Inflation-adjusted" checkbox that shows every price in today's dollars (USD stocks only).

### Insiders
SEC Form 4 open-market purchases and sales by officers, directors and 10% owners (US-listed only): 6 tiles for the last 12 months, quarterly buy/sell bars with the stock price, cluster buying (3+ insiders buying within 30 days), a by-insider table and every transaction with 10b5-1 and late flags and a link to the filing. Grants, option exercises and tax withholding are left out.

### Short interest
FINRA short interest (twice a month since 2017), daily short volume (since 2024) and free float: short % of float, days to cover, the 20-day average short-volume ratio, and a four-flag squeeze checklist (short interest at least 10% of float, days to cover at least 5, short interest up 10% in 3 reports, price above its 50-day average). A screening aid, not a forecast. The float is today's for every date, so older % values are approximate.

### Futures
Term structure of 20 CME / CBOT / COMEX / NYMEX products (index futures, energy, metals, grains, livestock, Treasuries, EUR/USD): the curve now and 1 / 3 / 12 months ago, contango or backwardation, annualised roll yield, calendar spreads and the front-vs-next spread over time, for the nearest 6 contracts (thin ones are marked). End-of-day data. A product takes 1-2 minutes to load the first time (one download per contract), then 6 hours from the disk cache. ICE contracts (coffee, sugar, cocoa) are not covered.

### Market
Breadth and scans for about 3,000 liquid US common stocks: advancers/decliners and the advance-decline line, the share of stocks above their 20 / 50 / 200-day average, new highs and lows, and lists of top gainers and losers, most active, volume spikes, momentum leaders and laggards (12-1, 6-1 or 3-1 months, whichever the history allows), lowest volatility and new highs and lows. Clicking a symbol opens its Overview. Data comes from Massive's "grouped daily" endpoint, one call per session. A background collector started with the backend downloads the last ~300 sessions newest first at 2 calls a minute (about 2.5 hours in total, leaving 3 calls a minute for the rest of the app) into `backend/cache/massive/grouped.db`; the tab shows its progress and each feature unlocks as history builds up (20-day average at 20 sessions, low volatility 61, 200-day average 200, 12-1 momentum 274). The newest session is yesterday's (today's is not on the free plan). Set `NO_BACKFILL=1` to switch the collector off. Rankings also gets a "Most traded (US)" universe from this data.

### Filings
Two views. **Fund portfolios (13F):** what 14 well-known investors (Berkshire Hathaway, Pershing Square, Scion, Appaloosa, Third Point, Duquesne, Baupost, Greenlight, Carl Icahn, Soros, Tiger Global, Lone Pine, Viking, Coatue) held at the end of their latest quarter, with weights, share counts, values, what is new, added, reduced or sold out since the quarter before, and a link to the SEC filing. Positions are long US-listed securities only and up to 6 weeks old. Fund identifiers were checked against the SEC's records; funds that stopped filing (for example Scion) show a message. **Risk factors:** the latest 10-K's risk categories compared with the previous 10-K: new risks, dropped ones, more or less emphasis, with the company's own wording. The newest 10-K can be missing because Massive processes filings with a delay.

### Calendar
Upcoming ex-dividend dates of US common stocks (next 7 / 14 / 30 days, minimum estimated yield, search; special dividends marked; click a company to open it) and IPOs (pending, postponed, recently priced, with price range and offer size). The estimated yield uses the prices collected by the Market tab.

### Options
No live option chain is on Massive's free plan, so the tab works from the list of contracts and each contract's daily prices. **Analyse a contract:** pick an expiration, call or put and strike (nearest the stock price by default): last traded price, implied volatility, delta, gamma, theta, vega, time value, break-even and a price history, computed with Black-Scholes from the last trade, the stock's close that day, the Treasury rate and the dividend yield (stock options are American; the model is approximate for deep in-the-money puts and around dividends). **Expected move:** the price of the at-the-money straddle for an expiration. **Strategy builder** (in the browser): long call/put, covered call, protective put, bull call spread, bear put spread, straddle, strangle, iron condor, or your own legs; profit or loss at expiry and today by the model, net debit or credit, maximum profit and loss, break-evens and the model's chance of profit. Learning tool, not advice.

### Watchlist
A card on the landing page and a top-level tab. Rows show a letter avatar, market-open dot, name, ticker, sparkline (previous session grey, last session green or red), price and % change. Lists: My watchlist (stored in the browser; add through a search box or the header star, remove with the x) and fixed lists for Commodities, Stocks, Indices, Currencies and Crypto. Refreshes every 60 s while a market in the list is open, else every 5 min. Clicking a row opens that symbol's Overview.

## API reference

All endpoints are `GET` and return JSON. Symbols are validated (400 on a bad format, 404 for an unknown ticker, 422 when a metric is not meaningful, 503 when a required key is missing).

| Endpoint | Purpose |
|---|---|
| `/api/config` | Which keys are configured |
| `/api/profile/{symbol}` | Company header data |
| `/api/quote/{symbol}` | Live quote and market state |
| `/api/watchlist?symbols=A,B` | Rows for up to 40 symbols |
| `/api/overview/{symbol}` | Daily closes, dividends, event dates |
| `/api/overview/{symbol}/intraday?range=1d\|1w` | Intraday bars |
| `/api/overview/{symbol}/overlay/{sales\|income\|fcf\|pe}` | Overlay series (US filers, Finnhub key) |
| `/api/yfinance/ev-ebitda/{symbol}` | Daily EV/EBITDA from yfinance |
| `/api/ev-ebitda-fy/{symbol}` | Fiscal-year EV/EBITDA with price |
| `/api/roic/{symbol}` | ROIC per fiscal year plus TTM |
| `/api/fcf-yield/{symbol}` | FCF yield (annual, quarterly, TTM) |
| `/api/solidity/{symbol}` | Altman Z, Piotroski F, Beneish M |
| `/api/peg/{symbol}` | PEG for two forecast years |
| `/api/fair-value/{symbol}` | Inputs and estimates for the Fair value tab |
| `/api/fair-value/{symbol}/summary` | One-line fair value used by the rankings |
| `/api/compare/suggest/{symbol}` | Suggested companies in three groups |
| `/api/compare/search?q=` | Ticker lookup by name |
| `/api/compare/prices?symbols=&years=` | Prices rebased to 100 |
| `/api/rankings/options` | Markets, sectors, industries |
| `/api/rankings/universe?kind=peers\|market\|traded\|custom&...` | Companies to rank |
| `/api/rankings/row/{symbol}` | One company's ranking metrics |
| `/api/seasonality/{symbol}?start_month=&vs=` | Seasonal curves and bars |
| `/api/seasonality/{symbol}/trades?start=MM-DD&end=MM-DD&vs=` | Per-year trade table |
| `/api/yfinance/ratios/{symbol}` | Fiscal-year ratios |
| `/api/finnhub/{symbol}?freq=annual\|quarterly` | Finnhub reported series |
| `/api/news/{symbol}` | Articles with sentiment |
| `/api/macro`, `/api/macro/cpi` | Macro series; CPI index for the inflation-adjusted price |
| `/api/rate-sensitivity/{symbol}` | Regression of monthly returns on 10-year yield changes |
| `/api/insiders/{symbol}` | Form 4 purchases and sales, clusters, quarterly totals |
| `/api/short-interest/{symbol}` | Short interest, short volume, float, squeeze checklist |
| `/api/futures/products`, `/api/futures/{code}` | Futures products and one product's term structure |
| `/api/breadth` | Market breadth, scans and collector progress |
| `/api/funds`, `/api/funds/{cik}` | 13F fund list and one fund's portfolio |
| `/api/risk-factors/{symbol}` | Risk-factor changes between the last two 10-Ks |
| `/api/calendar` | Ex-dividend dates and IPOs |
| `/api/options/{symbol}/expirations` | Option expirations and strikes (nearest ~3,000 contracts) |
| `/api/options/{symbol}/contract?expiry=&type=&strike=` | Last price, implied volatility and Greeks of one contract |
| `/api/options/{symbol}/expected-move?expiry=` | At-the-money straddle for an expiration |
| `/api/logo/{symbol}` | Company icon (the backend fetches it; the key never reaches the browser) |
| `/api/congress/trades` | Paginated, filterable trades |
| `/api/congress/summary[?ticker=]` | Quarterly buy/sell totals |

## Project layout

```
backend/    FastAPI app (main.py) and logic: data.py, overview.py, seasonality.py, solidity.py,
            forward.py, fairvalue.py, rankings.py, sentiment.py (+ lm_sentiment.json), congress.py,
            massive.py (Massive client: 5/min queue, disk cache), macro.py, insiders.py, shorts.py, futures.py,
            market.py (background collector), breadth.py (market breadth and scans), filings.py (13F, risk factors),
            calendars.py (dividends, IPOs), options.py (implied volatility, Greeks, expected move)
frontend/   React + Vite: src/App.jsx (shell), one *Tab.jsx per feature, Home.jsx, Watchlist.jsx,
            Plot.jsx (Plotly wrapper), perf.js (return/drawdown maths), rows.js (shared ranking rows), api.js
.env        your keys (not committed);  .env.example  the template
```

## General limitations

- Not investment advice. Third-party data can be wrong, late or missing.
- Finnhub's free tier covers US listings only; foreign-only tickers get fewer metrics.
- Banks and insurers lack EBITDA, ROIC and Solidity scores; those views say so.
- Yahoo is unofficial and can rate-limit heavy scans (Rankings undervalued/overvalued, big groups).
- Statement history from yfinance is short (about 4-5 years); long histories come from Finnhub.
- Massive's free plan allows 5 calls a minute: pages that need several downloads (a new futures product, a company's insider trades) wait on the first load, and per-company loops (Rankings) do not use it.
- The frontend bundle is about 5 MB because of Plotly.
