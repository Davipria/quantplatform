"""Comparing companies: suggestions, search, price performance and the ranking table rows.

Everything comes from yfinance: `industry_peers` finds real competitors (Yahoo files Apple, Samsung, Sony and Xiaomi under one
industry), `suggest` groups candidates by why they are relevant, `search` finds a ticker from a company name, `compare_prices` rebases
price histories to 100, and `ranking_row` computes the five checks for ONE company by reusing the functions behind the individual tabs
(so a number here is the number the matching tab shows). The frontend fetches rows one by one, which keeps every request short and lets
the Finnhub rate limiter in `data.finnhub_get` pace the calls.
"""
import re
from concurrent.futures import ThreadPoolExecutor

import pandas as pd
import yfinance as yf

import data
import forward
import sentiment
import solidity
from data import DataError, upstream

MAX_COMPANIES = 30
MAX_SCAN = 100  # the fair-value lists scan up to this many of the largest companies
SYMBOL = re.compile(r"[A-Z0-9.^=-]{1,15}")
SECTORS = {"technology", "financial-services", "healthcare", "consumer-cyclical", "communication-services", "industrials",
           "consumer-defensive", "energy", "real-estate", "utilities", "basic-materials"}
# Secondary venues that only carry cross-listings of a company (OTC, German regional exchanges, CEDEARs, BDRs, CDRs...).
SECONDARY_EXCHANGES = {"PNK", "OQB", "OQX", "OEM", "FRA", "STU", "BER", "MUN", "DUS", "HAM", "HAN", "BVC", "BUE", "MEX", "SAO", "WSE", "NEO",
                       "SGO", "BKK", "CXE"}


def _clean(symbols) -> list[str]:
    seen, out = set(), []
    for s in symbols:
        s = str(s).strip().upper()
        if SYMBOL.fullmatch(s) and s not in seen:
            seen.add(s)
            out.append(s)
    return out


def _name_key(name: str | None) -> str:
    return re.sub(r"[^a-z0-9]", "", re.sub(r"^\s*the\s+", "", (name or "").lower()))


# Symbols that are foreign lines of a company rather than its home listing: Milan "1KO.MI", Vienna ".VI", London IOB "0QZ0.L" / "0QLR.IL".
FOREIGN_LINE = re.compile(r"^\d[A-Z]{1,5}\.MI$|\.VI$|^0[A-Z0-9]{3}\.(L|IL)$")


def _same(name1, cap1, name2, cap2, letters: int = 4) -> bool:
    """Two listings of one company: the names start alike ("SamsungElec", "SAMSUNG ELECTRONICS CO", "Eni", "ENI S.P.A.", GOOG/GOOGL) and the USD market
    caps agree within 12%. The cap test keeps different companies with similar names ("Bank of America" / "Bank of China") apart."""
    k1, k2 = _name_key(name1), _name_key(name2)
    n = min(len(k1), len(k2), letters)  # compare the first 4 letters ("Eni" and "Eni S.p.A." only have 3 in common)
    return bool(cap1 and cap2 and n >= 3 and k1[:n] == k2[:n] and abs(cap1 / cap2 - 1) < 0.12)


# Not a company of its own: preferred shares, depositary receipts, rights, warrants.
JUNK_NAME = re.compile(r"\(\d?P\)|\bPREF|\bPFD|_DR\b|\bDR\b|\bCDR\b|CEDEAR|\bDRN?\b|\bRIGHTS?\b|\bWARRANTS?\b|#", re.I)


def _usd(cap, currency) -> float | None:
    fx = data.usd_per_unit(currency)
    return float(cap) * fx if cap and fx else None


# ---------------------------------------------------------------- competitors and suggestions

def _screener_industry(profile_name: str) -> str | None:
    """The screener spells some industries differently from company profiles ("Banks - Diversified" vs "Banks—Diversified")."""
    norm = lambda s: re.sub(r"[^a-z0-9]", "", s.lower())  # noqa: E731
    valid = {norm(i): i for group in yf.const.EQUITY_SCREENER_EQ_MAP["industry"].values() for i in group}
    return valid.get(norm(profile_name))


