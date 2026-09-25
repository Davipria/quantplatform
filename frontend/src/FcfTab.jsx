import { useCallback, useMemo, useState } from 'react';
import { useApi } from './api.js';
import Plot from './Plot.jsx';
import { Seg, median } from './ui.jsx';

const MODES = [['annual', 'Annual'], ['quarterly', 'Quarterly']];
const YEARS = [['3', '3 years'], ['5', '5 years'], ['10', '10 years'], ['20', '20 years'], ['all', 'Max']];
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const DAY = 86400000;
const pct = (v, d = 2) => `${v.toFixed(d)}%`;
const addDays = (iso, n) => new Date(new Date(iso).getTime() + n * DAY).toISOString().slice(0, 10); // ISO dates parse as UTC

const quarterLabel = (iso) => `${MONTHS[Number(iso.slice(5, 7)) - 1]} '${iso.slice(2, 4)}`;

/** The bars to show (fiscal years or quarters, plus the TTM bar), the price window and headline stats. */
function summarise(data, mode, years) {
  const all = data[mode];
  if (!all.length) return null;
  // "10 years" = 9 completed fiscal years + the TTM bar (as in the reference); quarterly: 39 quarters + TTM
  const shown = years === 'all' ? all : all.slice(-(Number(years) * (mode === 'annual' ? 1 : 4) - 1));
  const step = mode === 'annual' ? 365 : 91; // days per bar slot; the TTM bar takes the next slot
  const bars = shown.map((p) => ({ x: p.date, label: mode === 'annual' ? p.date.slice(0, 4) : quarterLabel(p.date), value: p.value, ttm: false }));
  bars.push({ x: addDays(shown.at(-1).date, step), label: 'TTM', value: data.ttm.value, ttm: true });
  const from = addDays(shown[0].date, -step / 2);
  const values = shown.map((p) => p.value);
  return {
    bars, shown, step, from, prices: data.prices.filter((p) => p.date >= from),
    latest: values.at(-1), med: median([...values].sort((a, b) => a - b)),
  };
}

function FcfChart({ s, showYield, showPrice }) {
  const build = useCallback((t) => {
    const values = s.bars.map((b) => b.value);
    const top = Math.max(...values, 0) * 1.2;
    const bottom = Math.min(...values, 0) * 1.2;
    const every = Math.ceil(s.bars.length / 12); // thin out tick labels, always keeping the TTM one
    const ticks = s.bars.filter((_, i) => (s.bars.length - 1 - i) % every === 0);
    const data = [];
    if (showYield) {
      data.push({
        type: 'bar', name: 'Free cash flow yield', x: s.bars.map((b) => b.x), y: values, customdata: s.bars.map((b) => b.label),
        width: s.step * 0.62 * DAY, marker: { color: t.series, opacity: s.bars.map((b) => (b.ttm ? 0.5 : 1)) },
        text: s.bars.length <= 14 ? values.map((v) => pct(v)) : undefined, textposition: 'outside', cliponaxis: false,
        textfont: { size: 11, color: t.text }, hovertemplate: '%{customdata}: %{y:.2f}%<extra></extra>',
      });
    }
    if (showPrice) {
      data.push({
        type: 'scatter', mode: 'lines', name: 'Stock price', yaxis: 'y2', x: s.prices.map((p) => p.date), y: s.prices.map((p) => p.price),
        line: { color: t.text, width: 1.2 }, hovertemplate: '%{x|%b %d, %Y}: %{y:,.2f}<extra>Stock price</extra>',
      });
    }
    return {
      data,
      layout: {
        hovermode: 'closest', margin: { l: 52, r: 16, t: 24, b: 40 },
        xaxis: { type: 'date', tickmode: 'array', tickvals: ticks.map((b) => b.x), ticktext: ticks.map((b) => b.label), range: [s.from, addDays(s.bars.at(-1).x, s.step * 0.6)] },
        yaxis: { ticksuffix: '%', range: [bottom, top], zeroline: true, zerolinecolor: t.muted, zerolinewidth: 1 },
        yaxis2: { overlaying: 'y', side: 'right', showticklabels: false, showgrid: false, zeroline: false }, // price scale is hidden, as in the reference
      },
    };
  }, [s, showYield, showPrice]);
  return <Plot build={build} />;
}

