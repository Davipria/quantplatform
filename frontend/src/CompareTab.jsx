import { useCallback, useEffect, useMemo, useState } from 'react';
import { useApi } from './api.js';
import Plot from './Plot.jsx';
import { COLUMNS, cap, useRows } from './rows.js';
import {
  BEST_CELL, MUTED, SCORE_CELL, SCORE_FIRST_CELL, SCORE_HEAD_CELL, SCORE_SMALL, SCORE_TABLE, Seg,
} from './ui.jsx';

const MAX = 6; // companies in a comparison
const YEARS = [['1', '1Y'], ['3', '3Y'], ['5', '5Y'], ['10', '10Y']];
const CHARTED = ['evEbitda', 'roic', 'fcfYield', 'peg', 'altman', 'piotroski'];
const METRICS = COLUMNS.filter((c) => CHARTED.includes(c.key));
const dot = (slot) => ({ background: `var(--cat-${slot + 1})` }); // each company keeps its colour everywhere
const pctChange = (v) => `${v >= 0 ? '+' : ''}${v.toFixed(1)}%`;

function PerformanceChart({ data, all, slotOf }) {
  const build = useCallback((t) => ({
    data: all.map((s) => ({
      type: 'scatter', mode: 'lines', name: s, x: data.dates, y: data.series[s],
      line: { color: t.palette[slotOf(s)], width: 1.8 }, hovertemplate: `${s}: %{y:.1f}<extra></extra>`,
    })),
    layout: {
      margin: { l: 52, r: 16, t: 16, b: 32 }, yaxis: { title: { text: 'Price, rebased to 100' } },
      shapes: [{ type: 'line', xref: 'paper', x0: 0, x1: 1, y0: 100, y1: 100, line: { color: t.muted, width: 1, dash: 'dot' } }],
    },
  }), [data, all, slotOf]);
  return <Plot build={build} />;
}

const CHIP_ON = 'inline-flex items-center gap-2 py-1.5 px-3.5 border border-[var(--text-2)] rounded-full cursor-pointer';
const CHIP_X = 'border-0 bg-transparent text-[var(--text-2)] pl-1 text-base leading-none cursor-pointer';

function MetricChart({ metric, entries }) {
  const build = useCallback((t) => {
    const values = entries.map((e) => e.value).filter((v) => v != null);
    return {
      data: [{
        type: 'bar', x: entries.map((e) => e.symbol), y: entries.map((e) => e.value),
        marker: { color: entries.map((e) => t.palette[e.slot]) },
        text: entries.map((e) => (e.value == null ? '' : metric.fmt(e.value))), textposition: 'outside', cliponaxis: false,
        textfont: { size: 11, color: t.text }, hovertemplate: '%{x}: %{text}<extra></extra>',
      }],
      layout: {
        title: { text: `${metric.label} · ${metric.better === 'low' ? 'lower is better' : 'higher is better'}`, x: 0, font: { size: 13, color: t.text } },
        hovermode: 'closest', margin: { l: 44, r: 8, t: 36, b: 36 }, xaxis: { type: 'category' },
        yaxis: { range: [Math.min(...values, 0) * 1.25, (Math.max(...values, 0) || 1) * 1.25] },
      },
    };
  }, [metric, entries]);
  return <Plot build={build} className="h-[230px]" />;
}

const STORE = 'quant.compare';

const freeSlot = (slots) => {
  const used = new Set(Object.values(slots));
  let i = 0;
  while (used.has(i)) i++;
  return i;
};

/** The comparison survives switching tabs and reloading the page. The stock loaded in the header is added the first time it is loaded. */
function initialState(symbol) {
  let saved = {};
  try {
    saved = JSON.parse(localStorage.getItem(STORE)) ?? {};
  } catch { /* nothing saved yet */ }
  let list = Array.isArray(saved.list) ? saved.list : [];
  let slots = saved.slots ?? {};
  if (saved.lastSymbol !== symbol && !list.includes(symbol) && list.length < MAX) {
    slots = { ...slots, [symbol]: freeSlot(slots) };
    list = [...list, symbol];
  }
  return { list, slots };
}