def _screen_industry(industry: str, region: str | None, size: int) -> list[dict]:
    query = yf.EquityQuery("eq", ["industry", industry])
    if region:
        query = yf.EquityQuery("and", [query, yf.EquityQuery("eq", ["region", region])])
    return yf.screen(query, sortField="intradaymarketcap", sortAsc=False, size=size)["quotes"]


def _listing_items(quotes: list[dict]) -> list[dict]:
    """Screener quotes -> candidate listings with USD market cap, dropping cross-listings that are not a company of their own."""
    with ThreadPoolExecutor(8) as ex:  # warm the FX cache in parallel
        list(ex.map(data.usd_per_unit, {q.get("currency") for q in quotes}))
    items, seen = [], set()
    for q in quotes:
        name = q.get("shortName") or q.get("longName") or ""
        cap = _usd(q.get("marketCap"), q.get("currency"))
        if (q.get("quoteType") != "EQUITY" or q.get("exchange") in SECONDARY_EXCHANGES or JUNK_NAME.search(name) or "%" in name
                or FOREIGN_LINE.search(q["symbol"]) or not cap or not name or q["symbol"] in seen):
            continue
        seen.add(q["symbol"])
        traded = (q.get("averageDailyVolume3Month") or 0) * (q.get("regularMarketPrice") or 0) * (data.usd_per_unit(q.get("currency")) or 0)
        items.append({
            "symbol": q["symbol"], "name": name, "marketCapUsd": cap, "currency": q.get("currency"), "exchange": q.get("fullExchangeName"),
            # A listing whose price currency differs from the financials' (a US ADR of a Japanese company...) gives wrong ratios.
            "longName": q.get("longName") or name,
            "_mismatch": bool(q.get("financialCurrency") and q.get("currency") and q["financialCurrency"] != q["currency"]), "_traded": traded,
        })
    return items


def _one_per_company(items: list[dict]) -> list[dict]:
    """Group listings of the same company (largest cap first) and keep the best of each: financials in the price currency (the home
    listing), then the most traded. Returns the companies largest first."""
    groups: list[list[dict]] = []
    for it in sorted(items, key=lambda x: -x["marketCapUsd"]):
        for g in groups:
            if (_same(it["name"], it["marketCapUsd"], g[0]["name"], g[0]["marketCapUsd"])
                    or _same(it["longName"], it["marketCapUsd"], g[0]["longName"], g[0]["marketCapUsd"], 8)):
                g.append(it)
                break
        else:
            groups.append([it])
    best = [min(g, key=lambda x: (x["_mismatch"], -x["_traded"])) for g in groups]
    return sorted(({k: v for k, v in b.items() if not k.startswith("_")} for b in best), key=lambda p: -p["marketCapUsd"])


@upstream
def industry_peers(symbol: str) -> dict:
    """Companies of the same Yahoo industry, worldwide, largest first (market cap converted to USD), one listing per company.

    The screener sorts by market cap in local currency, so a US-only query (USD, comparable) and a worldwide one are merged; then
    cross-listings are removed, preferring a plain (US-style) ticker, then the larger cap."""
    info = yf.Ticker(symbol).info
    industry = info.get("industry")
    if not industry:
        raise DataError(404, f"Yahoo has no industry for {symbol}")
    screener_name = _screener_industry(industry)
    if not screener_name:
        raise DataError(404, f"The screener does not know the industry {industry}")
    with ThreadPoolExecutor(2) as ex:
        quotes = [q for batch in ex.map(lambda a: _screen_industry(screener_name, *a), [("us", 25), (None, 100)]) for q in batch]

    me_cap = _usd(info.get("marketCap"), info.get("currency"))
    me_name = info.get("shortName") or info.get("longName")
    peers = [p for p in _one_per_company(_listing_items(quotes))
             if p["symbol"] != symbol and not _same(me_name, me_cap, p["name"], p["marketCapUsd"])]  # not the company itself
    return {"industry": industry, "peers": peers[:30]}


