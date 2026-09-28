import { useCallback, useMemo, useState } from 'react';
import { useApi } from './api.js';
import Plot from './Plot.jsx';
import { num } from './ui.jsx';

const LAST_PRODUCT = 'quant.futures';
const THIN_VOLUME = 100; // contracts trading fewer than this on the last session have prices that may be stale
const CURVE_STYLE = [ // Latest first; older curves lighter
  { color: null, width: 2.6, dash: 'solid' }, { color: 'palette1', width: 1.6, dash: 'dash' },
  { color: 'palette2', width: 1.4, dash: 'dot' }, { color: 'muted', width: 1.2, dash: 'dot' },
];
const price = (v) => (v == null ? '–' : v.toLocaleString('en', { maximumFractionDigits: v >= 1000 ? 2 : 4, minimumFractionDigits: 2 }));
const pct = (v, d = 2) => (v == null ? '–' : `${v >= 0 ? '+' : ''}${v.toFixed(d)}%`);

const Tile = ({ label, value, sub, tone }) => (
  <div className="bg-[var(--surface)] rounded-lg py-3 px-3.5">
    <div className="text-[var(--text-2)] text-[13px]">{label}</div>
    <div className={`text-2xl font-semibold tabular-nums ${tone ?? ''}`}>{value}</div>
    <div className="text-xs text-[var(--text-2)]">{sub}</div>
  </div>
);

function initialProduct() {
  try {
    return localStorage.getItem(LAST_PRODUCT) || 'ES';
  } catch {
    return 'ES';
  }
}

