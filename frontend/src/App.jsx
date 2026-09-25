import { useEffect, useState } from 'react';
import { get, useApi, useQuote } from './api.js';
import CompareTab from './CompareTab.jsx';
import CongressTab from './CongressTab.jsx';
import EvTab from './EvTab.jsx';
import FairValueTab from './FairValueTab.jsx';
import FcfTab from './FcfTab.jsx';
import FyTab from './FyTab.jsx';
import Home from './Home.jsx';
import NewsTab from './NewsTab.jsx';
import OverviewTab from './OverviewTab.jsx';
import PegTab from './PegTab.jsx';
import RankingsTab from './RankingsTab.jsx';
import RatiosTab from './RatiosTab.jsx';
import RoicTab from './RoicTab.jsx';
import SeasonalityTab from './SeasonalityTab.jsx';
import SolidityTab from './SolidityTab.jsx';
import Watchlist, { useWatchlist } from './Watchlist.jsx';
import { big } from './ui.jsx';

const TABS = [
  ['overview', 'Overview'], ['seasonality', 'Seasonality'], ['fundamentals', 'Fundamentals'], ['fairvalue', 'Fair value'], ['compare', 'Compare'],
  ['rankings', 'Rankings'], ['news', 'News'], ['congress', 'Politicians'], ['watchlist', 'Watchlist'],
];
const FUNDAMENTALS = [
  ['ev', 'EV / EBITDA'], ['fy', 'EV / EBITDA vs price'], ['roic', 'ROIC'], ['fcf', 'FCF yield'], ['solidity', 'Solidity'], ['peg', 'PEG'], ['ratios', 'Historical ratios'],
];
const VIEWS = {
  overview: OverviewTab, fairvalue: FairValueTab, seasonality: SeasonalityTab, compare: CompareTab, rankings: RankingsTab, news: NewsTab, congress: CongressTab,
  ev: EvTab, fy: FyTab, roic: RoicTab, fcf: FcfTab, solidity: SolidityTab, peg: PegTab, ratios: RatiosTab,
};
const LAST_SYMBOL = 'quant.symbol';

// Colours live ONLY in the idle/active strings, never in the base: with two utilities for the same property on one element, Tailwind's
// stylesheet order decides the winner, not the class order (the active tab used to stay transparent).
const TAB_BTN = 'border-0 border-l border-l-white/55 first:border-l-0 rounded-none py-[11px] px-6 text-[15px] max-[640px]:py-[9px] max-[640px]:px-3.5';
const TAB_BTN_IDLE = 'bg-transparent text-[var(--tabbar-text)]';
const TAB_BTN_ACTIVE = 'bg-[var(--navy)] text-white';
const SUBTAB_BTN = 'rounded-full py-1.5 px-4';
const SUBTAB_BTN_IDLE = 'text-[var(--text-2)]';
const SUBTAB_BTN_ACTIVE = 'bg-[var(--brand-soft)] border-[var(--brand)] text-[var(--text)] font-semibold';

function initialSymbol() {
  try {
    return localStorage.getItem(LAST_SYMBOL) || 'AAPL'; // the last stock you looked at; Apple only the very first time
  } catch {
    return 'AAPL';
  }
}