@upstream
def profile(symbol: str) -> dict:
    info = yf.Ticker(symbol).info
    name = info.get("shortName") or info.get("longName")
    if not name:
        raise DataError(404, f"Unknown ticker {symbol}")
    return {"symbol": symbol, "name": name, "marketCapUsd": _usd(info.get("marketCap"), info.get("currency")),
            "currency": info.get("currency"), "exchange": info.get("fullExchangeName") or info.get("exchange"), "country": info.get("country")}


def _yahoo_similar(symbol: str) -> list[str]:
    """Yahoo's "people also view" list for a symbol (through yfinance's authenticated session)."""
    try:
        r = yf.Ticker(symbol)._data.cache_get(f"https://query2.finance.yahoo.com/v6/finance/recommendationsbysymbol/{symbol}")
        return [x["symbol"] for x in r.json()["finance"]["result"][0]["recommendedSymbols"]]
    except Exception:  # noqa: BLE001 - suggestions are a bonus; never fail the page because of them
        return []


def _profiles(symbols: list[str]) -> list[dict]:
    def one(s):
        try:
            return profile(s)
        except Exception:  # noqa: BLE001
            return None
    with ThreadPoolExecutor(8) as ex:
        return [p for p in ex.map(one, symbols) if p]


@upstream
def suggest(symbol: str) -> dict:
    """Who to compare `symbol` with, in three groups: same-industry competitors worldwide, Yahoo's "also viewed", same-sector giants."""
    info = yf.Ticker(symbol).info
    if not (info.get("shortName") or info.get("longName")):
        raise DataError(404, f"Unknown ticker {symbol}")
    seen_symbols = {symbol}
    seen = [(info.get("shortName") or info.get("longName"), _usd(info.get("marketCap"), info.get("currency")))]  # (name, USD cap)

    def fresh(items):
        out = []
        for p in items:
            if p["symbol"] in seen_symbols or any(_same(p["name"], p.get("marketCapUsd"), n, c) for n, c in seen):
                continue
            seen_symbols.add(p["symbol"])
            seen.append((p["name"], p.get("marketCapUsd")))
            out.append(p)
        return out

    groups = []
    try:
        ip = industry_peers(symbol)
        groups.append({"id": "industry", "title": f"Direct competitors: {ip['industry']}, worldwide (largest first)",
                       "items": fresh(ip["peers"])[:8]})
    except DataError:
        pass
    similar = _profiles([s for s in _yahoo_similar(symbol) if s not in seen_symbols])
    groups.append({"id": "similar", "title": "Often viewed together on Yahoo Finance", "items": fresh(similar)[:6]})
    sector_key = info.get("sectorKey")
    if sector_key in SECTORS:
        try:
            top = list(yf.Sector(sector_key).top_companies.index[:14])
            groups.append({"id": "sector", "title": f"Largest companies in the same sector: {info.get('sector')}",
                           "items": fresh(_profiles([s for s in top if s not in seen_symbols]))[:6]})
        except Exception:  # noqa: BLE001
            pass
    return {"symbol": symbol, "name": info.get("shortName") or info.get("longName"), "industry": info.get("industry"),
            "sector": info.get("sector"), "groups": [g for g in groups if g["items"]]}


@upstream
def search(q: str) -> list[dict]:
    """Find tickers by company name or partial ticker."""
    res = yf.Search(q, max_results=10, news_count=0).quotes
    return [{"symbol": x["symbol"], "name": x.get("shortname") or x.get("longname") or "", "exchange": x.get("exchDisp") or x.get("exchange")}
            for x in res if x.get("quoteType") == "EQUITY" and x.get("symbol")][:8]


# ---------------------------------------------------------------- price performance

@upstream
def compare_prices(symbols: tuple, years: int) -> dict:
    """Close prices of several stocks rebased to 100 at the first day all of them have data inside the window (local currency)."""
    def close(s):
        hist = data.price_history(yf.Ticker(s))
        if hist.empty:
            raise DataError(404, f"No price data for {s}")
        px = hist["Close"].dropna()
        px.index = px.index.tz_localize(None).normalize()
        return px[~px.index.duplicated()]
    with ThreadPoolExecutor(6) as ex:
        df = pd.DataFrame(dict(zip(symbols, ex.map(close, symbols)))).sort_index()
    df = df[df.index >= df.index.max() - pd.DateOffset(years=years)].ffill(limit=5).dropna()  # holidays differ between markets
    if len(df) < 2:
        raise DataError(422, "The stocks do not have overlapping price history in this window")
    rebased = df / df.iloc[0] * 100
    return {
        "start": df.index[0].strftime("%Y-%m-%d"), "dates": [d.strftime("%Y-%m-%d") for d in df.index],
        "series": {s: [round(float(v), 3) for v in rebased[s]] for s in symbols},
        "totalReturn": {s: float(rebased[s].iloc[-1] - 100) for s in symbols},
    }


