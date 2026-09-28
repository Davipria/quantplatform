// Pure calculations for the Overview page. `dates` are ISO strings (sortable as text), `close` the matching closes.

export const RANGES = [
  ['1d', 'Today'], ['1w', '1 Week'], ['1m', '1 Month'], ['6m', '6 Months'], ['ytd', 'This Year'], ['1y', '1 Year'], ['3y', '3 Years'],
  ['5y', '5 Years'], ['10y', '10 Years'], ['20y', '20 Years'], ['all', 'All history'],
];
const SLACK_DAYS = 7; // a stock that listed a few days after the window's start still counts as having that much history

const iso = (d) => d.toISOString().slice(0, 10);

/** The date `months` before `isoDate`, clamped to the end of a shorter month (31 Mar - 1 month = 28/29 Feb). */
function monthsBefore(isoDate, months) {
  const [y, m, d] = isoDate.split('-').map(Number);
  const first = new Date(Date.UTC(y, m - 1 - months, 1));
  const last = new Date(Date.UTC(first.getUTCFullYear(), first.getUTCMonth() + 1, 0)).getUTCDate();
  return iso(new Date(Date.UTC(first.getUTCFullYear(), first.getUTCMonth(), Math.min(d, last))));
}

/** Where a range starts: the first close on or after this date is the base of the return (Forecaster's convention). null = from the first close. */
export function rangeStart(key, lastDate) {
  if (key === 'all') return null;
  if (key === 'ytd') return `${lastDate.slice(0, 4)}-01-01`;
  if (key === '1w') return iso(new Date(Date.parse(lastDate) - 7 * 86400000));
  const n = Number(key.slice(0, -1));
  return monthsBefore(lastDate, key.endsWith('m') ? n : n * 12);
}

/** Index of the first date on or after `target` (dates.length when there is none). */
export function indexOnOrAfter(dates, target) {
  let lo = 0, hi = dates.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (dates[mid] < target) lo = mid + 1; else hi = mid;
  }
  return lo;
}

/** First index of a range and its return in %, or null when the history is too short for it. */
export function windowOf(dates, close, key) {
  const last = dates.length - 1;
  if (last < 1) return null;
  if (key === '1d') return { i0: last - 1, ret: (close[last] / close[last - 1] - 1) * 100 }; // today vs the previous close
  const start = rangeStart(key, dates[last]);
  let i0 = 0;
  if (start !== null) {
    const slack = new Date(Date.parse(start) + SLACK_DAYS * 86400000);
    if (dates[0] > iso(slack)) return null;
    i0 = indexOnOrAfter(dates, start);
  }
  return i0 >= last ? null : { i0, ret: (close[last] / close[i0] - 1) * 100 };
}

/** % below the highest close so far (0 at a new high), computed over the whole history so the running peak is right. */
export function drawdown(close) {
  let peak = -Infinity;
  return close.map((c) => {
    peak = Math.max(peak, c);
    return Math.min(0, (c / peak - 1) * 100);
  });
}

/** Calendar-year returns in %, from the year's first close to its last close (as on Forecaster). The last entry is the
 *  year to date (partial: true). */
export function yearlyReturns(dates, close) {
  const out = [];
  let first = 0;
  for (let i = 0; i < dates.length; i += 1) {
    const year = Number(dates[i].slice(0, 4));
    if (i === dates.length - 1 || Number(dates[i + 1].slice(0, 4)) !== year) {
      out.push({ year, ret: (close[i] / close[first] - 1) * 100, partial: false });
      first = i + 1;
    }
  }
  if (out.length) out[out.length - 1].partial = true; // the current, unfinished year
  return out;
}

