# QuantPlatform

This file is the project tracker and the source of truth. It is loaded at the start of every session.

## Working agreement

- After finishing any step, update this file (Done, Next steps, Change log) before replying.
- Work one step at a time and confirm the next step with the owner before starting something big.
- Never write the Finnhub key (or anything from `.env`) into any file except `.env`.
- Don't install software without the owner's OK. The owner approved using the portable Node copy on 2026-09-21
  (IT approval for a proper Node install is still pending).

Last updated: 2026-09-25 (Politicians: party, photos, S&P 500 line)

## 1. The idea (from the owner)

Build a platform that retrieves financial data from **yfinance** and **Finnhub** (https://finnhub.io/docs/api/introduction)
and analyses it.

- **Starting point:** a view of **historical ratios** and **EV/EBITDA**.
- Further analysis modules will be added step by step after that (not yet defined by the owner).

## 2. Architecture decisions

| Topic | Decision | Why / status |
|---|---|---|
| Backend | **Python**, FastAPI, yfinance, Finnhub over HTTP | Owner's choice. Done and tested. |
| Frontend | **Node.js / React** (Vite + Plotly.js) | Owner's choice. Installed, builds, logic tested in jsdom. **Not yet seen in a real browser.** |
| Styling | **Tailwind CSS v4** (`@tailwindcss/vite`, no config file) | Owner asked to migrate off hand-written CSS on 2026-09-22. Done, see Done section. |
| Streamlit | Dropped | Owner wanted a real frontend. |
| Pure Node backend | Tried and dropped | Owner wants Python for the backend. |
| News source | Finnhub `/company-news` **plus Benzinga's own API** (module 11) | Owner gave a Benzinga API key and its docs on 2026-09-22 to get news that isn't mostly Yahoo re-posts. Done, see Done section. |
| Congress trade source | House: TattooedHead/house-stock-watcher-data (GitHub, free). Senate: Bargo AI congress-trades API (module 12) | housestockwatcher.com / senatestockwatcher.com are both dead (2026-09-23). Owner gave a free Bargo API key the same day. Done, see Done section. |
| Finnhub / Benzinga / Bargo keys | In `.env` at the project root (git-ignored) | Never commit or paste them elsewhere. |

Layout: `backend/` (FastAPI `main.py`, logic in `data.py`, `overview.py`, `congress.py`, `fairvalue.py`, `requirements.txt`, venv at `backend/.venv`),
`frontend/` (React + Vite: `src/App, OverviewTab, perf.js, EvTab, RatiosTab, CongressTab, FairValueTab, Watchlist, Plot, ui, api`), `.env`, `README.md` (setup and run commands).

Windows policy on the owner's machine blocks the `.exe` launchers in `.venv\Scripts` (e.g. `uvicorn.exe`: "Access is denied").
Always run Python tools as modules: `python -m uvicorn main:app --port 8000`, `python -m pip install ...`.

Node on this machine is a **portable copy** (no admin, no PATH entry) at
`%LOCALAPPDATA%\Programs\nodejs-portable\node-v24.19.0-win-x64`. In Git Bash use
`export PATH="/c/Users/DavidePriarone/AppData/Local/Programs/nodejs-portable/node-v24.19.0-win-x64:$PATH"` before `node`/`npm`.

## 3. Done

- [x] Explored data sources. yfinance exposes only ~4-5 fiscal years / ~5-7 quarters of statements. Finnhub `/stock/metric`
      has annual series back to 1985 and quarterly to 1989, including `evEbitda` / `evEbitdaTTM`.
- [x] Finnhub API key obtained and verified (it is 40 characters; the screenshot showed two 20-char halves joined).
- [x] Python backend (`backend/`):
  - `GET /api/config`
  - `GET /api/yfinance/ev-ebitda/{symbol}`: daily EV/EBITDA = (price x shares + debt + minority - cash) / TTM EBITDA,
    fundamentals applied 45 days after period end
  - `GET /api/yfinance/ratios/{symbol}`: gross / operating / net margin, ROE, current ratio, debt/equity, net debt/EBITDA
  - `GET /api/finnhub/{symbol}?freq=annual|quarterly`: Finnhub series, oldest first
  - Verified: AAPL, NVDA, MSFT, XOM numbers sane; JPM (bank, no EBITDA) returns a clear 422; unknown ticker 404;
    invalid ticker 400; SAP shows a currency-mismatch warning on the yfinance source.
- [x] React frontend (`frontend/`): ticker box, EV/EBITDA tab (Finnhub or yfinance source, 1Y/3Y/5Y/10Y/Max,
      median line, current/median/range/percentile tiles, data tables), Ratios tab (small-multiple charts + Finnhub series
      picker, annual/quarterly), light/dark theme.
- [x] `npm install` works (resolved: react 19.3, vite 7.3, plugin-react 5.2, plotly.js-dist-min 4.1.1) and `npm run build`
      succeeds; the backend serves the built UI from `frontend/dist` on `http://localhost:8000`.
- [x] Frontend tested in jsdom against the live backend with Plotly stubbed (real React code, no pixels): initial load,
      range and source switching, ticker changes (JPM / SAP / bad ticker show correct errors or banners), ratios tab, metric
      picker, annual/quarterly toggle. No runtime errors.
- [x] Owner ran the app in a browser (2026-09-21): AAPL EV/EBITDA chart renders correctly.
- [x] Correctness cross-check of the yfinance EV/EBITDA against Finnhub's independent series at the same quarter ends
      (AAPL, no filing lag): 2023-09 21.6 vs 22.1, 2024-09 25.9 vs 26.7, 2025-09 26.4 vs 26.4, 2026-03 22.9 vs 22.9,
      2026-06 24.9 vs 24.9. Differences 0-0.8x. Worked example on 2026-09-21: 337.47 x 14.687B sh = 4,957B mcap + 84.3B debt
      - 62.4B cash = EV 4,978B / 168.0B TTM EBITDA = 29.6x.
- [x] **Module 2, "EV / EBITDA vs price" (owner's reference chart, Forecaster.biz style, 2026-09-21).** Third tab (`frontend/src/FyTab.jsx`)
      + `GET /api/ev-ebitda-fy/{symbol}` (`data.ev_ebitda_fy_history`). EV/EBITDA on the left axis and the stock price on the right
      axis (dual axis on purpose, as in the reference), dotted vertical lines with FY labels at each fiscal year end, range 5Y/10Y/15Y/Max
      (default 10Y), ~26 years of history. Method: EBITDA = last completed fiscal year (Finnhub annual `ebitda`), applied from the
      period-end date (multiple climbs during the year, drops at the FY line, like the reference). EV daily = price x shares + net debt.
      Finnhub has no shares/net debt, so they are backed out of its annual EV: net debt = `netDebtToTotalEquity` x `bookValue`;
      shares = (EV - net debt) / close on the FIRST TRADING DAY ON OR AFTER the period end (this is the day Finnhub values EV on; it
      reproduces Finnhub's EV to ~0.1%).
- [x] Validation of module 2: implied shares vs yfinance balance-sheet shares: AAPL/NVDA/MSFT within 0.2%, XOM 1-4.5%. NVDA series
      matches the reference chart (peak 264x just before the FY24 line vs ~260x in the reference; ~35x in 2025-26; FY17..FY26 markers).
      jsdom test of the tab (ranges, tickers, errors, other tabs) passed. Real-browser look still pending.
- [x] **Module 3, "ROIC" (owner's Forecaster.biz reference: Visa vs Mastercard bar charts, 2026-09-21).** Fourth tab
      (`frontend/src/RoicTab.jsx`) + `GET /api/roic/{symbol}` (`data.roic_history`). One bar per fiscal year (last 5/10/15/all) plus a
      lighter TTM bar, value labels on the bars (hidden above 12 bars), "Compare with" box to show up to 6 companies side by side
      (each with its own scale, like the reference), per-company data table. Fiscal-year bars = Finnhub annual `roic` (history back to
      the 1980s-2000s). TTM bar = computed here from yfinance quarterlies on the same basis: 4-quarter operating income x (1 - effective
      tax rate) / (equity + total debt) at the latest quarter (Finnhub's own `roicTTM` is shown in the table only, because it is on a
      different basis: NVDA 97% TTM vs 72% annual for the same date).
- [x] Validation of module 3: Finnhub annual ROIC ~ NOPAT/(equity+debt) (V 31.8 vs 34.9, MA 56.0 vs 58.8, AAPL 64.5 vs 65.1, MSFT 24.3 vs
      25.1, KO 16.9 vs 15.8, HD 20.6 vs 20.3; JNJ off by 4 pts). Own TTM is close to the last fiscal-year bar for most names. Absolute values do
      NOT match Forecaster (V 2025: 32% here vs 45% there; MA 56% vs 109%; NVDA TTM 62% vs ~74%): providers define invested capital
      differently and Forecaster's method is not public. Shapes/trends do match (V rising, MA peaks 2018/2025 with a 2020-21 dip).
      jsdom test of the tab (ranges, compare add/remove, JPM without TTM, unknown ticker, other tabs) passed.
- [x] **Module 4, "FCF yield" (owner's Forecaster.biz Oracle reference, 2026-09-21).** Fifth tab (`frontend/src/FcfTab.jsx`) +
      `GET /api/fcf-yield/{symbol}` (`data.fcf_yield_history`). Layout as in the reference: Annual/Quarterly toggle, years dropdown
      (3/5/10/20/Max; "10 years" = 9 completed fiscal years + TTM bar, as in the reference), Download CSV, blue bars with 2-decimal labels
      (negative bars go below zero), lighter TTM bar in its own slot, stock price line overlaid on a hidden right axis, checkbox chips
      to show/hide "Stock price" and "Free cash flow yield". Method: yield = Finnhub quarterly `fcfPerShareTTM` / close on the first
      trading day on or after the period end (Finnhub's valuation day). Annual bars = the value at each fiscal year end (dates from
      Finnhub's annual series); TTM bar = latest TTM FCF per share / latest close (today's yield); quarterly view = TTM yield at each
      quarter end. Why not Finnhub's annual FCF margin / P-FCF: they are empty in negative-FCF years (ORCL 2025-26).
- [x] Validation of module 4: ORCL annual yields vs the reference: FY2022 2.62 vs 2.59, FY2023 2.95 vs 2.97, FY2024 3.66 vs 3.67, FY2025 -0.08 vs
      -0.08, FY2026 -3.31 vs -3.32 (FY2018-21 are 0.2-0.6 points higher: 7.31/7.58/7.11/6.14 vs 7.09/7.01/6.79/5.87, probably a different
      market cap basis in the reference). Yield is continuous across NVDA's 2021 and 2024 splits. jsdom test passed (modes, ranges, chips,
      CSV, warnings, other tabs).
- [x] **Module 5, "Solidity" (owner's Forecaster.biz Ratios > Solidity table, 2026-09-21).** Sixth tab (`frontend/src/SolidityTab.jsx`) +
      `GET /api/solidity/{symbol}` (`backend/solidity.py`, its own module). Table like the reference: one column per fiscal year (or
      quarter) + TTM, rows Altman Z / Piotroski F / Beneish M, click a row to chart it (with threshold lines), Annual/Quarterly toggle,
      <- -> scroll arrows (newest columns in view), "Show components" (Altman X1-X5, the 9 Piotroski signals, the 8 Beneish indices),
      tiles with the TTM zone in words, a warning mark on warning-level cells (Altman < 1.81, Piotroski <= 2, Beneish > -1.78).
      Data: Finnhub `/stock/financials-reported` (SEC as-reported XBRL; free tier; the standardized `/stock/financials` is premium = 403).
      Each filing becomes a "snapshot" of one period end (balance sheet + trailing-12-month flows: 10-K = the year; 10-Q = last 10-K +
      YTD now - YTD a year ago); every score compares a snapshot with the one a year earlier. Tags are read namespace-agnostically with
      fallback lists per line item (`BS_ITEMS`, `FLOW_ITEMS`); EBIT falls back to pre-tax income + interest, gross margin to operating
      margin, shares to net income / diluted EPS. Market cap = un-split-adjusted close x reported shares; TTM column uses today's price.
      Conventions chosen (documented in the UI): period-end total assets everywhere; Piotroski leverage signal = "did not rise";
      neutral index 1.0 for a missing Beneish input (marked with *).
- [x] Validation of module 5: independent Altman Z from yfinance statements vs the as-reported version: AAPL 10.17 vs 10.20, NVDA 61.14 vs 60.41,
      KO 4.76 vs 4.64. Plausible levels: AAPL Z 7-10, KO ~4.5, F (Ford) 0.8 (captive finance pushes autos into distress), Piotroski 4-9, Beneish -2 to -3.
      Coverage of annual rows (Altman/Piotroski/Beneish): AAPL 15/15/13, XOM 15/14/15, NVDA 16/16/16, WMT 13/13/13, KO and JNJ 15/15/15,
      GOOGL 10/10/8, TSLA 9/8/13, F 8/6/11 of the fiscal years. jsdom test of the tab passed.
- [x] **Module 6, "PEG" (owner's Forecaster.biz Micron reference, Forward Valuation category, 2026-09-21).** Seventh tab
      (`frontend/src/PegTab.jsx`) + `GET /api/peg/{symbol}` (`backend/forward.py`). One bar per forecast fiscal year (current and next,
      labelled e.g. "2026e", "2027e"; the reference shows a single "2026" bar) with a dotted PEG = 1 line, tiles (price, PEG for both years,
      a reading in words), an inputs table (EPS estimate avg / low-high, number of analysts, prior-year EPS, expected growth, P/E, PEG) and
      a "for reference" table (trailing/forward P/E, Yahoo's PEG, Finnhub's `pegTTM`, 5-year historical EPS growth). Method:
      PEG = (price / that year's consensus EPS) / (that year's expected EPS growth in %), from yfinance `earnings_estimate`
      (Finnhub's estimate endpoints are premium = 403). Fiscal-year label from `info.nextFiscalYearEnd`. Not meaningful (shown as n/a with
      the reason) when EPS or base-year EPS is not positive or growth <= 0. No history exists (estimates cover two years only).
- [x] Validation of module 6: V 1.82 / MA 1.65 (2026e) vs Yahoo's own PEG 1.67 / 1.48 and Finnhub's 2.46 / 2.13; AAPL 2.10 vs 2.70 / 2.93;
      KO 2.65 vs 4.01 / 3.36; SAP 2.05 vs 1.60 / 1.21: same ballpark, sitting between the two providers. Warnings work: growth above 100%
      (MU: 786% / 113% -> PEG 0.02 / 0.06), currency mismatch (NVO: DKK estimates vs USD price), loss-makers (RIVN: n/a). jsdom test passed.
      The owner's article quotes Forecaster values (V ~6, MA ~7.28, MU ~0.55) that this tool cannot reproduce: Forecaster's growth basis is unknown.
- [x] **Module 7, "Rankings" (owner's ROIC/FCF/PEG articles: sort the companies of an index and compare with direct competitors;
      owner said the tickers can come from yfinance, 2026-09-21).** Eighth tab (`frontend/src/RankingsTab.jsx`) + `backend/rankings.py`
      (`GET /api/rankings/universe`, `GET /api/rankings/row/{symbol}`). Universes, all from yfinance: direct competitors (top companies of
      the ticker's Yahoo industry, the ticker always included), same sector (`yf.Sector`), largest US companies (`yf.screen` by market
      cap; yfinance has NO S&P 500 / Dow membership), or a typed list. Sizes 6-30. The table has Market cap, EV/EBITDA, ROIC, FCF yield, PEG,
      Altman Z, Piotroski F, Beneish M; each column sorts (first click = best first; missing values always last; rank numbers appear
      while sorted), a "lower/higher is better" hint per column, the current company marked with a marker, and a median row of the
      group. Each row calls the same functions as the individual tabs (EV/EBITDA = yfinance daily latest; ROIC = TTM else last FY; FCF yield
      TTM; PEG = next FY else this FY; Solidity TTM), so numbers match the tabs. The browser loads rows 3 at a time so the table fills in
      progressively; failures give a dash (hover shows the reason). New in `data.py`: `finnhub_get`, a shared rate limiter for Finnhub
      (max 50 calls per minute, up to 2 retries on HTTP 429), also used by `solidity.py`.
- [x] Validation of module 7: V's industry (Credit Services) loads in ~16 s cold for 10 companies with plausible values (V 24.1x / 41% ROIC /
      3.2% FCF yield / PEG 1.83 / Altman 9.2 / F 7; MA 23.0x / 56% / 3.2% / 1.58 / 10.8 / 8); financials (AXP, COF, SYF, SOFI, ALLY) correctly
      lack EV/EBITDA and Solidity scores. Stress test: 30 cold companies (Industrials sector) in 88 s, 30/30 rows, max 50 Finnhub calls per 60 s,
      two 429s from the statements endpoint recovered by the retry; coverage EV/EBITDA 30/30, ROIC 30/30, FCF 29/30, PEG 29/30, Altman 26/30.
      jsdom test passed (progressive load, sorting both ways, universes, size, custom list with a bad ticker, other tabs).
- [x] **Module 8, "Compare" (owner: "compare different stocks, suggest which ones by sector and real competitors, like Apple and Samsung",
      2026-09-21).** Ninth tab (`frontend/src/CompareTab.jsx`, shared `frontend/src/rows.js`; backend `rankings.py`). The current ticker plus up
      to 5 others (max 6; each keeps a fixed colour, a removed company's colour is reused by the next one added). Ways to add: three groups of
      suggestions (1: same Yahoo industry WORLDWIDE, largest first, e.g. Apple -> Samsung, Sony, Xiaomi, Panasonic, LG; 2: Yahoo's "often viewed
      together"; 3: largest companies of the same sector), and a name search (`yf.Search`, "samsung" -> 005930.KS). Output: price performance
      rebased to 100 (1/3/5/10Y, each stock in its own currency, starts the first day all have data), six bar charts (EV/EBITDA, ROIC, FCF yield,
      PEG, Altman Z, Piotroski F), and a table with price change plus all metrics, best value per column in bold.
      Backend: `industry_peers` (screener by industry: a US query + a worldwide one merged; market caps converted to USD with `data.usd_per_unit`;
      one listing per company: same company = names start alike (first 4 letters, ignoring a leading "The") AND USD caps within 12%; filters for
      OTC/German regional/CEDEAR/BDR exchanges, depositary receipts, preferred shares, "1KO.MI"-style Milan and Vienna lines; best listing =
      price currency equals financials currency (home listing), then most traded), `suggest`, `search`, `compare_prices`. The screener spells
      industries differently from profiles ("Banks - Diversified" vs "Banks—Diversified"): mapped through `yf.const.EQUITY_SCREENER_EQ_MAP`.
      `ranking_row` now also has yfinance-only fallbacks for companies Finnhub does not cover (`data._ttm_roic`, new `data._ttm_fcf_yield`),
      skips ratios that mix currencies (US receipts of foreign companies, HK stocks reporting in CNY), and reports `marketCapUsd`.
      Also fixed: today's empty price row (market still closed, e.g. Korea) broke the latest EV/EBITDA and TTM FCF yield: every `hist["Close"]` is
      now `.dropna()`; Finnhub's 403 for non-US symbols now reads "free tier does not cover this symbol (US listings only)".
      Rankings' "Direct competitors" now uses the same worldwide `industry_peers` logic; "Largest US companies" merges share classes (GOOG/GOOGL).
- [x] **Free choice of stocks (owner: "I want to choose the stock to compare, not only Apple default", 2026-09-21).** (a) Header box
      (`TickerBox` in `App.jsx`) now says "Company": it takes a ticker OR a company name; typing shows a dropdown (debounced call to
      `/api/compare/search`), Enter resolves an exact ticker first, else the first match for the name; the last stock is remembered
      (`localStorage` key `quant.symbol`), AAPL only the very first time. (b) Compare tab: no company is special any more: every chip can
      be removed (also the header stock), "Clear all", the header stock is added the first time it is loaded (tracked with `lastSymbol`, so a
      removed stock is not re-added), the list and colour slots persist across tab switches and reloads (`quant.compare`), a selector chooses
      WHOSE competitors to suggest (default: the header stock, else the first in the list), search-by-name to add anything. Compare with fewer
      than 2 companies shows a hint instead of the charts.
      jsdom test passed: start empty, add MSFT and GOOGL by name (no Apple), suggestions for MSFT (ORCL, PLTR, PANW...), header "samsung" ->
      005930.KS added to the comparison, "toyota" + Enter -> TM, comparison kept when leaving the tab, Clear all, "ko" + Enter.
- [x] **Rankings: choose the sector, and "Largest companies" for any market, not only US (owner, 2026-09-21).** The universe buttons are now
      Direct competitors / Largest companies / My own list. "Largest companies" has three dropdowns: Market (United States, European Union,
      Europe = EU + UK + Switzerland + Norway, United Kingdom, Japan, China & Hong Kong, Worldwide), Sector (the 11 Yahoo sectors or all) and
      Industry (the industries of the chosen sector, from `yf.const.EQUITY_SCREENER_EQ_MAP`; resets when the sector changes), plus the number
      of companies. New endpoint `GET /api/rankings/options`; `universe(kind, key, size, market, sector, industry)` in `backend/rankings.py`
      (`_market_companies`). IMPORTANT finding: the screener's `region` is where a stock TRADES, not where the company is based (region "de"
      returns Nvidia/Apple/Alphabet lines on XETRA, "fr" returns bond-like instruments, Nordic exchanges list dual listings). So: one screener
      query per country (size 250; the screener sorts by LOCAL-currency cap, so currencies must not be mixed), merge with USD conversion, drop
      cross-listings/junk, keep one listing per company, then keep only companies whose DOMICILE (`info.country` via `profile`, cached) belongs to
      the market, checking the largest candidates a chunk at a time. First EU load ~11 s, then cached for an hour. The old "Same sector"/"Largest US
      companies" kinds were removed; "US" now means US-domiciled (TSMC's US receipt no longer appears). Name matching for the same company on
      several exchanges now works for short names ("Eni" vs "ENI S.P.A."), London "0QLR.IL" lines are filtered.
      Results: EU = ASML, Siemens, SAP, L'Oreal, LVMH, Santander, TotalEnergies, Schneider, Inditex, Airbus; EU Financial Services = Santander, Allianz,
      BBVA, UniCredit, Intesa, BNP, AXA; EU Technology > Semiconductors = Infineon, NXP, STMicro...; US, Japan, China/HK, UK lists also sensible.
      jsdom test passed (markets/sectors/industries lists, industry disabled until a sector is chosen, reset on sector change, sorting, back to peers).
- [x] Validation of module 8: Apple's competitor group = Samsung 005930.KS, Sony 6758.T, Xiaomi 1810.HK, Panasonic 6752.T, LG 066570.KS; JPM -> BAC,
      HSBC, Chinese banks; MU -> NVDA, TSMC, AVGO, SK hynix, AMD, INTC; TSLA -> Toyota, BYD, GM, Ferrari, Hyundai, Ford, VW; KO -> PEP, MNST, Coca-Cola Europacific...
      Apple vs Samsung row: EV/EBITDA 29.7x vs 5.7x, ROIC 66.7% vs 24.4% (yfinance fallback), FCF yield 2.8% vs 7.8%, PEG 4.08 vs 0.08; Sony (home listing) 7.9x / 12.2% /
      7.4% / 2.76, whereas Sony's US receipt gave a nonsense 1,147% FCF yield (now skipped). jsdom test passed (suggestions, add by click and by search, colour
      stability after remove, max 6, range switch, best-cell bolding, other tabs).
- [x] **Module 9, "Seasonality" (owner's Forecaster.biz article "Seasonality in Financial Markets", 2026-09-21).** Tenth tab
      (`frontend/src/SeasonalityTab.jsx`) + `backend/seasonality.py` (`GET /api/seasonality/{symbol}?start_month=1..12&vs=`, `GET
      /api/seasonality/{symbol}/trades?start=MM-DD&end=MM-DD&vs=`). Works for any yfinance symbol (stocks, ETFs, `^GSPC`, `GC=F`, `EURUSD=X`,
      `BTC-USD`); prices are split-adjusted, not dividend-adjusted. What it shows, following the article and its screenshots:
      (1) seasonal curve: for each year the % change since the start of the window (the last close before it = 0%), averaged by calendar date
      over the last N complete years; period pills Current / Last year / 3 / 5 / 7 / 10 / 15 / 20 / 25 / 30 years, each with a fixed colour, several
      at once, greyed out when the history is too short (default 5 years, as in the reference); "Detrended" view (curve minus its centred moving
      average, 10/20/40/60 trading days, the article's DPO idea); "Chart starts in" month (the reference chart starts at today's month);
      (2) Daily average (month dropdown, days 1-31), Weekly average, Monthly average: bars = share of years/days that closed up, drawn as "% LONG"
      up or "% SHORT" down like the reference, one bar per selected period, hover gives "k of n" and the average return (weekends shown for crypto);
      (3) Trades statistics: pick a period by dragging on the curve (shaded box) or with the From/to month+day selects (default: today to +60 days),
      Long/Short toggle, one ring per selected N-year period (share of profitable years + average return) and a table (open/close date and price,
      revenue %, max drop %, max rise %) for the last 30 years; (4) "Spread against" box: seasonality of the ratio symbol / other (long one, short the
      other, equal dollar amounts, the article's Coca-Cola vs Pepsi / XLF vs GDX example), same charts and tables; (5) "High-probability days" scanner =
      the article's "70% rule": upcoming days (2 weeks to a year) where the up-share (or down-share) is at least X% (default 70) in ALL chosen periods
      (default 10, 15, 20 years), listing "share (k/n)" per period; a day needs at least 4 observations per period.
      Also: `Plot.jsx` got an optional `onRange` callback (drag-select), and CSS `input[type="checkbox"] { width: auto }` (the global `input { width: 110px }`
      rule could have stretched the checkboxes of the FCF chips in a real browser).
- [x] Validation of module 9 against the article's own numbers: MSFT trade 05/11 -> 08/14: the 2020, 2021 and 2023 rows match the screenshot exactly (open/close price,
      revenue, max rise; e.g. 2023: 310.11 -> 324.04, +4.49%, +18.27%); the screenshot's 2022 close is Mon 08/15 for a Sunday 08/14 and 2021's is Fri 08/13 for a Saturday
      08/14, so the close is the NEAREST trading day (implemented); max drop for 2023 is -1.13% here vs -1.24% there (we measure from the day after entry). Monthly bars
      (MSFT 3/5/10 years): the reference measures a month as last close vs FIRST close of the month, which reproduces 32 of its 36 bars (month-over-month gave 24);
      adopted; the 4 differences are Dec/Jan (probably the year sets). S&P 500 on Nov 24, the article's "70% rule" example: 100% / 100% / 82% long over 10 / 15 / 20 years
      reproduced exactly (but from only 5 / 7 / 11 observations). jsdom test passed (27 checks: pills, detrended, start month, simulated drag-select, long/short, scanner,
      KO vs PEP spread, bad spread ticker, BTC-USD 7-day week, `^GSPC`, other tabs). Backend also checked on EURUSD=X, GC=F, XLF vs GDX, wrapped periods (11-15 -> 02-15),
      invalid dates (400) and unknown ticker (404).
- [x] **Module 10, "Overview" + new look (owner's Forecaster.biz NVIDIA page screenshots: header, price chart with performance tiles, Drawdown,
      Years Performance, Dividends; "not exactly the same, but similar", 2026-09-21).** (a) App shell restyled like the reference: top bar with a
      rounded search box, a company header on every tab (logo initial, name, ticker + exchange, chips Sector / Industry / Country / Currency /
      Market cap, price and today's change; `GET /api/profile/{symbol}`), a pill tab bar **Overview | Seasonality | Fundamentals | Compare |
      Rankings**, Overview first and the default. Fundamentals holds a second pill row with the older tabs (EV/EBITDA, EV/EBITDA vs price, ROIC,
      FCF yield, Solidity, PEG, Historical ratios); the tabs themselves are unchanged. (b) `frontend/src/OverviewTab.jsx` +
      `backend/overview.py` (`GET /api/overview/{symbol}`, `GET /api/overview/{symbol}/overlay/{kind}`) + pure calculations in `frontend/src/perf.js`:
      event strip (dark boxes: "10 days to dividend payment date!", earnings; from Yahoo's calendar, shown when within 60 days); price area chart with a
      dotted line and a label at the last price, Log checkbox, and overlay pills **Sales / Net Income / Free Cash Flow / P/E (ttm) / Dividends** (one
      at a time on a right axis; loaded on demand; click again to switch off); nine tiles **1 Month, 6 Months, This Year, 1 Year, 3, 5, 10, 20 Years,
      All history** with the return, they also select the chart range (default 5 Years; too-short ranges are disabled, a young stock falls back to All
      history); **Drawdown** chart (red area, i-button with the explanation and formula, "now" and "worst in this range"); **Years Performance** bars
      (green/red, year to date pale, last 10 / 20 / all years); **Dividends** (badge INCREASING / DECREASING / STABLE / NO DIVIDEND, tiles for last
      12 months, yield, last and next ex-dividend date, bars per payment or per year).
      Conventions taken from the reference: a range/year return runs from the FIRST close on or after the start date (calendar year: first close of
      the year) to the last close. Overlay sources: sales / net income / FCF = trailing-12-month values from the SEC filings already used by Solidity
      (`solidity._snapshots`, new `capex` tag list in `FLOW_ITEMS`; FCF = operating cash flow - capex); P/E = daily close / TTM EPS, where EPS is backed
      out of Finnhub's quarterly `peTTM` (price on the valuation day / P/E) and applied 45 days after each quarter end (no look-ahead); P/E above 200 and
      loss-making periods are left out.
- [x] Validation of module 10 against the reference (NVDA): tiles 3Y +452.65 vs 450.91, 5Y +966.93 vs 963.45, 10Y +13,880 vs 13,850, 20Y +44,173 vs 44,037 (the
      remaining 0.3-0.4% is the price: 226.68 now vs 225.98 in the screenshot); years 2006 +93.66 vs 93.67, 2008 -75.56 vs -75.55, 2009 +114.5 vs 114.47, 2016 +229.8
      vs 229.94, 2018 -33.0 vs -32.93, 2022 -51.48 vs -51.49, 2023 +245.9 vs 245.81, 2024 +178.8 vs 178.78, 2025 +34.84 vs 34.84; "10 days to dividend payment date"
      identical; dividend bars 0.25 / 0.25 and the INCREASING badge as in the reference; worst drawdown since 2021-09: -66.4% (reference chart ~ -65%). Overlays vs
      yfinance: NVDA TTM sales 253.491B, net income 159.613B, FCF 119.076B at Apr-2026 are identical to the sum of yfinance's last four quarters; P/E now 28.44 vs
      Yahoo's trailing 28.67. jsdom test passed (46 checks: header, tabs, tiles, ranges, all five overlays, log axis, drawdown info, years select, dividend modes,
      TSLA without dividends, Samsung with a non-US overlay error, RIVN with disabled ranges, unknown ticker, Fundamentals sub tabs, all top tabs).
- [x] `README.md` with setup and run commands.
- [x] Tracker set up in this file.
- [x] **Frontend styling migrated from hand-written CSS to Tailwind CSS v4 (owner's request, 2026-09-22).** Installed `tailwindcss` +
      `@tailwindcss/vite` (no `tailwind.config.js` needed in v4) and wired the plugin into `vite.config.js`. `frontend/src/style.css`
      now imports Tailwind and keeps only: the `:root` colour tokens (light + the `prefers-color-scheme: dark` overrides, unchanged --
      dark mode here follows the OS, not a class Tailwind would toggle, so the tokens stay plain CSS custom properties referenced from
      utilities as `bg-[var(--surface)]` etc., not a Tailwind `@theme` block) and a small `@layer base` block for element defaults that
      apply everywhere without a class (`body`, `h1-h3`, `form`, `label`, `input`/`select`/`button`, focus outline, `details`/`summary`,
      the plain `table`/`th`/`td` defaults). Every component-specific class (tiles, chips, pills, the score tables, the app shell, etc.,
      about 70 of them) was converted 1:1 into Tailwind utility strings across all 14 `frontend/src/*.jsx` files, preserving the exact
      pixel values, colours and dark-mode behaviour (mechanical conversion, not a redesign). `Plot.jsx`'s `className` prop changed
      meaning: it now takes the chart's own height utility (e.g. `h-[300px]`) instead of a `"tall"/"mid"/"short"` size keyword, because
      Tailwind utilities cannot cascade from a parent wrapper's class the way the old `.grid .chart { height: 240px }` rules did; each
      `<Plot>` call site now passes its height explicitly. Reused table styling (Solidity scores, Rankings, Compare) was extracted into
      shared class-string constants in `ui.jsx` (`SCORE_TABLE`, `SCORE_CELL`, etc.) instead of repeating long utility strings three times.
      Also fixed in passing: the search-icon bug from earlier this session (`.ac::before { content: "5" }`) is now a `<span>🔍</span>`,
      so the corrupted-byte class of bug cannot recur there. `frontend/src` was backed up before starting (no git repo yet in this
      project -- see "In progress" -- so this was the safety net); `npm run build` succeeds (CSS bundle 24 KB, JS bundle unchanged
      Plotly size, a pre-existing warning). **Not yet seen in a real browser** (see item 1 in Next steps -- this makes that check more
      important than usual, since ~70 classes were converted by hand without visual verification here).
- [x] **Module 11, "News" (owner's Forecaster.biz NVIDIA page screenshots: the News tab, card grid with pagination, 2026-09-22).**
      New top-level tab (`frontend/src/NewsTab.jsx`) + `GET /api/news/{symbol}` (`data.company_news`, `backend/data.py`). Data:
      Finnhub `/company-news` (free tier), last 30 days, deduplicated by headline. Layout like the reference: a 3-column grid
      (2 on medium screens, 1 on phones) of light cards -- thumbnail image (when Finnhub has one), headline, summary snippet,
      source + date, an external-link button opening the article in a new tab -- each at least 260px tall, paginated 9 per page
      (3x3) with dot navigation and prev/next arrows above the grid; falls back to "Page X of Y" text instead of dots when there
      are more than 10 pages (a heavily-covered name like NVDA hits Finnhub's ~250-articles-per-call cap even within a 5-day
      window). Needs the Finnhub key (503 without it, same convention as modules 5/6/10-overlay). Owner saw it in a real browser
      (2026-09-22), asked for more articles per page (6 -> 12), then for bigger cards filling the leftover space below the fold
      (added the thumbnail/summary and a min-height, settled on 9 larger cards per page instead of 12 smaller ones), then asked
      for news from somewhere other than Yahoo: added a client-side "Hide Yahoo re-posts" checkbox (default on, filters on the
      `source` field already returned by the endpoint). Owner then gave a Benzinga API key and its docs (github.com/Benzinga/
      doc-site-mintlify) and asked to use it. `BENZINGA_API_KEY` added to `.env` only (never in source, same rule as the Finnhub
      key). `data._benzinga_news` (`backend/data.py`) calls `GET https://api.benzinga.com/api/v2/news` (`token` query param,
      `tickers`, `dateFrom`/`dateTo`, `pageSize=100`; needs an `Accept: application/json` header -- the API answers XML by
      default, undocumented in the mdx pages, found by inspecting a live response) and is merged into `company_news` alongside
      Finnhub's feed, deduplicated by headline (Finnhub already re-labels some of its own items "source: Benzinga", so this
      catches the ones Finnhub does not carry). HTML entities in Benzinga's `teaser` are unescaped and tags stripped for the
      summary; `created` (RFC 2822) is parsed with `email.utils.parsedate_to_datetime`. Best-effort: any Benzinga failure
      (missing key, network error, bad JSON) returns an empty list rather than breaking the view, since Finnhub alone already
      satisfies it. Verified against the live API (not just jsdom): AAPL and NVDA return real headlines/sources/dates through `/api/news/{symbol}`,
      an unknown ticker returns an empty list (200, "No recent news" shown) rather than an error, and an invalid ticker format still
      gets the existing 400. With Benzinga merged in, AAPL's 30-day feed gained 25 genuinely new (non-duplicate) articles with
      real `benzinga.com` links, clean summaries and images; NVDA gained fewer (9) since it was already Yahoo-saturated. `npm run
      build` succeeds (no frontend changes needed -- the merged articles already fit the existing shape). Owner then asked why
      non-US-listed stocks (Toyota `7203.T`, Samsung `005930.KS`) get nothing, since Finnhub's free tier 403s them and Benzinga's
      coverage turned out unrelated to geography (see Known limitations); asked to fall back to `yfinance`'s own news for those.
      Added `data._yfinance_news`: `company_news` now tries Finnhub+Benzinga first and, only on Finnhub's specific 422
      ("US listings only") error, falls back to `yf.Ticker(symbol).news` instead (normalised to the same shape: `content.title`,
      `content.summary`, `content.provider.displayName`, `content.canonicalUrl.url`, a non-"original" thumbnail resolution,
      `content.pubDate` parsed as ISO 8601). US-listed symbols are unaffected (still Finnhub+Benzinga; AAPL/JPM unchanged in
      testing). Verified live: `7203.T` and `005930.KS` each return 10 articles instead of a 422, though as flagged before the
      content is often generic market-roundup filler rather than company-specific (e.g. "Sector Update: Energy Stocks Fall Monday
      Afternoon" for Toyota) -- better than an empty tab, not equivalent to Finnhub's targeted coverage. `npm run build` succeeds
      (no frontend changes needed).
      **Local sentiment score (owner: "how can we calculate it locally", agreed to source a word list, 2026-09-22).** New
      `backend/sentiment.py` + `backend/lm_sentiment.json` (401 positive / 2393 negative / 37 negation words). Word-count scoring
      against the Loughran-McDonald finance dictionary (Notre Dame, free for research use -- general lexicons like VADER
      misclassify routine filing language such as "tax"/"liability"/"cost" as negative), via a commonly-redistributed derived
      word list (a gist, since the official site is a licensed CSV download) parsed once into a small local JSON file -- no pip
      package, no network call at runtime, no ML model. `sentiment.score_text` tokenizes headline + summary, counts
      positive/negative matches with a 3-word negation window (so "no longer growing" flips "growing" to negative), and labels
      each article Positive/Neutral/Negative by which count wins; `sentiment.tag` is applied to `GET /api/news/{symbol}`'s
      response (each article now carries a `sentiment: {label, score, positive, negative}` field) -- Finnhub, Benzinga and the
      yfinance fallback are all covered since tagging happens after they're merged. Frontend: a colour-coded pill per card (using
      the existing `--pos`/`--err`/`--text-2` tokens, so it already matches light/dark mode) and a Positive/Neutral/Negative tally
      strip above the grid, computed over the filtered (Hide Yahoo-aware) article list client-side, no extra request. Verified on
      AAPL (14 days, 271 headlines): 116 positive / 102 neutral / 53 negative, spot-checked headlines look right ("How Tim Cook
      Set Up Apple Stock's Next Growth Era" -> positive; several routine product-launch headlines with no sentiment-bearing words
      -> neutral, not forced into a label).
      **Sentiment trend chart + Rankings/Compare column (owner: "do them", both follow-ups offered after the score shipped,
      2026-09-22).** (a) `NewsTab.jsx` gained a `SentimentTrend` bar chart (one bar per day = positive-article count minus
      negative-article count that day, green/red via the existing `--up`/`--down` tokens, same convention as Overview's Years
      Performance bars) between the tally strip and the article grid; computed client-side from the sentiment already on each
      fetched article (grouped by `datetime`, respects the Hide Yahoo filter) -- no new endpoint, no extra request. Had to move
      the `filtered`/`trend` `useMemo`s to before the loading/error/empty early returns (they were first added after, which
      breaks React's Rules of Hooks: the hook count would differ between a loading render and a loaded one). (b) New
      `sentiment.news_sentiment(symbol, days=14)` (`backend/sentiment.py`): net sentiment = (positive - negative articles) / all
      articles x 100, reusing `data.company_news` (same cache as the News tab, so Finnhub+Benzinga+yfinance-fallback are all
      covered). Wired into `rankings.ranking_row` as `newsSentiment` (via the existing `_safe`/`check` pattern, so a failure -- no
      Finnhub key, no recent news -- just shows a dash like any other check) and added one entry to the shared `COLUMNS` array in
      `rows.js` -- since Rankings and Compare both already map over `COLUMNS` generically for the table, sorting, the median row
      and best-cell bolding, this one array edit was enough to add the column to both tabs with no other changes. Not added to
      Compare's six bar charts (`CHARTED` in `CompareTab.jsx`) or the Rankings sort default -- table-only, like Beneish M already
      is, to avoid growing the "six bar charts" the reference design fixed. Verified live: `/api/rankings/row/AAPL` ->
      newsSentiment 23.2 (no error), `/api/rankings/row/JPM` -> 23.4 (evEbitda still correctly errors for a bank, sentiment does
      not), a `custom` universe of AAPL/MSFT still resolves. `npm run build` succeeds. **Not yet seen in a real browser** (see
      item 1 in Next steps -- the Rankings/Compare load-time impact of one more per-company check, on top of the five that
      already make a cold 30-company group take 1-2 minutes, is also unverified outside a browser).
- [x] **Homepage / landing page (owner sent a screenshot of Forecaster.biz's start page: centered logo, search box, "pick a
      plan" link, an AI-agent pill, sign-in top right; asked for the same layout without "Sign in", 2026-09-23).** New
      `frontend/src/Home.jsx` + a `view` state (`'home'` | `'app'`) in `App.jsx`. The app now opens on this landing page
      (no company auto-loaded) instead of jumping straight to the last-viewed ticker: centered "Q" avatar + "QuantPlatform"
      wordmark (reuses the existing brand-circle style already used by `CompanyHeader`), a one-line tagline, a large pill
      search box (magnifying-glass icon, a clear "x" button once text is typed, live suggestions from the existing
      `/api/compare/search` as you type, same resolve-a-ticker-or-company-name logic as the header `TickerBox`) and three
      example-ticker quick links. Submitting loads that company and switches to the normal dashboard (`view: 'app'`);
      clicking the "QuantPlatform" title in the dashboard header returns to this landing page. Left out on purpose, since
      they don't apply to this single-purpose internal tool: the "Sign in" button (per the owner's request), the top-right
      app-switcher grid icon, "pick a plan", and the "Ask AI Agent" pill (no accounts/billing/AI agent exist here). Chose to
      show the landing page on every load rather than only the very first time, since that is what actually matches the
      reference (Forecaster.biz's own root URL) and gives an explicit way back via the clickable title; the last-viewed
      symbol is still remembered in `localStorage` and offered back via the "Try: AAPL, MSFT, NVDA" links, not auto-loaded.
      `npm run build` succeeds. **Not yet seen in a real browser** (see item 1 in Next steps).
- [x] **Module 12, "Politicians" (owner sent screenshots of a "US Government Tracker" site: a buy/sell bar chart with an
      index price line and a paginated politician-trades table, asked how to build the same, 2026-09-23).** New top-level
      tab (`frontend/src/CongressTab.jsx`) + `backend/congress.py` (`GET /api/congress/trades`, `GET /api/congress/summary`).
      Congressional stock trading disclosures under the STOCK Act, from two sources:
      - **House** (full history back to 2012, no key): the original free datasets this kind of tool is usually built on,
        housestockwatcher.com and senatestockwatcher.com, turned out to both be dead (domains no longer resolve, checked
        live). Found an actively maintained replacement instead: `TattooedHead/house-stock-watcher-data` on GitHub (pushed
        the day before this was built), a free JSON dump (24,141 rows) scraped directly from the official House Clerk PTR
        filings (`disclosures-clerk.house.gov`). Fetched and cached for 6 hours; no rate limit since it is a static file.
      - **Senate** (rolling last ~3 months only): no equivalent well-maintained free full-history mirror exists any more.
        Owner chose (via a clarifying question) to supplement with the Bargo AI congress-trades API
        (bargo.ai/free-apis/congress), a third-party service covering both chambers with per-trade performance data. Its
        anonymous quota (30 requests/100 rows per day, shared per IP) was exhausted by two test calls during this build;
        owner then supplied a free `BARGO_API_KEY` (raises it to 100 requests/1,000 rows/day), added to `.env` only. Bargo's
        free-tier terms require a visible, above-the-fold credit linking back to them wherever the data is shown -- added as
        a text line (with a link) at the top of the tab, alongside the House source credit.
      Both sources are normalised to one shape (chamber, politician, state/district, ticker, asset, buy/sell/exchange,
      disclosed amount range, transaction/disclosure dates, filing link) and merged in `congress.trades()` (paginated,
      filterable by chamber / trade type / a politician-or-ticker search, newest disclosure first) and `congress.summary()`
      (quarterly buy vs. sell dollar totals for the chart, using the disclosed range's midpoint). Senate fetches best-effort
      empty-list on any failure (no key, quota reached, network error), same convention as the Benzinga/yfinance news
      fallbacks in `data.py`, so the House data still shows and a banner explains when Senate rows are temporarily missing.
      Tab layout: quarterly green/red buy-sell bar chart (2Y/5Y/10Y/Max range pills), chamber and trade-type dropdowns, a
      debounced politician/ticker search box, a paginated table (politician with an initials avatar in the existing
      brand-circle style, ticker + asset description, a Buy/Sell/Exchange chip, publication and transaction dates, the
      disclosed amount range, a link to the underlying filing). No politician photos (same "letter avatar, not a real logo"
      convention as the company header) and no S&P 500 price overlay (left out to keep this first version lean; noted as a
      possible follow-up, not requested).
- [x] Validation of module 12: `congress.trades()`/`congress.summary()` tested live (not jsdom) via a test backend on port
      8001. House: 24,141 rows, dates 2012-06-06 to 2026-09-21 (one bad future-dated row, "12/26/2026" for a Steve
      Cohen/SONY trade -- a single source-data glitch out of 24k rows, left as-is rather than special-cased). Senate: 99
      rows once the Bargo key was added (0 before it, confirming the quota story). Combined pagination, and chamber + trade
      type + search filters together (chamber=senate&type=purchase&q=mcconnell -> exactly the 1 matching row), verified via
      curl. `npm run build` succeeds. **Not yet seen in a real browser** (see item 1 in Next steps); no jsdom harness is
      installed in this project (see the "Tests for the backend calculations" idea in section 6), so this used direct API
      calls instead of the ad-hoc jsdom checks earlier modules describe.
- [x] **Module 12 follow-up: per-company view + minimum-amount filter (owner sent a screenshot of Forecaster's NVDA
      "Political" tab -- the same buy/sell chart but scoped to one company, with that company's own stock price overlaid --
      plus an article mentioning filtering trades by size, 2026-09-23).** `backend/congress.py` gained
      `company_summary(ticker)`: the same quarterly buy/sell aggregation as `summary()`, factored out into a shared
      `_quarterly()` helper, plus that ticker's own quarter-end closing price (yfinance, last close on or before each
      quarter's end) for the chart's price line. `trades()` gained `ticker` (exact match) and `min_amount` filters, both
      usable together with the existing chamber/type/search ones. `GET /api/congress/summary` now takes an optional
      `ticker` query param (routes to `company_summary`, validated through the existing `symbol_of()`); `GET
      /api/congress/trades` gained `ticker`/`minAmount` params. Frontend: a "This company only ($SYMBOL)" checkbox (the
      tab now takes the `symbol` prop every tab already receives, previously unused) switches both the chart and table to
      that company; the chart then adds a second y-axis with the stock's own price line, matching the reference. A
      "Minimum amount" dropdown ($15K/$50K/$100K/$250K/$500K/$1M+, the STOCK Act's own disclosure-bracket boundaries) was
      added next to the existing chamber/trade-type filters. Left out on purpose: the dividend/ex-dividend "N days to..."
      banners visible in the owner's screenshot -- those are the Overview tab's existing event strip (`overview.py`), and
      duplicating that component here would just repeat what switching to Overview already shows for the same company; not
      built, to avoid the duplication, unless the owner wants it directly on this tab too.
- [x] Validation of the follow-up: `GET /api/congress/summary?ticker=NVDA` returns 31 quarters (2017 Q1 back-filled from
      the first House NVDA trade, through 2026 Q3) each with a quarter-end close (e.g. Q1 2017 $2.72, Q3 2026 $227.38,
      both split-adjusted like every other price series in this app); an unknown/untraded ticker (`ZZZZ`) gives a clean 404
      "No congressional trades found for ZZZZ"; a lowercase ticker is upper-cased via the existing `symbol_of()`.
      `ticker=NVDA&minAmount=100000` on the trades list correctly returns only NVDA rows in the $100,001+ brackets (Cleo
      Fields' Oct/Aug 2025 purchases, $100,001-$250,000 each). All checked live via curl against a test backend on port
      8001. `npm run build` succeeds. Not yet seen in a real browser.

- [x] **Module 13, "Fair value" (owner: "I want a section dedicated to the fair value", 2026-09-23; owner chose via a question the
      methods DCF + historical multiples + analyst targets, NOT Graham/Lynch formulas, and a new top-level tab).** Tab "Fair value"
      after Fundamentals (`frontend/src/FairValueTab.jsx`) + `GET /api/fair-value/{symbol}` (`backend/fairvalue.py`). Top: tiles (price, fair
      value = median of all method estimates, upside, reading: under/over-valued when more than 10% away) and a "football field" chart (one
      horizontal bar per method from low to high, a dot at the central value, dashed line at today's price). (1) DCF, computed in the browser
      so the inputs are editable live (FCF growth years 1-5, WACC, terminal growth, Reset to defaults): two-stage, growth fades linearly from
      year 6 to the terminal rate at year 10, Gordon terminal value, EV - net debt / shares; 10-year projection table and a 5x5 sensitivity table
      (WACC +-2 pts x terminal growth +-1 pt). Defaults from the backend: FCF = last 4 quarters of yfinance "Free Cash Flow" (else last fiscal year);
      WACC = CAPM (risk-free = ^TNX 10-year yield, beta clamped 0.5-2.5, 5% equity premium) weighted with after-tax cost of debt (TTM interest /
      total debt, 2-12%), result clamped 6-14%; growth = analysts' next-FY revenue growth (yfinance `revenue_estimate`), else historical FCF CAGR,
      else 5%, capped 0-25%; terminal 2.5%. Negative FCF shows "not meaningful" instead of a number. (2) Historical multiples: today's TTM EPS /
      EBITDA (less net debt) / FCF per share / sales per share x the company's own median P/E, EV/EBITDA, P/FCF, P/S at quarter ends over 5 or
      10 years (Finnhub quarterly TTM series, toggle), range = 25th-75th percentile; multiples <= 0 or >= 200 dropped; a result more than 10x away
      from the price is dropped as a share-class mismatch (BRK-B P/FCF). (3) Analyst targets (yfinance `analyst_price_targets`): low/mean/median/high,
      number of analysts, consensus. Statement figures are converted to the price currency with `data.usd_per_unit` when they differ (SAP: EUR
      statements, USD price); banner for financials.
- [x] Validation of module 13 (live, test backend on port 8001): AAPL DCF 188 (defaults: growth 10.5%, WACC 10.3%) vs price 340, multiples
      10y medians give 204-240 (P/E 26.1x -> 228), analysts mean 328; NVDA growth 66% capped to 25%, WACC capped to 14%; KO multiples 69-92 around
      price 88.6; SAP converted from EUR; JPM and Toyota (7203.T) negative FCF -> DCF not meaningful, JPM keeps P/E + analysts, Toyota has no Finnhub
      (US-only note) but analysts work; RIVN only P/S + analysts; bad ticker 400, unknown 404. DCF math checked in node (FCF 100, g 0, WACC 10% ->
      1000). `npm run build` succeeds. Not yet seen in a real browser; no jsdom run.

- [x] **Rankings: "Most undervalued" / "Most overvalued" lists (owner: "in the rankings create two new tabs with the top 20 most
      overvalued and the top 20 most undervalued companies, and in each you can choose the sector, nation etc", 2026-09-23).** Rankings now
      has a view switch **Metrics table | Most undervalued | Most overvalued** (`RankingsTab.jsx`: the old table is `MetricsTable`; new
      `frontend/src/ValueRankTab.jsx`). Filters: Market, Sector, Industry and "Scan the largest 30 / 50 / 100 companies" (default 30), shared by
      the two lists so switching reuses the same scan. Each company is valued through the new `GET /api/fair-value/{symbol}/summary`
      (`fairvalue.summary`): the same median-of-methods fair value the Fair value tab shows with its defaults (DCF with default assumptions,
      via a Python copy of the JS `dcf()` = `fairvalue.dcf_per_share`; each multiple at its 10-year median; analysts' mean target). Rows load 3 at
      a time (`useRows` in `rows.js` now takes a URL builder) and the top 20 re-sort as results arrive; companies with fewer than 2 estimates
      are left out. Columns: country, sector, market cap, price, fair value, upside/downside, DCF / multiples / analysts each with its own gap
      to the price, number of estimates, a warning mark with the caveat on hover. Backend changes in `rankings.py`: `universe(kind="market")`
      accepts up to 100 companies (`MAX_SCAN`; the metrics table stays at 30); new single-country markets Germany, France, Italy, Spain,
      Netherlands, Switzerland, Sweden, Canada, Australia, India, South Korea, Taiwan, Brazil. Found while testing: region "de" returned
      Frankfurt/XETRA lines of Nvidia, Apple, Microsoft... first, so Germany alone gave only SAP and Siemens. The screener query now keeps only
      each country's main exchanges (screener exchange list minus `SECONDARY_EXCHANGES`), Germany and Switzerland get a second page of 250,
      the domicile check looks at up to max(8 x size, 400) candidates, and a XETRA/SIX line of a foreign company is dropped when the same
      name also appears under another exchange suffix (IBE1.DE next to IBE.MC). This also improves the existing EU / Europe groups.
- [x] Validation: US Technology, 30 companies, cold: 25 s, all 30 valued; most undervalued CRM +118% (its 10-year P/E median is high, which
      inflates the multiples estimate), UBER +61%, NOW +34%, NVDA +31%; most overvalued INTC -74%, LRCX -70%, MRVL -66%, PANW -63%. Markets
      (30 companies): Germany = SIE, SAP, DTE, ENR, IFX, DHL, MUV2, DBK, MRK, DB1, BAYN, RWE, RHM... (24 s cold); Switzerland = Novartis, Nestle,
      ABB, UBS, Richemont, Zurich...; Italy only 22 (the rest are foreign lines); US unchanged. Testing triggered Yahoo's "Too Many Requests"
      limit for a few minutes (see Known limitations). `npm run build` succeeds. Not seen in a real browser.
- [x] Follow-up fixes after re-testing EU/Europe and a German fair-value scan (2026-09-23): (a) EU/Europe duplicates: XETRA lines of
      Inditex (IXD1.DE) and AB InBev (1NBA.DE) survived because their SHORT names differ from the home line's; `_listing_items` now keeps
      `longName` and `_one_per_company` / the hub check also match on the first 8 letters of the long name. Irish/Luxembourg/Swiss companies
      whose main listing is in New York (Medtronic 2M6.DE, Spotify 639.DE, Chubb AEX.DE) stay, as intended. (b) One Yahoo screener timeout sank
      the whole Europe group: each query is retried once, then a failing country is skipped in multi-country groups. (c) Fair value: no DCF for
      banks, insurers, capital markets, asset managers, mortgage lenders (`fairvalue.NO_DCF_INDUSTRY`, by Yahoo industry; Visa/Mastercard and
      exchanges keep it): Deutsche Bank's DCF was 425 vs price 32, Munich Re's 2,044 vs 506. (d) Net debt now adds minority interests (book value
      from the balance sheet) in the DCF and EV/EBITDA fair values, and a warning appears when they exceed 10% of market cap: Deutsche Telekom
      (T-Mobile US ~half owned by others) still shows DCF 116 vs price 27 because book value understates the minority stake; it is flagged.

- [x] **Live prices (owner: "live prices?", then "use only yahoo for the prices", 2026-09-23).** Before this, every price was cached 1 hour
      in the backend and nothing refreshed on its own. New `GET /api/quote/{symbol}` (`overview.quote`, Yahoo `info` only, cached 10 s):
      price, previous close, time of the last price, `marketState`, `live` (= regular session; always for crypto), `delay` (Yahoo's
      `exchangeDataDelayedBy`: 0 for US listings, 15-20 min for most others) and the trading `date` in the exchange's own time zone.
      Frontend: `useQuote` in `api.js`, called once in `App.jsx` and passed to the header and to every tab as `quote`. It polls every
      15 s for real-time quotes, 60 s for delayed ones, 5 min when the market is closed, and pauses while the browser tab is hidden. Header:
      price and "% today" follow the quote, with a badge "LIVE · 15:42" / "Delayed 15 min · 15:42" / "Market closed · last price Sep 18 07:00"
      (viewer's time zone). Overview: `perf.withLatest` replaces the chart's last close (same trading day) or adds today, so the chart's
      last point and label, the tiles, the drawdown, the year-to-date bar and the dividend yield move with the live price. The other tabs
      (EV/EBITDA, FCF yield, Fair value, Rankings...) still use the hourly prices on purpose (Yahoo rate limit). Finnhub is not used for prices.
- [x] Validation: live on port 8001: AAPL live delay 0, 7203.T closed (last price Sep 18, Tokyo holidays) delay 20, SAP.DE after-hours delay 15,
      BTC-USD live, unknown 404, invalid 400, a repeat call within 10 s served from the backend's saved result. `withLatest` checked in node
      (replace, append, older quote, unchanged price, no quote). `npm run build` succeeds. Not seen in a real browser.

- [x] **Missing trading days fixed in every price series (owner: "you have the same issue in the other api? check and fix it", 2026-09-23).**
      Every US stock's daily history lacked 2026-09-22: Yahoo sent an empty bar for it (no prices, volume 0) and yfinance drops empty bars
      silently; non-US stocks (SAP.DE, 7203.T) and crypto were fine. New `data.price_history(ticker)` downloads with `keepna=True` and
      rebuilds each empty bar of the last 720 days from that day's hourly bars (open = first, high = max, low = min, close = last,
      volume = sum; Adj Close keeps the previous day's ratio), dropping only the ones it cannot rebuild. All 7 callers of
      `history(period="max")` use it: `data` (EV/EBITDA daily, EV/EBITDA vs price, FCF yield), `seasonality._prices` (also feeds Overview and
      its P/E overlay), `solidity._prices`, `rankings.compare_prices`, `congress.company_summary`. Verified on port 8001: AAPL, NVDA, ^GSPC, RIVN
      gain exactly one row (Sep 22; AAPL close 339.73), SAP.DE / BTC-USD / 7203.T unchanged; overview, EV/EBITDA, EV/EBITDA vs price, compare,
      seasonality (+ trades), congress per-company, solidity and FCF yield endpoints all answer and include Sep 22 where they return days.

- [x] **Overview: "Today" and "1 Week" ranges (owner's NVDA screenshot: "here I would like the weekly and of today graph", 2026-09-23).**
      Two new tiles before "1 Month" (11 tiles: 6 on the first row, 5 on the second, on a 30-column grid). Returns from the daily closes (with
      the live price as the last one): Today = vs the previous close (same as the header's "% today"), 1 Week = from the first close on or after
      7 days ago. Selecting either draws INTRADAY bars instead of daily closes: new `GET /api/overview/{symbol}/intraday?range=1d|1w`
      (`overview.intraday`, Yahoo only, cached 60 s): last session in 1-minute bars / last 5 sessions in 5-minute bars, regular hours, times
      in the exchange's time zone. The chart puts the bars one after another (numeric x axis with day or hour labels from `perf.intradayTicks`),
      so nights and weekends leave no gaps; "Today" adds a dashed "Previous close" line. The live quote updates the last bar or adds a point
      (`perf.withLiveBar`; also brings in the closing-auction price the 1-minute bars miss, e.g. Toyota 3013 -> 3025). The bars are polled every
      60 s while the last bar is under 30 minutes old, else every 10 minutes (`usePoll` in `api.js`, now the generic polling hook; `useQuote`
      is built on it). Overlays (Sales, P/E...) are disabled on the two intraday ranges; the drawdown chart stays on daily closes (2 points for
      Today). Tested: endpoint on port 8001 (NVDA 1d/1w, 7203.T, BTC-USD, bad range 400, unknown 404), helpers in node (returns, live bar
      replace/append/older/other day, hour and day ticks), `npm run build` succeeds. Owner confirmed it works in a real browser (2026-09-23,
      after restarting the backend; the first try gave "404 Not Found" because the running backend predated the intraday endpoint).
      Owner's screenshot also confirmed the tab-colour fix (selected tab navy again).

- [x] **Watchlist (owner's screenshot of a broker watchlist: pills "My watchlist / Commodities / Stocks" with a > arrow, rows with logo +
      market-status dot, name, ticker, a sparkline grey then red/green, price with currency and % change with an arrow, 2026-09-23).**
      `frontend/src/Watchlist.jsx` + `GET /api/watchlist?symbols=A,B,...` (max 40; `overview.watch_row`, cached 60 s, fetched 8 at a time;
      a symbol that fails gives a "no data" row, not an error for the whole list). One Yahoo chart request per symbol (last 2 sessions,
      15-minute bars): name, price and previous close come from the chart metadata (same previous close as the header's quote); the sparkline
      draws the earlier session grey and the last one green/red; the dot is green when now is inside today's regular session AND the last bar
      is from today (holidays count as closed). Lists: My watchlist (in `localStorage` `quant.watchlist`, first time = the screenshot's GOOG, TSM,
      BAYN.DE, UNI.MI, LUV, DAL, UAL; add with a search box under the list or the new star next to the company name in the header; remove with
      the x on hover), and fixed lists Commodities (10 futures), Stocks (12 large caps), Indices (10), Currencies (9 pairs), Crypto (7). Shown as
      a card on the home page and as a new top-level tab "Watchlist"; clicking a row opens that symbol's Overview. Refreshes every 60 s while any
      market in the list is open, else every 5 min; pauses while the browser tab is hidden. Prices: indices without a currency sign, pairs with
      4 decimals, pence as "p", US cents (grain/coffee futures, "USX") as "¢". Logos are the usual letter avatar, not real logos.
- [x] Validation: live on port 8001: GOOG 335.67 / TSM 446.05 / UNI.MI 26.97 / DAL 82.38 vs the screenshot's 335.85 / 445.99 / 27.04 / 82.33
      (a few minutes apart); all 47 preset symbols return prices; each list loads in ~0.6 s warm (~3 s for the very first Yahoo call); unknown
      ticker -> "no data" row; invalid ticker -> 400; empty list -> []. `npm run build` succeeds. Not seen in a real browser.

- [x] **Module 12 follow-ups: party, photos, S&P 500 line (owner: "do 2-3 and then 1", 2026-09-25).** (a) Party + photo:
      `congress._legislators()` loads `unitedstates/congress-legislators` (current + historical JSON, public domain, cached 24 h,
      best-effort: `{}` if unreachable) indexed by last-name token; `_member(name, state)` matches a trade's name (titles like
      "Hon."/"Mr." dropped, all last-name tokens must appear, state must be one of the legislator's states, ties broken by the first
      3 letters of first/nickname/middle name, ambiguous = no match). `_all_trades()` (now cached 6 h) adds `party` (D/R/I, from the
      member's LAST term) and `bioguide` to every row. Table: portrait `https://unitedstates.github.io/images/congress/225x275/{bioguide}.jpg`
      with the letter avatar as `onError` fallback, and a small D/R/I chip after the name. (b) `summary()` now returns the S&P 500 (`^GSPC`)
      quarter-end close as `price` and `priceLabel`; `company_summary` shares the new `_with_prices` helper; the chart always draws the
      price line on the right axis ("S&P 500" or "Stock price"). Validation (live, venv python): 294 of 301 distinct politician+district
      pairs matched (unmatched: Michael Garcia x2 (nickname Mike), Jordan, MacArthur, Gutierrez, Dingell, Miller); Pelosi = D, McConnell = R;
      summary 58 quarters with S&P 1,362 (Q2 2012) to 7,704, NVDA still 31 quarters. `npm run build` succeeds. Not seen in a real browser.
      Not built: a party filter / party-split chart.

## 4. In progress / blocked

- [ ] **Visual check in a real browser is still missing.** Headless Edge and Chrome hang in the tool environment (GPU process
      crash), so Claude cannot take screenshots. The owner should open the app and report anything that looks wrong.
- [ ] IT approval for a proper Node.js install is still pending (the portable copy works meanwhile).

## 5. Next steps (in order)

0. [x] (Resolved: the empty "Next module:" message was followed by the PEG module, now built.)
1. [ ] Owner restarts the backend (`python -m uvicorn main:app --port 8000` in `backend/`; no auto-reload) and checks the new tabs
       "EV / EBITDA vs price" (NVDA, 10Y), "ROIC" (V vs MA) and "FCF yield" (ORCL, 10 years) and "Solidity" (AAPL), "PEG" (MU) and "Rankings" (V vs its competitors) and "Compare" (AAPL vs
       Samsung) and the new "Overview" page (NVDA: tiles, overlays, drawdown, years, dividends; check the layout, the pill tab bar, the dotted last-price line with its label, the fill under the price line, and that overlay axes look right) and "Seasonality" (MSFT 5/10 years, S&P 500 `^GSPC`, drag on the curve to pick a period) and the new "News" tab (NVDA: card grid, pagination, links open in a new tab) and the new homepage (loads on start instead of a ticker now; check the layout, that the search box and its suggestions/clear button work, and that clicking "QuantPlatform" in the dashboard header gets back to it) and the new "Politicians" tab (check the buy/sell chart and its range pills, the chamber/trade-type/minimum-amount/search filters, that Senate rows show alongside House ones now that the Bargo key is in `.env`, pagination, the Bargo/House attribution line is visible without scrolling, and that the "This company only" checkbox switches the chart to that ticker's own price line on a second axis, e.g. NVDA) and Rankings > Most undervalued / Most overvalued (US Technology, then Germany) and the new "Fair value" tab (AAPL, JPM: football field chart, editing the DCF inputs updates the chart and sensitivity table, 5y/10y toggle) and the new Watchlist (home page card and tab: sparklines, green/grey dots, star in the header adds/removes, add box, x to remove, the > arrow scrolls the list pills) and the live price (header badge LIVE / Delayed / Market closed; during US hours AAPL's header price and the Overview chart's last point should change every ~15 s) against the reference charts in a browser;
       fix what looks off. The drag-select and the month labels centred under the month ("period" tick labels) rely on real Plotly behaviour that jsdom cannot show.
2. [ ] Decide what to do about the 5 MB frontend bundle (Plotly): fine for local use, could be trimmed with a partial Plotly build.
3. [ ] Owner picks the next analysis module (see ideas below). Possible follow-ups on module 2: optional filing lag (no hindsight),
       switch between fiscal-year and TTM EBITDA, EV/EBITDA on next-year estimates (not available from yfinance/Finnhub free).

## 6. Ideas to discuss (suggestions from Claude, not yet requested)

- Summary / checklist tab (from the owner's PEG article: "four quick checks"): for one company, show EV/EBITDA versus its own history,
  ROIC level and trend, FCF yield, Solidity scores and PEG on one page, then compare with direct competitors using the same ratios.
  All five ingredients now exist as separate tabs; this would combine them (and could reuse the "compare with" idea from ROIC).
- (Done as module 7) Rankings page. Possible follow-ups: index membership (S&P 500 / Dow) from a CSV the owner supplies, a "vs group
  median" column, a checklist Summary tab for one company (see above), exporting the table to CSV, saving favourite lists.
- Moat view: sustained high ROIC (e.g. median ROIC over 10 years above a threshold, stable margins) as a simple moat indicator.
- Peer comparison: a company's EV/EBITDA against a peer group and the sector median.
- Watchlist: current multiples vs. each name's own history (percentile) in one table.
- More Finnhub series on the ratios view (P/E, P/B, ROIC, growth) with a multi-series compare.
- Currency-consistent multiples for the yfinance source on foreign listings (SAP, NVO); Finnhub already covers them.
- Valuation view for financials (P/B and ROE instead of EV/EBITDA).
- Tests for the backend calculations; persist/cache data to disk.
- (Done as module 12, incl. S&P 500 line, party and photos) Politicians / congressional trades tracker. Remaining idea: a party filter
  or party-split buy/sell chart. (Per-company view: already built as a checkbox on that tab.) Earlier notes: a per-company view (trades involving the currently viewed ticker, on its Overview page -- the owner chose a standalone tab
  for the first version), politician photos (same trade-off as the company logo: a real photo needs another data source).

## 7. Known limitations

- Module 10 (Overview): the reference's index badges (World Index, Dow Jones, S&P 500, Nasdaq 100) are NOT built: yfinance has no index membership
  (a CSV from the owner could feed them); the reference's other tabs (Pattern, Overbought-Oversold, Political, Insider Activity, News, AI agent, watchlist star)
  are not built. Prices are split-adjusted, not dividend-adjusted; the year-to-date and calendar-year bars start at the first close of the year (as in the
  reference), so they differ by the first day's move from the usual previous-year-end convention. Sales / net income / FCF overlays: US SEC filers only, one point
  per filing (the newest quarter appears when Finnhub has the filing, e.g. NVDA stops at Apr-2026 while yfinance already has Jul-2026), in the reporting currency;
  a few companies lack a capex tag (no FCF for JPM). P/E overlay: needs Finnhub coverage (US), gaps when earnings were negative. Dividend dates are ex-dividend
  dates from Yahoo; the "next" dates come from Yahoo's calendar and can be missing. The company logo is a letter, not the real logo. The area fill is a flat colour
  (no gradient); the chart look could not be checked in a real browser from here.

- yfinance statement history is short (~4-5 years); the daily yfinance EV/EBITDA line starts around late 2022 for AAPL.
- EV/EBITDA is undefined when EBITDA <= 0 and for banks/insurers (neither source has EBITDA for e.g. JPM).
- The yfinance source mixes currencies for foreign listings (banner shown). Finnhub has EV/EBITDA for SAP and NVO, so use it there.
- Finnhub values are at fiscal quarter ends: its "current" is the last quarter end, not today's price, so it can differ a lot
  from the yfinance daily value (AAPL ~24.9x vs ~29.6x on 2026-09-21).
- Definition choices differ from terminals (Bloomberg/FactSet): cash here is cash + SHORT-term investments only (Apple's long-term
  securities are not netted, which makes EV/EBITDA a bit higher), debt is yfinance "Total Debt" (includes leases), EBITDA is
  Yahoo's reported EBITDA (not adjusted). Expect ~1-2x differences vs a terminal; investigate gaps above ~10%.
- The 45-day filing lag makes the daily line step slightly when new fundamentals become "available".
- Module 2 (fiscal-year view): uses hindsight (new FY EBITDA takes over on the FY end date although it is published 1-2 months later,
  same as the reference chart); share count and net debt are derived (see Done), so they are exact only to ~0.2% (up to a few %
  for some names); net debt follows Finnhub's definition (ratio x equity, rounded to 2 decimals); for foreign ADRs (SAP, NVO) the
  Finnhub EV is in the reporting currency while the price is in USD, so the view scales with the price but ignores FX moves;
  banks/insurers and tickers without Finnhub annual EBITDA give a clear 422; needs the Finnhub key (503 without it).
- Module 3 (ROIC): definition differs from Forecaster/terminals, so levels differ (see Done); early history has data artifacts
  (V 2005-06 = 156%/69% from its pre-IPO reorganisation, NVDA 1996 = -130%) that only show in the Max view and stretch its y-axis;
  TTM is missing for banks/insurers (no operating income) and when yfinance lacks 4 consecutive quarters; fiscal-year labels are the
  period-end year; ROIC is not meaningful for banks. Needs the Finnhub key (503 without it).
- Module 4 (FCF yield): banks/insurers are not meaningful (JPM shows -17%); share-class mismatches give absurd values (BRK-B
  +3,300%: Finnhub's per-share figure is not comparable with the B price): the API adds a warning when the yield exceeds 50%;
  foreign ADRs mix currencies (banner); the "quarterly" view is the TTM yield at each quarter end, NOT a single quarter's FCF over
  market cap. The owner's article quotes Visa ~0.5% and Mastercard ~0.64% "in the webinar snapshot" while this tool shows ~3.2% TTM for
  both; the article's figures are probably single-quarter values (unverified hypothesis), so a single-quarter mode may be wanted later
  (Finnhub has no quarterly FCF per share; yfinance quarterly cash flow only covers ~5 quarters).
- Module 5 (Solidity): US SEC filers only (no SAP/NVO/foreign ADRs: 404 "US filers only"); not meaningful for banks/insurers (no
  current assets: all three scores n/a, banner shown); Finnhub's as-reported feed has gaps (e.g. MSFT lacks the Dec-2023 and Mar-2024
  10-Qs), so some quarterly columns are missing and the TTM column falls back to the newest period that has a comparable prior year
  (MSFT TTM = Sep-2025); filings depend on company-specific tags, so a few years/companies lack an input (TSLA, F) and show "-";
  Altman Z was built for manufacturers; values differ somewhat from Forecaster and other tools (different conventions).
- Module 6 (PEG): only two forecast years (no history, no long-term growth: yfinance's LTG is empty); PEG is only as good as the
  consensus; growth from a tiny base makes it meaningless (banner above 100%); estimates in another currency than the price (NVO)
  give wrong P/E (banner); Yahoo's and Finnhub's PEG use other bases, so numbers differ between tools and from the owner's article.
- Module 7 (Rankings): no index membership from yfinance (only industry/sector top lists and a market-cap screener; GOOG and GOOGL both
  appear in "largest US companies"); a cold group of 30 takes 1-2 minutes because of the Finnhub limit (later loads are cached for 1 hour);
  ROIC and FCF yield are not meaningful for financials (they still show numbers, e.g. SOFI -40% FCF yield); it compares raw values, there is
  no composite score on purpose (the articles say the goal is understanding, not a buy/sell signal). The "News sentiment (14d)" column
  (added 2026-09-22) is a 6th per-company check added on top of the five that already make a cold group slow -- not stress-tested at 30
  companies yet, and it inherits every News-tab caveat (Yahoo-heavy for big US names, bag-of-words not a model, generic filler for
  foreign-only listings via the yfinance fallback), so a company's sentiment number reflects its news feed's quality, not just its tone.
- Rankings by market: domicile comes from Yahoo's profile (`info.country`); a company listed abroad shows under the listing that is best for ratios
  (e.g. an Irish-domiciled group appears through its XETRA line, HSBC through 'HBC1.DE'), and a few duplicate lines of one company can still slip in when
  their market caps differ by more than 12%; the screener returns at most 250 stocks per country, so very small sectors in small countries can be incomplete;
  the first load of a country group is slow (10-15 s). A US 'SPCX' entry (Space Exploration?) appears in the US list: it is what Yahoo returns.
- Module 8 (Compare): competitors are Yahoo's industry classification (coarse: Apple's rivals include Shenzhen/Shanghai component makers further
  down the list; Sony is "Consumer Electronics" although it is also games and music); the same company on two exchanges with caps more than 12%
  apart still appears twice (e.g. SK hynix's US receipt SKHY next to 000660.KS; China A-share vs H-share); foreign companies get fewer figures
  (Finnhub free tier is US-only, so SEC-based Solidity scores never exist for them; HK/China ADR-style names report in another currency than the price
  so EV/EBITDA, FCF yield and PEG are skipped); price performance is in local currency without FX; FX rates come from Yahoo pairs like KRWUSD=X (a few
  exotic currencies have none and the market cap then shows a dash); Yahoo's "often viewed together" list uses an unofficial endpoint through
  yfinance's session and may stop working (the group is then just omitted).
- Module 9 (Seasonality): historical tendency, not a forecast. Daily bars rest on few observations (a calendar date falls on a weekend or holiday in about 2 of 7 years,
  so 10 years give ~7 observations); a 70% share appears by chance too, so the scanner is a filter for further analysis, not a signal. "N years" = the last N COMPLETE
  calendar years (or complete 12-month windows starting on the chosen month for the curve); the daily/weekly/monthly bars always use calendar years. Prices ignore dividends.
  Months count as up when the last close is above the first close (as in the reference), not month over month. Spread = ratio of the two closes (equal-dollar long/short without
  rebalancing); its max drop/rise use closes (no intraday range); different currencies give a banner. Trades use the nearest trading day for both dates and show the last 30 years.
  Detrending = curve minus a centred moving average (fewer points at the ends of the year). yfinance history for a new symbol takes 1-5 s (cached 1 hour). NOT built from the
  article: Polymarket / prediction-market prices (no data source connected), Overbought-Oversold and COT report tabs, trend-line/MACD overlays (illustrations in the article).
- Module 11 (News): Finnhub's `/company-news` is a broad "symbol mentioned" feed (aggregated from Yahoo and others), not a curated
  on-topic feed, so some headlines are about competitors or the sector rather than the company itself (matches what the reference
  screenshots also show, e.g. "Beyond NVIDIA: 2 AI Data Center Stocks to Buy" on NVDA's page). Finnhub caps a single call at ~250
  articles, which a heavily-covered name like NVDA can hit within days, not just the 30-day window requested. No sentiment/summary
  scoring (Finnhub's `/news-sentiment` is premium on the free tier). Needs the Finnhub key (503 without it; Benzinga is additive
  and optional -- its absence never breaks the view). Most of Finnhub's free-tier volume for big names is tagged source "Yahoo"
  (measured 2026-09-22: 192/247 for AAPL, 237/250 for NVDA over 30 days); the "Hide Yahoo re-posts" checkbox filters those out.
  Benzinga's own `/news` (added 2026-09-22, owner's key) narrows that gap somewhat -- AAPL gained 25 non-duplicate articles, NVDA
  only 9, since Benzinga's own catalog for a stock this widely covered is itself a small fraction of the Yahoo-aggregated volume;
  Benzinga's free/paid tier rate limit is unknown (no retry logic added, unlike Finnhub's), and its Mintlify doc site
  (github.com/Benzinga/doc-site-mintlify) was archived read-only by Benzinga on 2026-07-22, so if the API changes later there is
  no maintained reference to check against, only the frozen snapshot used to build this. The `Accept: application/json` header is
  required (the API answers XML by default) and is not documented in the mdx/OpenAPI pages found -- discovered by inspecting a
  live response; could break silently if Benzinga changes its default format negotiation.
  Non-US coverage (checked live 2026-09-22): Finnhub's `/company-news` has the same US-listed-only gate as its other endpoints --
  works for foreign companies with a real US listing (SAP, NVO, TM: 62-207 articles) but 403s for native foreign-exchange tickers
  (Toyota `7203.T`, Samsung `005930.KS`: "You don't have access to this resource"). Benzinga is NOT cleanly a "US only" restriction
  instead: testing a spread of pure-US mega-caps found AAPL/MSFT/JPM/KO/DIS/INTC/WMT/PG/V/HD consistently return articles while
  NVDA/GOOGL/META/TSLA/AMZN/AMD/NFLX/XOM/MA/BAC come back empty (200 OK, `[]`, no error) -- NVDA itself flipped from 9 articles
  (when the integration was first tested) to empty on retest minutes later in the same session. This looks like a ticker
  entitlement or quota tied to this specific key/plan that the API does not surface as an error; the owner would need to check
  the Benzinga account dashboard to know what the plan actually covers. Given that, no conclusion could be drawn about whether
  Benzinga covers non-US names specifically (7203.T/005930.KS/BABA/TSM/SHOP were all empty too, but so were many US names).
  `yfinance`'s own `Ticker.news` responds for foreign tickers without erroring, so `company_news` now falls back to it
  specifically when Finnhub returns its 422 (no US listing); Benzinga is not part of the fallback since its gaps aren't
  geography-based (see above) -- a symbol Finnhub can't cover just skips straight to yfinance. As flagged when this was tested:
  the yfinance fallback often returns generic market-roundup filler rather than company-specific news for less-US-covered names
  (e.g. "Sector Update: Energy Stocks Fall Monday Afternoon" for Toyota `7203.T`) -- shown anyway, since an imperfect tab beats
  an empty one, but don't expect Finnhub-level relevance for foreign-only listings.
- News sentiment: a bag-of-words score on short headlines/summaries, not a language model -- it can't follow sarcasm, cross-
  sentence context, or headlines whose sentiment-bearing word isn't in the ~2,800-word Loughran-McDonald list (many routine
  headlines score exactly neutral (0 positive, 0 negative words) rather than "no opinion detected"; the UI doesn't currently
  distinguish the two). Negation only looks 3 words back, so longer-range negation ("far from being a record quarter") can slip
  through. It scores whatever `company_news` already returned, so it inherits that feed's own gaps (Yahoo-heavy for big US names,
  generic market-roundup filler for foreign-only listings via the yfinance fallback) -- the sentiment label on a filler headline
  is scoring the filler, not real sentiment about the company.
- Module 13 (Fair value): every number rests on assumptions; the DCF is very sensitive to growth and WACC (terminal value is often 50%+ of it)
  and uses one growth rate from a single analyst revenue estimate, so edit the inputs rather than trusting the default. Beta and the 5% equity
  premium are generic; the risk-free rate is the US 10-year for every company (also non-US). Historical multiples need Finnhub (US listings) and
  assume the past valuation was "right". Analyst targets lean optimistic. Not meaningful for banks/insurers (negative or meaningless FCF).
- Rankings > Most undervalued / overvalued: ranks on the Fair value tab's DEFAULT assumptions, so one-size-fits-all growth / WACC and each
  company's own multiple history drive the order (a company that was always expensive, e.g. CRM's high 10-year P/E, looks "undervalued");
  the four multiples are four votes in the median, so they weigh more than the DCF or the analysts. Outside the US most rows only have the DCF
  and analysts (Finnhub is US-only). Each company costs about 7 Yahoo calls: a 100-company cold scan takes minutes and can trigger Yahoo's
  "Too Many Requests" rate limit for the whole backend for a few minutes (happened during testing on 2026-09-23). Results are cached 1 hour.
  Single countries with few big companies on their own exchange (Italy: 22) return fewer companies than asked.
  Minority interests are subtracted at BOOK value (the only figure in the statements), which overstates groups with big partly-owned listed
  subsidiaries (Deutsche Telekom / T-Mobile US): flagged with a warning, not corrected.
- Finnhub free tier is rate limited (60 calls/min); responses are cached for 1 hour in the backend.
- Live prices: "live" is Yahoo's regular-session price; pre-market and after-hours trades are not shown (the badge says market closed).
  Non-US exchanges are delayed 15-20 min by Yahoo (shown in the badge). Only the header and the Overview page move live; every other
  tab uses prices up to 1 hour old. Each open browser tab polls Yahoo about 4 times a minute during US trading hours.
- Empty daily bars from Yahoo (see Done, `data.price_history`): rebuilt from hourly bars, whose last close is the last trade before the
  closing auction, so a rebuilt close can differ from the official one by a few cents (AAPL 2026-09-22: 339.73 vs 339.75). Gaps older than
  720 days cannot be rebuilt (no hourly data) and stay missing, as before.
- Module 12 (Politicians): Senate coverage is a rolling last-~3-months window only (Bargo's free tier), not full history
  like House (back to 2012) -- a Senate row that scrolls out of that window simply disappears from the feed, there is no
  archive. Both data sources are third-party, unofficial mirrors of government filings, not the government's own API:
  the House source (`TattooedHead/house-stock-watcher-data` on GitHub) could go stale or disappear the way its predecessor
  (housestockwatcher.com) did; Bargo is a company with its own free-tier terms (30/100 requests/rows per day anonymously,
  100/1,000 with the free key in `.env`, no retry logic on failure -- a bad day just shows fewer/no Senate rows, silently).
  Disclosed amounts are always a reported RANGE (e.g. "$15,001 - $50,000"), never an exact figure -- the chart's dollar
  totals use the range midpoint, so they are an approximation, not the true traded value. STOCK Act filings lag the actual
  trade by up to ~45 days, so a trade shown today may be weeks old. The House source's `asset_description` field has
  occasional corrupted/garbled text from unfilled PDF form fields (null bytes are stripped, but the surrounding "F S: New"-
  style fragments are not otherwise cleaned up). One row in the House dataset has an implausible future transaction date
  (Steve Cohen / SONY, "12/26/2026") -- a single source-data glitch, left as-is since it is immaterial to the totals. Party
  and photo come from a name match against congress-legislators (about 2% of names unmatched, shown with a letter avatar and no chip;
  party = the member's latest term, not at the trade date). Not yet seen in a real browser.

## 8. Change log

- 2026-09-25: Owner asked to build party affiliation + photos, then the S&P 500 line, on the Politicians tab. Done, see Done section.

- 2026-09-25: Owner asked to recreate the README with more precise per-feature detail. Rewrote `README.md`: requirements, setup, run, keys table,
  a section per tab (Overview, Seasonality, Fundamentals sub tabs, Fair value, Compare, Rankings, News, Politicians, Watchlist), full API table,
  layout, general limitations. Python 3.10+ / Node 20+ are my assumptions (not checked against the machine).

- 2026-09-25: Owner asked to make the code ready for GitHub. Ran `git init -b main` (no commit yet), added `.env.example` (3 empty key names), extended
  `.gitignore` (.env, .venv, caches, node_modules, dist, editor/OS files), README setup line now points to `.env.example`. Checked that none of the
  three real keys appears in any tracked file; `.env` is ignored. Not committed or pushed: needs the owner's remote URL.

- 2026-09-24: Owner asked for a left arrow next to the watchlist's list pills, not only the right one. Added a ‹ button before the pills
  (scrolls them back by 160 px, like › forward). Build OK; not seen in a browser.

- 2026-09-23: Owner sent a screenshot of a broker's watchlist and asked for the same. Built the Watchlist (home page card, "Watchlist" tab, star
  in the company header) on a new batch endpoint; tested on port 8001 (stopped afterwards). Real-browser check pending.

- 2026-09-23: Owner asked whether the intraday chart's hours are US hours (yes: the exchange's own time zone, New York for US stocks). Their
  screenshot showed the tooltip title "149" (the bar's position on the gap-free numeric axis). The intraday x axis is now a category axis whose
  values are the bar times with the zone ("2026-09-23 11:59 EDT"), so the tooltip shows the time; the note under the chart names the zone; the
  header badge now names the VIEWER's zone ("LIVE · 17:59 CEST") since it uses the viewer's clock, unlike the chart. Build OK; not re-checked
  in a browser.

- 2026-09-23: Two display fixes from the owner's screenshot. (a) The selected main tab showed no navy background (also: selected Fundamentals
  sub-tab kept grey text, selected Overview overlay pill no white fill): the base class string carried `bg-transparent`/text colour AND the
  active string its own, and Tailwind's stylesheet order (not the class order) picked the idle one. Colours now sit only in separate
  idle/active strings (`TAB_BTN_IDLE`, `SUBTAB_BTN_IDLE` in `App.jsx`; the overlay pills in `OverviewTab.jsx`). Rule for new code: never put
  a colour in a base class string that a conditional class also sets. Scanned the other tabs: no other case. (b) The Overview's last-price
  label covered the nearest y-axis number: the linear axis now uses its own round ticks (`niceTicks`) and drops any within 4% of the chart
  height from the last price (log axis unchanged). `npm run build` succeeds; not seen in a browser.

- 2026-09-23: Owner sent an Overview screenshot (NVDA, 1 Month) asking for a weekly and a today chart. Added "Today" and "1 Week" tiles with
  intraday charts (new intraday endpoint, live last point, previous-close line). Tested on port 8001 (stopped afterwards).

- 2026-09-23: Owner asked to check whether the missing Sep 22 row (noticed while testing live prices) affected the other endpoints and fix it.
  Cause: Yahoo's empty daily bar for every US stock, dropped by yfinance. Added `data.price_history` (rebuilds such days from hourly bars)
  and switched all 7 price downloads to it. Tested on port 8001 (stopped afterwards).

- 2026-09-23: Owner asked how often prices update (answer: on demand, saved for 1 hour), then asked for live prices. Proposed Finnhub for US
  plus Yahoo for the rest; owner said "use only yahoo for the prices". Built `/api/quote` (Yahoo, 10 s) + a polling hook, wired into the
  header (LIVE / Delayed / Market closed badge) and the Overview chart's last point. Tested on port 8001 (stopped afterwards).

- 2026-09-23: Owner asked for two new Rankings tabs: top 20 most undervalued and top 20 most overvalued companies, choosing sector, nation
  etc. Built them on the Fair value module (new summary endpoint), added 13 single-country markets, and fixed the screener crowding out
  German/Swiss companies with foreign cross-listings. Heavy testing hit Yahoo's rate limit; the default scan is 30 companies because of it.

- 2026-09-23: Owner asked for "a section dedicated to the fair value". Asked which methods and where; owner chose DCF + historical multiples +
  analyst targets in a new top-level tab. Built module 13 (`backend/fairvalue.py`, `frontend/src/FairValueTab.jsx`), tested live on port 8001
  (stopped afterwards); `npm run build` succeeds. Real-browser check pending.

- 2026-09-23: Owner opened the app in a real browser for the first time (Politicians tab) and hit "Could not load trades:
  422 Unprocessable Content". Cause: `GET /api/congress/trades` declared `minAmount: float = 0`, but the frontend's default
  state for that filter is `''` (no minimum selected), sent as `&minAmount=` -- FastAPI can't parse an empty string as a
  float, so every page load 422'd before any minimum was ever chosen (the chart, which doesn't send `minAmount`, loaded
  fine, which is why only the table failed). Also fixed: the search box rendered its placeholder/text in all caps, because
  `input { text-transform: uppercase }` is a global default in `style.css` (meant for ticker-style inputs; every other free-
  text input in the app, e.g. the header `TickerBox`, overrides it with `normal-case`, which this one had missed). Fixed
  `minAmount` to `str = ""` parsed manually in `main.py`, and added `normal-case` to the search input. Verified against the
  exact failing query shape via curl (now 200); `npm run build` succeeds. This was the app's first real-browser look at
  anything in it (see section 4) -- expect more of this class of bug (frontend/backend contract mismatches jsdom-less curl
  testing can miss) until the rest of the tabs get the same check.
- 2026-09-23: Owner sent screenshots of a "US Government Tracker" site (a politician buy/sell chart plus a paginated trades
  table) and asked how to build the same. The obvious free datasets (housestockwatcher.com / senatestockwatcher.com) turned
  out to be dead; found `TattooedHead/house-stock-watcher-data` on GitHub as a live replacement for House (full history, no
  key) and confirmed with the owner (clarifying questions) to use free sources and a new top-level tab. No equally good free
  full-history option exists for Senate; owner chose to supplement it with the Bargo AI congress-trades API instead (a
  rolling ~3-month window). Its anonymous quota was exhausted by two test calls; owner supplied a free `BARGO_API_KEY`
  (added to `.env` only), after which Senate rows worked end-to-end. Built `backend/congress.py` (merges both sources into
  one shape, paginated/filterable) and `frontend/src/CongressTab.jsx` (quarterly buy/sell chart, filters, table), with an
  above-the-fold attribution line linking back to Bargo as its free-tier terms require. Verified live via curl against a
  test backend (House 24,141 rows, Senate 99 once the key was added, filters combined correctly); `npm run build` succeeds.
  Real-browser check still pending.
- 2026-09-23: Owner sent a screenshot of Forecaster's per-company "Political" tab (NVDA: the same buy/sell chart, but
  scoped to one company with its own stock price overlaid, plus dividend-date banners) and an article mentioning filtering
  trades by size. Clarified scope first (ticker filter + price overlay vs. simpler options; owner picked the full match),
  and separately confirmed a minimum-amount filter was wanted too. Added `congress.company_summary(ticker)` (quarterly
  buy/sell for one ticker plus its own quarter-end closing price) and `ticker`/`min_amount` filters on `congress.trades()`;
  a "This company only" checkbox and a minimum-amount dropdown in `CongressTab.jsx`. Deliberately left out the dividend
  banners from the screenshot: they already exist on the Overview tab for the same company, so duplicating them here would
  just repeat that view rather than add anything. Verified live via curl (NVDA: 31 quarters with prices from $2.72 to
  $227.38, an untraded ticker 404s cleanly, ticker+minAmount combine correctly); `npm run build` succeeds. Real-browser
  check still pending.
- 2026-09-23: Owner sent a screenshot of Forecaster.biz's start page and asked for the same homepage without "Sign in".
  Built `Home.jsx` (centered logo/wordmark, tagline, search box with suggestions and a clear button, example-ticker links)
  and a `view` state in `App.jsx` so the app opens on it instead of a ticker; entering a company switches to the dashboard,
  clicking the "QuantPlatform" title returns home. Dropped the sign-in button, app-switcher icon, "pick a plan" and the
  AI-agent pill from the reference, none of which apply to this tool. `npm run build` succeeds; real-browser check pending.
- 2026-09-22: Owner said "do them" to the two follow-ups offered after the sentiment score shipped. Added a sentiment trend bar
  chart to the News tab (client-side, from data already fetched) and a "News sentiment (14d)" column to Rankings/Compare (one new
  backend function, one line added to the shared `COLUMNS` array -- both tables picked it up automatically). Fixed a Rules-of-
  Hooks bug caught before shipping: the trend's `useMemo` was first placed after `NewsTab`'s early returns.
- 2026-09-22: Owner asked what else could be done now that News exists; suggested a sentiment score among other ideas. Owner asked
  to compute it locally rather than pay for a sentiment API. Explained the Loughran-McDonald finance word-list approach and got
  the owner's OK to source a word list. Built `backend/sentiment.py` (word-count scoring with a 3-word negation window) +
  `backend/lm_sentiment.json` (parsed once from a public derived copy of the LM dictionary), wired into `GET /api/news/{symbol}`,
  and added a sentiment pill per card plus a tally strip to `NewsTab.jsx`. Verified on AAPL: sensible, non-degenerate label split.
- 2026-09-22: Owner said to use yfinance's own news for non-US stocks, as suggested when the Benzinga/Finnhub gap was found.
  `company_news` now falls back to `data._yfinance_news` (`yf.Ticker(symbol).news`, normalised to the same article shape) only
  when Finnhub's 422 fires (no US listing); US-listed symbols are untouched. Verified live: Toyota `7203.T` and Samsung
  `005930.KS` each return 10 articles instead of erroring, though the content is often generic market-roundup filler rather than
  company-specific, as already flagged to the owner before building this.
- 2026-09-22: Owner asked whether Benzinga/Yahoo cover non-US stocks like Finnhub does not. Tested live: Finnhub's `/company-news`
  has the same US-listed-only gate as its other endpoints (works for ADRs like SAP/NVO/TM, 403s for native foreign tickers like
  Toyota `7203.T` and Samsung `005930.KS`). Benzinga turned out messier: testing US mega-caps found half consistently return
  articles (AAPL, MSFT, JPM, KO, DIS, INTC, WMT, PG, V, HD) and half come back empty with no error (NVDA, GOOGL, META, TSLA,
  AMZN, AMD, NFLX, XOM, MA, BAC) -- NVDA itself flipped from working to empty within the session, so this looks like a ticker
  entitlement tied to the key/plan rather than a US-vs-foreign rule; recorded as a known limitation, owner would need to check
  their Benzinga dashboard to know what the plan covers. No code changes; owner said "ok" to leaving it documented rather than
  digging further (nothing to dig into from this side without access to the Benzinga account).
- 2026-09-22: Owner gave a Benzinga API key and its docs (github.com/Benzinga/doc-site-mintlify) and asked to use it for news.
  Key added to `.env` only. Read the docs repo's `benzinga-apis/newsfeed-v2/` and `openapi/newsfeed-v2.yaml` to find the REST
  endpoint (`GET https://api.benzinga.com/api/v2/news`, `token` query param, `tickers`/`dateFrom`/`dateTo`/`pageSize`); found in
  testing that it answers XML unless sent `Accept: application/json` (undocumented). Merged Benzinga's own headlines into
  `data.company_news` alongside Finnhub's, deduplicated by headline. Verified against the live API: AAPL gained 25 genuinely new
  articles, NVDA 9 (Benzinga's own catalog is much smaller than Finnhub's Yahoo-aggregated feed for heavily-covered names).
- 2026-09-22: Owner asked how to get news from somewhere other than Yahoo. Checked the data: 192/247 of AAPL's and 237/250 of
  NVDA's 30-day Finnhub headlines are tagged source "Yahoo" (Yahoo re-syndicates most other outlets for big names). Added a
  client-side "Hide Yahoo re-posts" checkbox (default on) rather than a new provider, since that would need a new API key/account
  outside the current yfinance/Finnhub architecture -- flagged as the real fix if the owner wants it, not built without their OK.
- 2026-09-22: Owner asked for bigger News cards filling the empty space below the grid. Added a thumbnail image (when Finnhub
  has one) and the article summary, gave each card a 260px minimum height, and dropped the page size from 12 to 9 (3x3) so the
  larger cards still fit a page without excess scrolling.
- 2026-09-22: Owner saw the News tab in a real browser (screenshot: AAPL, styling matched) and asked for more articles per page.
  Grid widened from 2 to 3 columns and page size raised from 6 to 12.
- 2026-09-22: Owner asked whether the APIs already in use expose news for the current stock, then sent screenshots of a
  Forecaster.biz News tab (card grid, pagination) and asked for that layout. Built the News tab (module 11) on Finnhub
  `/company-news`, tested against the live API. Real-browser check still pending.
- 2026-09-22: Owner asked why the project used hand-written CSS instead of Tailwind, then asked to migrate. Installed Tailwind CSS v4
  and converted all 14 frontend component files from the old `style.css` classes to Tailwind utility classes (see Done section for
  details); `npm run build` passes. Real-browser check still pending, more important than usual for this change.
- 2026-09-22: Owner reported a stray "5" showing before the ticker in the header search box (screenshot). Found in
  `frontend/src/style.css`: the `.ac::before` rule that draws the search icon had corrupted bytes (`content: "\xc2\x995"`,
  an invisible mis-encoded control character followed by "5") instead of a real icon glyph -- rendered as a tofu box + "5"
  before the typed ticker. Fixed to a proper CSS unicode escape for the magnifying-glass icon (`content: "\1F50D"`), which
  can't suffer the same encoding corruption. Real-browser check still pending (see section 4).
- 2026-09-21: Owner sent screenshots of a Forecaster.biz stock page (header, price chart with range tiles and overlays, Drawdown, Years Performance, Dividends) and asked
  for a similar UI/UX and functions. Built the Overview page (module 10), a company header, and a pill tab bar with Fundamentals sub tabs. Test server on 8001 stopped afterwards.
- 2026-09-21: Owner sent the next module: Seasonality (article + 10 screenshots: seasonal curve, detrended, period toggles, daily/weekly/monthly
  averages, trade statistics, spread trading, the "70% rule"). Built and tested (module 9, tenth tab). Test server on port 8001 was stopped afterwards.
- 2026-09-21: Started as Streamlit, moved to Node, settled on Python backend + React frontend. Tracker created (in CLAUDE.md).
- 2026-09-21: Owner ran the app; found `uvicorn.exe` blocked by Windows policy, use `python -m uvicorn`. Cross-checked EV/EBITDA against
  Finnhub (matches). Owner chose the next module: the "EV/EBITDA vs price" chart from a Forecaster.biz reference. Built and tested it.
  Note: the owner's own uvicorn on port 8000 can still be running old code; test on another port (e.g. 8001) and never kill it.
- 2026-09-21: Owner asked for a way to compare different stocks with suggested competitors (sector / real rivals like Apple and Samsung).
  Built the Compare tab (module 8), the worldwide competitor finder, name search and rebased price comparison; improved Rankings' competitors.
- 2026-09-21: Owner answered the Rankings question: "take those information from yfinance". Built Rankings (module 7) with yfinance
  industry/sector/screener universes, tested (incl. a 30-company stress test), and added the shared Finnhub rate limiter.
- 2026-09-21: Owner chose the next module: PEG ratio (Micron reference; article explains the "four quick checks" workflow and Rankings).
  Built and tested (module 6).
- 2026-09-21: Owner chose the next module: Solidity (Altman Z, Piotroski F, Beneish M table). Built and tested (module 5). A follow-up
  message "Next module:" arrived with no content.
- 2026-09-21: Owner chose the next module: free cash flow yield (Oracle reference chart, output "like in the photo"). Built and tested
  (module 4). Pattern so far: each module = one Finnhub/yfinance function in `data.py` + one endpoint in `main.py` + one tab in
  `frontend/src`, validated against the owner's reference numbers, tested in jsdom on port 8001.
- 2026-09-21: Owner chose the next module: ROIC (Visa vs Mastercard reference). Built and tested (module 3). Test servers use port 8001.
- 2026-09-21: Owner approved using the portable Node. Frontend installed, built and tested in jsdom. Corrected an earlier
  mistake: Finnhub does have EV/EBITDA for SAP and NVO. Real-browser check not possible from the tool environment.
