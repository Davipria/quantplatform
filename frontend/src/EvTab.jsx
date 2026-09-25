import { useCallback, useMemo, useState } from 'react';
import { useApi } from './api.js';
import Plot from './Plot.jsx';
import { DataTable, Seg, median, num, x } from './ui.jsx';

const RANGES = ['1Y', '3Y', '5Y', '10Y', 'Max'];
const LABELS = { finnhub: 'Finnhub (quarterly, long history)', yfinance: 'yfinance (daily, ~4 years)' };

function fromFinnhub(fh) {
  const by = (k) => new Map((fh[k] ?? []).map((p) => [p.period, p.v]));
  const [ev, ebitda] = [by('ev'), by('ebitda')];
  const points = fh.evEbitdaTTM.map((p) => ({ date: p.period, value: p.v }));
  return {
    points, mode: 'lines+markers', warning: '',
    note: 'Finnhub EV / trailing-12-month EBITDA at each fiscal quarter end. EV and EBITDA are in millions; EBITDA is for the quarter.',
    detail: {
      headers: ['Period end', 'EV / EBITDA', 'EV', 'EBITDA (qtr)'],
      rows: points.map((p) => [p.date, x(p.value), num(ev.get(p.date)), num(ebitda.get(p.date))]),
    },
  };
}

function fromYfinance(y) {
  return {
    points: y.points.map((p) => ({ date: p.date, value: p.evEbitda })),
    mode: 'lines', warning: y.warning ?? '',
    note: `EV = price × shares + debt + minority interest − cash. EBITDA is trailing 12 months. Fundamentals apply ${y.filingLagDays} days after period end. yfinance only exposes ~4–5 fiscal years of statements, which bounds the history.`,
    fundamentals: {
      headers: ['Period end', 'EBITDA (TTM)', 'Total debt', 'Cash', 'Minority', 'Shares'],
      rows: y.fundamentals.map((f) => [f.date, num(f.ebitda), num(f.debt), num(f.cash), num(f.minority), num(f.shares)]),
    },
    detail: {
      headers: ['Date', 'Price', 'Market cap', 'EV', 'EBITDA (TTM)', 'EV / EBITDA'],
      rows: y.points.map((p) => [p.date, num(p.price, 2), num(p.marketCap), num(p.ev), num(p.ebitda), p.evEbitda == null ? '–' : x(p.evEbitda)]),
    },
  };
}

/** Restrict to the range and compute headline stats. Dates are ISO strings, so they compare lexically. */
function summarise(points, range) {
  const valid = points.filter((p) => p.value > 0); // negative EBITDA makes the multiple meaningless
  if (!valid.length) return null;
  let from = '';
  if (range !== 'Max') {
    const last = new Date(valid.at(-1).date); // parsed as UTC
    from = new Date(Date.UTC(last.getUTCFullYear() - parseInt(range), last.getUTCMonth(), last.getUTCDate())).toISOString().slice(0, 10);
  }
  const view = valid.filter((p) => p.date >= from);
  const values = view.map((p) => p.value);
  const sorted = [...values].sort((a, b) => a - b);
  const now = values.at(-1);
  return {
    view, values, now, from: view[0].date,
    med: median(sorted), min: sorted[0], max: sorted.at(-1),
    pctile: values.filter((v) => v <= now).length / values.length,
  };
}

const Tile = ({ label, value, sub }) => (
  <div className="bg-[var(--surface)] rounded-lg py-3 px-3.5">
    <div className="text-[var(--text-2)] text-[13px]">{label}</div>
    <div className="text-2xl font-semibold tabular-nums">{value}</div>
    <div className="text-[var(--text-2)] text-xs">{sub}</div>
  </div>
);

