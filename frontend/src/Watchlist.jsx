import { useEffect, useRef, useState } from 'react';
import { get, usePoll } from './api.js';

const STORE = 'quant.watchlist';
const DEFAULT_LIST = ['GOOG', 'TSM', 'BAYN.DE', 'UNI.MI', 'LUV', 'DAL', 'UAL']; // the owner's reference screenshot

// Ready-made lists: [symbol, display name] (Yahoo's own names for futures read "Gold Dec 26", for pairs "EUR/USD").
const PRESETS = {
  commodities: [
    ['GC=F', 'Gold'], ['SI=F', 'Silver'], ['PL=F', 'Platinum'], ['HG=F', 'Copper'], ['CL=F', 'Crude oil (WTI)'], ['BZ=F', 'Brent crude'],
    ['NG=F', 'Natural gas'], ['ZW=F', 'Wheat'], ['ZC=F', 'Corn'], ['KC=F', 'Coffee'],
  ],
  stocks: [
    ['NVDA'], ['AAPL'], ['MSFT'], ['GOOGL'], ['AMZN'], ['META'], ['AVGO'], ['TSLA'], ['TSM'], ['ASML'], ['SAP.DE'], ['005930.KS'],
  ],
  indices: [
    ['^GSPC', 'S&P 500'], ['^NDX', 'Nasdaq 100'], ['^DJI', 'Dow Jones'], ['^STOXX50E', 'Euro Stoxx 50'], ['^GDAXI', 'DAX'],
    ['FTSEMIB.MI', 'FTSE MIB'], ['^FTSE', 'FTSE 100'], ['^N225', 'Nikkei 225'], ['^HSI', 'Hang Seng'], ['^VIX', 'VIX'],
  ],
  currencies: [
    ['EURUSD=X', 'EUR / USD'], ['GBPUSD=X', 'GBP / USD'], ['USDJPY=X', 'USD / JPY'], ['USDCHF=X', 'USD / CHF'], ['EURCHF=X', 'EUR / CHF'],
    ['EURGBP=X', 'EUR / GBP'], ['AUDUSD=X', 'AUD / USD'], ['USDCAD=X', 'USD / CAD'], ['USDCNY=X', 'USD / CNY'],
  ],
  crypto: [
    ['BTC-USD', 'Bitcoin'], ['ETH-USD', 'Ethereum'], ['SOL-USD', 'Solana'], ['XRP-USD', 'XRP'], ['BNB-USD', 'BNB'], ['DOGE-USD', 'Dogecoin'],
    ['ADA-USD', 'Cardano'],
  ],
};
const LISTS = [['mine', 'My watchlist'], ['commodities', 'Commodities'], ['stocks', 'Stocks'], ['indices', 'Indices'], ['currencies', 'Currencies'], ['crypto', 'Crypto']];

/** The personal watchlist, remembered in this browser (localStorage); shared by the header star and the Watchlist view. */
export function useWatchlist() {
  const [list, setList] = useState(() => {
    try {
      const saved = JSON.parse(localStorage.getItem(STORE));
      return Array.isArray(saved) ? saved : DEFAULT_LIST;
    } catch {
      return DEFAULT_LIST;
    }
  });
  const save = (next) => {
    setList(next);
    try {
      localStorage.setItem(STORE, JSON.stringify(next));
    } catch { /* private mode: kept for this visit only */ }
  };
  return {
    list,
    has: (s) => list.includes(s),
    toggle: (s) => save(list.includes(s) ? list.filter((x) => x !== s) : [...list, s]),
    remove: (s) => save(list.filter((x) => x !== s)),
  };
}

// Refresh every minute while any market in the list is open (the backend keeps each row for 60 s), else every 5 minutes.
const pollSeconds = (rows) => (rows?.some((r) => r.open) ? 60 : 300);

function priceText(r) {
  if (r.type === 'CURRENCY') return r.price.toFixed(4);
  const digits = r.price < 1 ? 4 : 2;
  const n = r.price.toLocaleString('en', { minimumFractionDigits: digits, maximumFractionDigits: digits });
  if (r.type === 'INDEX' || !r.currency) return n; // an index is points, not dollars
  if (r.currency === 'GBp') return `${n}p`; // London quotes in pence; Intl would read it as pounds
  if (r.currency === 'USX') return `${n}¢`; // US cents (grain and coffee futures)
  try {
    const symbol = new Intl.NumberFormat('en', { style: 'currency', currency: r.currency, currencyDisplay: 'narrowSymbol' })
      .formatToParts(0).find((p) => p.type === 'currency').value;
    return `${n} ${symbol}`;
  } catch {
    return `${n} ${r.currency}`;
  }
}

