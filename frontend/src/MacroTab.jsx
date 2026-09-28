import { useCallback, useMemo, useState } from 'react';
import { useApi } from './api.js';
import Plot from './Plot.jsx';

const RANGES = ['5Y', '10Y', '20Y', 'Max'];
const INVERTED = 'rgba(220, 80, 80, 0.12)';
const pct = (v, d = 2) => (v == null ? '–' : `${v.toFixed(d)}%`);
const signed = (v, d = 2) => (v == null ? '–' : `${v >= 0 ? '+' : ''}${v.toFixed(d)} pts`);

/** Start date (YYYY-MM-DD) of a range pill, '' for Max. */
function cutoffFor(range) {
  return range === 'Max' ? '' : new Date(Date.now() - parseInt(range, 10) * 365.25 * 864e5).toISOString().slice(0, 10);
}

/** The dates from `cutoff` on, with the same slice of every series. */
function cut(cutoff, dates, ...series) {
  const i = cutoff ? dates.findIndex((d) => d >= cutoff) : 0;
  const from = i < 0 ? dates.length : i;
  return [dates.slice(from), ...series.map((s) => s.slice(from))];
}

/** Shaded boxes over the stretches where a spread is below zero (an inverted yield curve). */
function inversionShapes(dates, spread) {
  const shapes = [];
  let start = null;
  spread.forEach((v, i) => {
    if (v != null && v < 0 && start == null) start = dates[i];
    if ((v == null || v >= 0) && start != null) {
      shapes.push({ type: 'rect', xref: 'x', yref: 'paper', x0: start, x1: dates[i], y0: 0, y1: 1, fillcolor: INVERTED, line: { width: 0 }, layer: 'below' });
      start = null;
    }
  });
  if (start != null) shapes.push({ type: 'rect', xref: 'x', yref: 'paper', x0: start, x1: dates.at(-1), y0: 0, y1: 1, fillcolor: INVERTED, line: { width: 0 }, layer: 'below' });
  return shapes;
}

const zeroLine = (y = 0, dash = 'dot') => ({ type: 'line', xref: 'paper', x0: 0, x1: 1, yref: 'y', y0: y, y1: y, line: { color: '#888', width: 1, dash } });
const line = (x, y, name, color, { line: style, ...rest } = {}) => ({
  x, y, name, type: 'scatter', mode: 'lines', connectgaps: true, line: { color, width: 1.6, ...style },
  hovertemplate: `%{y:.2f}%<extra>${name}</extra>`, ...rest,
});
const LEGEND = { showlegend: true, legend: { orientation: 'h', x: 0.5, xanchor: 'center', y: -0.14 } };
const MARGIN = { l: 44, r: 16, t: 8, b: 44 };
const yAxis = { ticksuffix: '%' };

const Tile = ({ label, value, sub, warn }) => (
  <div className="bg-[var(--surface)] rounded-lg py-3 px-3.5">
    <div className="text-[var(--text-2)] text-[13px]">{label}</div>
    <div className="text-2xl font-semibold tabular-nums">{value}</div>
    <div className={`text-xs ${warn ? 'text-[var(--err)] font-semibold' : 'text-[var(--text-2)]'}`}>{sub}</div>
  </div>
);

function Panel({ title, note, children }) {
  return (
    <section className="min-w-0">
      <h3 className="mt-6 mb-0.5">{title}</h3>
      <p className="text-[var(--text-2)] text-[13px] mb-1.5">{note}</p>
      {children}
    </section>
  );
}

