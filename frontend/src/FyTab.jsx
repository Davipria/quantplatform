import { useCallback, useMemo, useState } from 'react';
import { useApi } from './api.js';
import Plot from './Plot.jsx';
import { DataTable, Seg, median, num, x } from './ui.jsx';

const RANGES = ['5Y', '10Y', '15Y', 'Max'];

/** Restrict to the range and compute headline stats. Dates are ISO strings, so they compare lexically. */
function summarise({ points, fiscalYears }, range) {
  let from = '';
  if (range !== 'Max') {
    const last = new Date(points.at(-1).date); // parsed as UTC
    from = new Date(Date.UTC(last.getUTCFullYear() - parseInt(range), last.getUTCMonth(), last.getUTCDate())).toISOString().slice(0, 10);
  }
  const view = points.filter((p) => p.date >= from);
  const values = view.map((p) => p.evEbitda).filter((v) => v != null);
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const now = values.at(-1);
  const lastDate = view.at(-1).date;
  return {
    view, now, from: view[0].date, lastDate,
    med: median(sorted), min: sorted[0], max: sorted.at(-1),
    markers: fiscalYears.filter((f) => f.date >= view[0].date && f.date <= lastDate),
    basis: fiscalYears.findLast((f) => f.date <= lastDate), // fiscal year whose EBITDA is in use today
  };
}

const Tile = ({ label, value, sub }) => (
  <div className="bg-[var(--surface)] rounded-lg py-3 px-3.5">
    <div className="text-[var(--text-2)] text-[13px]">{label}</div>
    <div className="text-2xl font-semibold tabular-nums">{value}</div>
    <div className="text-[var(--text-2)] text-xs">{sub}</div>
  </div>
);

function FyChart({ s }) {
  const build = useCallback((t) => {
    const rotate = s.markers.length > 14;
    return {
      data: [
        {
          x: s.view.map((p) => p.date), y: s.view.map((p) => p.evEbitda), name: 'EV / EBITDA', type: 'scatter', mode: 'lines',
          line: { color: t.series, width: 1.5 }, hovertemplate: '%{y:.1f}x<extra>EV / EBITDA</extra>',
        },
        {
          x: s.view.map((p) => p.date), y: s.view.map((p) => p.price), name: 'Stock price', type: 'scatter', mode: 'lines', yaxis: 'y2',
          line: { color: t.text, width: 1.5 }, hovertemplate: '%{y:,.2f}<extra>Stock price</extra>',
        },
      ],
      layout: {
        showlegend: true, legend: { orientation: 'h', x: 0.5, xanchor: 'center', y: -0.1 },
        margin: { l: 52, r: 56, t: 36, b: 48 },
        yaxis: { title: { text: 'EV / EBITDA' }, ticksuffix: 'x', rangemode: 'tozero' },
        yaxis2: { title: { text: 'Stock price' }, overlaying: 'y', side: 'right', showgrid: false, zeroline: false, rangemode: 'tozero' },
        shapes: s.markers.map((f) => ({
          type: 'line', xref: 'x', yref: 'paper', x0: f.date, x1: f.date, y0: 0, y1: 1,
          line: { color: t.muted, width: 1, dash: 'dot' },
        })),
        annotations: s.markers.map((f) => ({
          xref: 'x', yref: 'paper', x: f.date, y: 1, yanchor: 'bottom', showarrow: false, text: f.label,
          textangle: rotate ? -90 : 0, font: { size: 10, color: t.text2 }, bgcolor: t.surface, bordercolor: t.border, borderpad: 2,
        })),
      },
    };
  }, [s]);
  return <Plot build={build} />;
}

export default function FyTab({ symbol }) {
  const [range, setRange] = useState('10Y');
  const api = useApi(`/api/ev-ebitda-fy/${encodeURIComponent(symbol)}`);
  const s = useMemo(() => (api.data ? summarise(api.data, range) : null), [api.data, range]);

  if (api.loading) return <p className="text-[var(--text-2)] py-6">Loading…</p>;
  if (api.error) return <p className="text-[var(--err)] py-6">Could not build the fiscal-year EV/EBITDA for {symbol}: {api.error.message}</p>;
  if (!s) return <p className="text-[var(--text-2)] py-6">No positive EV/EBITDA available for {symbol}.</p>;

  const vsMedian = (s.now / s.med - 1) * 100;
  return (
    <>
      <div className="flex flex-wrap gap-4 mb-3">
        <Seg options={RANGES.map((r) => [r, r])} value={range} onChange={setRange} />
      </div>
      <div className="grid grid-cols-[repeat(auto-fit,minmax(150px,1fr))] gap-3 my-3">
        <Tile label="Current" value={x(s.now)} sub={s.lastDate} />
        <Tile label="Median" value={x(s.med)} sub={`${vsMedian >= 0 ? '+' : ''}${vsMedian.toFixed(0)}% vs median (${range})`} />
        <Tile label="Range" value={`${x(s.min)} – ${x(s.max)}`} sub={`since ${s.from}`} />
        <Tile label="EBITDA in use" value={s.basis?.label ?? '–'} sub={s.basis ? `${num(s.basis.ebitda)} M, year ended ${s.basis.date}` : ''} />
      </div>
      <FyChart s={s} />
      <details>
        <summary>Underlying data</summary>
        <p className="text-[var(--text-2)] text-[13px]">
          EV / EBITDA = (price × shares + net debt) ÷ EBITDA of the last completed fiscal year, so the multiple climbs through
          the year and drops at each dotted line, when the next year's EBITDA takes over. The switch happens on the fiscal
          year-end date although the figures are published 1–2 months later, so this view reflects hindsight. EBITDA, EV and net
          debt come from Finnhub (annual, millions); prices from yfinance. Finnhub gives no share count, so it is backed out of
          Finnhub's own EV: shares = (EV − net debt) ÷ close on the first trading day on or after the year end. This matches
          balance-sheet share counts to within about 0.2% for AAPL, NVDA and MSFT, and to a few percent for some others.
        </p>
        <DataTable
          headers={['Period end', 'FY', 'EBITDA', 'EV', 'Net debt', 'Shares (M)', 'EV / EBITDA at year end']}
          rows={api.data.fiscalYears.filter((f) => f.date >= s.from).reverse().map((f) => [
            f.date, f.label, num(f.ebitda), num(f.ev), num(f.netDebt), num(f.shares), f.ebitda > 0 ? x(f.ev / f.ebitda) : '–',
          ])}
        />
      </details>
    </>
  );
}