/** Dividend totals per calendar year, the trailing-12-month dividend, its yield and the trend. */
export function dividendStats(dividends, lastDate, lastClose) {
  if (!dividends.length) return null;
  const yearAgo = monthsBefore(lastDate, 12);
  const twoYearsAgo = monthsBefore(lastDate, 24);
  const sum = (from, to) => dividends.filter((d) => d.date > from && d.date <= to).reduce((s, d) => s + d.value, 0);
  const ttm = sum(yearAgo, lastDate);
  const prior = sum(twoYearsAgo, yearAgo);
  const byYear = new Map();
  dividends.forEach((d) => byYear.set(d.date.slice(0, 4), (byYear.get(d.date.slice(0, 4)) ?? 0) + d.value));
  let trend = 'stable';
  if (ttm === 0) trend = 'none';
  else if (prior === 0 || ttm > prior * 1.01) trend = 'increasing';
  else if (ttm < prior * 0.99) trend = 'decreasing';
  return {
    ttm, yieldPct: (ttm / lastClose) * 100, trend, last: dividends.at(-1),
    perYear: [...byYear].map(([year, value]) => ({ year: Number(year), value })),
    paymentsTtm: dividends.filter((d) => d.date > yearAgo).length,
  };
}

/** Price history with the latest polled price as its last point: replaces the close of the same trading day (the hourly
 * history may be minutes old) or adds a new day. `date` is the quote's trading day in the exchange's time zone. */
export function withLatest(hist, price, date) {
  if (!hist?.dates.length || !price || !date) return hist;
  const last = hist.dates.at(-1);
  if (date < last) return hist; // an older quote than the history: keep the history
  if (date === last) return hist.close.at(-1) === price ? hist : { ...hist, close: [...hist.close.slice(0, -1), price] };
  return { ...hist, dates: [...hist.dates, date], close: [...hist.close, price] };
}

/** Intraday bars with the latest quote as their last point: it updates the current bar, or adds a point when it is newer than
 * the last bar (the bars can be up to a minute old; the quote also carries the closing-auction price the bars miss). Only for a
 * quote from the same trading day as the last bar. */
export function withLiveBar(bars, q) {
  if (!bars?.close.length || !q?.price || !q.time || q.time < bars.last) return bars;
  const label = new Intl.DateTimeFormat('sv-SE', {
    timeZone: bars.timezone, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
  }).format(new Date(q.time * 1000)); // "2026-09-23 15:42" in the exchange's time zone, like the bars
  if (label.slice(0, 10) !== bars.times.at(-1).slice(0, 10)) return bars;
  if (q.time < bars.last + bars.step) {
    return bars.close.at(-1) === q.price ? bars : { ...bars, close: [...bars.close.slice(0, -1), q.price] };
  }
  return { ...bars, times: [...bars.times, label], close: [...bars.close, q.price] };
}

/** Axis ticks for intraday bars drawn one after another (nights and weekends left out): the start of each day when there are
 * several days, else the full hours (every other hour when there are many). */
export function intradayTicks(times) {
  const vals = [], text = [];
  const days = new Set(times.map((t) => t.slice(0, 10)));
  if (days.size > 1) {
    times.forEach((t, i) => {
      if (i === 0 || t.slice(0, 10) !== times[i - 1].slice(0, 10)) {
        vals.push(i);
        text.push(new Date(`${t.slice(0, 10)}T12:00:00Z`).toLocaleDateString('en', { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC' }));
      }
    });
    return { vals, text };
  }
  times.forEach((t, i) => {
    if (t.slice(14, 16) === '00' || i === 0) { vals.push(i); text.push(t.slice(11, 16)); }
  });
  const every = Math.ceil(vals.length / 9);
  return { vals: vals.filter((_, k) => k % every === 0), text: text.filter((_, k) => k % every === 0) };
}

/** Prices in today's dollars: each close x (latest CPI / CPI of its month). Months after the last CPI release use the latest CPI
 * (no adjustment yet); days before the first CPI month are dropped. `cpi` = { dates: ['YYYY-MM-01'...], cpi: [...] }. */
export function deflate(hist, cpi) {
  if (!hist?.dates.length || !cpi?.dates.length) return hist;
  const byMonth = new Map(cpi.dates.map((d, i) => [d.slice(0, 7), cpi.cpi[i]]));
  const latest = cpi.cpi.at(-1);
  const lastMonth = cpi.dates.at(-1).slice(0, 7);
  const dates = [];
  const close = [];
  hist.dates.forEach((d, i) => {
    const m = d.slice(0, 7);
    const level = m > lastMonth ? latest : byMonth.get(m);
    if (!level) return;
    dates.push(d);
    close.push(hist.close[i] * (latest / level));
  });
  return { ...hist, dates, close };
}
