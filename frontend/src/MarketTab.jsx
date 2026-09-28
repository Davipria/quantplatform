import { useCallback, useMemo, useState } from 'react';
import { usePoll } from './api.js';
import Plot from './Plot.jsx';
import { big, num } from './ui.jsx';

const RANGES = [['3M', 92], ['6M', 183], ['1Y', 366], ['Max', null]];
const LISTS = [
  ['gainers', 'Top gainers'], ['losers', 'Top losers'], ['active', 'Most active'], ['spikes', 'Volume spikes'],
  ['momentumTop', 'Momentum leaders'], ['momentumBottom', 'Momentum laggards'], ['lowVolatility', 'Lowest volatility'], ['highs', 'New highs'], ['lows', 'New lows'],
];
const LIST_NOTES = {
  gainers: 'Biggest one-day gains among stocks with at least $5M traded.',
  losers: 'Biggest one-day losses among stocks with at least $5M traded.',
  active: 'Highest dollar volume (price x shares traded) in the latest session.',
  spikes: 'Volume at least 3 times its 20-day average, among stocks with at least $10M traded. Needs 22 sessions.',
  momentumTop: 'Best return from the start of the window to one month ago (the latest month is skipped, as in the classic momentum factor). Stocks with at least $10M a day.',
  momentumBottom: 'Weakest return over the same window.',
  lowVolatility: 'Smallest 60-day price swings, annualised, among stocks with at least $20M a day. Needs 61 sessions.',
  highs: 'Closed above every close of the look-back window (largest stocks first). Needs 21 sessions.',
  lows: 'Closed below every close of the look-back window (largest stocks first). Needs 21 sessions.',
};
const EXTRA = { spikes: ['Volume vs average', (r) => `${r.volumeRatio}x`], momentumTop: ['Momentum', (r) => `${r.momentum >= 0 ? '+' : ''}${r.momentum}%`],
  momentumBottom: ['Momentum', (r) => `${r.momentum >= 0 ? '+' : ''}${r.momentum}%`], lowVolatility: ['Volatility, a year', (r) => `${r.volatility}%`] };
const NEEDS = [['20-day average', 20], ['50-day average', 50], ['200-day average', 200], ['52-week highs and lows', 253], ['12-1 momentum', 274]];
const signed = (v) => (v == null ? '–' : `${v >= 0 ? '+' : ''}${v.toFixed(2)}%`);
const tone = (v) => (v == null ? '' : v >= 0 ? 'text-[var(--pos)]' : 'text-[var(--err)]');

const Tile = ({ label, value, sub }) => (
  <div className="bg-[var(--surface)] rounded-lg py-3 px-3.5">
    <div className="text-[var(--text-2)] text-[13px]">{label}</div>
    <div className="text-2xl font-semibold tabular-nums">{value}</div>
    <div className="text-xs text-[var(--text-2)]">{sub}</div>
  </div>
);

const Panel = ({ title, note, children }) => (
  <section className="min-w-0">
    <h3 className="mt-6 mb-0.5">{title}</h3>
    <p className="text-[var(--text-2)] text-[13px] mb-1.5">{note}</p>
    {children}
  </section>
);

