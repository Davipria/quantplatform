import { useCallback, useMemo, useState } from 'react';
import { useApi } from './api.js';
import Plot from './Plot.jsx';
import { big, num } from './ui.jsx';

const RANGES = ['1Y', '3Y', '5Y', 'Max'];
const LEVEL_STYLE = {
  High: 'bg-[var(--err)]/15 text-[var(--err)]',
  Moderate: 'bg-[var(--surface)] text-[var(--text)]',
  Low: 'bg-[var(--pos)]/15 text-[var(--pos)]',
};
const fmt = (v, d = 1, unit = '') => (v == null ? '–' : `${v.toFixed(d)}${unit}`);

const Tile = ({ label, value, sub }) => (
  <div className="bg-[var(--surface)] rounded-lg py-3 px-3.5">
    <div className="text-[var(--text-2)] text-[13px]">{label}</div>
    <div className="text-2xl font-semibold tabular-nums">{value}</div>
    <div className="text-xs text-[var(--text-2)]">{sub}</div>
  </div>
);

/** Start date (YYYY-MM-DD) of a range pill, '' for Max. */
function cutoffFor(range) {
  return range === 'Max' ? '' : new Date(Date.now() - parseInt(range, 10) * 365.25 * 864e5).toISOString().slice(0, 10);
}

function Panel({ title, note, children }) {
  return (
    <section className="min-w-0">
      <h3 className="mt-6 mb-0.5">{title}</h3>
      <p className="text-[var(--text-2)] text-[13px] mb-1.5">{note}</p>
      {children}
    </section>
  );
}

function Charts({ d, cutoff }) {
  const reports = useMemo(() => d.reports.filter((r) => r.date >= cutoff), [d, cutoff]);
  const volume = useMemo(() => d.volume.filter((v) => v.date >= cutoff), [d, cutoff]);
  const hasFloat = reports.some((r) => r.pctFloat != null);
  const hasPrice = reports.some((r) => r.price != null);

  const interest = useCallback((t) => ({
    data: [
      {
        x: reports.map((r) => r.date), y: reports.map((r) => (hasFloat ? r.pctFloat : r.shortInterest)), name: hasFloat ? 'Short % of float' : 'Short interest',
        type: 'scatter', mode: 'lines', line: { color: t.brand, width: 2 }, hovertemplate: hasFloat ? '%{y:.2f}%<extra>Short % of float</extra>' : '%{y:,.0f}<extra>Short interest</extra>',
      },
      ...(hasPrice ? [{
        x: reports.map((r) => r.date), y: reports.map((r) => r.price), name: 'Stock price', type: 'scatter', mode: 'lines', yaxis: 'y2', connectgaps: true,
        line: { color: t.muted, width: 1.3 }, hovertemplate: '%{y:,.2f}<extra>Stock price</extra>',
      }] : []),
    ],
    layout: {
      showlegend: true, legend: { orientation: 'h', x: 0.5, xanchor: 'center', y: -0.14 }, margin: { l: 50, r: hasPrice ? 50 : 16, t: 8, b: 44 },
      yaxis: { ticksuffix: hasFloat ? '%' : '', rangemode: 'tozero' },
      ...(hasPrice ? { yaxis2: { overlaying: 'y', side: 'right', showgrid: false, zeroline: false } } : {}),
    },
  }), [reports, hasFloat, hasPrice]);

  const days = useCallback((t) => ({
    data: [{ x: reports.map((r) => r.date), y: reports.map((r) => r.daysToCover), type: 'bar', marker: { color: t.brand, opacity: 0.7 }, hovertemplate: '%{y:.1f} days<extra>Days to cover</extra>' }],
    layout: { margin: { l: 50, r: 16, t: 8, b: 32 }, yaxis: { rangemode: 'tozero' }, shapes: [{ type: 'line', xref: 'paper', x0: 0, x1: 1, yref: 'y', y0: 5, y1: 5, line: { color: '#d55', width: 1, dash: 'dot' } }] },
  }), [reports]);

  const ratio = useCallback((t) => ({
    data: [
      { x: volume.map((v) => v.date), y: volume.map((v) => v.ratio), name: 'Daily', type: 'scatter', mode: 'lines', line: { color: t.muted, width: 1 }, opacity: 0.6, hovertemplate: '%{y:.1f}%<extra>Daily</extra>' },
      { x: volume.map((v) => v.date), y: volume.map((v) => v.avg20), name: '20-day average', type: 'scatter', mode: 'lines', connectgaps: true, line: { color: t.brand, width: 2 }, hovertemplate: '%{y:.1f}%<extra>20-day average</extra>' },
    ],
    layout: {
      showlegend: true, legend: { orientation: 'h', x: 0.5, xanchor: 'center', y: -0.14 }, margin: { l: 50, r: 16, t: 8, b: 44 }, yaxis: { ticksuffix: '%' },
      shapes: [{ type: 'line', xref: 'paper', x0: 0, x1: 1, yref: 'y', y0: 50, y1: 50, line: { color: '#888', width: 1, dash: 'dot' } }],
    },
  }), [volume]);

  return (
    <>
      <Panel
        title={hasFloat ? 'Short interest, % of float' : 'Short interest, shares'}
        note="Twice a month. The float is today's, applied to every date, so older values are approximate."
      >
        <Plot build={interest} className="h-[300px]" />
      </Panel>
      <div className="grid grid-cols-2 max-[900px]:grid-cols-1 gap-x-8">
        <Panel title="Days to cover" note="Short interest divided by average daily volume. Dotted line: 5 days.">
          <Plot build={days} className="h-[280px]" />
        </Panel>
        <Panel title="Daily short volume ratio" note="Share of each day's trading that was short selling (available since Feb 2024). Market makers' hedging is included, so 50% is normal.">
          {volume.length ? <Plot build={ratio} className="h-[280px]" /> : <p className="text-[var(--text-2)] py-4">No daily data in this range.</p>}
        </Panel>
      </div>
    </>
  );
}

