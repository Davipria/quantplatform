import { useEffect, useState } from 'react';
import { get } from './api.js';
import Watchlist from './Watchlist.jsx';

const EXAMPLES = ['AAPL', 'MSFT', 'NVDA'];

/** Landing page: centered logo + search, shown before a company is chosen. No sign-in, no plans. */
export default function Home({ onEnter, watch }) {
  const [input, setInput] = useState('');
  const [results, setResults] = useState([]);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    const q = input.trim();
    if (!open || q.length < 2) {
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
  }, [input, open]);

  const enter = async (symbol) => {
    setOpen(false);
    onEnter(symbol);
  };

  const submit = async (e) => {
    e.preventDefault();
    const q = input.trim();
    if (!q) return;
    const typed = q.toUpperCase();
    let list = results;
    if (!list.length) {
      try {
        list = await get(`/api/compare/search?q=${encodeURIComponent(q)}`);
      } catch {
        list = [];
      }
    }
    enter(list.find((r) => r.symbol === typed)?.symbol ?? list[0]?.symbol ?? typed);
  };

  return (
    <div className="min-h-[80vh] flex flex-col items-center pt-[12vh] px-4">
      <div className="flex items-center gap-3">
        <div className="w-14 h-14 rounded-full grid place-items-center text-2xl font-bold text-[var(--brand)] bg-[var(--brand-soft)]" aria-hidden="true">
          Q
        </div>
        <h1 className="text-[40px] font-bold tracking-[-0.02em] text-[var(--text)]">QuantPlatform</h1>
      </div>
      <p className="mt-1 text-[var(--text-2)] text-[15px]">Fundamentals, ratios and valuation — in one place.</p>

      <form onSubmit={submit} className="mt-8 w-full max-w-[560px] flex-col items-stretch gap-0">
        <label htmlFor="home-search" className="sr-only">Company or ticker</label>
        <div className="relative w-full">
          <input
            id="home-search" value={input} placeholder="Search company or ticker…" autoComplete="off" spellCheck={false} maxLength={40}
            className="w-full rounded-full py-3.5 pl-12 pr-11 text-base normal-case shadow-[0_1px_6px_rgba(0,0,0,0.08)]"
            onChange={(e) => { setInput(e.target.value); setOpen(true); }}
            onFocus={() => setOpen(true)}
            onBlur={() => setTimeout(() => setOpen(false), 100)}
          />
          <span aria-hidden="true" className="absolute left-4 top-1/2 -translate-y-1/2 text-[var(--text-2)] text-lg pointer-events-none">🔍</span>
          {input && (
            <button
              type="button" aria-label="Clear"
              className="absolute right-2.5 top-1/2 -translate-y-1/2 border-0 bg-transparent p-1.5 rounded-full text-[var(--text-2)] leading-none"
              onMouseDown={(e) => { e.preventDefault(); setInput(''); setResults([]); }}
            >
              ✕
            </button>
          )}
          {open && results.length > 0 && (
            <div className="absolute top-full left-0 w-full z-10 mt-1.5 p-1 max-h-[320px] overflow-auto bg-[var(--bg)] border border-[var(--border)] rounded-2xl shadow-[0_6px_20px_rgba(0,0,0,0.18)] text-left" role="listbox">
              {results.map((r) => (
                <button
                  key={r.symbol} type="button" role="option"
                  className="block w-full text-left border-0 bg-transparent py-2 px-3 rounded-xl hover:bg-[var(--surface)] focus-visible:bg-[var(--surface)]"
                  onMouseDown={(e) => { e.preventDefault(); enter(r.symbol); }}
                >
                  <b>{r.symbol}</b> {r.name} <small className="text-[var(--text-2)] ml-1.5">{r.exchange}</small>
                </button>
              ))}
            </div>
          )}
        </div>
      </form>

      <p className="mt-3 text-[13px] text-[var(--text-2)]">
        Try{' '}
        {EXAMPLES.map((s, i) => (
          <span key={s}>
            {i > 0 && ', '}
            <button type="button" className="border-0 bg-transparent p-0 text-[var(--brand)] underline" onClick={() => enter(s)}>{s}</button>
          </span>
        ))}
      </p>

      <Watchlist watch={watch} onOpen={enter} className="mt-10 w-full max-w-[560px]" />
    </div>
  );
}