function Charts({ d, days }) {
  const s = d.series;
  const from = useMemo(() => {
    if (!days) return 0;
    const cutoff = new Date(Date.now() - days * 864e5).toISOString().slice(0, 10);
    const i = s.dates.findIndex((x) => x >= cutoff);
    return i < 0 ? s.dates.length : i;
  }, [s, days]);
  const cut = (a) => a.slice(from);
  const dates = cut(s.dates);
  const has = (a) => cut(a).some((v) => v != null);
  const zero = { type: 'line', xref: 'paper', x0: 0, x1: 1, yref: 'y', y0: 0, y1: 0, line: { color: '#888', width: 1, dash: 'dot' } };
  const legend = { showlegend: true, legend: { orientation: 'h', x: 0.5, xanchor: 'center', y: -0.14 } };

  const ad = useCallback((t) => ({
    data: [
      { x: dates, y: cut(s.net), name: 'Advancers − decliners', type: 'bar', marker: { color: cut(s.net).map((v) => (v >= 0 ? t.up : t.down)), opacity: 0.7 }, hovertemplate: '%{y:+,}<extra>Advancers − decliners</extra>' },
      { x: dates, y: cut(s.adLine), name: 'Advance-decline line', type: 'scatter', mode: 'lines', yaxis: 'y2', line: { color: t.brand, width: 2 }, hovertemplate: '%{y:+,}<extra>A/D line</extra>' },
    ],
    layout: { ...legend, margin: { l: 56, r: 56, t: 8, b: 44 }, yaxis: { zeroline: false }, yaxis2: { overlaying: 'y', side: 'right', showgrid: false, zeroline: false }, shapes: [zero] },
  }), [s, from]); // eslint-disable-line react-hooks/exhaustive-deps
  const above = useCallback((t) => ({
    data: [[20, 'above20', t.palette[2]], [50, 'above50', t.palette[1]], [200, 'above200', t.brand]].filter(([, k]) => has(s[k])).map(([w, k, color]) => ({
      x: dates, y: cut(s[k]), name: `Above ${w}-day average`, type: 'scatter', mode: 'lines', connectgaps: false, line: { color, width: 1.8 }, hovertemplate: `%{y:.1f}%<extra>${w}-day</extra>`,
    })),
    layout: { ...legend, margin: { l: 50, r: 16, t: 8, b: 44 }, yaxis: { ticksuffix: '%', range: [0, 100] }, shapes: [{ ...zero, y0: 50, y1: 50 }] },
  }), [s, from]); // eslint-disable-line react-hooks/exhaustive-deps
  const highs = useCallback((t) => ({
    data: [
      { x: dates, y: cut(s.highs), name: 'New highs', type: 'bar', marker: { color: t.up }, hovertemplate: '%{y}<extra>New highs</extra>' },
      { x: dates, y: cut(s.lows).map((v) => (v == null ? null : -v)), name: 'New lows', type: 'bar', marker: { color: t.down }, hovertemplate: '%{customdata}<extra>New lows</extra>', customdata: cut(s.lows) },
    ],
    layout: { ...legend, barmode: 'relative', margin: { l: 50, r: 16, t: 8, b: 44 }, yaxis: { zeroline: false }, shapes: [zero] },
  }), [s, from]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div className="grid grid-cols-2 max-[900px]:grid-cols-1 gap-x-8">
      <Panel title="Advancers and decliners" note="Bars: stocks up minus stocks down each day. Line: the running total (advance-decline line), which should confirm a rising market.">
        <Plot build={ad} className="h-[290px]" />
      </Panel>
      <Panel title="Stocks above their moving average" note="Share of stocks closing above their 20, 50 and 200-day average. Dotted line: 50%.">
        {has(s.above20) ? <Plot build={above} className="h-[290px]" /> : <p className="text-[var(--text-2)] py-6">Needs 20 sessions of history.</p>}
      </Panel>
      <Panel title="New highs and new lows" note={`Stocks closing above (green) or below (red) every close of the previous ${d.highWindow ?? '…'} sessions.`}>
        {d.highWindow && has(s.highs) ? <Plot build={highs} className="h-[290px]" /> : <p className="text-[var(--text-2)] py-6">Needs 21 sessions of history.</p>}
      </Panel>
    </div>
  );
}

function StatusBar({ st }) {
  const pctDone = Math.min(100, (st.sessions / st.target) * 100);
  const need = NEEDS.filter(([, n]) => st.sessions < n);
  return (
    <div className="mb-4 rounded-lg bg-[var(--surface)] py-3 px-4 text-[13px]">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <b>History collected: {st.sessions} of {st.target} sessions</b>
        <span className="text-[var(--text-2)]">{st.message}</span>
      </div>
      <div className="h-1.5 rounded-full bg-[var(--border)] mt-2 overflow-hidden"><div className="h-full bg-[var(--brand)]" style={{ width: `${pctDone}%` }} /></div>
      {need.length > 0 && (
        <p className="text-[var(--text-2)] mt-2 mb-0">
          The collector runs in the background while the backend is on (about 2 sessions a minute, so the rest of the app keeps its quota). Still to unlock: {need.map(([l, n]) => `${l} (${n} sessions)`).join(', ')}.
        </p>
      )}
    </div>
  );
}