function Charts({ d, range }) {
  const cutoff = cutoffFor(range);
  const y = useMemo(() => {
    const [dates, m3, y2, y10, y30, s2s10, s3m10] = cut(cutoff, d.yields.dates, d.yields.m3, d.yields.y2, d.yields.y10, d.yields.y30, d.yields.s2s10, d.yields.s3m10);
    return { dates, m3, y2, y10, y30, s2s10, s3m10 };
  }, [d, cutoff]);
  const infl = useMemo(() => { const [dates, cpi, core, cpi3m] = cut(cutoff, d.inflation.dates, d.inflation.cpi, d.inflation.core, d.inflation.cpi3m); return { dates, cpi, core, cpi3m }; }, [d, cutoff]);
  const exp = useMemo(() => { const [dates, y1, y5, y10, y30, real10] = cut(cutoff, d.expectations.dates, d.expectations.y1, d.expectations.y5, d.expectations.y10, d.expectations.y30, d.expectations.real10); return { dates, y1, y5, y10, y30, real10 }; }, [d, cutoff]);
  const lab = useMemo(() => { const [dates, un, sahm, wages] = cut(cutoff, d.labor.dates, d.labor.unemployment, d.labor.sahm, d.labor.aheYoy); return { dates, un, sahm, wages }; }, [d, cutoff]);
  const pol = useMemo(() => { const [dates, upper, lower, effr, sofr] = cut(cutoff, d.policy.dates, d.policy.upper, d.policy.lower, d.policy.effr, d.policy.sofr); return { dates, upper, lower, effr, sofr }; }, [d, cutoff]);
  // wages vs inflation share the months both exist for
  const wageLine = useMemo(() => {
    const cpiByMonth = new Map(d.inflation.dates.map((m, i) => [m, d.inflation.cpi[i]]));
    return lab.dates.map((m) => cpiByMonth.get(m) ?? null);
  }, [d, lab]);

  const curve = useCallback((t) => {
    const x = d.yields.curve.map((c) => c.maturity);
    const trace = (key, name, color, dash) => ({ x, y: d.yields.curve.map((c) => c[key]), name, type: 'scatter', mode: 'lines+markers', connectgaps: true, line: { color, width: dash ? 1.5 : 2.4, dash }, marker: { size: 5 }, hovertemplate: `%{y:.2f}%<extra>${name}</extra>` });
    return {
      data: [trace('yearAgo', `1 year ago (${d.yields.dateYearAgo})`, t.muted, 'dot'), trace('monthAgo', `1 month ago (${d.yields.dateMonthAgo})`, t.palette[1], 'dash'), trace('today', `Today (${d.yields.date})`, t.brand)],
      layout: { ...LEGEND, margin: MARGIN, xaxis: { type: 'category' }, yaxis: yAxis },
    };
  }, [d]);
  const yields = useCallback((t) => ({
    data: [line(y.dates, y.m3, '3 months', t.palette[2]), line(y.dates, y.y2, '2 years', t.palette[1]), line(y.dates, y.y10, '10 years', t.brand), line(y.dates, y.y30, '30 years', t.muted)],
    layout: { ...LEGEND, margin: MARGIN, yaxis: yAxis, shapes: inversionShapes(y.dates, y.s2s10) },
  }), [y]);
  const spreads = useCallback((t) => ({
    data: [line(y.dates, y.s2s10, '10Y − 2Y', t.brand), line(y.dates, y.s3m10, '10Y − 3M', t.palette[1])],
    layout: { ...LEGEND, margin: MARGIN, yaxis: { ticksuffix: ' pts', zeroline: false }, shapes: [zeroLine(), ...inversionShapes(y.dates, y.s2s10)] },
  }), [y]);
  const policy = useCallback((t) => ({
    data: [line(pol.dates, pol.upper, 'Target ceiling', t.palette[1]), line(pol.dates, pol.lower, 'Target floor', t.palette[2]), line(pol.dates, pol.effr, 'Effective fed funds', t.brand), line(pol.dates, pol.sofr, 'SOFR', t.muted, { line: { dash: 'dot' } })],
    layout: { ...LEGEND, margin: MARGIN, yaxis: yAxis },
  }), [pol]);
  const inflation = useCallback((t) => ({
    data: [line(infl.dates, infl.cpi, 'CPI, year on year', t.brand), line(infl.dates, infl.core, 'Core CPI, year on year', t.palette[1]), line(infl.dates, infl.cpi3m, 'CPI, last 3 months annualised', t.muted, { line: { dash: 'dot', width: 1.2 } })],
    layout: { ...LEGEND, margin: MARGIN, yaxis: { ...yAxis, zeroline: false }, shapes: [zeroLine()] },
  }), [infl]);
  const expectations = useCallback((t) => ({
    data: [line(exp.dates, exp.y1, '1 year', t.palette[2]), line(exp.dates, exp.y5, '5 years', t.palette[1]), line(exp.dates, exp.y10, '10 years', t.brand), line(exp.dates, exp.y30, '30 years', t.muted)],
    layout: { ...LEGEND, margin: MARGIN, yaxis: yAxis },
  }), [exp]);
  const real = useCallback((t) => ({
    data: [{ ...line(exp.dates, exp.real10, 'Real 10Y yield', t.brand), fill: 'tozeroy', fillcolor: 'rgba(60,100,200,0.08)' }],
    layout: { margin: MARGIN, yaxis: { ...yAxis, zeroline: false }, shapes: [zeroLine()] },
  }), [exp]);
  const sahm = useCallback((t) => ({
    data: [
      { ...line(lab.dates, lab.un, 'Unemployment rate', t.brand) },
      { x: lab.dates, y: lab.sahm, name: 'Sahm indicator', type: 'bar', yaxis: 'y2', marker: { color: lab.sahm.map((v) => (v != null && v >= 0.5 ? t.down : t.muted)), opacity: 0.55 }, hovertemplate: '%{y:.2f} pts<extra>Sahm indicator</extra>' },
    ],
    layout: {
      ...LEGEND, margin: { ...MARGIN, r: 44 }, yaxis: yAxis,
      yaxis2: { overlaying: 'y', side: 'right', showgrid: false, zeroline: false, ticksuffix: ' pts', range: [0, Math.max(1.5, ...lab.sahm.map((v) => v ?? 0))] },
      shapes: [{ type: 'line', xref: 'paper', x0: 0, x1: 1, yref: 'y2', y0: 0.5, y1: 0.5, line: { color: '#d55', width: 1, dash: 'dot' } }],
    },
  }), [lab]);
  const wages = useCallback((t) => ({
    data: [line(lab.dates, lab.wages, 'Average hourly earnings, year on year', t.brand), line(lab.dates, wageLine, 'CPI, year on year', t.palette[1])],
    layout: { ...LEGEND, margin: MARGIN, yaxis: { ...yAxis, zeroline: false }, shapes: [zeroLine()] },
  }), [lab, wageLine]);

  return (
    <div className="grid grid-cols-2 max-[900px]:grid-cols-1 gap-x-8">
      <Panel title="Yield curve" note="US Treasury yield by maturity. A curve that slopes down (short rates above long rates) is inverted.">
        <Plot build={curve} className="h-[300px]" />
      </Panel>
      <Panel title="Treasury yields over time" note="Shaded red where the 10Y−2Y spread was negative (inverted).">
        <Plot build={yields} className="h-[300px]" />
      </Panel>
      <Panel title="Curve spreads" note="10Y − 2Y and 10Y − 3M. Below zero = inverted, which has preceded most US recessions.">
        <Plot build={spreads} className="h-[300px]" />
      </Panel>
      <Panel title="Fed policy rate" note="Federal funds target range and the rates actually traded overnight (since 2015).">
        <Plot build={policy} className="h-[300px]" />
      </Panel>
      <Panel title="Inflation" note="Consumer price index, year on year, computed from the CPI index level. Core excludes food and energy.">
        <Plot build={inflation} className="h-[300px]" />
      </Panel>
      <Panel title="Inflation expectations" note="Model-based expected average inflation over the next 1, 5, 10 and 30 years.">
        <Plot build={expectations} className="h-[300px]" />
      </Panel>
      <Panel title="Real 10-year yield" note="10-year Treasury yield at month end minus the 10-year inflation expectation: what bonds pay after expected inflation.">
        <Plot build={real} className="h-[300px]" />
      </Panel>
      <Panel title="Unemployment and the Sahm rule" note="Bars: 3-month average unemployment minus its lowest level of the last 12 months. At 0.50 pts or more (dotted line, red bars) a recession has usually started.">
        <Plot build={sahm} className="h-[300px]" />
      </Panel>
      <Panel title="Wages versus inflation" note="Average hourly earnings growth against CPI. Wages above the CPI line means real pay is rising.">
        <Plot build={wages} className="h-[300px]" />
      </Panel>
    </div>
  );
}