export default function CompareTab({ symbol }) {
  const [state, setState] = useState(() => initialState(symbol)); // { list: [tickers], slots: { ticker: colour slot } }
  const [focus, setFocus] = useState(null); // whose competitors to suggest
  const [years, setYears] = useState('5');
  const [query, setQuery] = useState('');
  const [submitted, setSubmitted] = useState('');

  useEffect(() => {
    try {
      localStorage.setItem(STORE, JSON.stringify({ ...state, lastSymbol: symbol }));
    } catch { /* private mode: the comparison just is not remembered */ }
  }, [state, symbol]);

  const all = state.list;
  const slotOf = useCallback((s) => state.slots[s] ?? 0, [state.slots]);
  const full = all.length >= MAX;
  const suggestFor = all.includes(focus) ? focus : all.includes(symbol) ? symbol : all[0]; // default: the stock loaded in the header

  const suggestions = useApi(suggestFor ? `/api/compare/suggest/${encodeURIComponent(suggestFor)}` : null);
  const found = useApi(submitted ? `/api/compare/search?q=${encodeURIComponent(submitted)}` : null);
  const companies = useMemo(() => all.map((s) => ({ symbol: s })), [all]);
  const rows = useRows(companies);
  const prices = useApi(all.length >= 2 ? `/api/compare/prices?symbols=${all.map(encodeURIComponent).join(',')}&years=${years}` : null);

  const add = (raw) => setState((cur) => {
    const s = raw.toUpperCase();
    if (cur.list.includes(s) || cur.list.length >= MAX) return cur;
    return { list: [...cur.list, s], slots: { ...cur.slots, [s]: freeSlot(cur.slots) } };
  });
  const remove = (s) => setState((cur) => {
    const { [s]: _gone, ...slots } = cur.slots;
    return { list: cur.list.filter((x) => x !== s), slots };
  });
  const search = (e) => {
    e.preventDefault();
    setSubmitted(query.trim());
  };

  const charts = useMemo(() => METRICS.map((metric) => ({
    metric,
    entries: all.map((s) => ({ symbol: s, value: rows[s] && !rows[s].failed ? rows[s][metric.key] : null, slot: slotOf(s) })),
  })), [all, rows, slotOf]);

  // best value of each column among the companies loaded so far
  const best = useMemo(() => Object.fromEntries(COLUMNS.filter((c) => c.better).map((c) => {
    const vals = all.map((s) => rows[s]?.[c.key]).filter((v) => v != null);
    return [c.key, vals.length < 2 ? null : c.better === 'low' ? Math.min(...vals) : Math.max(...vals)];
  })), [all, rows]);

  const nameOf = (s) => rows[s]?.name ?? '';

  return (
    <>
      <h2>Compare companies</h2>

      <div className="flex flex-wrap gap-2.5 mt-2.5 mb-1" aria-label="Companies in the comparison">
        {all.map((s) => (
          <span key={s} className={CHIP_ON}>
            <span className="inline-block w-2.5 h-2.5 rounded-full" style={dot(slotOf(s))} />
            <b>{s}</b> <span className="text-[var(--text-2)] font-normal">{nameOf(s)}</span>
            <button className={CHIP_X} aria-label={`Remove ${s}`} onClick={() => remove(s)}>×</button>
          </span>
        ))}
        {all.length > 0 && <button className="border-0 bg-transparent p-0 text-[var(--text-2)] underline" onClick={() => setState({ list: [], slots: {} })}>Clear all</button>}
      </div>
      <p className="text-[var(--text-2)] text-[13px]">
        {all.length} of {MAX} companies{full ? ': the maximum, remove one to add another' : ''}. Choose any companies you like: search by name or
        ticker, or start from the suggestions. The stock loaded in the box at the top is added the first time you load it, and you can remove it.
      </p>

      <form className="flex items-center gap-2" onSubmit={search}>
        <label htmlFor="cmp-search">Find a company</label>
        <input id="cmp-search" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="name or ticker, e.g. samsung" autoComplete="off" spellCheck={false} style={{ width: 260, textTransform: 'none' }} />
        <button type="submit">Search</button>
      </form>
      {submitted && (
        <div className="flex flex-wrap gap-2 mt-1.5 mb-3">
          {found.loading && <span className="text-[var(--text-2)] font-normal">Searching…</span>}
          {found.error && <span className="text-[var(--err)]">{found.error.message}</span>}
          {found.data?.length === 0 && <span className="text-[var(--text-2)] font-normal">No company found for “{submitted}”.</span>}
          {found.data?.map((r) => (
            <button key={r.symbol} className="inline-flex flex-col items-start text-left py-1.5 px-3 disabled:opacity-45 disabled:cursor-default" disabled={all.includes(r.symbol) || full} onClick={() => add(r.symbol)}>
              + {r.symbol} · {r.name}<small className="text-[var(--text-2)] text-[11px]">{r.exchange}</small>
            </button>
          ))}
        </div>
      )}

      {suggestFor && (
        <div className="flex flex-wrap gap-4 mb-3">
          <label className="inline-flex items-center gap-1.5 text-[var(--text-2)]">
            Suggest companies to compare with
            <select aria-label="Suggest competitors of" value={suggestFor} onChange={(e) => setFocus(e.target.value)}>
              {all.map((s) => <option key={s} value={s}>{s}{nameOf(s) ? ` · ${nameOf(s)}` : ''}</option>)}
            </select>
          </label>
        </div>
      )}
      {!suggestFor && <p className="text-[var(--text-2)] py-6">Search for a company above to start; suggestions of competitors then appear here.</p>}
      {suggestions.loading && <p className="text-[var(--text-2)] py-6">Looking for competitors of {suggestFor}…</p>}
      {suggestions.error && <p className="text-[var(--err)] py-6">Could not suggest companies: {suggestions.error.message}</p>}
      {suggestions.data?.groups.map((g) => (
        <div key={g.id}>
          <h3>{g.title}</h3>
          <div className="flex flex-wrap gap-2 mt-1.5 mb-3">
            {g.items.map((p) => (
              <button key={p.symbol} className="inline-flex flex-col items-start text-left py-1.5 px-3 disabled:opacity-45 disabled:cursor-default" disabled={all.includes(p.symbol) || full} onClick={() => add(p.symbol)}>
                + {p.symbol} · {p.name}
                <small className="text-[var(--text-2)] text-[11px]">{[p.marketCapUsd ? `$${cap(p.marketCapUsd)}` : null, p.exchange, p.country].filter(Boolean).join(' · ')}</small>
              </button>
            ))}
          </div>
        </div>
      ))}

      {all.length === 0 ? null : (
        <>
          {all.length < 2 && <p className="text-[var(--text-2)] py-6">Add at least one more company to compare prices and see the charts side by side.</p>}
          {all.length >= 2 && (
            <>
              <h2>Price performance</h2>
              <div className="flex flex-wrap gap-4 mb-3">
                <Seg options={YEARS} value={years} onChange={setYears} />
              </div>
              {prices.loading && <p className="text-[var(--text-2)] py-6">Loading prices…</p>}
              {prices.error && <p className="text-[var(--err)] py-6">Could not compare prices: {prices.error.message}</p>}
              {prices.data && (
                <>
                  <PerformanceChart data={prices.data} all={all} slotOf={slotOf} />
                  <p className="text-[var(--text-2)] text-[13px]">Each stock in its own trading currency (no FX conversion), rebased to 100 on {prices.data.start}, the first day all of them have data.</p>
                </>
              )}
            </>
          )}

          <h2>Side by side</h2>
          <div className="grid grid-cols-[repeat(auto-fill,minmax(min(300px,100%),1fr))] gap-4">
            {charts.map(({ metric, entries }) => <MetricChart key={metric.key} metric={metric} entries={entries} />)}
          </div>

          <div className="overflow-x-auto border border-[var(--border)] rounded-lg" style={{ marginTop: 16 }}>
            <table className={SCORE_TABLE}>
              <thead>
                <tr>
                  <th className={`${SCORE_CELL} ${SCORE_HEAD_CELL} ${SCORE_FIRST_CELL} min-w-[300px] bg-[var(--surface)]`}>Company</th>
                  <th className={`${SCORE_CELL} ${SCORE_HEAD_CELL}`}>Price change<small className={SCORE_SMALL}>{years} years</small></th>
                  {COLUMNS.map((c) => (
                    <th key={c.key} className={`${SCORE_CELL} ${SCORE_HEAD_CELL}`}>{c.label}<small className={SCORE_SMALL}>{c.better === 'low' ? 'lower is better' : c.better === 'high' ? 'higher is better' : ' '}</small></th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {all.map((s) => {
                  const r = rows[s];
                  return (
                    <tr key={s}>
                      <th scope="row" className={`${SCORE_CELL} ${SCORE_FIRST_CELL} min-w-[300px]`}><span className="inline-block w-2.5 h-2.5 rounded-full" style={dot(slotOf(s))} /> <b>{s}</b> <span className={MUTED}>{r?.name ?? ''}</span></th>
                      <td className={SCORE_CELL}>{prices.data?.totalReturn?.[s] == null ? '–' : pctChange(prices.data.totalReturn[s])}</td>
                      {!r && <td colSpan={COLUMNS.length} className={`${SCORE_CELL} ${MUTED}`}>loading…</td>}
                      {r?.failed && <td colSpan={COLUMNS.length} className={`${SCORE_CELL} ${MUTED}`}>could not load: {r.failed}</td>}
                      {r && !r.failed && COLUMNS.map((c) => (
                        <td key={c.key} className={`${SCORE_CELL} ${best[c.key] != null && r[c.key] === best[c.key] ? BEST_CELL : ''}`}
                          title={r.errors?.[c.key] ?? (['altman', 'piotroski', 'beneish'].includes(c.key) ? r.errors?.solidity : undefined)}>
                          {r[c.key] == null ? '–' : c.fmt(r[c.key])}
                        </td>
                      ))}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </>
      )}

      <p className="text-[var(--text-2)] text-[13px]">
        Suggestions come from Yahoo Finance: companies of the same industry worldwide (largest first; Yahoo files Apple, Samsung, Sony and
        Xiaomi under one industry), the stocks people often view together with this one, and the largest companies of the same sector.
        Every figure is the one the matching tab shows (bold = best in this comparison). Companies without US filings, such as Samsung or
        Sony, use figures computed from their yfinance statements where possible; a dash means the figure does not exist or cannot be
        compared (hover it for the reason): for instance a US-listed receipt of a foreign company reports in another currency than its
        price, banks have no EBITDA, and SEC-based scores exist only for US filers. It is a way to understand differences, not a buy or sell signal.
      </p>
    </>
  );
}