export default function FuturesTab() {
  const [code, setCode] = useState(initialProduct);
  const products = useApi('/api/futures/products');
  const { data: d, error, loading } = useApi(`/api/futures/${encodeURIComponent(code)}`);
  const groups = useMemo(() => {
    const g = new Map();
    (products.data ?? []).forEach((p) => g.set(p.group, [...(g.get(p.group) ?? []), p]));
    return [...g];
  }, [products.data]);

  const choose = (c) => {
    setCode(c);
    try {
      localStorage.setItem(LAST_PRODUCT, c);
    } catch { /* private mode: just don't remember it */ }
  };

  const curve = useCallback((t) => {
    const colors = { palette1: t.palette[1], palette2: t.palette[2], muted: t.muted };
    return {
      data: d.curves.map((c, i) => {
        const s = CURVE_STYLE[i];
        return {
          x: c.points.map((p) => p.expiry), y: c.points.map((p) => p.price), text: c.points.map((p) => p.ticker), name: `${c.label} (${c.date})`,
          type: 'scatter', mode: 'lines+markers', marker: { size: 6 }, line: { color: s.color ? colors[s.color] : t.brand, width: s.width, dash: s.dash },
          hovertemplate: `%{text}: %{y:,.2f}<extra>${c.label}</extra>`,
        };
      }),
      layout: {
        hovermode: 'closest', showlegend: true, legend: { orientation: 'h', x: 0.5, xanchor: 'center', y: -0.16 }, margin: { l: 64, r: 16, t: 8, b: 48 },
        xaxis: { title: { text: 'Contract expiry' }, type: 'date' }, yaxis: { title: { text: d.unit }, zeroline: false },
      },
    };
  }, [d]);
  const spread = useCallback((t) => ({
    data: [{
      x: d.history.dates, y: d.history.pct, type: 'scatter', mode: 'lines', fill: 'tozeroy', fillcolor: 'rgba(60,100,200,0.10)', line: { color: t.brand, width: 2 },
      hovertemplate: '%{y:+.2f}%<extra>Next vs front</extra>',
    }],
    layout: {
      margin: { l: 56, r: 16, t: 8, b: 32 }, yaxis: { ticksuffix: '%', zeroline: false },
      shapes: [{ type: 'line', xref: 'paper', x0: 0, x1: 1, yref: 'y', y0: 0, y1: 0, line: { color: '#888', width: 1, dash: 'dot' } }],
    },
  }), [d]);

  return (
    <>
      <h2>Futures curves</h2>
      <p className="text-[var(--text-2)] text-[13px] mb-3">
        Prices of a future for each delivery month, from Massive (CME, CBOT, COMEX and NYMEX; end-of-day data, about 8 hours behind). Contango: later
        months cost more than the front month, so a long position loses a little each time it rolls forward. Backwardation: later months cost less, so
        rolling gains. Stock-index futures are almost always in contango because of interest costs. The first load of a product takes 1-2 minutes
        (one download per contract on the free plan), then it is kept for 6 hours.
      </p>

      <label className="inline-flex flex-col gap-1 text-[var(--text-2)] text-[13px] mb-3">
        Product
        <select aria-label="Futures product" value={code} onChange={(e) => choose(e.target.value)}>
          {groups.length === 0 && <option value={code}>{code}</option>}
          {groups.map(([group, list]) => (
            <optgroup key={group} label={group}>
              {list.map((p) => <option key={p.code} value={p.code}>{p.name} ({p.code})</option>)}
            </optgroup>
          ))}
        </select>
      </label>

      {loading && <p className="text-[var(--text-2)] py-6">Loading {code} futures (the first load can take up to 2 minutes)…</p>}
      {error && <p className="text-[var(--err)] py-6">{error.message}</p>}
      {d && (
        <>
          <div className="grid grid-cols-[repeat(auto-fit,minmax(190px,1fr))] gap-3">
            <Tile label="Front contract" value={d.front ? price(d.front.price) : '–'} sub={d.front ? `${d.front.ticker} · expires in ${d.front.days} days · ${d.unit}` : ''} />
            <Tile
              label="Curve shape" value={d.shape?.label ?? '–'}
              sub={d.shape ? `${pct(d.shape.slope)} from the front to ${d.contracts.at(-1).ticker}` : 'needs two contracts'}
            />
            <Tile
              label="Roll yield, a year" value={pct(d.rollYield, 1)} tone={d.rollYield > 0 ? 'text-[var(--pos)]' : d.rollYield < 0 ? 'text-[var(--err)]' : ''}
              sub={d.rollYield == null ? '' : d.rollYield > 0 ? 'a long position gains on each roll' : 'a long position loses on each roll'}
            />
            <Tile label="Next vs front" value={pct(d.spreadPct)} sub={d.spreads[0] ? `${d.spreads[0].to} vs ${d.spreads[0].from}` : ''} />
            <Tile label="Last session" value={d.asOf} sub="settlement price, else the close" />
          </div>

          <h3 className="mt-6 mb-0.5">The curve</h3>
          <p className="text-[var(--text-2)] text-[13px] mb-1.5">One point per contract. An older curve appears only for the contracts that were already trading then.</p>
          <Plot build={curve} className="h-[340px]" />

          {d.history.dates.length > 1 && (
            <>
              <h3 className="mt-6 mb-0.5">Next contract vs front, over time</h3>
              <p className="text-[var(--text-2)] text-[13px] mb-1.5">Above zero: contango; below zero: backwardation. Only the period both contracts have traded.</p>
              <Plot build={spread} className="h-[260px]" />
            </>
          )}

          <h3 className="mt-6">Contracts</h3>
          <div className="overflow-auto border border-[var(--border)] rounded-md">
            <table>
              <thead><tr><th className="text-left">Contract</th><th>Expiry</th><th>Days left</th><th>Price</th><th>vs front</th><th>Volume, last session</th></tr></thead>
              <tbody>
                {d.contracts.map((c) => {
                  const thin = (c.volume ?? 0) < THIN_VOLUME;
                  return (
                    <tr key={c.ticker} className={thin ? 'text-[var(--text-2)]' : ''}>
                      <td className="text-left font-semibold">{c.ticker}</td><td>{c.expiry}</td><td>{c.days}</td><td>{price(c.price)}</td>
                      <td>{pct(d.front.price ? (c.price / d.front.price - 1) * 100 : null)}</td>
                      <td title={thin ? 'Very few trades: this price may be stale' : undefined}>{num(c.volume)}{thin ? ' (thin)' : ''}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          <h3 className="mt-6">Calendar spreads</h3>
          <p className="text-[var(--text-2)] text-[13px] mb-1.5">
            Price of each contract minus the one before it. The annualised roll yield is the gain (+) or loss (−) of a long position per year if it keeps rolling between these two contracts.
          </p>
          <div className="overflow-auto border border-[var(--border)] rounded-md">
            <table>
              <thead><tr><th className="text-left">Spread</th><th>Difference</th><th>%</th><th>Days apart</th><th>Roll yield, a year</th></tr></thead>
              <tbody>
                {d.spreads.map((s) => (
                  <tr key={s.to}>
                    <td className="text-left">{s.to} − {s.from}</td><td>{s.diff >= 0 ? '+' : ''}{price(s.diff)}</td><td>{pct(s.pct)}</td><td>{s.gapDays}</td>
                    <td className={s.rollYield > 0 ? 'text-[var(--pos)]' : 'text-[var(--err)]'}>{pct(s.rollYield, 1)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="text-[var(--text-2)] text-xs mt-2">
            Contracts far from expiry, or outside a commodity's main delivery months, trade rarely and their prices can be stale (shown as thin). Only
            the nearest {d.contracts.length} contracts with recent trades are shown. ICE contracts (coffee, sugar, cocoa) are not covered. A short history means the
            later contract only started trading recently.
          </p>
        </>
      )}
    </>
  );
}
