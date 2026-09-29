import { useCallback, useMemo, useState } from 'react';
import { useApi, usePoll } from './api.js';
import {
  RANGES, deflate, dividendStats, drawdown, indexOnOrAfter, intradayTicks, windowOf, withLatest, withLiveBar, yearlyReturns,
} from './perf.js';
import Plot from './Plot.jsx';
import { Seg, big } from './ui.jsx';

const OVERLAYS = [['sales', 'Sales'], ['income', 'Net Income'], ['fcf', 'Free Cash Flow'], ['pe', 'P/E (ttm)'], ['div', 'Dividends']];
const OVERLAY_NOTES = {
  sales: 'Sales: trailing 12 months, one point per SEC filing (Finnhub, US filers only), in the reporting currency.',
  income: 'Net income: trailing 12 months, one point per SEC filing (Finnhub, US filers only), in the reporting currency.',
  fcf: 'Free cash flow: operating cash flow minus capital expenditure, trailing 12 months, one point per SEC filing (Finnhub, US filers only).',
  pe: 'P/E (ttm): daily price divided by trailing 12-month earnings per share, which count from 45 days after each quarter end. Days with negative earnings, or a P/E above 200, are left out.',
  div: 'Dividends: dividend per share on each ex-dividend date (split-adjusted).',
};
const DAY = 86400000;
const signed = (v, d = 2) => `${v >= 0 ? '+' : ''}${v.toFixed(d)}%`;
// `on`: true inside a highlighted (navy-background) range tile, which needs lighter shades for contrast.
const tone = (v, on) => (v >= 0 ? (on ? 'text-[#5ee08d]' : 'text-[var(--pos)]') : (on ? 'text-[#ff9a9a]' : 'text-[var(--err)]'));
const BADGE = {
  up: 'bg-[#dcf8e6] text-[#0a7a3a] dark:bg-[#12331f] dark:text-[#5ccf98]',
  down: 'bg-[#fde3e3] text-[#b3261e] dark:bg-[#3a1616] dark:text-[#f2b8b5]',
  flat: 'bg-[var(--surface)] text-[var(--text-2)]',
};

const alpha = (hex, a) => {
  const m = /^#([0-9a-f]{6})$/i.exec(hex);
  if (!m) return hex;
  const n = parseInt(m[1], 16);
  return `rgba(${n >> 16}, ${(n >> 8) & 255}, ${n & 255}, ${a})`;
};

/** Round tick values (1, 2, 2.5, 5 x 10^k) covering [lo, hi]. */
function niceTicks(lo, hi, count = 5) {
  const raw = (hi - lo) / count || 1;
  const mag = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * mag).find((s) => s >= raw);
  const vals = [];
  for (let k = Math.floor(lo / step); k * step < hi + step * 0.999; k += 1) vals.push(k * step);
  return vals;
}

/** The overlay series inside [from, to]: the level in force at `from` is carried in, and a step series runs on to `to`. */
function clipSeries(s, from, to, { step, gapDays }) {
  const x = [], y = [];
  const i = indexOnOrAfter(s.dates, from);
  if (step && i > 0) { x.push(from); y.push(s.values[i - 1]); }
  for (let k = i; k < s.dates.length && s.dates[k] <= to; k += 1) {
    if (gapDays && x.length && (Date.parse(s.dates[k]) - Date.parse(x.at(-1))) / DAY > gapDays) { x.push(s.dates[k - 1]); y.push(null); }
    x.push(s.dates[k]);
    y.push(s.values[k]);
  }
  if (step && x.length && x.at(-1) < to) { x.push(to); y.push(y.at(-1)); }
  return { x, y };
}

/** Short name of a time zone ("EDT", "GMT+9", "UTC") for labelling exchange times. */
function zoneName(timeZone) {
  try {
    return new Intl.DateTimeFormat('en-US', { timeZone, timeZoneName: 'short' }).formatToParts(new Date()).find((p) => p.type === 'timeZoneName')?.value ?? timeZone;
  } catch {
    return timeZone;
  }
}