export default function ShortTab({ symbol }) {
  const [range, setRange] = useState('3Y');
  const { data: d, error, loading } = useApi(`/api/short-interest/${encodeURIComponent(symbol)}`);
  if (loading) return <p className="text-[var(--text-2)] py-6">Loading short interest (the first load of a company can take up to a minute)…</p>;
  if (error) return <p className="text-[var(--err)] py-6">{error.message}</p>;

  const t = d.tiles;
  const table = [...d.reports].reverse().slice(0, 24);
  return (
    <>
      <h2>Short interest — {symbol}</h2>
      <p className="text-[var(--text-2)] text-[13px] mb-3">
        FINRA short interest via Massive: reported twice a month and published about a week after the settlement date. A high short interest
        means many investors bet on a fall; if the price rises instead, they may have to buy back, which can push it up further (a squeeze).
        It is a positioning gauge, not a forecast.
      </p>

      <div className="grid grid-cols-[repeat(auto-fit,minmax(180px,1fr))] gap-3">
        <Tile label="Short interest" value={big(t.shortInterest)} sub={`shares · ${t.date}`} />
        <Tile label="Short % of float" value={fmt(t.pctFloat, 2, '%')} sub={d.floatDate ? `float ${big(d.floatShares)} · ${d.floatDate}` : 'no float data'} />
        <Tile label="Days to cover" value={fmt(t.daysToCover, 1)} sub="at average daily volume" />
        <Tile label="Change since last report" value={t.change == null ? '–' : `${t.change >= 0 ? '+' : ''}${t.change.toFixed(1)}%`} sub="in shares sold short" />
        <Tile label="Short volume, 10 days" value={fmt(t.ratio10, 1, '%')} sub={t.ratioDate ? `share of daily volume · to ${t.ratioDate}` : 'no daily data'} />
      </div>

      <section className="mt-5 bg-[var(--surface)] rounded-lg py-3 px-4">
        <div className="flex flex-wrap items-center gap-3 mb-1.5">
          <h3 className="m-0">Squeeze checklist</h3>
          <span className={`inline-block py-0.5 px-2.5 rounded-full text-xs font-semibold ${LEVEL_STYLE[d.level]}`}>{d.level} · {d.score} of {d.flags.length}</span>
        </div>
        <ul className="list-none m-0 p-0 text-[13px]">
          {d.flags.map((f) => (
            <li key={f.label} className={f.on ? 'font-semibold text-[var(--text)]' : 'text-[var(--text-2)]'}>
              <span aria-hidden="true" className="inline-block w-5">{f.on ? '✔' : '–'}</span>{f.label} <span className="font-normal text-[var(--text-2)]">({f.detail})</span>
            </li>
          ))}
        </ul>
        <p className="text-[var(--text-2)] text-xs mt-2 mb-0">A screening aid: many heavily shorted stocks never squeeze.</p>
      </section>

      <div className="flex flex-wrap gap-2 mt-5">
        {RANGES.map((r) => (
          <button
            key={r} type="button" aria-pressed={r === range}
            className={`rounded-full py-1 px-3 text-[13px] border border-[var(--border)] ${r === range ? 'bg-[var(--brand-soft)] border-[var(--brand)] font-semibold' : 'bg-transparent'}`}
            onClick={() => setRange(r)}
          >
            {r}
          </button>
        ))}
      </div>
      <Charts d={d} cutoff={cutoffFor(range)} />

      <h3 className="mt-6">Recent reports</h3>
      <div className="overflow-auto border border-[var(--border)] rounded-md">
        <table>
          <thead>
            <tr><th className="text-left">Settlement date</th><th>Short interest</th><th>% of float</th><th>Days to cover</th><th>Avg daily volume</th><th>Change</th></tr>
          </thead>
          <tbody>
            {table.map((r) => (
              <tr key={r.date}>
                <td className="text-left">{r.date}</td><td>{num(r.shortInterest)}</td><td>{fmt(r.pctFloat, 2, '%')}</td><td>{fmt(r.daysToCover, 1)}</td>
                <td>{num(r.avgVolume)}</td>
                <td className={r.change == null ? '' : r.change >= 0 ? 'text-[var(--err)]' : 'text-[var(--pos)]'}>{r.change == null ? '–' : `${r.change >= 0 ? '+' : ''}${r.change.toFixed(1)}%`}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}
