import { useCallback, useMemo, useState } from 'react';
import { useApi } from './api.js';
import Plot from './Plot.jsx';
import { DataTable, Seg, median } from './ui.jsx';

const RANGES = [['5', '5Y'], ['10', '10Y'], ['15', '15Y'], ['all', 'Max']];
const MAX_COMPANIES = 6;
const pct = (v, d = 1) => `${v.toFixed(d)}%`;

/** Last N fiscal years plus the TTM bar; stats are over the fiscal years shown. */
function summarise({ years, ttm }, count) {
  const fy = count === 'all' ? years : years.slice(-Number(count));
  const bars = fy.map((p) => ({ x: p.date, label: p.date.slice(0, 4), value: p.value, ttm: false }));
  if (ttm) bars.push({ x: 'TTM', label: 'TTM', value: ttm.value, ttm: true });
  const values = fy.map((p) => p.value);
  return { bars, fyCount: fy.length, med: median([...values].sort((a, b) => a - b)), latest: values.at(-1), from: fy[0].date };
}

function RoicChart({ s }) {
  const build = useCallback((t) => {
    const values = s.bars.map((b) => b.value);
    const top = Math.max(...values, 0) * 1.15;
    const bottom = Math.min(...values, 0) * 1.15;
    return {
      data: [{
        type: 'bar', x: s.bars.map((b) => b.x), y: values, customdata: s.bars.map((b) => b.label),
        marker: { color: t.series, opacity: s.bars.map((b) => (b.ttm ? 0.5 : 1)) },
        text: s.bars.length <= 12 ? values.map((v) => pct(v)) : undefined, textposition: 'outside', cliponaxis: false,
        textfont: { size: 11, color: t.text }, hovertemplate: '%{customdata}: %{y:.1f}%<extra></extra>',
      }],
      layout: {
        hovermode: 'closest', margin: { l: 48, r: 8, t: 16, b: 32 },
        xaxis: { type: 'category', tickmode: 'array', tickvals: s.bars.map((b) => b.x), ticktext: s.bars.map((b) => b.label) },
        yaxis: { ticksuffix: '%', range: [bottom, top] },
      },
    };
  }, [s]);
  return <Plot build={build} className="h-[340px]" />;
}

function RoicCard({ symbol, count, onRemove }) {
  const api = useApi(`/api/roic/${encodeURIComponent(symbol)}`);
  const s = useMemo(() => (api.data ? summarise(api.data, count) : null), [api.data, count]);

  let body;
  if (api.loading) body = <p className="text-[var(--text-2)] py-6">Loading…</p>;
  else if (api.error) body = <p className="text-[var(--err)] py-6">Could not load ROIC for {symbol}: {api.error.message}</p>;
  else {
    const { ttm, finnhubTtm } = api.data;
    const rows = [
      ...api.data.years.filter((p) => p.date >= s.from).reverse().map((p) => [p.date, 'Fiscal year (Finnhub)', pct(p.value)]),
      ...(ttm ? [[ttm.date, 'TTM (computed from yfinance quarterlies)', pct(ttm.value)]] : []),
      ...(finnhubTtm ? [[finnhubTtm.date,'TTM (Finnhub, different basis)', pct(finnhubTtm.value)]] : []),
    ];
    body = (
      <>
        <p className="text-[var(--text-2)] text-[13px]">
          {ttm ? `TTM ${pct(ttm.value)} · ` : 'TTM not available · '}latest fiscal year {pct(s.latest)} · median of {s.fyCount} fiscal years {pct(s.med)}
        </p>
        <RoicChart s={s} />
        <details>
          <summary>Underlying data</summary>
          <DataTable headers={['Period end', 'Basis', 'ROIC']} rows={rows} />
        </details>
      </>
    );
  }

  return (
    <div>
      <div className="flex items-baseline justify-between gap-3">
        <h2 className="mt-3 mb-1">{symbol}</h2>
        {onRemove && <button className="border-0 bg-transparent p-0 text-[var(--text-2)] underline" onClick={onRemove}>Remove</button>}
      </div>
      {body}
    </div>
  );
}

export default function RoicTab({ symbol }) {
  const [count, setCount] = useState('10');
  const [extra, setExtra] = useState([]);
  const [input, setInput] = useState('');

  const add = (e) => {
    e.preventDefault();
    const next = input.toUpperCase().split(/[\s,;]+/).filter((t) => /^[A-Z0-9.^=-]{1,15}$/.test(t));
    setExtra((cur) => [...new Set([...cur, ...next])].filter((t) => t !== symbol).slice(0, MAX_COMPANIES - 1));
    setInput('');
  };

  return (
    <>
      <div className="flex flex-wrap gap-4 mb-3">
        <Seg options={RANGES} value={count} onChange={setCount} />
        <form className="flex items-center gap-2" onSubmit={add}>
          <label htmlFor="compare">Compare with</label>
          <input id="compare" className="w-[150px]" value={input} onChange={(e) => setInput(e.target.value)} placeholder="e.g. MA, PYPL" autoComplete="off" spellCheck={false} />
          <button type="submit">Add</button>
        </form>
      </div>

      <div className="grid grid-cols-[repeat(auto-fit,minmax(min(480px,100%),1fr))] gap-6">
        <RoicCard symbol={symbol} count={count} />
        {extra.map((t) => <RoicCard key={t} symbol={t} count={count} onRemove={() => setExtra((cur) => cur.filter((x) => x !== t))} />)}
      </div>

      <p className="text-[var(--text-2)] text-[13px]">
        ROIC = NOPAT ÷ invested capital: how much operating profit a company earns on the money invested in it. Fiscal-year bars are
        Finnhub's annual ROIC (roughly NOPAT ÷ (equity + debt)). The lighter TTM bar is computed here on the same basis from yfinance
        quarterlies: 4-quarter operating income × (1 − effective tax rate) ÷ (equity + total debt) at the latest quarter. Data providers
        define invested capital differently, so absolute levels differ between tools (Forecaster, Bloomberg, …): compare companies and
        trends within one tool. Banks and insurers are not meaningful here.
      </p>
    </>
  );
}