/** Two sessions of 15-minute bars: the earlier one grey, the last one green or red (up or down on the previous close). */
function Sparkline({ values, split, up }) {
  const W = 100;
  const H = 34;
  const lo = Math.min(...values);
  const span = Math.max(...values) - lo || 1;
  const pt = (v, i) => `${((i / Math.max(values.length - 1, 1)) * W).toFixed(1)},${(H - 2 - ((v - lo) / span) * (H - 4)).toFixed(1)}`;
  const before = values.slice(0, split + 1).map(pt).join(' '); // shares its last point with the coloured part, so the line is unbroken
  const today = values.map(pt).slice(Math.max(split, 0)).join(' ');
  return (
    <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" className="w-full h-[34px] overflow-visible" aria-hidden="true">
      {split > 0 && <polyline points={before} fill="none" stroke="var(--muted)" strokeWidth="1.2" vectorEffect="non-scaling-stroke" />}
      <polyline points={today} fill="none" stroke={up ? 'var(--up)' : 'var(--down)'} strokeWidth="1.8" vectorEffect="non-scaling-stroke" />
    </svg>
  );
}

function Row({ symbol, name, row, onOpen, onRemove }) {
  const title = name ?? row?.name ?? symbol;
  const up = (row?.change ?? 0) >= 0;
  return (
    <li className="group relative">
      <button
        type="button" onClick={() => onOpen(symbol)}
        className="w-full grid grid-cols-[48px_minmax(0,1fr)_minmax(60px,110px)_auto] items-center gap-3 border-0 bg-transparent rounded-xl py-2.5 px-2 text-left hover:bg-[var(--surface)]"
      >
        <span className="relative w-12 h-12 rounded-xl grid place-items-center text-lg font-bold text-[var(--brand)] bg-[var(--brand-soft)]" aria-hidden="true">
          {title.replace(/^the /i, '').slice(0, 1).toUpperCase()}
          {row && !row.error && (
            <span className={`absolute -right-0.5 -bottom-0.5 w-3 h-3 rounded-full border-2 border-[var(--bg)] ${row.open ? 'bg-[var(--up)]' : 'bg-[var(--muted)]'}`} />
          )}
        </span>
        <span className="min-w-0">
          <span className="block truncate text-[17px] font-medium text-[var(--text)]">{title}</span>
          <span className="block text-[13px] font-semibold text-[var(--text-2)]">{symbol}</span>
        </span>
        <span className="min-w-0">{row?.spark?.length > 1 && <Sparkline values={row.spark} split={row.split} up={up} />}</span>
        <span className="text-right tabular-nums min-w-[96px]">
          {row?.error ? (
            <small className="text-[var(--err)]" title={row.error}>no data</small>
          ) : row ? (
            <>
              <span className="block text-[17px] font-medium text-[var(--text)]">{priceText(row)}</span>
              {row.change != null && (
                <span className={`block text-[13px] ${up ? 'text-[var(--up)]' : 'text-[var(--down)]'}`}>
                  {up ? '↗' : '↘'} {Math.abs(row.change).toFixed(2)}%
                </span>
              )}
            </>
          ) : (
            <small className="text-[var(--text-2)]">…</small>
          )}
        </span>
      </button>
      {onRemove && (
        <button
          type="button" aria-label={`Remove ${symbol}`} title="Remove from watchlist"
          className="absolute right-0 top-0 border-0 bg-[var(--bg)] rounded-full w-6 h-6 p-0 leading-none text-xs text-[var(--text-2)] opacity-0 group-hover:opacity-100 focus-visible:opacity-100"
          onClick={() => onRemove(symbol)}
        >
          ✕
        </button>
      )}
    </li>
  );
}

