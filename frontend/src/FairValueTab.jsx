import { useCallback, useMemo, useState } from 'react';
import { useApi } from './api.js';
import Plot from './Plot.jsx';
import { big, median, Seg } from './ui.jsx';

const px = (v) => (v == null ? '–' : v.toLocaleString('en', { minimumFractionDigits: 2, maximumFractionDigits: 2 }));
const pct = (v, d = 1) => (v == null ? '–' : `${(v * 100).toFixed(d)}%`);
const upside = (fair, price) => (fair == null ? null : fair / price - 1);
const signed = (v) => (v == null ? '–' : `${v >= 0 ? '+' : ''}${(v * 100).toFixed(1)}%`);
const upClass = (v) => (v == null ? '' : v >= 0 ? 'text-[var(--pos)]' : 'text-[var(--err)]');
const verdict = (u) => (u == null ? '–' : u > 0.1 ? 'Undervalued' : u < -0.1 ? 'Overvalued' : 'Fairly valued');

/**
 * Two-stage DCF: free cash flow grows at `growth` for years 1-5, the growth then fades linearly to `terminalGrowth` by
 * year 10, followed by a Gordon-growth terminal value. Enterprise value minus net debt, divided by shares = value per share.
 */
export function dcf({ fcf, growth, wacc, terminalGrowth, netDebt, shares }) {
  if (!(fcf > 0) || !(wacc > terminalGrowth)) return null;
  let f = fcf;
  let pv = 0;
  const rows = [];
  for (let y = 1; y <= 10; y += 1) {
    const g = y <= 5 ? growth : growth + ((terminalGrowth - growth) * (y - 5)) / 5;
    f *= 1 + g;
    const disc = f / (1 + wacc) ** y;
    pv += disc;
    rows.push({ y, g, fcf: f, pv: disc });
  }
  const tv = (f * (1 + terminalGrowth)) / (wacc - terminalGrowth);
  const tvPv = tv / (1 + wacc) ** 10;
  const ev = pv + tvPv;
  return { rows, pv, tv, tvPv, ev, equity: ev - netDebt, perShare: (ev - netDebt) / shares };
}

const Tile = ({ label, value, sub, className = '' }) => (
  <div className="bg-[var(--surface)] rounded-lg py-3 px-3.5">
    <div className="text-[var(--text-2)] text-[13px]">{label}</div>
    <div className={`text-2xl font-semibold tabular-nums ${className}`}>{value}</div>
    <div className="text-[var(--text-2)] text-xs">{sub}</div>
  </div>
);

const Card = ({ title, children }) => (
  <section className="border border-[var(--border)] rounded-xl p-4 mt-4">
    <h2 className="mt-0">{title}</h2>
    {children}
  </section>
);

/** Football field: one horizontal bar per method from its low to its high estimate, a dot at its central value, today's price as a line. */
function FootballField({ methods, price, currency }) {
  const build = useCallback((t) => {
    const rows = [...methods].reverse(); // Plotly draws categories bottom-up
    const labels = rows.map((m) => m.label);
    return {
      data: [
        {
          type: 'bar', orientation: 'h', y: labels, base: rows.map((m) => m.low), x: rows.map((m) => m.high - m.low),
          marker: { color: rows.map((m) => (m.value >= price ? t.up : t.down)), opacity: 0.35 }, width: 0.5,
          hovertemplate: rows.map((m) => `${m.label}<br>range ${px(m.low)} – ${px(m.high)}<extra></extra>`),
        },
        {
          type: 'scatter', mode: 'markers+text', y: labels, x: rows.map((m) => m.value),
          marker: { size: 11, color: rows.map((m) => (m.value >= price ? t.up : t.down)), line: { color: t.text, width: 1 } },
          text: rows.map((m) => px(m.value)), textposition: 'top center', textfont: { size: 11, color: t.text },
          hovertemplate: rows.map((m) => `${m.label}: <b>${px(m.value)}</b> (${signed(upside(m.value, price))})<extra></extra>`),
        },
      ],
      layout: {
        hovermode: 'closest', margin: { l: 150, r: 24, t: 28, b: 36 }, bargap: 0.4,
        xaxis: { title: { text: currency ?? '' }, zeroline: false, showgrid: true, gridcolor: t.grid },
        yaxis: { type: 'category', gridcolor: 'rgba(0,0,0,0)', automargin: true },
        shapes: [{ type: 'line', yref: 'paper', y0: 0, y1: 1, x0: price, x1: price, line: { color: t.brand, width: 2, dash: 'dash' } }],
        annotations: [{ yref: 'paper', y: 1, x: price, yanchor: 'bottom', showarrow: false, text: `Price ${px(price)}`, font: { size: 11, color: t.brand } }],
      },
    };
  }, [methods, price, currency]);
  return <Plot build={build} className={methods.length > 5 ? 'h-[380px]' : 'h-[300px]'} />;
}