/** Daily closes (`dates`), or intraday bars (`times` in the exchange's `timezone`: one category per bar, so nights and weekends leave
 * no gaps and the tooltip title is the bar's time; `base` = the previous close, drawn as a dashed line on the "Today" range).
 * `forecast` (daily view only) = {dates, forecast, low, high} from TimesFM, drawn as a dashed continuation with a shaded band. */
function PriceChart({ dates, close, overlay, log, times, timezone, base, forecast }) {
  const build = useCallback((t) => {
    const zone = times ? zoneName(timezone) : '';
    const x = times ? times.map((s) => `${s} ${zone}`) : dates;
    const last = close.at(-1);
    const fLo = forecast ? Math.min(...forecast.low) : Infinity, fHi = forecast ? Math.max(...forecast.high) : -Infinity;
    const lo = Math.min(...close, base ?? Infinity, fLo), hi = Math.max(...close, base ?? -Infinity, fHi);
    const pad = (hi - lo) * 0.05 || hi * 0.05;
    const floor = log ? lo * 0.92 : lo - pad;
    const yRange = log ? [Math.log10(floor), Math.log10(hi * 1.08)] : [floor, hi + pad];
    const ends = [x[0], forecast ? forecast.dates.at(-1) : x.at(-1)];
    const data = [
      { type: 'scatter', mode: 'lines', x: ends, y: [floor, floor], line: { width: 0 }, hoverinfo: 'skip' }, // fill anchor
      {
        type: 'scatter', mode: 'lines', name: 'Price', x, y: close, fill: 'tonexty', fillcolor: alpha(t.series, 0.16),
        line: { color: t.series, width: 2 }, hovertemplate: '%{y:,.2f}<extra>Price</extra>',
      },
      { type: 'scatter', mode: 'lines', x: ends, y: [last, last], line: { color: t.muted, width: 1, dash: 'dot' }, hoverinfo: 'skip' },
    ];
    const tk = times ? intradayTicks(times) : null;
    // linear axis: our own round ticks, minus any too close to the last-price label (it would cover the tick's number)
    const span = yRange[1] - yRange[0];
    const yTicks = log ? undefined
      : niceTicks(yRange[0], yRange[1]).filter((v) => v >= yRange[0] && v <= yRange[1] && Math.abs(v - last) > span * 0.04);
    const layout = {
      margin: { l: 64, r: overlay ? 64 : 16, t: 16, b: 36 },
      xaxis: tk
        ? { type: 'category', range: [0, x.length - 1], tickvals: tk.vals.map((i) => x[i]), ticktext: tk.text, tickangle: 0 }
        : { type: 'date', range: ends },
      yaxis: { type: log ? 'log' : 'linear', range: yRange, nticks: 6, tickvals: yTicks, tickformat: hi >= 1000 ? ',.0f' : ',.2f' },
      annotations: [{
        xref: 'paper', x: 0, xanchor: 'right', yref: 'y', y: log ? Math.log10(last) : last, text: last.toFixed(2), showarrow: false,
        bgcolor: t.brand, font: { color: '#fff', size: 11 }, borderpad: 3,
      }],
    };
    if (base != null) {
      data.push({
        type: 'scatter', mode: 'lines', x: ends, y: [base, base], line: { color: t.text, width: 1, dash: 'dash' },
        hovertemplate: `Previous close: ${base.toFixed(2)}<extra></extra>`,
      });
      layout.annotations.push({
        xref: 'paper', x: 1, xanchor: 'right', yref: 'y', y: log ? Math.log10(base) : base, yanchor: 'bottom', showarrow: false,
        text: `Previous close ${base.toFixed(2)}`, font: { color: t.text, size: 11 },
      });
    }
    if (forecast) {
      const fc = t.palette[3];
      const fx = [dates.at(-1), ...forecast.dates];
      data.push(
        { type: 'scatter', mode: 'lines', x: fx, y: [last, ...forecast.low], line: { width: 0 }, hoverinfo: 'skip', showlegend: false },
        {
          type: 'scatter', mode: 'lines', name: '10-90% range', x: fx, y: [last, ...forecast.high], fill: 'tonexty',
          fillcolor: alpha(fc, 0.18), line: { width: 0 }, hovertemplate: '%{y:,.2f}<extra>10-90% range</extra>',
        },
        {
          type: 'scatter', mode: 'lines', name: 'Forecast', x: fx, y: [last, ...forecast.forecast],
          line: { color: fc, width: 2, dash: 'dash' }, hovertemplate: '%{y:,.2f}<extra>Forecast</extra>',
        },
      );
    }
    if (overlay) {
      const { series, from, to, kind } = overlay;
      const money = kind !== 'pe' && kind !== 'div';
      const fmt = (v) => (kind === 'pe' ? `${v.toFixed(1)}x` : kind === 'div' ? v.toFixed(3) : big(v));
      const c = t.palette[1];
      if (kind === 'div') {
        const w = clipSeries(series, from, to, { step: false });
        data.push({ type: 'bar', name: 'Dividends', x: w.x, y: w.y, yaxis: 'y2', width: 6 * DAY, marker: { color: c }, text: w.y.map(fmt), hovertemplate: '%{text}<extra>Dividend</extra>' });
      } else {
        const w = clipSeries(series, from, to, { step: money, gapDays: kind === 'pe' ? 10 : 0 });
        data.push({
          type: 'scatter', mode: 'lines', name: kind, x: w.x, y: w.y, yaxis: 'y2', connectgaps: false,
          line: { color: c, width: 2, shape: money ? 'hv' : 'linear' }, text: w.y.map((v) => (v == null ? '' : fmt(v))),
          hovertemplate: `%{text}<extra>${OVERLAYS.find((o) => o[0] === kind)[1]}</extra>`,
        });
      }
      const vals = data.at(-1).y.filter((v) => v != null);
      const ticks = niceTicks(Math.min(0, ...vals), Math.max(...vals));
      layout.yaxis2 = {
        overlaying: 'y', side: 'right', showgrid: false, zeroline: false, tickvals: ticks, ticktext: ticks.map(fmt),
        range: [ticks[0], ticks.at(-1)], color: c,
      };
    }
    return { data, layout };
  }, [dates, close, overlay, log, times, timezone, base, forecast]);
  return <Plot build={build} className="h-[460px]" />;
}