/** Search box that adds a company to the personal list (same search as the header). */
function AddBox({ onAdd }) {
  const [input, setInput] = useState('');
  const [results, setResults] = useState([]);
  useEffect(() => {
    const q = input.trim();
    if (q.length < 2) {
      setResults([]);
      return undefined;
    }
    let live = true;
    const timer = setTimeout(() => {
      get(`/api/compare/search?q=${encodeURIComponent(q)}`).then((r) => live && setResults(r), () => live && setResults([]));
    }, 300);
    return () => {
      live = false;
      clearTimeout(timer);
    };
  }, [input]);
  const add = (s) => {
    onAdd(s);
    setInput('');
    setResults([]);
  };
  const submit = (e) => {
    e.preventDefault();
    const typed = input.trim().toUpperCase();
    if (typed) add(results.find((r) => r.symbol === typed)?.symbol ?? results[0]?.symbol ?? typed);
  };
  return (
    <form onSubmit={submit} className="relative mt-2 px-2">
      <label htmlFor="watch-add" className="sr-only">Add to watchlist</label>
      <input
        id="watch-add" value={input} placeholder="+ Add a company, index, commodity…" autoComplete="off" spellCheck={false} maxLength={40}
        className="w-full rounded-full py-2 px-4 text-sm normal-case" onChange={(e) => setInput(e.target.value)}
      />
      {results.length > 0 && (
        <div className="absolute left-2 right-2 top-full z-10 mt-1 p-1 max-h-[280px] overflow-auto bg-[var(--bg)] border border-[var(--border)] rounded-xl shadow-[0_6px_20px_rgba(0,0,0,0.18)]" role="listbox">
          {results.map((r) => (
            <button
              key={r.symbol} type="button" role="option" onMouseDown={(e) => { e.preventDefault(); add(r.symbol); }}
              className="block w-full text-left border-0 bg-transparent py-1.5 px-2 rounded-md hover:bg-[var(--surface)]"
            >
              <b>{r.symbol}</b> {r.name} <small className="text-[var(--text-2)] ml-1.5">{r.exchange}</small>
            </button>
          ))}
        </div>
      )}
    </form>
  );
}

/** Watchlist card: list pills on top (My watchlist, Commodities, Indices, ...), one row per symbol with a status dot (market open or
 * closed), a two-session sparkline, the latest price and today's change. Clicking a row opens that symbol in the dashboard. */
export default function Watchlist({ watch, onOpen, className = '' }) {
  const [tab, setTab] = useState('mine');
  const pills = useRef(null);
  const items = tab === 'mine' ? watch.list.map((s) => [s]) : PRESETS[tab];
  const symbols = items.map(([s]) => s);
  const url = symbols.length ? `/api/watchlist?symbols=${symbols.map(encodeURIComponent).join(',')}` : null;
  const { data, error } = usePoll(url, pollSeconds);

  // Keep every row seen so far, so adding or removing a symbol (a new URL) does not blank the rows already on screen.
  const seen = useRef(new Map());
  data?.forEach((r) => seen.current.set(r.symbol, r));

  return (
    <section className={`bg-[var(--bg)] border border-[var(--border)] rounded-2xl p-3 ${className}`} aria-label="Watchlist">
      <div className="flex items-center gap-1">
        <button
          type="button" aria-label="Previous lists" className="shrink-0 border-0 bg-transparent px-2 text-lg text-[var(--text)]"
          onClick={() => pills.current?.scrollBy({ left: -160, behavior: 'smooth' })}
        >
          ‹
        </button>
        <div ref={pills} className="flex gap-1 overflow-x-auto [scrollbar-width:none]" role="tablist">
          {LISTS.map(([id, label]) => (
            <button
              key={id} type="button" role="tab" aria-selected={tab === id} onClick={() => setTab(id)}
              className={`shrink-0 border-0 rounded-xl py-2.5 px-4 text-[15px] ${tab === id ? 'bg-[var(--surface)] text-[var(--text)] font-semibold' : 'bg-transparent text-[var(--text-2)]'}`}
            >
              {label}
            </button>
          ))}
        </div>
        <button
          type="button" aria-label="More lists" className="shrink-0 border-0 bg-transparent px-2 text-lg text-[var(--text)]"
          onClick={() => pills.current?.scrollBy({ left: 160, behavior: 'smooth' })}
        >
          ›
        </button>
      </div>

      {error && !data && <p className="text-[var(--err)] text-sm px-2 mt-2">Could not load prices: {error}</p>}
      {tab === 'mine' && !symbols.length && (
        <p className="text-[var(--text-2)] text-sm px-2 mt-3">Your watchlist is empty. Add a company below, or with the ☆ next to a company's name.</p>
      )}
      <ul className="list-none m-0 mt-1 p-0">
        {items.map(([s, name]) => (
          <Row key={s} symbol={s} name={name} row={seen.current.get(s)} onOpen={onOpen} onRemove={tab === 'mine' ? watch.remove : null} />
        ))}
      </ul>
      {tab === 'mine' && <AddBox onAdd={(s) => !watch.has(s) && watch.toggle(s)} />}
      <p className="text-[11px] text-[var(--text-2)] px-2 mt-2 mb-0">
        Prices from Yahoo, refreshed every minute while a market is open (non-US exchanges are delayed 15-20 min). Green dot = market open.
      </p>
    </section>
  );
}
