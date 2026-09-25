import { useCallback, useMemo, useState } from 'react';
import { useApi } from './api.js';
import Plot from './Plot.jsx';
import { DataTable, Seg } from './ui.jsx';

const WINDOWS = [
  ['current', 'Current'], ['last', 'Last year'], ['3', '3 years'], ['5', '5 years'], ['7', '7 years'],
  ['10', '10 years'], ['15', '15 years'], ['20', '20 years'], ['25', '25 years'], ['30', '30 years'],
];
const NAME = Object.fromEntries(WINDOWS);
const COLOR = { current: '--text', last: '--cat-5', 3: '--cat-4', 5: '--cat-1', 7: '--cat-3', 10: '--cat-8', 15: '--cat-7', 20: '--cat-2', 25: '--cat-6', 30: '--muted' };
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const SHORT = MONTHS.map((m) => m.slice(0, 3));
const WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
const DPO_DAYS = [10, 20, 40, 60];

const cssVar = (name) => getComputedStyle(document.documentElement).getPropertyValue(name).trim();
const colorOf = (key) => cssVar(COLOR[key]);
const pad = (n) => String(n).padStart(2, '0');
const daysIn = (month, year = 2024) => new Date(year, month, 0).getDate(); // month 1..12; 2024 is a leap year so 02-29 exists
const fmtDate = (iso) => `${iso.slice(5, 7)}/${iso.slice(8, 10)}/${iso.slice(0, 4)}`;
const signedPct = (v, d = 2) => `${v > 0 ? '+' : ''}${v.toFixed(d)}%`;
const mdOf = (date) => `${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;

function defaultRange() {
  const today = new Date();
  return { start: mdOf(today), end: mdOf(new Date(today.getTime() + 60 * 86400000)) }; // "what usually happens over the next two months"
}

/** Value minus its centred moving average: what is left when the trend is taken out (a detrended price oscillator). */
function detrend(values, n) {
  const half = Math.floor(n / 2);
  return values.map((v, i) => {
    if (v == null) return null;
    let sum = 0;
    let count = 0;
    for (let j = Math.max(0, i - half); j <= Math.min(values.length - 1, i + half); j++) {
      if (values[j] != null) {
        sum += values[j];
        count += 1;
      }
    }
    return v - sum / count;
  });
}

/** Bar as in the reference: up-share above 50% is drawn upwards as "% long", otherwise downwards as "% short". */
function signed(up, n) {
  if (!n) return null;
  const p = (up / n) * 100;
  return { p, share: Math.max(p, 100 - p), y: p === 50 ? 0 : p > 50 ? p : -(100 - p) };
}

/** Date of the chart's dummy year for a "MM-DD" string (the chart spans two dummy years when it does not start in January). */
const chartDate = (md, startMonth) => {
  const [m, d] = md.split('-').map(Number);
  return `${m >= startMonth ? 2001 : 2002}-${pad(m)}-${pad(Math.min(d, daysIn(m, 2001)))}`;
};
const mdOfChartX = (x) => (typeof x === 'number' ? new Date(x).toISOString() : String(x)).slice(5, 10);

// ------------------------------------------------------------------ seasonal curve

function CurveChart({ data, active, view, dpo, range, onRange }) {
  const build = useCallback((t) => {
    const detrended = view === 'detrended';
    const traces = active.map((k) => ({
      type: 'scatter', mode: 'lines+markers', marker: { size: 2, opacity: 0 }, name: NAME[k], connectgaps: false, x: data.dates,
      y: detrended ? detrend(data.series[k].values, dpo) : data.series[k].values,
      line: { color: colorOf(k), width: 1.6 }, hovertemplate: `%{y:+.2f}%<extra>${NAME[k]}</extra>`,
    }));
    const [a, b] = [chartDate(range.start, data.startMonth), chartDate(range.end, data.startMonth)];
    const [first, last] = [data.dates[0], data.dates.at(-1)];
    const rect = (x0, x1) => ({ type: 'rect', xref: 'x', yref: 'paper', x0, x1, y0: 0, y1: 1, fillcolor: t.series, opacity: 0.12, line: { width: 0 }, layer: 'below' });
    return {
      data: traces,
      layout: {
        dragmode: 'select', selectdirection: 'h', shapes: a <= b ? [rect(a, b)] : [rect(a, last), rect(first, b)], // a period crossing New Year is two boxes
        xaxis: { type: 'date', range: [first, last], tickformat: '%b', hoverformat: '%b %d', dtick: 'M1', ticklabelmode: 'period' },
        yaxis: { ticksuffix: '%', zeroline: detrended, zerolinecolor: t.muted },
      },
    };
  }, [data, active, view, dpo, range]);
  return <Plot build={build} onRange={onRange} />;
}

// ------------------------------------------------------------------ daily / weekly / monthly probabilities

/** `rows[key]` = [{ up, n, avg? }] per bar; every bar is the share of up moves as % long / % short. */
function ProbChart({ labels, keys, rows, unit, dense }) {
  const build = useCallback((t) => {
    const traces = keys.map((k) => {
      const bars = rows[k].map((r) => signed(r.up, r.n));
      return {
        type: 'bar', name: NAME[k], x: labels, y: bars.map((b) => b && b.y), marker: { color: colorOf(k) },
        text: keys.length <= 3 ? bars.map((b) => (b ? String(Math.round(b.share)) : '')) : undefined, textposition: 'outside', cliponaxis: false,
        textfont: { size: dense ? 8 : 10, color: t.text },
        customdata: rows[k].map((r, i) => (bars[i]
          ? `${Math.round(bars[i].p)}% up: ${r.up} of ${r.n} ${unit}${r.avg == null ? '' : ` · average ${signedPct(r.avg)}`}`
          : 'no data')),
        hovertemplate: `%{customdata}<extra>${NAME[k]}</extra>`,
      };
    });
    const top = Math.max(0, ...traces.flatMap((tr) => tr.y.map((v) => Math.abs(v ?? 0))));
    const wide = top > 70; // weekday bars are all near 50%, so they get a tighter scale as in the reference
    const ticks = wide ? [100, 50, 0, -50, -100] : [60, 30, 0, -30, -60];
    return {
      data: traces,
      layout: {
        barmode: 'group', bargap: 0.2, bargroupgap: 0.05, margin: { l: 96, r: 16, t: 24, b: 32 },
        xaxis: { type: 'category' },
        yaxis: { range: wide ? [-112, 112] : [-75, 75], tickvals: ticks, ticktext: ticks.map((v) => (v === 0 ? '0%' : `${Math.abs(v)}% ${v > 0 ? 'LONG' : 'SHORT'}`)), zeroline: true, zerolinecolor: t.muted },
      },
    };
  }, [labels, keys, rows, unit, dense]);
  return <Plot build={build} className="h-[260px]" />;
}

function Probabilities({ data, active }) {
  const [month, setMonth] = useState(() => new Date(`${data.lastDate}T00:00:00`).getMonth());
  const weekend = Object.values(data.stats).some((s) => s.weekday.n[5] > 0 || s.weekday.n[6] > 0);
  const keys = active.filter((k) => data.stats[k]);
  const pick = (fn) => Object.fromEntries(keys.map((k) => [k, fn(data.stats[k])]));
  const zip = (up, n, avg) => up.map((u, i) => ({ up: u, n: n[i], avg: avg?.[i] }));

  const length = daysIn(month + 1);
  const dayLabels = useMemo(() => Array.from({ length }, (_, i) => String(i + 1)), [length]);
  const daily = useMemo(() => pick((s) => zip(s.daily.up[month].slice(0, length), s.daily.n[month].slice(0, length))), [data, keys.join(), month, length]);
  const weekly = useMemo(() => pick((s) => zip(s.weekday.up, s.weekday.n, s.weekday.avg).slice(0, weekend ? 7 : 5)), [data, keys.join(), weekend]);
  const monthly = useMemo(() => pick((s) => zip(s.monthly.up, s.monthly.n, s.monthly.avg)), [data, keys.join()]);

  if (!keys.length) return <p className="text-[var(--text-2)] py-6">Not enough history for the selected periods.</p>;
  return (
    <>
      <div className="flex flex-wrap gap-4 mb-3" style={{ alignItems: 'center', marginTop: 18 }}>
        <h3 style={{ margin: 0 }}>Daily average</h3>
        <select aria-label="Month for the daily average" value={month} onChange={(e) => setMonth(Number(e.target.value))}>
          {MONTHS.map((m, i) => <option key={m} value={i}>{m}</option>)}
        </select>
      </div>
      <ProbChart labels={dayLabels} keys={keys} rows={daily} unit="years" dense />
      <h3>Weekly average</h3>
      <ProbChart labels={WEEKDAYS.slice(0, weekend ? 7 : 5)} keys={keys} rows={weekly} unit="days" />
      <h3>Monthly average</h3>
      <ProbChart labels={SHORT} keys={keys} rows={monthly} unit="years" />
    </>
  );
}

// ------------------------------------------------------------------ trades statistics

function MonthDay({ label, value, onChange }) {
  const [m, d] = value.split('-').map(Number);
  return (
    <span className="inline-flex items-center gap-1.5">
      <label>{label}</label>
      <select aria-label={`${label} month`} value={m} onChange={(e) => onChange(`${pad(e.target.value)}-${pad(Math.min(d, daysIn(Number(e.target.value))))}`)}>
        {SHORT.map((name, i) => <option key={name} value={i + 1}>{name}</option>)}
      </select>
      <select aria-label={`${label} day`} value={d} onChange={(e) => onChange(`${pad(m)}-${pad(e.target.value)}`)}>
        {Array.from({ length: daysIn(m) }, (_, i) => <option key={i} value={i + 1}>{i + 1}</option>)}
      </select>
    </span>
  );
}

function Ring({ color, label, pct, avg }) {
  const r = 46;
  const c = 2 * Math.PI * r;
  return (
    <div className="text-center">
      <svg viewBox="0 0 120 120" width="120" height="120" role="img" aria-label={`${label}: ${pct}% of the trades made money, average return ${signedPct(avg, 1)}`}>
        <circle cx="60" cy="60" r={r} fill="none" stroke="var(--border)" strokeWidth="12" />
        <circle cx="60" cy="60" r={r} fill="none" stroke={color} strokeWidth="12" strokeDasharray={`${(c * pct) / 100} ${c}`} transform="rotate(-90 60 60)" />
        <text x="60" y="56" textAnchor="middle" fontSize="13" fontWeight="600" fill="var(--text)">{label}</text>
        <text x="60" y="76" textAnchor="middle" fontSize="13" fill="var(--text-2)">{Math.round(pct)}%</text>
      </svg>
      <div className="text-[var(--text-2)] text-[13px]">Average return</div>
      <b className={`text-[18px] ${avg < 0 ? 'text-[var(--err)]' : 'text-[var(--pos)]'}`}>{signedPct(avg, 1)}</b>
    </div>
  );
}

function Trades({ symbol, vsq, active, range, setRange }) {
  const [dir, setDir] = useState('long');
  const api = useApi(`/api/seasonality/${encodeURIComponent(symbol)}/trades?start=${range.start}&end=${range.end}${vsq}`);
  const sign = dir === 'long' ? 1 : -1;
  // a short trade wins when the price falls; its worst moment is the highest price and its best the lowest
  const rows = useMemo(() => (api.data?.rows ?? []).map((r) => ({
    ...r, ret: sign * r.ret, drop: sign > 0 ? r.maxDrop : -r.maxRise, rise: sign > 0 ? r.maxRise : -r.maxDrop,
  })), [api.data, sign]);
  const rings = active.filter((k) => /^\d+$/.test(k) && rows.length >= Number(k)).map((k) => {
    const last = rows.slice(0, Number(k));
    return { key: k, pct: (last.filter((r) => r.ret > 0).length / last.length) * 100, avg: last.reduce((s, r) => s + r.ret, 0) / last.length };
  });
  const cell = (v, plus) => <span className={v < 0 ? 'text-[var(--err)]' : plus ? 'text-[var(--pos)]' : undefined}>{signedPct(v)}</span>;
  const price = (v) => v.toLocaleString('en', { minimumFractionDigits: 2, maximumFractionDigits: api.data?.spread ? 4 : 2 });

  return (
    <>
      <div className="flex flex-wrap gap-4 mb-3" style={{ alignItems: 'center', marginTop: 24 }}>
        <h3 style={{ margin: 0 }}>Trades statistics</h3>
        <MonthDay label="From" value={range.start} onChange={(start) => setRange({ ...range, start })} />
        <MonthDay label="to" value={range.end} onChange={(end) => setRange({ ...range, end })} />
        <Seg options={[['short', 'Short'], ['long', 'Long']]} value={dir} onChange={setDir} />
      </div>
      {api.loading && <p className="text-[var(--text-2)] py-6">Loading…</p>}
      {api.error && <p className="text-[var(--err)] py-6">{api.error.message}</p>}
      {api.data && (
        <>
          <p className="text-[var(--text-2)] text-[13px]">
            {dir === 'long' ? 'Buy' : 'Sell short'} at the close on {range.start.replace('-', '/')} and close the trade at the close on {range.end.replace('-', '/')}, every year
            (nearest trading day). {rings.length ? 'Each circle: share of years the trade made money, and the average return.' : 'Pick 3, 5, 7… years above to see the circles.'}
          </p>
          <div className="flex flex-wrap gap-8 my-3">
            {rings.map((g) => <Ring key={g.key} color={colorOf(g.key)} label={NAME[g.key]} pct={g.pct} avg={g.avg} />)}
          </div>
          <DataTable
            headers={['Open date', 'Close date', api.data.spread ? 'Open ratio' : 'Open price', api.data.spread ? 'Close ratio' : 'Close price', 'Revenue %', 'Max drop %', 'Max rise %']}
            rows={rows.map((r) => [fmtDate(r.openDate), fmtDate(r.closeDate), price(r.open), price(r.close), cell(r.ret, true), cell(r.drop), cell(r.rise, true)])}
          />
        </>
      )}
    </>
  );
}

// ------------------------------------------------------------------ the "70% rule" scanner

const SCAN_WINDOWS = ['5', '10', '15', '20', '25', '30'];
const HORIZONS = [[14, 'Next 2 weeks'], [30, 'Next 30 days'], [60, 'Next 60 days'], [90, 'Next 90 days'], [365, 'Whole next year']];
const MIN_YEARS = 4; // fewer observations for a calendar day than this and it is skipped

function Scanner({ data }) {
  const [picked, setPicked] = useState(['10', '15', '20']);
  const [threshold, setThreshold] = useState(70);
  const [horizon, setHorizon] = useState(30);
  const use = picked.filter((k) => data.stats[k]);
  const weekend = Object.values(data.stats).some((s) => s.weekday.n[5] > 0 || s.weekday.n[6] > 0);

  const hits = useMemo(() => {
    if (!use.length) return [];
    const out = [];
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    for (let i = 0; i <= horizon; i++) {
      const date = new Date(today.getTime() + i * 86400000);
      if (!weekend && (date.getDay() === 0 || date.getDay() === 6)) continue;
      const per = use.map((k) => {
        const { up, n } = data.stats[k].daily;
        const [u, c] = [up[date.getMonth()][date.getDate() - 1], n[date.getMonth()][date.getDate() - 1]];
        return { k, up: u, n: c, p: c ? (u / c) * 100 : null };
      });
      if (per.some((x) => x.n < MIN_YEARS)) continue;
      const side = per.every((x) => x.p >= threshold) ? 'Long' : per.every((x) => 100 - x.p >= threshold) ? 'Short' : null;
      if (side) out.push({ date, side, per });
    }
    return out;
  }, [data, use.join(), threshold, horizon, weekend]);

  const toggle = (k) => setPicked((p) => (p.includes(k) ? p.filter((x) => x !== k) : [...p, k]));
  return (
    <>
      <h3 style={{ marginTop: 28 }}>High-probability days</h3>
      <p className="text-[var(--text-2)] text-[13px]">
        Calendar days on which the price has closed up (or down) in at least the chosen share of years, in <b>every</b> selected period at once
        (the "70% rule"). Upcoming days only; weekends are skipped.
      </p>
      <div className="flex flex-wrap gap-4 mb-3" style={{ alignItems: 'center' }}>
        <span className="flex flex-wrap gap-2 mt-1 mb-3" style={{ margin: 0 }}>
          {SCAN_WINDOWS.map((k) => (
            <button
              key={k}
              className="inline-flex items-center gap-2 py-[5px] px-3 rounded-full aria-pressed:border-[var(--text-2)] aria-pressed:bg-[var(--bg)] aria-pressed:font-semibold disabled:opacity-40 disabled:cursor-default"
              aria-pressed={picked.includes(k)} disabled={!data.stats[k]} title={data.stats[k] ? undefined : 'Not enough price history'} onClick={() => toggle(k)}
            >
              <span className="inline-block w-2.5 h-2.5 rounded-full" style={{ background: `var(${COLOR[k]})` }} />{NAME[k]}
            </button>
          ))}
        </span>
        <span className="inline-flex items-center gap-1.5">
          <label htmlFor="threshold">At least</label>
          <input id="threshold" className="w-[70px] normal-case" type="number" min="50" max="100" step="5" value={threshold} onChange={(e) => setThreshold(Number(e.target.value) || 70)} />%
        </span>
        <select aria-label="Horizon" value={horizon} onChange={(e) => setHorizon(Number(e.target.value))}>
          {HORIZONS.map(([v, label]) => <option key={v} value={v}>{label}</option>)}
        </select>
      </div>
      {!use.length ? (
        <p className="text-[var(--text-2)] py-6">Not enough price history for the selected periods.</p>
      ) : !hits.length ? (
        <p className="text-[var(--text-2)] py-6">No day in this horizon reaches {threshold}% in all of {use.map((k) => NAME[k]).join(', ')}.</p>
      ) : (
        <DataTable
          headers={['Date', 'Signal', ...use.map((k) => NAME[k])]}
          rows={hits.map((h) => [
            h.date.toLocaleDateString('en', { weekday: 'short', day: 'numeric', month: 'short' }),
            <b className={h.side === 'Long' ? 'text-[var(--pos)]' : 'text-[var(--err)]'}>{h.side}</b>,
            ...h.per.map((x) => {
              const share = h.side === 'Long' ? x.p : 100 - x.p;
              return `${Math.round(share)}% (${h.side === 'Long' ? x.up : x.n - x.up}/${x.n})`;
            }),
          ])}
        />
      )}
    </>
  );
}

// ------------------------------------------------------------------ the tab

function Content({ data, symbol, vsq, sel, view, dpo, range, setRange }) {
  const active = WINDOWS.map(([k]) => k).filter((k) => sel.includes(k) && data.series[k]);
  const onRange = useCallback(([a, b]) => setRange({ start: mdOfChartX(a), end: mdOfChartX(b) }), [setRange]);
  return (
    <>
      {data.warning && <div className="py-[10px] px-3.5 rounded-lg my-2 bg-[var(--warn-bg)] text-[var(--warn-text)]">{data.warning}</div>}
      <p className="text-[var(--text-2)] text-[13px]">
        {data.name} · prices from {fmtDate(data.firstDate)} to {fmtDate(data.lastDate)} · {data.statYearsAvailable} complete calendar years
        {data.vs && <> · <b>spread</b>: long {data.symbol}, short {data.vs}, equal dollar amounts; a rising line means {data.symbol} outperforms {data.vs}</>}
      </p>
      {!active.length ? (
        <p className="text-[var(--text-2)] py-6">Select a period above (the ones greyed out need more price history).</p>
      ) : (
        <>
          <CurveChart data={data} active={active} view={view} dpo={dpo} range={range} onRange={onRange} />
          <p className="text-[var(--text-2)] text-[13px]">Drag across the chart to pick a period for the trade statistics below (or set the dates there).</p>
        </>
      )}
      <Probabilities data={data} active={active} />
      <Trades symbol={symbol} vsq={vsq} active={active} range={range} setRange={setRange} />
      <Scanner data={data} />
      <p className="text-[var(--text-2)] text-[13px]" style={{ marginTop: 24 }}>
        <b>How it is calculated.</b> For each year, the price is followed from the start of the year (the last close before it = 0%) and the yearly paths are
        averaged by calendar date over the last N complete years; "Current" is this year so far and "Last year" the latest complete one. The detrended view
        subtracts a centred moving average (the chosen number of trading days) from the curve, so it shows recurring highs and lows instead of the general
        upward drift. Bars show how often the day, weekday or month closed up: above 50% is drawn upwards as "% long", below 50% downwards as "% short"; a month
        counts as up when its last close is above its first close. Daily bars rest on only a handful of years each, so read them with the hover numbers
        (for example 3 of 3 years is 100%, but it is three observations). In the trade table, the maximum drop and rise use the daily lows and highs after the entry
        day, and prices are not adjusted for dividends. Seasonality shows what happened on average, not what will happen: it works best as a filter together with
        other analysis, and with 10-20 observations per calendar day a 70% share also appears by chance, so treat single days with caution. Prices come from yfinance.
      </p>
    </>
  );
}

export default function SeasonalityTab({ symbol }) {
  const [sel, setSel] = useState(['5']);
  const [startMonth, setStartMonth] = useState(1);
  const [view, setView] = useState('seasonal');
  const [dpo, setDpo] = useState(40);
  const [vsInput, setVsInput] = useState('');
  const [vs, setVs] = useState('');
  const [range, setRange] = useState(defaultRange);
  const vsq = vs ? `&vs=${encodeURIComponent(vs)}` : '';
  const api = useApi(`/api/seasonality/${encodeURIComponent(symbol)}?start_month=${startMonth}${vsq}`);
  const available = api.data?.series ?? {};
  const toggle = (k) => setSel((s) => (s.includes(k) ? s.filter((x) => x !== k) : [...s, k]));

  return (
    <>
      <h2>{vs ? `${symbol} vs ${vs}` : symbol} · Seasonality</h2>
      <div className="flex flex-wrap gap-4 mb-3" style={{ alignItems: 'center' }}>
        <Seg options={[['seasonal', 'Seasonality'], ['detrended', 'Detrended']]} value={view} onChange={setView} />
        {view === 'detrended' && (
          <select aria-label="Detrending period" value={dpo} onChange={(e) => setDpo(Number(e.target.value))}>
            {DPO_DAYS.map((n) => <option key={n} value={n}>Trend removed over {n} days</option>)}
          </select>
        )}
        <select aria-label="Chart starts in" value={startMonth} onChange={(e) => setStartMonth(Number(e.target.value))}>
          {MONTHS.map((m, i) => <option key={m} value={i + 1}>Chart starts in {m}</option>)}
        </select>
        <form className="ml-auto" onSubmit={(e) => { e.preventDefault(); setVs(vsInput.trim().toUpperCase()); }}>
          <label htmlFor="vs">Spread against</label>
          <input id="vs" value={vsInput} placeholder="e.g. PEP" autoComplete="off" spellCheck={false} maxLength={15} onChange={(e) => setVsInput(e.target.value)} />
          <button type="submit">Apply</button>
          {vs && <button type="button" onClick={() => { setVs(''); setVsInput(''); }}>Clear</button>}
        </form>
      </div>
      <div className="flex flex-wrap gap-2 mt-1 mb-3" role="group" aria-label="Periods">
        {WINDOWS.map(([k, label]) => (
          <button
            key={k}
            className="inline-flex items-center gap-2 py-[5px] px-3 rounded-full aria-pressed:border-[var(--text-2)] aria-pressed:bg-[var(--bg)] aria-pressed:font-semibold disabled:opacity-40 disabled:cursor-default"
            aria-pressed={sel.includes(k)} disabled={api.data != null && !available[k]} title={api.data != null && !available[k] ? 'Not enough price history' : undefined} onClick={() => toggle(k)}
          >
            <span className="inline-block w-2.5 h-2.5 rounded-full" style={{ background: `var(${COLOR[k]})` }} />{label}
          </button>
        ))}
      </div>
      {api.loading && <p className="text-[var(--text-2)] py-6">Loading…</p>}
      {api.error && <p className="text-[var(--err)] py-6">Could not load the seasonality of {vs ? `${symbol} vs ${vs}` : symbol}: {api.error.message}</p>}
      {api.data && <Content data={api.data} symbol={symbol} vsq={vsq} sel={sel} view={view} dpo={dpo} range={range} setRange={setRange} />}
    </>
  );
}