function DrawdownChart({ dates, values }) {
  const build = useCallback((t) => ({
    data: [{
      type: 'scatter', mode: 'lines', x: dates, y: values, fill: 'tozeroy', fillcolor: alpha(t.down, 0.14),
      line: { color: t.down, width: 1.6 }, hovertemplate: '%{y:.2f}%<extra>Drawdown</extra>',
    }],
    layout: {
      margin: { l: 64, r: 16, t: 12, b: 32 }, xaxis: { type: 'date' },
      yaxis: { ticksuffix: '%', tickformat: '.0f', range: [Math.min(...values) * 1.12 - 0.5, 1.5], zeroline: true, zerolinecolor: t.muted },
    },
  }), [dates, values]);
  return <Plot build={build} className="h-[230px]" />;
}

/** Bars coloured green/red by sign, the unfinished period lighter. */
function SignedBars({ x, values, partial, labels = true, suffix = '%', ticks }) {
  const build = useCallback((t) => ({
    data: [{
      type: 'bar', x, y: values, marker: { color: values.map((v) => (v >= 0 ? t.up : t.down)), opacity: partial.map((p) => (p ? 0.5 : 1)) },
      text: labels ? values.map((v) => v.toFixed(2)) : undefined, textposition: 'outside', cliponaxis: false, textfont: { size: 10, color: t.text },
      hovertemplate: `%{x}: %{y:,.2f}${suffix}<extra></extra>`,
    }],
    layout: {
      hovermode: 'closest', margin: { l: 56, r: 16, t: 28, b: 32 },
      xaxis: { type: 'category', tickvals: ticks, ticktext: ticks },
      yaxis: { ticksuffix: suffix, zeroline: true, zerolinecolor: t.muted, range: [Math.min(0, ...values) * 1.25 - 1, Math.max(0, ...values) * 1.2 + 1] },
    },
  }), [x, values, partial, labels, suffix, ticks]);
  return <Plot build={build} className="h-[300px]" />;
}