const PctInput = ({ id, label, value, onChange, step = 0.5 }) => (
  <label htmlFor={id} className="flex flex-col gap-1">
    {label}
    <span className="flex items-center gap-1 text-[var(--text)]">
      <input id={id} type="number" step={step} value={value} onChange={(e) => onChange(e.target.value)} className="w-24 text-right" />%
    </span>
  </label>
);

const toPct = (v) => (Math.round(v * 1000) / 10).toString(); // 0.1049 -> "10.5"

function DcfCard({ d, price, currency, assumptions, setAssumptions, result }) {
  const set = (k) => (v) => setAssumptions((a) => ({ ...a, [k]: v }));
  const reset = () => setAssumptions({ growth: toPct(d.growth), wacc: toPct(d.wacc), terminalGrowth: toPct(d.terminalGrowth) });
  const a = { growth: +assumptions.growth / 100, wacc: +assumptions.wacc / 100, terminalGrowth: +assumptions.terminalGrowth / 100 };
  const netDebt = d.netDebt;

  if (d.note || !(d.fcf > 0)) {
    return (
      <Card title="Discounted cash flow (DCF)">
        <p className="text-[var(--text-2)]">
          Not meaningful for this company: {d.note ?? `free cash flow over the ${d.fcfBasis} is negative (${big(d.fcf)} ${currency ?? ''})`}.
          A DCF needs positive cash flow to project; use the multiples and analyst targets instead.
        </p>
      </Card>
    );
  }

  const waccs = [-0.02, -0.01, 0, 0.01, 0.02].map((s) => a.wacc + s);
  const tgs = [-0.01, -0.005, 0, 0.005, 0.01].map((s) => a.terminalGrowth + s);
  const u = upside(result?.perShare, price);

  return (
    <Card title="Discounted cash flow (DCF)">
      <div className="flex flex-wrap items-end gap-4">
        <PctInput id="dcf-g" label="FCF growth, years 1–5" value={assumptions.growth} onChange={set('growth')} />
        <PctInput id="dcf-w" label="Discount rate (WACC)" value={assumptions.wacc} onChange={set('wacc')} step={0.25} />
        <PctInput id="dcf-t" label="Terminal growth" value={assumptions.terminalGrowth} onChange={set('terminalGrowth')} step={0.25} />
        <button type="button" onClick={reset}>Reset to defaults</button>
      </div>
      <p className="text-[var(--text-2)] text-xs mt-2">
        Defaults: growth = {d.growthSource} ({pct(d.growthRaw)}{d.growthRaw !== d.growth ? `, capped to ${pct(d.growth)}` : ''});
        WACC = cost of equity {pct(d.costEquity, 2)} (risk-free {pct(d.riskFree, 2)} + beta {d.betaUsed.toFixed(2)} × {pct(d.erp, 0)} premium)
        weighted {pct(1 - d.debtWeight, 0)} with after-tax cost of debt {pct(d.costDebt * (1 - d.taxRate), 2)} ({pct(d.debtWeight, 0)}), kept between 6% and 14%.
      </p>

      {result == null ? (
        <p className="text-[var(--err)] mt-3">The discount rate must be above the terminal growth rate.</p>
      ) : (
        <>
          <div className="grid grid-cols-[repeat(auto-fit,minmax(150px,1fr))] gap-3 my-3">
            <Tile label="Value per share" value={px(result.perShare)} sub={`${signed(u)} vs price`} className={upClass(u)} />
            <Tile label={`Free cash flow (${d.fcfBasis})`} value={big(d.fcf)} sub={currency ?? ''} />
            <Tile label="Enterprise value" value={big(result.ev)} sub={`terminal value = ${pct(result.tvPv / result.ev, 0)} of it`} />
            <Tile label="Net debt" value={big(netDebt)} sub={`debt ${big(d.debt)} − cash ${big(d.cash)}${d.minority ? ` + minorities ${big(d.minority)}` : ''}`} />
            <Tile label="Equity value" value={big(result.equity)} sub={`÷ ${big(d.shares)} shares`} />
          </div>

          <div className="grid grid-cols-2 max-[900px]:grid-cols-1 gap-6">
            <div>
              <h3>Projected free cash flow</h3>
              <div className="overflow-auto border border-[var(--border)] rounded-md">
                <table>
                  <thead><tr><th>Year</th><th>Growth</th><th>FCF</th><th>Present value</th></tr></thead>
                  <tbody>
                    {result.rows.map((r) => (
                      <tr key={r.y}><td>{r.y}</td><td>{pct(r.g)}</td><td>{big(r.fcf)}</td><td>{big(r.pv)}</td></tr>
                    ))}
                    <tr className="font-semibold"><td>Terminal</td><td>{pct(a.terminalGrowth)}</td><td>{big(result.tv)}</td><td>{big(result.tvPv)}</td></tr>
                  </tbody>
                </table>
              </div>
            </div>
            <div>
              <h3>Sensitivity: value per share</h3>
              <div className="overflow-auto border border-[var(--border)] rounded-md">
                <table>
                  <thead>
                    <tr><th>WACC ↓ / terminal growth →</th>{tgs.map((g) => <th key={g}>{pct(g)}</th>)}</tr>
                  </thead>
                  <tbody>
                    {waccs.map((w) => (
                      <tr key={w}>
                        <td className="font-semibold">{pct(w, 2)}</td>
                        {tgs.map((g) => {
                          const v = dcf({ fcf: d.fcf, growth: a.growth, wacc: w, terminalGrowth: g, netDebt, shares: d.shares })?.perShare;
                          const centre = Math.abs(w - a.wacc) < 1e-9 && Math.abs(g - a.terminalGrowth) < 1e-9;
                          return <td key={g} className={`${upClass(upside(v, price))} ${centre ? 'font-bold bg-[var(--surface)]' : ''}`}>{px(v)}</td>;
                        })}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <p className="text-[var(--text-2)] text-xs mt-1">Green = above today's price, red = below. Bold = your assumptions.</p>
            </div>
          </div>
        </>
      )}
    </Card>
  );
}

function MultiplesCard({ m, years, setYears, price }) {
  return (
    <Card title="Historical multiples">
      <div className="flex flex-wrap items-center gap-3 mb-2">
        <span className="text-[var(--text-2)] text-[13px]">Company's own median over the last</span>
        <Seg options={[['5', '5 years'], ['10', '10 years']]} value={years} onChange={setYears} />
      </div>
      {m.note ? (
        <p className="text-[var(--text-2)]">Not available: {m.note}.</p>
      ) : (
        <div className="overflow-auto border border-[var(--border)] rounded-md">
          <table>
            <thead>
              <tr><th>Multiple</th><th>Today</th><th>Median</th><th>25th – 75th pct.</th><th>Fair price</th><th>Range</th><th>vs price</th></tr>
            </thead>
            <tbody>
              {m.items.map((it) => {
                const w = it.windows[years];
                const u = upside(w?.fair, price);
                return (
                  <tr key={it.key}>
                    <td className="font-semibold">{it.label}</td>
                    <td>{it.current == null ? '–' : `${it.current.toFixed(1)}x`}</td>
                    {w ? (
                      <>
                        <td>{w.median.toFixed(1)}x</td>
                        <td>{w.p25.toFixed(1)}x – {w.p75.toFixed(1)}x</td>
                        <td className="font-semibold">{px(w.fair)}</td>
                        <td>{px(w.low)} – {px(w.high)}</td>
                        <td className={upClass(u)}>{signed(u)}</td>
                      </>
                    ) : (
                      <td colSpan={5} className="text-left text-[var(--text-2)]">{it.note ?? `fewer than 2 years of data in the last ${years} years`}</td>
                    )}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      <p className="text-[var(--text-2)] text-xs mt-2">
        Fair price = today's fundamentals (trailing 12 months: EPS, EBITDA less net debt, FCF per share, sales per share) × the multiple's
        median at quarter ends over the chosen window (Finnhub). The range uses the 25th and 75th percentile. It asks "what if the market paid
        what it usually paid for this company?", so it cannot tell whether the company's history itself was cheap or expensive.
      </p>
    </Card>
  );
}

function AnalystCard({ a, price }) {
  if (a.note) {
    return <Card title="Analyst price targets"><p className="text-[var(--text-2)]">{a.note}.</p></Card>;
  }
  const u = upside(a.mean, price);
  return (
    <Card title="Analyst price targets">
      <div className="grid grid-cols-[repeat(auto-fit,minmax(130px,1fr))] gap-3">
        <Tile label="Low" value={px(a.low)} sub={signed(upside(a.low, price))} />
        <Tile label="Mean" value={px(a.mean)} sub={signed(u)} className={upClass(u)} />
        <Tile label="Median" value={px(a.median)} sub={signed(upside(a.median, price))} />
        <Tile label="High" value={px(a.high)} sub={signed(upside(a.high, price))} />
        <Tile label="Analysts" value={a.analysts ?? '–'} sub={a.recommendation ? `consensus: ${a.recommendation.replace('_', ' ')}` : ''} />
      </div>
      <p className="text-[var(--text-2)] text-xs mt-2">12-month price targets from Yahoo's analyst consensus. Targets tend to follow the price and lean optimistic.</p>
    </Card>
  );
}

export default function FairValueTab({ symbol }) {
  const api = useApi(`/api/fair-value/${encodeURIComponent(symbol)}`);
  const [years, setYears] = useState('10');
  const [assumptions, setAssumptions] = useState(null); // null = the defaults from the API

  const d = api.data;
  const dd = d?.dcf;
  const inputs = assumptions ?? (dd ? { growth: toPct(dd.growth), wacc: toPct(dd.wacc), terminalGrowth: toPct(dd.terminalGrowth) } : null);

  const result = useMemo(() => {
    if (!dd || !inputs || dd.note || !(dd.fcf > 0)) return null;
    return dcf({ fcf: dd.fcf, growth: +inputs.growth / 100, wacc: +inputs.wacc / 100, terminalGrowth: +inputs.terminalGrowth / 100, netDebt: dd.netDebt, shares: dd.shares });
  }, [dd, inputs?.growth, inputs?.wacc, inputs?.terminalGrowth]); // eslint-disable-line react-hooks/exhaustive-deps

  const methods = useMemo(() => {
    if (!d) return [];
    const out = [];
    if (result && result.perShare > 0) {
      const at = (dw) => dcf({ fcf: dd.fcf, growth: +inputs.growth / 100, wacc: +inputs.wacc / 100 + dw, terminalGrowth: +inputs.terminalGrowth / 100, netDebt: dd.netDebt, shares: dd.shares })?.perShare;
      const lo = at(0.01);
      const hi = at(-0.01);
      out.push({ label: 'DCF', value: result.perShare, low: lo ?? result.perShare, high: hi ?? result.perShare });
    }
    for (const it of d.multiples.items ?? []) {
      const w = it.windows[years];
      if (w) out.push({ label: `${it.label} (median ${years}y)`, value: w.fair, low: w.low, high: w.high });
    }
    if (!d.analysts.note) out.push({ label: 'Analyst targets', value: d.analysts.mean, low: d.analysts.low, high: d.analysts.high });
    return out;
  }, [d, dd, result, years, inputs?.growth, inputs?.wacc, inputs?.terminalGrowth]); // eslint-disable-line react-hooks/exhaustive-deps

  if (api.loading) return <p className="text-[var(--text-2)] py-6">Loading…</p>;
  if (api.error) return <p className="text-[var(--err)] py-6">Could not estimate the fair value of {symbol}: {api.error.message}</p>;

  const { price, currency, warning } = d;
  const mid = methods.length ? median(methods.map((m) => m.value).sort((a, b) => a - b)) : null;
  const u = upside(mid, price);

  return (
    <>
      <h2>{symbol} · Fair value</h2>
      {warning && <div className="py-[10px] px-3.5 rounded-lg my-2 bg-[var(--warn-bg)] text-[var(--warn-text)]">{warning}</div>}

      <div className="grid grid-cols-[repeat(auto-fit,minmax(170px,1fr))] gap-3 my-3">
        <Tile label="Price" value={px(price)} sub={currency ?? ''} />
        <Tile label="Fair value (median of methods)" value={px(mid)} sub={`${methods.length} estimates`} />
        <Tile label="Upside / downside" value={signed(u)} sub="median fair value vs price" className={upClass(u)} />
        <Tile label="Reading" value={verdict(u)} sub="more than 10% away from the price counts" />
      </div>

      {methods.length ? (
        <FootballField methods={methods} price={price} currency={currency} />
      ) : (
        <p className="text-[var(--text-2)]">No method produced a fair value for this company.</p>
      )}
      <p className="text-[var(--text-2)] text-xs">
        Each bar is one method's range (DCF: WACC ± 1 point; multiples: 25th–75th percentile; analysts: lowest–highest target); the dot is its central
        value. Green = above today's price, red = below. Your DCF assumptions below update this chart immediately.
      </p>

      <DcfCard d={dd} price={price} currency={currency} assumptions={inputs} setAssumptions={(f) => setAssumptions(f(inputs))} result={result} />
      <MultiplesCard m={d.multiples} years={years} setYears={setYears} price={price} />
      <AnalystCard a={d.analysts} price={price} />

      <p className="text-[var(--text-2)] text-[13px] mt-4">
        A fair value is an estimate built on assumptions, not a price the stock must reach. The three approaches answer different questions: the DCF
        values the cash the business is expected to generate (very sensitive to growth and the discount rate: see the sensitivity table), historical
        multiples ask what the market has usually paid for this company, and analyst targets show what the sell side expects over 12 months. Where
        they agree, the estimate is more robust. Free cash flow = operating cash flow − capital expenditure (yfinance); net debt = total debt − cash
        and short-term investments + minority interests (the part of subsidiaries other shareholders own); shares = market cap ÷ price. DCF and free-cash-flow multiples are not meaningful for banks and insurers.
      </p>
    </>
  );
}