# ---------------------------------------------------------------- ranking table

# ---------------------------------------------------------------- markets: "largest companies of a country group"

EU_REGIONS = ["de", "fr", "it", "es", "nl", "be", "ie", "fi", "dk", "se", "at", "pt", "gr", "pl"]
EU_COUNTRIES = {"Germany", "France", "Italy", "Spain", "Netherlands", "Belgium", "Ireland", "Finland", "Denmark", "Sweden", "Austria",
                "Portugal", "Greece", "Poland", "Luxembourg", "Czech Republic", "Czechia", "Hungary", "Cyprus", "Malta", "Estonia", "Latvia",
                "Lithuania", "Slovakia", "Slovenia", "Croatia", "Romania", "Bulgaria"}
HUB_EXCHANGES = {"DE": "Germany", "SW": "Switzerland"}  # symbol suffix -> country: exchanges that list many foreign companies
# regions = where the screener looks (it returns stocks TRADING there, which includes foreign cross-listings);
# countries = where the company is domiciled (Yahoo profile), which is what "EU company" really means.
MARKETS = {
    "us": {"label": "United States", "regions": ["us"], "countries": {"United States"}},
    "eu": {"label": "European Union", "regions": EU_REGIONS, "countries": EU_COUNTRIES},
    "europe": {"label": "Europe (EU + UK, Switzerland, Norway)", "regions": EU_REGIONS + ["gb", "ch", "no"],
               "countries": EU_COUNTRIES | {"United Kingdom", "Switzerland", "Norway", "Iceland", "Liechtenstein"}},
    "uk": {"label": "United Kingdom", "regions": ["gb"], "countries": {"United Kingdom"}},
    "jp": {"label": "Japan", "regions": ["jp"], "countries": {"Japan"}},
    "cn": {"label": "China & Hong Kong", "regions": ["cn", "hk"], "countries": {"China", "Hong Kong"}},
    **{code: {"label": name, "regions": [code], "countries": {name}} for code, name in [
        ("de", "Germany"), ("fr", "France"), ("it", "Italy"), ("es", "Spain"), ("nl", "Netherlands"), ("ch", "Switzerland"),
        ("se", "Sweden"), ("ca", "Canada"), ("au", "Australia"), ("in", "India"), ("kr", "South Korea"), ("tw", "Taiwan"),
        ("br", "Brazil"),
    ]},
    "world": {"label": "Worldwide", "regions": ["us", "cn", "hk", "jp", "kr", "tw", "in", "gb", "de", "fr", "ch", "ca", "au", "nl"], "countries": None},
}


def options() -> dict:
    """What the Rankings dropdowns offer: markets, and sectors with their industries (screener spellings)."""
    industries = yf.const.EQUITY_SCREENER_EQ_MAP["industry"]
    return {"markets": [{"id": k, "label": m["label"]} for k, m in MARKETS.items()],
            "sectors": [{"name": sec, "industries": sorted(industries[sec])} for sec in sorted(industries)]}