function DividendBars({ mode, stats, dividends }) {
  const build = useCallback((t) => {
    const perYear = mode === 'year';
    const x = perYear ? stats.perYear.map((y) => String(y.year)) : dividends.map((d) => d.date);
    const y = perYear ? stats.perYear.map((v) => v.value) : dividends.map((d) => d.value);
    const partial = perYear ? stats.perYear.map((v, i) => i === stats.perYear.length - 1) : y.map(() => false);
    return {
      data: [{
        type: 'bar', x, y, marker: { color: t.palette[2], opacity: partial.map((p) => (p ? 0.55 : 1)) }, width: perYear ? undefined : 30 * DAY,
        text: y.length <= 32 ? y.map((v) => (v < 0.1 ? v.toPrecision(2) : v.toFixed(2))) : undefined, textposition: 'outside', cliponaxis: false,
        textfont: { size: 10, color: t.text }, hovertemplate: `%{x}: %{y:.4f}<extra>${perYear ? 'Year total' : 'Dividend'}</extra>`,
      }],
      layout: {
        hovermode: 'closest', margin: { l: 56, r: 16, t: 28, b: 32 },
        xaxis: { type: perYear ? 'category' : 'date' }, yaxis: { rangemode: 'tozero', range: [0, Math.max(...y) * 1.2] },
      },
    };
  }, [mode, stats, dividends]);
  return <Plot build={build} className="h-[300px]" />;
}

const TREND = { increasing: ['INCREASING', 'up'], decreasing: ['DECREASING', 'down'], stable: ['STABLE', 'flat'], none: ['NO DIVIDEND', 'flat'] };

const Info = ({ open, onToggle, label }) => (
  <button
    type="button"
    className="w-5 h-5 p-0 rounded-full border-[1.5px] border-[#8fb4e8] bg-transparent text-[#8fb4e8] italic font-bold text-xs leading-none [font-family:Georgia,serif]"
    aria-label={label} aria-expanded={open} onClick={onToggle}
  >
    i
  </button>
);

function Events({ events }) {
  const soon = events.filter((e) => e.days <= 60);
  if (!soon.length) return null;
  return (
    <div className="flex flex-wrap gap-3 mt-1 mb-4">
      {soon.map((e) => (
        <div key={e.label} className="inline-flex items-center gap-3 py-3.5 px-[22px] rounded-[14px] bg-[var(--navy)] text-[#ff8a1f]">
          <span aria-hidden="true">⚠</span>
          <b>{e.days === 0 ? `Today: ${e.label.toLowerCase()}!` : `${e.days} ${e.days === 1 ? 'day' : 'days'} to ${e.label.toLowerCase()}!`}</b>
          <small className="text-[#c9d6e8]">{e.date}</small>
        </div>
      ))}
    </div>
  );
}