export default function MarketTab({ onOpen }) {
  const [range, setRange] = useState('6M');
  const [list, setList] = useState('gainers');
  const { data: d, error } = usePoll('/api/breadth', () => 60);

  if (error && !d) return <p className="text-[var(--err)] py-6">Could not load the market data: {error}</p>;
  if (!d) return <p className="text-[var(--text-2)] py-6">Loading…</p>;
  if (!d.ready) {
    return (
      <>
        <h2>Market</h2>
        <StatusBar st={d.status} />
        <p className="text-[var(--text-2)]">The first sessions are still being downloaded. This page fills in as soon as two sessions and the list of stocks are stored.</p>
        {d.status.phase === 'disabled' && <p className="text-[var(--err)]">{d.status.message}</p>}
      </>
    );
  }
  const l = d.latest;
  const rows = d.lists[list];
  const extra = EXTRA[list];
  const label = (k) => (k === 'momentumTop' ? `Momentum leaders${d.momentumLabel ? ` (${d.momentumLabel})` : ''}` : k === 'momentumBottom' ? `Momentum laggards${d.momentumLabel ? ` (${d.momentumLabel})` : ''}` : null);
  return (
    <>
      <h2>Market — US stocks</h2>
      <p className="text-[var(--text-2)] text-[13px] mb-3">
        Breadth and scans for {num(d.universe)} liquid US common stocks, from end-of-day data collected from Massive (latest session {d.asOf}). Breadth shows whether a
        move is broad or carried by a few big names.
      </p>
      <StatusBar st={d.status} />

      <div className="grid grid-cols-[repeat(auto-fit,minmax(170px,1fr))] gap-3">
        <Tile label="Advancers / decliners" value={`${num(l.advancers)} / ${num(l.decliners)}`} sub={`${l.unchanged} unchanged · ${l.upVolumeShare == null ? '–' : l.upVolumeShare.toFixed(0)}% of volume in rising stocks`} />
        <Tile label="Above 20-day average" value={l.above20 == null ? '–' : `${l.above20.toFixed(0)}%`} sub={l.above20 == null ? 'needs 20 sessions' : 'of stocks'} />
        <Tile label="Above 50-day average" value={l.above50 == null ? '–' : `${l.above50.toFixed(0)}%`} sub={l.above50 == null ? 'needs 50 sessions' : 'of stocks'} />
        <Tile label="Above 200-day average" value={l.above200 == null ? '–' : `${l.above200.toFixed(0)}%`} sub={l.above200 == null ? 'needs 200 sessions' : 'of stocks'} />
        <Tile label="New highs / lows" value={l.highs == null ? '–' : `${num(l.highs)} / ${num(l.lows)}`} sub={d.highWindow ? `vs the last ${d.highWindow} sessions` : 'needs 21 sessions'} />
      </div>

      <div className="flex flex-wrap gap-2 mt-5">
        {RANGES.map(([r]) => (
          <button
            key={r} type="button" aria-pressed={r === range}
            className={`rounded-full py-1 px-3 text-[13px] border border-[var(--border)] ${r === range ? 'bg-[var(--brand-soft)] border-[var(--brand)] font-semibold' : 'bg-transparent'}`}
            onClick={() => setRange(r)}
          >
            {r}
          </button>
        ))}
      </div>
      <Charts d={d} days={RANGES.find(([r]) => r === range)[1]} />

      <h3 className="mt-8">Scans, latest session</h3>
      <div className="flex flex-wrap gap-2 mb-1.5">
        {LISTS.map(([k, name]) => {
          const off = !d.lists[k];
          return (
            <button
              key={k} type="button" aria-pressed={k === list} disabled={off} title={off ? 'Needs more collected history' : undefined}
              className={`rounded-full py-1 px-3 text-[13px] border border-[var(--border)] disabled:opacity-40 ${k === list ? 'bg-[var(--brand-soft)] border-[var(--brand)] font-semibold' : 'bg-transparent'}`}
              onClick={() => setList(k)}
            >
              {label(k) ?? name}
            </button>
          );
        })}
      </div>
      <p className="text-[var(--text-2)] text-[13px] mb-1.5">{LIST_NOTES[list]}</p>
      {!rows ? (
        <p className="text-[var(--text-2)] py-4">Not available yet: this scan needs more collected sessions.</p>
      ) : rows.length === 0 ? (
        <p className="text-[var(--text-2)] py-4">No stock qualifies today.</p>
      ) : (
        <div className="overflow-auto border border-[var(--border)] rounded-md">
          <table>
            <thead>
              <tr><th className="text-left">Stock</th><th>Price</th><th>Day</th>{extra && <th>{extra[0]}</th>}<th>Traded ($)</th></tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.symbol}>
                  <td className="text-left">
                    <button type="button" className="border-0 bg-transparent p-0 font-semibold text-[var(--brand)]" onClick={() => onOpen?.(r.symbol)}>{r.symbol}</button>
                    <span className="ml-2 text-[var(--text-2)] text-xs">{r.name}</span>
                  </td>
                  <td>{r.price?.toLocaleString('en', { minimumFractionDigits: 2 })}</td>
                  <td className={tone(r.change)}>{signed(r.change)}</td>
                  {extra && <td>{extra[1](r)}</td>}
                  <td>{big(r.dollarVolume)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <p className="text-[var(--text-2)] text-xs mt-3">
        Universe: US common stocks with at least $2M traded and a price of at least $2 on 90% of the stored sessions ({num(d.cleanUniverse)} of {num(d.universe)} pass the split
        filter used for averages, highs and momentum: a stock with a one-day move below −50% or above +100% is left out there, as it is usually a split). Prices are
        split-adjusted when downloaded and today's session is not available on the free plan. Scans describe what happened; they are not recommendations.
      </p>
    </>
  );
}