/** Ticker box that also understands company names: type "samsung" and pick from the list. */
function TickerBox({ onLoad, initial }) {
  const [input, setInput] = useState(initial);
  const [results, setResults] = useState([]);
  const [open, setOpen] = useState(false);
  const searchUrl = (q) => `/api/compare/search?q=${encodeURIComponent(q)}`;

  useEffect(() => {
    const q = input.trim();
    if (!open || q.length < 2) {
      setResults([]);
      return undefined;
    }
    let live = true;
    const timer = setTimeout(() => {
      get(searchUrl(q)).then((r) => live && setResults(r), () => live && setResults([]));
    }, 300); // wait for a pause in typing
    return () => {
      live = false;
      clearTimeout(timer);
    };
  }, [input, open]);

  const load = (symbol) => {
    setInput(symbol);
    setOpen(false);
    setResults([]);
    onLoad(symbol);
  };

  const submit = async (e) => {
    e.preventDefault();
    const q = input.trim();
    if (!q) return;
    const typed = q.toUpperCase();
    let list = results;
    if (!list.length) {
      try {
        list = await get(searchUrl(q));
      } catch {
        list = [];
      }
    }
    // an exact ticker wins; otherwise the first match for the name; otherwise take the text as a ticker
    load(list.find((r) => r.symbol === typed)?.symbol ?? list[0]?.symbol ?? typed);
  };

  return (
    <form onSubmit={submit}>
      <label htmlFor="ticker" className="sr-only">Company</label>
      <div className="relative">
        <input
          id="ticker" value={input} placeholder="ticker or company name" autoComplete="off" spellCheck={false} maxLength={40}
          className="rounded-full pt-[9px] pb-[9px] pl-[34px] pr-4 text-base w-60 normal-case"
          onChange={(e) => { setInput(e.target.value); setOpen(true); }}
          onBlur={() => setOpen(false)}
        />
        <span aria-hidden="true" className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--text-2)] text-lg pointer-events-none">🔍</span>
        {open && results.length > 0 && (
          <div className="absolute top-full left-0 min-w-full w-[380px] max-w-[90vw] z-10 mt-0.5 p-1 max-h-[320px] overflow-auto bg-[var(--bg)] border border-[var(--border)] rounded-lg shadow-[0_6px_20px_rgba(0,0,0,0.18)]" role="listbox">
            {results.map((r) => (
              <button
                key={r.symbol} type="button" role="option"
                className="block w-full text-left border-0 bg-transparent py-1.5 px-2 rounded-md hover:bg-[var(--surface)] focus-visible:bg-[var(--surface)]"
                onMouseDown={(e) => { e.preventDefault(); load(r.symbol); }}
              >
                <b>{r.symbol}</b> {r.name} <small className="text-[var(--text-2)] ml-1.5">{r.exchange}</small>
              </button>
            ))}
          </div>
        )}
      </div>
      <button type="submit" className="rounded-full py-2 px-[18px] bg-[var(--navy)] border-[var(--navy)] text-white">Load</button>
    </form>
  );
}

/** Name, ticker, exchange, sector/industry chips and the latest price: stays on screen whichever tab is open. */
function CompanyHeader({ symbol, quote, watched, onToggleWatch }) {
  const { data: p, error } = useApi(`/api/profile/${encodeURIComponent(symbol)}`);
  const name = p?.name ?? symbol;
  const price = quote?.price ?? p?.price; // the polled quote once it arrives, else the hourly profile price
  const prev = quote?.previousClose ?? p?.previousClose;
  const change = price && prev ? (price / prev - 1) * 100 : null;
  const chips = p ? [['Sector', p.sector], ['Industry', p.industry], ['Country', p.country], ['Currency', p.currency], ['Market cap', p.marketCap ? big(p.marketCap) : null]] : [];
  return (
    <section
      className="max-w-[1200px] mx-auto grid grid-cols-[auto_1fr_auto] max-[640px]:grid-cols-[auto_1fr] items-center gap-x-5 gap-y-1 pt-3.5 pb-1"
      aria-label="Company"
    >
      <div className="w-16 h-16 rounded-full grid place-items-center text-[26px] font-bold text-[var(--brand)] bg-[var(--brand-soft)]" aria-hidden="true">
        {name.replace(/^the /i, '').slice(0, 1).toUpperCase()}
      </div>
      <div>
        <h2 className="m-0 text-[30px] max-[640px]:text-[22px] leading-[1.2] font-bold text-[var(--text)]">
          {name} <span className="ml-2 font-normal text-[var(--muted)]">{symbol}{p?.exchange ? ` ${p.exchange}` : ''}</span>
          <button
            type="button" aria-pressed={watched} onClick={onToggleWatch}
            title={watched ? 'Remove from watchlist' : 'Add to watchlist'} aria-label={watched ? 'Remove from watchlist' : 'Add to watchlist'}
            className={`ml-2 align-middle border-0 bg-transparent p-1 text-[24px] leading-none ${watched ? 'text-[#f5b301]' : 'text-[var(--muted)]'}`}
          >
            {watched ? '★' : '☆'}
          </button>
        </h2>
        <div className="flex flex-wrap gap-2 mt-2">
          {chips.filter(([, v]) => v).map(([label, v]) => (
            <span key={label} className="py-[3px] px-3 rounded-full bg-[var(--brand-soft)] text-[13px]">
              <small className="text-[var(--text-2)] mr-1">{label}</small> {v}
            </span>
          ))}
          {error && <span className="text-[13px] text-[var(--err)]">{error.message}</span>}
        </div>
      </div>
      {price != null && (
        <div className="text-right max-[640px]:text-left max-[640px]:col-span-full text-[13px]">
          <b className="text-[26px] font-semibold tabular-nums">{price.toLocaleString('en', { maximumFractionDigits: 2 })}</b> <small>{p?.currency ?? quote?.currency}</small>
          {change != null && (
            <div className={change >= 0 ? 'text-[var(--pos)]' : 'text-[var(--err)]'}>{change >= 0 ? '+' : ''}{change.toFixed(2)}% today</div>
          )}
          <QuoteBadge quote={quote} />
        </div>
      )}
    </section>
  );
}