const CHIP = 'inline-flex items-center gap-2 py-1.5 px-3.5 border border-[var(--border)] rounded-full cursor-pointer';
const CHIP_ON = 'border-[var(--text-2)]';

const Chip = ({ checked, onChange, color, children }) => (
  <label className={`${CHIP} ${checked ? CHIP_ON : ''}`}>
    <input type="checkbox" className="m-0" checked={checked} onChange={(e) => onChange(e.target.checked)} />
    <span className="inline-block w-2.5 h-2.5 rounded-full" style={{ background: color }} />
    {children}
  </label>
);

function downloadCsv(symbol, mode, s, ttm) {
  const rows = [['period_end', 'fcf_yield_pct'], ...s.shown.map((p) => [p.date, p.value.toFixed(4)]), [`TTM (${ttm.date})`, ttm.value.toFixed(4)]];
  const url = URL.createObjectURL(new Blob([rows.map((r) => r.join(',')).join('\n')], { type: 'text/csv' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = `${symbol}-fcf-yield-${mode}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}

export default function FcfTab({ symbol }) {
  const [mode, setMode] = useState('annual');
  const [years, setYears] = useState('10');
  const [showYield, setShowYield] = useState(true);
  const [showPrice, setShowPrice] = useState(true);
  const api = useApi(`/api/fcf-yield/${encodeURIComponent(symbol)}`);
  const s = useMemo(() => (api.data ? summarise(api.data, mode, years) : null), [api.data, mode, years]);

  if (api.loading) return <p className="text-[var(--text-2)] py-6">Loading…</p>;
  if (api.error) return <p className="text-[var(--err)] py-6">Could not load the free cash flow yield for {symbol}: {api.error.message}</p>;
  const { ttm, warning } = api.data;

  return (
    <>
      <h2>{symbol} · Free cash flow yield</h2>
      {warning && <div className="py-[10px] px-3.5 rounded-lg my-2 bg-[var(--warn-bg)] text-[var(--warn-text)]">{warning}</div>}
      <div className="flex flex-wrap gap-4 mb-3">
        <Seg options={MODES} value={mode} onChange={setMode} />
        <select aria-label="Period" value={years} onChange={(e) => setYears(e.target.value)}>
          {YEARS.map(([v, label]) => <option key={v} value={v}>{label}</option>)}
        </select>
        {s && <button className="ml-auto" onClick={() => downloadCsv(symbol, mode, s, ttm)}>Download CSV</button>}
      </div>
      {!s ? (
        <p className="text-[var(--text-2)] py-6">No {mode} free cash flow yield data for {symbol}.</p>
      ) : (
        <>
          <p className="text-[var(--text-2)] text-[13px]">
            TTM {pct(ttm.value)} (today's price) · latest {mode === 'annual' ? 'fiscal year' : 'quarter'} {pct(s.latest)} · median of the {s.shown.length} {mode === 'annual' ? 'fiscal years' : 'quarters'} shown {pct(s.med)}
          </p>
          <FcfChart s={s} showYield={showYield} showPrice={showPrice} />
          <div className="flex flex-wrap gap-3 mt-2">
            <Chip checked={showPrice} onChange={setShowPrice} color="var(--text)">Stock price</Chip>
            <Chip checked={showYield} onChange={setShowYield} color="var(--series)">Free cash flow yield</Chip>
          </div>
        </>
      )}
      <p className="text-[var(--text-2)] text-[13px]">
        Free cash flow yield = trailing-12-month free cash flow per share ÷ share price: how much cash the company generates relative
        to its market value. Annual bars show the yield at each fiscal year end, using the price on the first trading day on or after it;
        the lighter TTM bar uses today's price. The quarterly view shows the trailing-12-month yield at each quarter end. Cash flow comes
        from Finnhub and prices from yfinance. Negative bars mean the company burned cash. A very high yield can look attractive but may
        mean the market expects trouble ahead: investigate it rather than treating it as an automatic opportunity. Not meaningful for
        banks and insurers.
      </p>
    </>
  );
}
