import { useCallback } from 'react';
import { useApi } from './api.js';
import Plot from './Plot.jsx';
import { DataTable } from './ui.jsx';

const f2 = (v) => (v == null ? '–' : v.toFixed(2));
const f1 = (v) => (v == null ? '–' : v.toFixed(1));
const zone = (peg) => (peg == null ? 'not meaningful' : peg < 1 ? 'Below 1: growth looks cheap' : peg <= 2 ? '1 to 2: priced in line with growth' : 'Above 2: expensive for its growth');

const Tile = ({ label, value, sub }) => (
  <div className="bg-[var(--surface)] rounded-lg py-3 px-3.5">
    <div className="text-[var(--text-2)] text-[13px]">{label}</div>
    <div className="text-2xl font-semibold tabular-nums">{value}</div>
    <div className="text-[var(--text-2)] text-xs">{sub}</div>
  </div>
);

function PegChart({ periods }) {
  const build = useCallback((t) => {
    const values = periods.map((p) => p.peg);
    const top = Math.max(...values.filter((v) => v != null), 1) * 1.25;
    return {
      data: [{
        type: 'bar', x: periods.map((p) => `${p.label}e`), y: values, width: 0.42, marker: { color: t.series },
        text: values.map((v) => (v == null ? '' : v.toFixed(2))), textposition: 'outside', cliponaxis: false, textfont: { size: 12, color: t.text },
        hovertemplate: '%{x}: PEG %{y:.2f}<extra></extra>',
      }],
      layout: {
        hovermode: 'closest', margin: { l: 52, r: 16, t: 24, b: 36 },
        xaxis: { type: 'category' }, yaxis: { range: [0, top] },
        shapes: [{ type: 'line', xref: 'paper', x0: 0, x1: 1, y0: 1, y1: 1, line: { color: t.muted, width: 1, dash: 'dot' } }],
        annotations: [{ xref: 'paper', x: 1, y: 1, xanchor: 'right', yanchor: 'bottom', showarrow: false, text: 'PEG 1: price in line with growth', font: { size: 10, color: t.text2 } }],
      },
    };
  }, [periods]);
  return <Plot build={build} />;
}

export default function PegTab({ symbol }) {
  const api = useApi(`/api/peg/${encodeURIComponent(symbol)}`);
  if (api.loading) return <p className="text-[var(--text-2)] py-6">Loading…</p>;
  if (api.error) return <p className="text-[var(--err)] py-6">Could not compute the PEG ratio for {symbol}: {api.error.message}</p>;

  const { periods, reference, price, currency, warning } = api.data;
  const [cur, next] = [periods[0], periods[1]];
  const read = next?.peg != null ? next : cur; // the reading follows next year's PEG when it exists
  const peTile = (p) => (p ? `P/E ${f1(p.pe)} ÷ growth ${f1(p.growthPct)}%` : '');

  return (
    <>
      <h2>{symbol} · PEG ratio</h2>
      {warning && <div className="py-[10px] px-3.5 rounded-lg my-2 bg-[var(--warn-bg)] text-[var(--warn-text)]">{warning}</div>}
      <div className="grid grid-cols-[repeat(auto-fit,minmax(150px,1fr))] gap-3 my-3">
        <Tile label="Price" value={price.toLocaleString('en', { maximumFractionDigits: 2 })} sub={currency ?? ''} />
        <Tile label={`PEG ${cur.label}e`} value={f2(cur.peg)} sub={cur.peg == null ? cur.note : peTile(cur)} />
        {next && <Tile label={`PEG ${next.label}e`} value={f2(next.peg)} sub={next.peg == null ? next.note : peTile(next)} />}
        <Tile label={`Reading (${read.label}e)`} value={read.peg == null ? '–' : read.peg < 1 ? 'PEG < 1' : read.peg <= 2 ? 'PEG 1–2' : 'PEG > 2'} sub={zone(read.peg)} />
      </div>

      <PegChart periods={periods} />

      <h2>Inputs</h2>
      <DataTable
        headers={['Fiscal year', 'EPS estimate', 'Low – high', 'Analysts', 'Prior-year EPS', 'Expected EPS growth', 'P/E', 'PEG']}
        rows={periods.map((p) => [
          `${p.label}e`, f2(p.epsAvg), `${f2(p.epsLow)} – ${f2(p.epsHigh)}`, p.analysts ?? '–', f2(p.priorEps),
          p.growthPct == null ? '–' : `${f1(p.growthPct)}%`, f1(p.pe), p.peg == null ? `n/a (${p.note})` : f2(p.peg),
        ])}
      />

      <h2>Other figures for reference</h2>
      <DataTable
        headers={['Figure', 'Value', 'Comment']}
        rows={[
          ['Trailing P/E', f1(reference.trailingPe), 'price ÷ last 12 months EPS (Yahoo)'],
          ['Forward P/E', f1(reference.forwardPe), 'price ÷ next-year EPS estimate (Yahoo)'],
          ['PEG according to Yahoo', f2(reference.yahooPeg), 'Yahoo\'s own figure; growth basis not disclosed'],
          ['PEG according to Finnhub', f2(reference.finnhubPeg), 'Finnhub TTM PEG (trailing basis)'],
          ['EPS growth, last 5 years (Finnhub)', reference.epsGrowth5y == null ? '–' : `${f1(reference.epsGrowth5y)}%`, 'historical, for context'],
        ]}
      />

      <p className="text-[var(--text-2)] text-[13px]">
        PEG = P/E ÷ expected EPS growth (in percent): how much investors pay for each point of expected growth. For each of the two fiscal
        years analysts cover, P/E = today's price ÷ that year's consensus EPS estimate, and growth = that year's estimate over the previous
        year's EPS. A lower PEG means less is paid for the expected growth (below 1 is often read as cheap, above 2 as expensive), but it is
        not a signal on its own: it is only as good as the estimates, growth from a very low base (above 100%) makes it tiny, and a
        negative or zero growth or EPS makes it meaningless. Estimates exist only for the current and next fiscal year, so there is no
        history. Providers use different growth bases (for instance a 5-year expected growth), so PEG values differ between tools:
        compare companies within one tool. Estimates come from yfinance (analyst consensus); the current price is used throughout.
      </p>
    </>
  );
}