const signedPct = (v, d = 1) => (v == null ? '–' : `${v >= 0 ? '+' : ''}${v.toFixed(d)}%`);
const strength = (t) => (t == null ? '' : Math.abs(t) >= 2 ? 'statistically clear' : 'weak, could be noise');

/** How the stock in the header moves with the 10-year yield: regressions of monthly returns on the monthly change in the yield. */
function RateSensitivity({ symbol }) {
  const { data: r, error, loading } = useApi(`/api/rate-sensitivity/${encodeURIComponent(symbol)}`);
  const main = r?.windows.find((w) => w.label === '10 years') ?? r?.windows.at(-1);

  const rolling = useCallback((t) => ({
    data: [{
      x: r.rolling.dates, y: r.rolling.beta, type: 'scatter', mode: 'lines', line: { color: t.brand, width: 2 },
      hovertemplate: '%{y:.1f}% per +1 pt<extra>36-month window</extra>',
    }],
    layout: { margin: MARGIN, yaxis: { ticksuffix: '%', zeroline: false }, shapes: [zeroLine()] },
  }), [r]);
  const scatter = useCallback((t) => {
    const xs = r.scatter.dy.filter((v) => v != null);
    const lo = Math.min(...xs), hi = Math.max(...xs);
    const ten = r.windows.find((w) => w.label === '10 years') ?? r.windows.at(-1);
    const mean = (a) => a.reduce((x, y) => x + y, 0) / a.length;
    const b = ten.rateBeta, a = mean(r.scatter.ret.filter((v) => v != null)) - b * mean(xs);
    return {
      data: [
        {
          x: r.scatter.dy, y: r.scatter.ret, customdata: r.scatter.dates, type: 'scatter', mode: 'markers', marker: { color: t.brand, size: 6, opacity: 0.6 },
          hovertemplate: '%{customdata}: yield %{x:+.2f} pts, stock %{y:+.1f}%<extra></extra>',
        },
        { x: [lo, hi], y: [a + b * lo, a + b * hi], type: 'scatter', mode: 'lines', line: { color: t.down, width: 1.5, dash: 'dash' }, hoverinfo: 'skip' },
      ],
      layout: {
        hovermode: 'closest', margin: { l: 50, r: 16, t: 8, b: 44 },
        xaxis: { title: { text: 'Change in the 10-year yield that month (pts)' }, zeroline: true, zerolinecolor: t.border },
        yaxis: { ticksuffix: '%', zeroline: true, zerolinecolor: t.border },
      },
    };
  }, [r]);

  return (
    <section className="mt-10 pt-2 border-t border-[var(--border)]">
      <h2 className="mt-4">How {symbol} reacts to interest rates</h2>
      <p className="text-[var(--text-2)] text-[13px] mb-3">
        Monthly returns (price only) compared with the monthly change in the US 10-year yield. "Market removed" also takes the S&amp;P 500's return
        into account, so it shows the rate effect beyond "the whole market moved". A value of −5% means the stock tended to fall 5% more in a month
        the yield rose 1 point (a typical month moves the yield by 0.1-0.3 points). History, not a forecast.
      </p>
      {loading && <p className="text-[var(--text-2)] py-4">Loading…</p>}
      {error && <p className="text-[var(--err)] py-4">{error.message}</p>}
      {r && (
        <>
          <p className="text-sm mb-3">
            Over {main.label === '10 years' ? 'the last 10 years' : main.label.toLowerCase()} ({main.months} months), a 1-point rise in the 10-year yield went with a
            {' '}<b>{signedPct(main.rateBetaNet)}</b> move in {symbol} beyond what the market explains ({strength(main.rateNetT)}, t = {main.rateNetT?.toFixed(1)});
            its market beta was <b>{main.marketBeta?.toFixed(2)}</b>.
          </p>
          <div className="overflow-auto border border-[var(--border)] rounded-md">
            <table>
              <thead>
                <tr>
                  <th className="text-left">Window</th><th>Months</th><th>Per +1 pt in the 10Y</th><th>t</th><th>Per +1 pt, market removed</th><th>t</th>
                  <th>Market beta</th><th>Correlation with yield changes</th>
                </tr>
              </thead>
              <tbody>
                {r.windows.map((w) => (
                  <tr key={w.label}>
                    <td className="text-left">{w.label} <small className="text-[var(--text-2)]">({w.from} → {w.to})</small></td>
                    <td>{w.months}</td><td>{signedPct(w.rateBeta)}</td><td title={strength(w.rateT)}>{w.rateT?.toFixed(1)}</td>
                    <td className="font-semibold">{signedPct(w.rateBetaNet)}</td><td title={strength(w.rateNetT)}>{w.rateNetT?.toFixed(1)}</td>
                    <td>{w.marketBeta?.toFixed(2)}</td><td>{w.corr?.toFixed(2)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="text-[var(--text-2)] text-xs mt-1">t: how clearly the number differs from zero; below 2 in absolute value it could be chance.</p>
          <div className="grid grid-cols-2 max-[900px]:grid-cols-1 gap-x-8">
            <Panel title="Rate sensitivity over time" note="Market removed, each point = the previous 36 months. Above zero: the stock did better when yields rose.">
              {r.rolling.dates.length ? <Plot build={rolling} className="h-[280px]" /> : <p className="text-[var(--text-2)] py-4">Needs 3 years of history.</p>}
            </Panel>
            <Panel title="Monthly returns vs yield changes" note="Last 10 years (or all history), one dot per month; dashed line = the fitted slope.">
              <Plot build={scatter} className="h-[280px]" />
            </Panel>
          </div>
          <h3 className="mt-6">Average month by regime</h3>
          <div className="overflow-auto border border-[var(--border)] rounded-md max-w-[640px]">
            <table>
              <thead><tr><th className="text-left">Months when…</th><th>Months</th><th>Average return</th><th>Up months</th></tr></thead>
              <tbody>
                {r.regimes.map((g) => (
                  <tr key={g.label}><td className="text-left">{g.label}</td><td>{g.months}</td><td>{signedPct(g.avg, 2)}</td><td>{g.up == null ? '–' : `${g.up.toFixed(0)}%`}</td></tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="text-[var(--text-2)] text-xs mt-1">
            Since {r.from}. Inflation = US CPI year on year in that month. {symbol}'s price is in its own currency; the yields and CPI are American.
          </p>
        </>
      )}
    </section>
  );
}

export default function MacroTab({ symbol }) {
  const [range, setRange] = useState('10Y');
  const { data: d, error, loading } = useApi('/api/macro');
  if (loading) return <p className="text-[var(--text-2)] py-6">Loading macro data (the first load takes a few seconds)…</p>;
  if (error) return <p className="text-[var(--err)] py-6">Could not load macro data: {error.message}</p>;

  const t = d.tiles;
  const inverted = t.s2s10.value < 0;
  const sahmOn = t.sahm.value >= 0.5;
  return (
    <>
      <h2>Macro</h2>
      <p className="text-[var(--text-2)] text-[13px] mb-3">
        Federal Reserve data served by Massive. Yields are daily (1-2 days behind); inflation, expectations and labor are monthly and
        arrive with the official release. The same 10-year yield is the risk-free rate in the Fair value tab.
      </p>

      <div className="grid grid-cols-[repeat(auto-fit,minmax(170px,1fr))] gap-3">
        <Tile label="10-year yield" value={pct(t.y10.value)} sub={t.y10.date} />
        <Tile label="10Y − 2Y spread" value={signed(t.s2s10.value)} sub={inverted ? 'Inverted curve' : 'Normal curve'} warn={inverted} />
        <Tile label="10Y − 3M spread" value={signed(t.s3m10.value)} sub={t.s3m10.value < 0 ? 'Inverted curve' : 'Normal curve'} warn={t.s3m10.value < 0} />
        <Tile label="Fed funds target" value={`${t.policy.lower?.toFixed(2)}–${t.policy.upper?.toFixed(2)}%`} sub={t.policy.date} />
        <Tile label="CPI inflation" value={pct(t.cpi.value)} sub={`year on year · ${t.cpi.date.slice(0, 7)}`} />
        <Tile label="Core CPI" value={pct(t.core.value)} sub={`year on year · ${t.core.date.slice(0, 7)}`} />
        <Tile label="Real 10Y yield" value={pct(t.real10.value)} sub={`after expected inflation · ${t.real10.date.slice(0, 7)}`} />
        <Tile label="Unemployment" value={pct(t.unemployment.value, 1)} sub={t.unemployment.date.slice(0, 7)} />
        <Tile label="Sahm indicator" value={`${t.sahm.value.toFixed(2)} pts`} sub={sahmOn ? 'Recession signal (0.50+)' : 'No recession signal (below 0.50)'} warn={sahmOn} />
        <Tile label="Wage growth" value={pct(t.wages.value)} sub={`year on year · ${t.wages.date.slice(0, 7)}`} />
      </div>

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

      <Charts d={d} range={range} />
      {symbol && <RateSensitivity symbol={symbol} />}
    </>
  );
}