def _market_companies(market: str, sector: str, industry: str, size: int) -> tuple[str, list[dict]]:
    """The `size` largest companies domiciled in the market (optionally within a sector / industry), one listing per company."""
    if market not in MARKETS:
        raise DataError(400, f"Unknown market {market}")
    valid = yf.const.EQUITY_SCREENER_EQ_MAP["industry"]
    if sector and sector not in valid:
        raise DataError(400, f"Unknown sector {sector}")
    if industry and industry not in {i for group in valid.values() for i in group}:
        raise DataError(400, f"Unknown industry {industry}")
    m = MARKETS[market]
    filters = []
    if sector:
        filters.append(yf.EquityQuery("eq", ["sector", sector]))
    if industry:
        filters.append(yf.EquityQuery("eq", ["industry", industry]))

    exchanges = yf.const.EQUITY_SCREENER_EQ_MAP["exchange"]

    def screen(job):  # one query per country: the screener sorts by market cap in local currency, so currencies must not be mixed
        region, offset = job
        # Only the country's main exchanges: regional venues (Frankfurt, Stuttgart...) are mostly foreign cross-listings that
        # crowd the country's own companies out of the results (region "de" = Nvidia, Apple, Microsoft... first).
        primary = sorted(set(exchanges.get(region, [])) - SECONDARY_EXCHANGES)
        parts = [yf.EquityQuery("eq", ["region", region]), *filters]
        if primary:
            parts.append(yf.EquityQuery("is-in", ["exchange", *primary]))
        q = yf.EquityQuery("and", parts) if len(parts) > 1 else parts[0]  # "and" needs at least two operands
        for attempt in range(2):  # Yahoo occasionally times out on one query: retry once
            try:
                return yf.screen(q, offset=offset, sortField="intradaymarketcap", sortAsc=False, size=250)["quotes"]
            except Exception:  # noqa: BLE001
                if attempt == 0:
                    continue
                if offset or len(m["regions"]) > 1:  # a second page, or one country of a group, must not sink the whole list
                    return []
                raise

    # Germany and Switzerland get a second page (500 listings): even their main exchanges carry so many foreign lines that the
    # domicile check would otherwise leave few of their own companies. Other countries' first 250 are mostly home companies.
    jobs = [(r, 0) for r in m["regions"]] + [(r, 250) for r in m["regions"] if r in ("de", "ch")]
    with ThreadPoolExecutor(8) as ex:
        quotes = [q for batch in ex.map(screen, jobs) for q in batch]
    candidates = _one_per_company(_listing_items(quotes))
    # XETRA and SIX list many other European companies too (IBE1.DE = Iberdrola, IXD1.DE = Inditex), often with a market cap far enough
    # from the home line's that `_same` misses them. Drop such a line when the same name also appears under another exchange suffix.
    suffixes: dict[str, set] = {}
    for c in candidates:
        for key in (_name_key(c["name"])[:4], _name_key(c["longName"])[:8]):  # short names differ more ("INDITEX" / "Industria de Diseno")
            suffixes.setdefault(key, set()).add(c["symbol"].rpartition(".")[2])

    def home_elsewhere(c, domicile):
        hub = HUB_EXCHANGES.get(c["symbol"].rpartition(".")[2])
        return hub is not None and domicile != hub and any(
            len(suffixes[k]) > 1 for k in (_name_key(c["name"])[:4], _name_key(c["longName"])[:8]))

    if m["countries"] is None:
        chosen = candidates[:size]
    else:  # keep only companies domiciled in the market: check the largest candidates a chunk at a time
        chosen, pos = [], 0
        while len(chosen) < size and pos < min(len(candidates), max(size * 8, 400)):
            chunk = candidates[pos: pos + size * 2]
            pos += size * 2
            country = {p["symbol"]: p["country"] for p in _profiles([c["symbol"] for c in chunk])}
            chosen += [c for c in chunk if country.get(c["symbol"]) in m["countries"] and not home_elsewhere(c, country[c["symbol"]])]
        chosen = chosen[:size]
    label = " · ".join(x for x in ["Largest companies", m["label"], sector, industry] if x)
    return label, chosen