export default function OverviewTab({ symbol, quote }) {
  const [range, setRange] = useState('5y');
  const [overlay, setOverlay] = useState(null);
  const [log, setLog] = useState(false);
  const [real, setReal] = useState(false);
  const [showForecast, setShowForecast] = useState(false);
  const [ddInfo, setDdInfo] = useState(false);
  const [years, setYears] = useState('20');
  const [divMode, setDivMode] = useState('payment');
  const enc = encodeURIComponent(symbol);
  const api = useApi(`/api/overview/${enc}`);
  const ov = useApi(overlay && overlay !== 'div' ? `/api/overview/${enc}/overlay/${overlay}` : null);

  // the live price moves the chart's last point, the tiles, the drawdown and the year to date; the rest of the history is hourly
  const nominal = useMemo(() => withLatest(api.data, quote?.price, quote?.date), [api.data, quote?.price, quote?.date]);
  // "Inflation-adjusted": every close in today's dollars (US CPI), so the chart, tiles, drawdown and yearly bars show real changes. The
  // dividend yield keeps nominal prices. Only for prices in USD (the CPI is the US one).
  const canReal = nominal?.currency === 'USD';
  const cpi = useApi(real && canReal ? '/api/macro/cpi' : null);
  const isReal = real && canReal && !!cpi.data;
  const d = useMemo(() => (isReal ? deflate(nominal, cpi.data) : nominal), [isReal, nominal, cpi.data]);
  const wins = useMemo(() => (d ? Object.fromEntries(RANGES.map(([k]) => [k, windowOf(d.dates, d.close, k)])) : {}), [d]);
  const active = wins[range] ? range : 'all'; // a stock too young for the chosen range shows its whole history
  const w = wins[active];
  const view = useMemo(() => (d && w ? { dates: d.dates.slice(w.i0), close: d.close.slice(w.i0) } : null), [d, w]);
  // "Today" and "1 Week" draw intraday bars (refreshed every minute while fresh, every 10 minutes once the session is over); the tile
  // returns and the drawdown still come from the daily closes
  const intra = active === '1d' || active === '1w';
  const forecastOn = showForecast && !intra && !isReal;
  const fc = useApi(forecastOn ? `/api/forecast/${enc}?horizon=30` : null);
  const intraBars = usePoll(
    intra ? `/api/overview/${enc}/intraday?range=${active}` : null,
    (b) => (b && Date.now() / 1000 - b.last < 1800 ? 60 : 600),
  );
  const liveBars = useMemo(() => (intra ? withLiveBar(intraBars.data, quote) : null), [intra, intraBars.data, quote]);
  const shown = intra ? liveBars : view; // what the price chart and its low/high line show
  const dd = useMemo(() => (d ? drawdown(d.close) : null), [d]);
  const ddView = useMemo(() => (dd && w ? dd.slice(w.i0) : null), [dd, w]);
  const yearly = useMemo(() => (d ? yearlyReturns(d.dates, d.close) : []), [d]);
  const divs = useMemo(() => (nominal ? dividendStats(nominal.dividends, nominal.dates.at(-1), nominal.close.at(-1)) : null), [nominal]);

  const divSeries = useMemo(() => (d ? { dates: d.dividends.map((x) => x.date), values: d.dividends.map((x) => x.value) } : null), [d]);
  const bars = useMemo(() => {
    const shown = years === 'all' ? yearly : yearly.slice(-(Number(years) + 1)); // N complete years + the year to date
    const every = Math.ceil(shown.length / 26);
    return {
      x: shown.map((y) => String(y.year)), values: shown.map((y) => y.ret), partial: shown.map((y) => y.partial), labels: shown.length <= 26,
      ticks: shown.filter((_, i) => i % every === 0).map((y) => String(y.year)),
    };
  }, [yearly, years]);
  const series = overlay === 'div' ? divSeries : ov.data;
  const overlayProp = useMemo(
    () => (series && view && !intra ? { series, from: view.dates[0], to: view.dates.at(-1), kind: overlay } : null),
    [series, view, overlay, intra],
  );

  if (api.loading) return <p className="text-[var(--text-2)] py-6">Loading…</p>;
  if (api.error) return <p className="text-[var(--err)] py-6">Could not load the overview for {symbol}: {api.error.message}</p>;
  if (!view) return <p className="text-[var(--text-2)] py-6">Not enough price history for {symbol}.</p>;

  const cur = isReal ? "USD, today's dollars" : (d.currency ?? '');
  const ddMin = Math.min(...ddView);
  const [trendText, trendTone] = divs ? TREND[divs.trend] : TREND.none;

  return (
    <>
      <Events events={d.events} />

      <section className="mb-7">
        <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
          <p className="text-[var(--text-2)] text-[13px]">
            <b>{RANGES.find(([k]) => k === active)[1]}</b> <span className={tone(w.ret)}>{signed(w.ret)}</span>
            {shown && <>{' '}· low {Math.min(...shown.close).toLocaleString('en', { maximumFractionDigits: 2 })} · high {Math.max(...shown.close).toLocaleString('en', { maximumFractionDigits: 2 })} {cur}</>}
          </p>
          <div className="inline-flex flex-wrap items-center gap-1 py-[5px] px-2.5 rounded-full bg-[var(--tabbar)]" role="group" aria-label="Overlay on the price chart">
            {OVERLAYS.map(([k, label]) => (
              <button
                key={k} type="button" disabled={intra} title={intra ? 'Overlays are for the daily ranges (1 Month and longer)' : undefined}
                className={`border-0 rounded-full py-[5px] px-[13px] disabled:opacity-45 disabled:cursor-default ${overlay === k && !intra ? 'bg-[var(--bg)] text-[var(--text)] font-semibold' : 'bg-transparent text-[var(--tabbar-text)]'}`}
                aria-pressed={overlay === k && !intra} onClick={() => setOverlay(overlay === k ? null : k)}
              >
                {label}
              </button>
            ))}
            <label className="inline-flex items-center gap-1.5 ml-1.5 text-[var(--tabbar-text)]"><input type="checkbox" checked={log} onChange={(e) => setLog(e.target.checked)} /> Log</label>
            <label
              className="inline-flex items-center gap-1.5 ml-1.5 text-[var(--tabbar-text)] has-[:disabled]:opacity-45"
              title={canReal ? "Prices in today's dollars, using the US consumer price index" : 'Only for prices in US dollars (the index used is the US CPI)'}
            >
              <input type="checkbox" checked={real && canReal} disabled={!canReal} onChange={(e) => setReal(e.target.checked)} /> Inflation-adjusted
            </label>
            <label
              className="inline-flex items-center gap-1.5 ml-1.5 text-[var(--tabbar-text)] has-[:disabled]:opacity-45"
              title={intra ? 'Forecasts are for the daily ranges (1 Month and longer)' : isReal ? 'Not with inflation-adjusted prices' : 'A zero-shot forecast (Google TimesFM), not a signal'}
            >
              <input type="checkbox" checked={forecastOn} disabled={intra || isReal} onChange={(e) => setShowForecast(e.target.checked)} /> Forecast
            </label>
          </div>
        </div>
        {!intra && <PriceChart dates={view.dates} close={view.close} overlay={overlayProp} log={log} forecast={forecastOn ? fc.data : null} />}
        {intra && liveBars && (
          <PriceChart times={liveBars.times} timezone={liveBars.timezone} close={liveBars.close} log={log} base={active === '1d' ? d.close[w.i0] : null} />
        )}
        {intra && !liveBars && (
          <div className="h-[460px] grid place-items-center text-[13px]">
            {intraBars.error ? <span className="text-[var(--err)]">Could not load intraday prices: {intraBars.error}</span> : <span className="text-[var(--text-2)]">Loading intraday prices…</span>}
          </div>
        )}
        {intra && liveBars && (
          <p className="text-[var(--text-2)] text-[13px]">
            {active === '1d' ? 'Last trading session, 1-minute bars' : 'Last 5 trading sessions, 5-minute bars'}, regular hours only, in the exchange's time ({zoneName(liveBars.timezone)}, {liveBars.timezone.replace(/_/g, ' ')});
            nights and weekends are left out of the axis. {active === '1d' ? 'The percentage is the change from the previous close.' : 'The percentage runs from the close 7 days ago.'}
          </p>
        )}
        {!intra && overlay && overlay !== 'div' && ov.loading && <p className="text-[var(--text-2)] text-[13px]">Loading {OVERLAYS.find((o) => o[0] === overlay)[1]}…</p>}
        {!intra && overlay && overlay !== 'div' && ov.error && <p className="text-[var(--err)] text-[13px]">{ov.error.message}</p>}
        {!intra && overlay && !ov.error && <p className="text-[var(--text-2)] text-[13px]">{OVERLAY_NOTES[overlay]}</p>}
        {forecastOn && fc.loading && <p className="text-[var(--text-2)] text-[13px]">Loading the forecast (the first one after a backend restart also downloads the model, up to a minute)…</p>}
        {forecastOn && fc.error && <p className="text-[var(--err)] text-[13px]">Could not load the forecast: {fc.error.message}</p>}
        {forecastOn && fc.data && (
          <p className="text-[var(--text-2)] text-[13px]">
            Forecast: a zero-shot statistical extrapolation of the recent price pattern by Google's TimesFM 3.0 model, 30 trading days ahead, with a shaded 10th-90th percentile
            range. It has no knowledge of the company, its fundamentals, news, or upcoming events -- not a price target or a signal.
          </p>
        )}
        {real && canReal && cpi.loading && <p className="text-[var(--text-2)] text-[13px]">Loading the consumer price index…</p>}
        {real && canReal && cpi.error && <p className="text-[var(--err)] text-[13px]">Could not load the consumer price index: {cpi.error.message}</p>}
        {isReal && (
          <p className="text-[var(--text-2)] text-[13px]">
            Inflation-adjusted: every close is converted into today's dollars with the US consumer price index (latest release {cpi.data.dates.at(-1).slice(0, 7)}),
            so the tiles, the drawdown and the yearly bars show real gains and losses. {intra ? 'Intraday prices are not adjusted (a few days of inflation are negligible).' : ''}
          </p>
        )}
      </section>

      <div className="grid grid-cols-30 max-[720px]:grid-cols-2 gap-3 mt-4 mb-7">
        {RANGES.map(([k, label]) => {
          const win = wins[k];
          const on = k === active;
          return (
            <button
              key={k} type="button"
              className={`col-span-5 [&:nth-child(n+7)]:col-span-6 max-[720px]:col-span-1 max-[720px]:[&:nth-child(n+7)]:col-span-1 flex flex-col items-center gap-0.5 py-3.5 px-2 rounded-xl disabled:opacity-45 disabled:cursor-default ${on ? 'bg-[var(--navy)] border-[var(--navy)] text-white' : 'bg-[var(--bg)]'}`}
              aria-pressed={on} disabled={!win} onClick={() => setRange(k)}
            >
              <span>{label}</span>
              <b className={win ? tone(win.ret, on) : ''}>{win ? signed(win.ret) : '–'}</b>
            </button>
          );
        })}
      </div>

      <section className="mb-7">
        <div className="flex flex-wrap items-center gap-3 mt-6 mb-2">
          <h2 className="m-0 inline-flex items-center gap-2.5 bg-[var(--navy)] text-white py-[9px] px-5 rounded-full text-base font-medium">
            Drawdown <Info open={ddInfo} onToggle={() => setDdInfo(!ddInfo)} label="About the drawdown chart" />
          </h2>
          <span className="text-[var(--text-2)] text-[13px]">
            now <b className={tone(ddView.at(-1))}>{ddView.at(-1).toFixed(2)}%</b> · worst in this range <b className="text-[var(--err)]">{ddMin.toFixed(2)}%</b>
          </span>
        </div>
        {ddInfo && (
          <div className="border border-[var(--border)] rounded-[14px] pt-1 px-[18px] pb-3.5 mb-2 text-sm">
            <p>How far the price is trading below the highest close reached up to each point in time.</p>
            <ul className="m-0 mb-2.5 pl-5">
              <li>0% means the price is at its highest close so far; a new high shows as 0%, never as a positive number.</li>
              <li>The chart shows the selected range, but the running peak comes from the full price history, so a range that starts in a slump still measures against the earlier high.</li>
              <li>A move from -10% to -4% means part of the fall has been recovered but the previous peak has not been reclaimed yet.</li>
            </ul>
            <code className="block bg-[var(--surface)] py-2 px-3 rounded-lg text-[13px] whitespace-normal">Drawdown % = min(0, (Close - Running highest close) / Running highest close x 100)</code>
          </div>
        )}
        <DrawdownChart dates={view.dates} values={ddView} />
      </section>

      <section className="mb-7">
        <div className="flex flex-wrap items-center gap-3 mt-6 mb-2">
          <h2 className="m-0 inline-flex items-center gap-2.5 bg-[var(--navy)] text-white py-[9px] px-5 rounded-full text-base font-medium">Years Performance</h2>
          <select aria-label="Years shown" value={years} onChange={(e) => setYears(e.target.value)}>
            <option value="10">Last 10 years</option><option value="20">Last 20 years</option><option value="all">All years</option>
          </select>
        </div>
        <SignedBars {...bars} />
        <p className="text-[var(--text-2)] text-[13px]">Each bar runs from the year's first close to its last close; the pale bar is the year to date. Prices are split-adjusted, not dividend-adjusted{isReal ? ', and adjusted for inflation' : ''}.</p>
      </section>

      <section className="mb-7">
        <div className="flex flex-wrap items-center gap-3 mt-6 mb-2">
          <h2 className="m-0 inline-flex items-center gap-2.5 bg-[var(--navy)] text-white py-[9px] px-5 rounded-full text-base font-medium">Dividends</h2>
          <span className={`inline-flex items-center py-2 px-[18px] rounded-full font-semibold text-sm ${BADGE[trendTone]}`}>{trendTone === 'up' ? '↗ ' : trendTone === 'down' ? '↘ ' : ''}{trendText}</span>
          {divs && <div className="ml-auto"><Seg options={[['payment', 'Per payment'], ['year', 'Per year']]} value={divMode} onChange={setDivMode} /></div>}
        </div>
        {!divs ? (
          <p className="text-[var(--text-2)] py-6">{symbol} has no dividend history.</p>
        ) : (
          <>
            <div className="grid grid-cols-[repeat(auto-fit,minmax(150px,1fr))] gap-3 my-3">
              <div className="bg-[var(--surface)] rounded-lg py-3 px-3.5"><div className="text-[var(--text-2)] text-[13px]">Last 12 months</div><div className="text-2xl font-semibold tabular-nums">{divs.ttm.toFixed(divs.ttm < 0.1 ? 3 : 2)}</div><div className="text-[var(--text-2)] text-xs">{cur} per share, {divs.paymentsTtm} payments</div></div>
              <div className="bg-[var(--surface)] rounded-lg py-3 px-3.5"><div className="text-[var(--text-2)] text-[13px]">Dividend yield</div><div className="text-2xl font-semibold tabular-nums">{divs.yieldPct.toFixed(2)}%</div><div className="text-[var(--text-2)] text-xs">last 12 months ÷ price</div></div>
              <div className="bg-[var(--surface)] rounded-lg py-3 px-3.5"><div className="text-[var(--text-2)] text-[13px]">Last ex-dividend</div><div className="text-2xl font-semibold tabular-nums">{divs.last.value.toFixed(divs.last.value < 0.1 ? 3 : 2)}</div><div className="text-[var(--text-2)] text-xs">{divs.last.date}</div></div>
              {d.events.find((e) => e.label === 'Ex-dividend date') && (
                <div className="bg-[var(--surface)] rounded-lg py-3 px-3.5"><div className="text-[var(--text-2)] text-[13px]">Next ex-dividend</div><div className="text-2xl font-semibold tabular-nums">{d.events.find((e) => e.label === 'Ex-dividend date').date}</div><div className="text-[var(--text-2)] text-xs">in {d.events.find((e) => e.label === 'Ex-dividend date').days} days</div></div>
              )}
            </div>
            <DividendBars mode={divMode} stats={divs} dividends={d.dividends} />
            <p className="text-[var(--text-2)] text-[13px]">Bars show the dividend per share on each ex-dividend date (split-adjusted). The badge compares the last 12 months with the 12 months before.</p>
          </>
        )}
      </section>
    </>
  );
}
