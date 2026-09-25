import { useCallback, useMemo, useState } from 'react';
import { useApi } from './api.js';
import Plot from './Plot.jsx';
import { DataTable, Seg } from './ui.jsx';

const PCT = new Set(['Gross margin', 'Operating margin', 'Net margin', 'ROE']);

function RatioChart({ name, years, values }) {
  const pct = PCT.has(name);
  const build = useCallback((t) => ({
    data: [{
      x: years, y: values, type: 'bar', marker: { color: t.series },
      hovertemplate: pct ? '%{y:.1%}<extra></extra>' : '%{y:.2f}x<extra></extra>',
    }],
    layout: {
      title: { text: name, x: 0, font: { size: 14, color: t.text } },
      margin: { l: 44, r: 8, t: 36, b: 28 },
      xaxis: { type: 'category' }, yaxis: { tickformat: pct ? '.0%' : '.1f' },
    },
  }), [name, years, values, pct]);
  return <Plot build={build} className="h-[240px]" />;
}

function FinnhubChart({ metric, points }) {
  const build = useCallback((t) => ({
    data: [{
      x: points.map((p) => p.period), y: points.map((p) => p.v), type: 'scatter', mode: 'lines+markers',
      line: { color: t.series, width: 2 }, marker: { size: 5 },
      hovertemplate: '%{y:,.3f}<extra></extra>',
    }],
    layout: { yaxis: { title: { text: metric } } },
  }), [metric, points]);
  return <Plot build={build} />;
}

function FinnhubSection({ symbol }) {
  const [freq, setFreq] = useState('annual');
  const [metric, setMetric] = useState(null);
  const fh = useApi(`/api/finnhub/${encodeURIComponent(symbol)}?freq=${freq}`);
  const names = useMemo(() => (fh.data ? Object.keys(fh.data) : []), [fh.data]);
  const active = names.includes(metric) ? metric : (names.find((n) => /^pe/.test(n)) ?? names[0]);
  const points = useMemo(() => (active ? fh.data[active].filter((p) => p.v != null) : []), [fh.data, active]);

  const table = useMemo(() => {
    if (!fh.data) return null;
    const periods = [...new Set(names.flatMap((n) => fh.data[n].map((p) => p.period)))].sort().reverse();
    const lookup = Object.fromEntries(names.map((n) => [n, new Map(fh.data[n].map((p) => [p.period, p.v]))]));
    return {
      headers: ['Period', ...names],
      rows: periods.map((p) => [p, ...names.map((n) => { const v = lookup[n].get(p); return v == null ? '' : +v.toPrecision(5); })]),
    };
  }, [fh.data, names]);

  if (fh.error) return <p className="text-[var(--err)]">Finnhub request failed: {fh.error.message}</p>;
  if (fh.loading) return <p className="text-[var(--text-2)] py-6">Loading…</p>;
  return (
    <>
      <div className="flex flex-wrap gap-4 mb-3">
        <Seg options={[['annual', 'Annual'], ['quarterly', 'Quarterly']]} value={freq} onChange={setFreq} />
        {names.length > 0 && (
          <select aria-label="Metric" value={active} onChange={(e) => setMetric(e.target.value)}>
            {names.map((n) => <option key={n}>{n}</option>)}
          </select>
        )}
      </div>
      {names.length === 0 ? (
        <p className="text-[var(--text-2)] text-[13px]">Finnhub returned no {freq} series for {symbol}.</p>
      ) : (
        <>
          <FinnhubChart metric={active} points={points} />
          <details>
            <summary>All Finnhub series</summary>
            <DataTable {...table} />
          </details>
        </>
      )}
    </>
  );
}

export default function RatiosTab({ symbol, config }) {
  const ratios = useApi(`/api/yfinance/ratios/${encodeURIComponent(symbol)}`);
  const years = useMemo(() => ratios.data?.periods.map((p) => p.slice(0, 4)), [ratios.data]);

  if (ratios.error) return <p className="text-[var(--err)] py-6">Could not load ratios for {symbol}: {ratios.error.message}</p>;
  if (ratios.loading) return <p className="text-[var(--text-2)] py-6">Loading…</p>;

  const { ratios: byName } = ratios.data;
  const names = Object.keys(byName);
  const fmt = (n, v) => (v == null ? '–' : PCT.has(n) ? `${(v * 100).toFixed(1)}%` : v.toFixed(2));

  return (
    <>
      <h2>Fiscal-year ratios (yfinance statements)</h2>
      <div className="grid grid-cols-[repeat(auto-fill,minmax(320px,1fr))] gap-4">
        {names.map((n) => <RatioChart key={n} name={n} years={years} values={byName[n]} />)}
      </div>
      <details>
        <summary>Table</summary>
        <DataTable headers={['Ratio', ...years]} rows={names.map((n) => [n, ...byName[n].map((v) => fmt(n, v))])} />
      </details>

      <h2>Finnhub reported series</h2>
      {config.finnhub
        ? <FinnhubSection symbol={symbol} />
        : <p className="text-[var(--text-2)] text-[13px]">Set FINNHUB_API_KEY in the .env file to enable this section.</p>}
    </>
  );
}