function EvChart({ s, mode }) {
  const build = useCallback((t) => ({
    data: [{
      x: s.view.map((p) => p.date), y: s.values, type: 'scatter', mode,
      line: { color: t.series, width: 2 }, marker: { size: 5 },
      hovertemplate: '%{y:.1f}x<extra></extra>',
    }],
    layout: {
      yaxis: { title: { text: 'EV / EBITDA (TTM)' }, ticksuffix: 'x' },
      shapes: [{ type: 'line', xref: 'paper', x0: 0, x1: 1, y0: s.med, y1: s.med, line: { color: t.muted, width: 1, dash: 'dash' } }],
      annotations: [{ xref: 'paper', x: 0, y: s.med, xanchor: 'left', yanchor: 'bottom', showarrow: false, text: `median ${x(s.med)}`, font: { color: t.text2 } }],
    },
  }), [s, mode]);
  return <Plot build={build} />;
}

export default function EvTab({ symbol, config }) {
  const [source, setSource] = useState('finnhub');
  const [range, setRange] = useState('Max');
  const sym = encodeURIComponent(symbol);

  const fh = useApi(config.finnhub ? `/api/finnhub/${sym}?freq=quarterly` : null);
  const hasFinnhub = Boolean(fh.data?.evEbitdaTTM?.length);
  const sources = [...(hasFinnhub ? ['finnhub'] : []), 'yfinance'];
  const active = sources.includes(source) ? source : sources[0];
  const waitingOnFinnhub = config.finnhub && fh.loading;
  const yf = useApi(active === 'yfinance' && !waitingOnFinnhub ? `/api/yfinance/ev-ebitda/${sym}` : null);

  const model = useMemo(() => {
    if (active === 'finnhub' && hasFinnhub) return fromFinnhub(fh.data);
    if (active === 'yfinance' && yf.data) return fromYfinance(yf.data);
    return null;
  }, [active, hasFinnhub, fh.data, yf.data]);
  const s = useMemo(() => (model ? summarise(model.points, range) : null), [model, range]);

  if (waitingOnFinnhub) return <p className="text-[var(--text-2)] py-6">Loading…</p>;

  const controls = (
    <div className="flex flex-wrap gap-4 mb-3">
      {sources.length > 1 && <Seg options={sources.map((k) => [k, LABELS[k]])} value={active} onChange={setSource} />}
      <Seg options={RANGES.map((r) => [r, r])} value={range} onChange={setRange} />
    </div>
  );

  let body;
  if (yf.error) body = <p className="text-[var(--err)] py-6">Could not build EV/EBITDA for {symbol}: {yf.error.message}</p>;
  else if (!model) body = <p className="text-[var(--text-2)] py-6">Loading…</p>;
  else if (!s) body = <p className="text-[var(--text-2)] py-6">No positive EV/EBITDA available for {symbol} from this source.</p>;
  else {
    const vsMedian = (s.now / s.med - 1) * 100;
    body = (
      <>
        {model.warning && <div className="py-[10px] px-3.5 rounded-lg my-2 bg-[var(--warn-bg)] text-[var(--warn-text)]">{model.warning}</div>}
        <div className="grid grid-cols-[repeat(auto-fit,minmax(150px,1fr))] gap-3 my-3">
          <Tile label="Current" value={x(s.now)} sub={s.view.at(-1).date} />
          <Tile label="Median" value={x(s.med)} sub={`${vsMedian >= 0 ? '+' : ''}${vsMedian.toFixed(0)}% vs median`} />
          <Tile label="Range" value={`${x(s.min)} – ${x(s.max)}`} sub={`${s.view.length} observations`} />
          <Tile label="Percentile" value={`${(s.pctile * 100).toFixed(0)}%`} sub="share of history at or below current" />
        </div>
        <EvChart s={s} mode={model.mode} />
        <details>
          <summary>Underlying data</summary>
          <p className="text-[var(--text-2)] text-[13px]">{model.note}</p>
          {model.fundamentals && <DataTable {...model.fundamentals} />}
          <DataTable headers={model.detail.headers} rows={model.detail.rows.filter((r) => r[0] >= s.from).reverse()} />
        </details>
      </>
    );
  }

  return (
    <>
      {controls}
      {body}
    </>
  );
}