@upstream
def universe(kind: str, key: str, size: int, market: str = "us", sector: str = "", industry: str = "") -> dict:
    """The companies to rank: `peers` (competitors of ticker `key`), `market` (largest companies of a country group, optionally within a
    sector or industry) or `custom` (tickers typed by the user)."""
    size = max(2, min(size, MAX_SCAN if kind == "market" else MAX_COMPANIES))
    names: dict[str, str] = {}
    if kind == "peers":
        ip = industry_peers(key)
        symbols = [key] + [p["symbol"] for p in ip["peers"]]
        names = {p["symbol"]: p["name"] for p in ip["peers"]}
        group = f"{ip['industry']} (competitors worldwide)"
    elif kind == "market":
        group, found = _market_companies(market, sector, industry, size)
        symbols = [c["symbol"] for c in found]
        names = {c["symbol"]: c["name"] for c in found}
    elif kind == "traded":
        import breadth  # here: breadth imports market, which is not needed for the other kinds

        found = breadth.traded_universe(size)
        symbols, names, group = [c["symbol"] for c in found], {c["symbol"]: c["name"] for c in found}, "Most traded US stocks (average dollar volume, last 20 sessions)"
    elif kind == "custom":
        symbols, group = re.split(r"[\s,;]+", key), "Your list"
    else:
        raise DataError(400, f"Unknown universe kind {kind}")
    tickers = _clean(symbols)[:size]
    if not tickers:
        raise DataError(404, "No companies found for this selection")
    return {"group": group, "companies": [{"symbol": s, "name": names.get(s, "")} for s in tickers]}


def _safe(fn):
    """(value, None) or (None, reason): one missing check must not sink the row."""
    try:
        return fn(), None
    except Exception as e:  # noqa: BLE001 - any provider failure just means "no value"
        return None, str(e)[:120]


@upstream
def ranking_row(symbol: str) -> dict:
    info = yf.Ticker(symbol).info
    if not info or not (info.get("shortName") or info.get("longName")):
        raise DataError(404, f"Unknown ticker {symbol}")
    errors: dict[str, str] = {}

    def check(name, fn):
        value, err = _safe(fn)
        if err:
            errors[name] = err
        return value

    mismatch = bool(info.get("financialCurrency") and info.get("currency") and info["financialCurrency"] != info["currency"])

    def ev_ebitda():
        r = data.ev_ebitda_history(symbol)
        if r["warning"]:  # statements and price in different currencies: the multiple would be wrong
            raise DataError(422, "financials and price are in different currencies")
        v = next((p["evEbitda"] for p in reversed(r["points"]) if p["evEbitda"] is not None), None)
        if v is None:
            raise DataError(422, "EBITDA is not positive")
        return v

    def roic():
        try:
            r = data.roic_history(symbol)
            return r["ttm"]["value"] if r["ttm"] else r["years"][-1]["value"]  # TTM, else the latest fiscal year
        except DataError:  # no Finnhub coverage (e.g. non-US company): the yfinance-only TTM calculation
            v = data._ttm_roic(symbol)
            if v is None:
                raise
            return v["value"]

    def fcf_yield():
        if mismatch:  # per-share cash flow in the reporting currency over a price in another currency
            raise DataError(422, "financials and price are in different currencies")
        try:
            return data.fcf_yield_history(symbol)["ttm"]["value"]
        except DataError:
            v = data._ttm_fcf_yield(symbol)
            if v is None:
                raise
            return v["value"]

    def peg():
        result = forward.peg_analysis(symbol)
        if "mix currencies" in (result["warning"] or ""):
            raise DataError(422, "EPS estimates and price are in different currencies")
        p = result["periods"]
        value = next((x["peg"] for x in reversed(p) if x["peg"] is not None), None)  # next year's PEG, else this year's
        if value is None:
            raise DataError(422, "PEG is not meaningful")
        return value

    sol = check("solidity", lambda: solidity.solidity_history(symbol)["ttm"])
    return {
        "symbol": symbol, "name": info.get("shortName") or info.get("longName"), "country": info.get("country"),
        "marketCap": info.get("marketCap"), "currency": info.get("currency"), "marketCapUsd": _usd(info.get("marketCap"), info.get("currency")),
        "evEbitda": check("evEbitda", ev_ebitda),
        "roic": check("roic", roic),
        "fcfYield": check("fcfYield", fcf_yield),
        "peg": check("peg", peg),
        "altman": sol["altman"]["z"] if sol else None,
        "piotroski": sol["piotroski"]["f"] if sol else None,
        "beneish": sol["beneish"]["m"] if sol else None,
        "newsSentiment": check("newsSentiment", lambda: sentiment.news_sentiment(symbol)["score"]),
        "errors": errors,
    }