/** "LIVE", "Delayed 15 min" or "Market closed", with the time of the last price in the viewer's own time zone. */
function QuoteBadge({ quote }) {
  if (!quote?.time) return null;
  const at = new Date(quote.time * 1000);
  const time = at.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', timeZoneName: 'short' }); // the viewer's clock, zone named
  if (!quote.live) {
    const day = at.toLocaleDateString([], { month: 'short', day: 'numeric' });
    return <div className="text-[var(--text-2)]">Market closed · last price {day} {time}</div>;
  }
  if (quote.delay) return <div className="text-[var(--text-2)]">Delayed {quote.delay} min · {time}</div>;
  return (
    <div className="text-[var(--pos)]">
      <span className="inline-block w-2 h-2 rounded-full bg-[var(--pos)] mr-1.5 animate-pulse" aria-hidden="true" />LIVE · {time}
    </div>
  );
}

export default function App() {
  const [symbol, setSymbol] = useState(initialSymbol);
  const [view, setView] = useState('home'); // 'home' landing page, or 'app' the dashboard
  const [tab, setTab] = useState('overview');
  const [sub, setSub] = useState('ev');
  const config = useApi('/api/config');
  const watch = useWatchlist();
  const quote = useQuote(view === 'app' ? symbol : null); // polled once here, shared by the header and the Overview chart

  const load = (s) => {
    setSymbol(s);
    setView('app');
    try {
      localStorage.setItem(LAST_SYMBOL, s);
    } catch { /* private mode: just don't remember it */ }
  };

  if (view === 'home') {
    return <Home onEnter={load} watch={watch} />;
  }

  // If /api/config fails the tabs still work; Finnhub features just stay off.
  const cfg = config.data ?? { finnhub: false };
  const Tab = VIEWS[tab === 'fundamentals' ? sub : tab];

  return (
    <>
      <header className="max-w-[1200px] mx-auto flex flex-wrap items-center justify-between gap-3 pt-5 pb-2">
        <button type="button" className="border-0 bg-transparent p-0 text-[24px] text-[var(--brand)] tracking-[-0.02em] font-bold" onClick={() => setView('home')}>
          QuantPlatform
        </button>
        <TickerBox initial={symbol} onLoad={load} />
      </header>

      <CompanyHeader symbol={symbol} quote={quote} watched={watch.has(symbol)} onToggleWatch={() => watch.toggle(symbol)} />

      <nav className="max-w-[1200px] mx-auto mt-3.5 mb-2">
        <div className="inline-flex flex-wrap rounded-full overflow-hidden bg-[var(--tabbar)] max-w-full" role="tablist">
          {TABS.map(([id, label]) => (
            <button
              key={id} role="tab" aria-selected={tab === id}
              className={`${TAB_BTN} ${tab === id ? TAB_BTN_ACTIVE : TAB_BTN_IDLE}`}
              onClick={() => setTab(id)}
            >
              {label}
            </button>
          ))}
        </div>
      </nav>
      {tab === 'fundamentals' && (
        <nav className="max-w-[1200px] mx-auto mb-3">
          <div className="flex flex-wrap gap-2" role="tablist" aria-label="Fundamentals">
            {FUNDAMENTALS.map(([id, label]) => (
              <button
                key={id} role="tab" aria-selected={sub === id}
                className={`${SUBTAB_BTN} ${sub === id ? SUBTAB_BTN_ACTIVE : SUBTAB_BTN_IDLE}`}
                onClick={() => setSub(id)}
              >
                {label}
              </button>
            ))}
          </div>
        </nav>
      )}

      <main className="max-w-[1200px] mx-auto mt-3">
        {tab === 'watchlist' ? (
          <Watchlist watch={watch} onOpen={(s) => { load(s); setTab('overview'); }} className="max-w-[720px]" />
        ) : config.loading ? (
          <p className="text-[var(--text-2)] py-6">Loading…</p>
        ) : (
          <Tab key={symbol} symbol={symbol} config={cfg} quote={quote} />
        )}
      </main>
    </>
  );
}
