import { useCallback, useEffect, useMemo, useState } from 'react';
import { useApi } from './api.js';
import Plot from './Plot.jsx';

const PAGE_SIZE = 9; // 3 columns x 3 rows of larger cards
const SENTIMENT_STYLE = {
  positive: { pill: 'bg-[var(--pos)]/15 text-[var(--pos)]', dot: 'bg-[var(--pos)]' },
  negative: { pill: 'bg-[var(--err)]/15 text-[var(--err)]', dot: 'bg-[var(--err)]' },
  neutral: { pill: 'bg-[var(--surface)] text-[var(--text-2)]', dot: 'bg-[var(--text-2)]' },
};

/** One bar per day: how many more positive than negative articles that day (green above zero, red below). */
function SentimentTrend({ trend }) {
  const build = useCallback((t) => ({
    data: [{
      type: 'bar', x: trend.map((d) => d.date), y: trend.map((d) => d.net),
      marker: { color: trend.map((d) => (d.net > 0 ? t.up : d.net < 0 ? t.down : t.muted)) },
      customdata: trend.map((d) => `${d.positive} positive, ${d.neutral} neutral, ${d.negative} negative`),
      hovertemplate: '%{x}<br>%{customdata}<extra></extra>',
    }],
    layout: {
      margin: { l: 40, r: 8, t: 8, b: 32 }, hovermode: 'closest',
      xaxis: { type: 'category' }, yaxis: { title: { text: 'Net sentiment (articles/day)' }, zeroline: true, zerolinecolor: t.border },
    },
  }), [trend]);
  return <Plot build={build} className="h-[160px]" />;
}

export default function NewsTab({ symbol }) {
  const { data: articles, error, loading } = useApi(`/api/news/${encodeURIComponent(symbol)}`);
  const [page, setPage] = useState(0);
  const [hideYahoo, setHideYahoo] = useState(true); // Yahoo re-syndicates most other outlets' stories under its own name

  useEffect(() => setPage(0), [symbol]);

  // Hooks must run unconditionally, so filtered/trend are computed here (defensively, before the loading/error/empty checks
  // below) rather than after an early return.
  const filtered = useMemo(
    () => (hideYahoo ? (articles ?? []).filter((a) => a.source?.toLowerCase() !== 'yahoo') : (articles ?? [])),
    [articles, hideYahoo],
  );
  const trend = useMemo(() => {
    const byDate = {};
    for (const a of filtered) {
      if (!a.datetime) continue;
      const d = byDate[a.datetime] ?? (byDate[a.datetime] = { positive: 0, neutral: 0, negative: 0 });
      d[a.sentiment.label] += 1;
    }
    return Object.keys(byDate).sort().map((date) => ({ date, ...byDate[date], net: byDate[date].positive - byDate[date].negative }));
  }, [filtered]);

  if (loading) return <p className="text-[var(--text-2)] py-6">Loading…</p>;
  if (error) return <p className="text-[var(--err)] py-6">Could not load news for {symbol}: {error.message}</p>;
  if (!articles.length) return <p className="text-[var(--text-2)] py-6">No recent news for {symbol}.</p>;

  const pages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const shown = filtered.slice(page * PAGE_SIZE, page * PAGE_SIZE + PAGE_SIZE);
  const tally = filtered.reduce((c, a) => ({ ...c, [a.sentiment.label]: (c[a.sentiment.label] ?? 0) + 1 }), {});

  return (
    <section className="mb-7">
      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 mb-3">
        <label className="inline-flex items-center gap-1.5 text-[var(--text-2)]">
          <input type="checkbox" checked={hideYahoo} onChange={(e) => { setHideYahoo(e.target.checked); setPage(0); }} /> Hide Yahoo re-posts
        </label>
        {!!filtered.length && (
          <div className="flex items-center gap-3 text-[13px] text-[var(--text-2)]" title="Local sentiment score, Loughran-McDonald finance word list">
            {['positive', 'neutral', 'negative'].map((label) => (
              <span key={label} className="inline-flex items-center gap-1.5">
                <span className={`inline-block w-2.5 h-2.5 rounded-full ${SENTIMENT_STYLE[label].dot}`} />
                {tally[label] ?? 0} {label}
              </span>
            ))}
          </div>
        )}
      </div>

      {!filtered.length ? (
        <p className="text-[var(--text-2)] py-6">No non-Yahoo news for {symbol} in the last 30 days.</p>
      ) : (
        <>
          {trend.length > 1 && <SentimentTrend trend={trend} />}
          {pages > 1 && (
            <div className="flex items-center justify-center gap-3 mb-4">
              <button
                type="button" aria-label="Previous page" disabled={page === 0}
                className="border-0 bg-transparent p-0 w-8 h-8 rounded-full grid place-items-center text-lg disabled:opacity-30"
                onClick={() => setPage((p) => Math.max(0, p - 1))}
              >
                ‹
              </button>
              {pages <= 10 ? (
                <div className="flex flex-wrap items-center gap-2">
                  {Array.from({ length: pages }, (_, i) => (
                    <button
                      key={i} type="button" aria-label={`Page ${i + 1}`} aria-current={i === page}
                      className={`border-0 p-0 w-2.5 h-2.5 rounded-full ${i === page ? 'bg-[var(--navy)]' : 'bg-[var(--border)]'}`}
                      onClick={() => setPage(i)}
                    />
                  ))}
                </div>
              ) : (
                <span className="text-[13px] text-[var(--text-2)] tabular-nums">Page {page + 1} of {pages}</span>
              )}
              <button
                type="button" aria-label="Next page" disabled={page === pages - 1}
                className="border-0 bg-transparent p-0 w-8 h-8 rounded-full grid place-items-center text-lg disabled:opacity-30"
                onClick={() => setPage((p) => Math.min(pages - 1, p + 1))}
              >
                ›
              </button>
            </div>
          )}
          <div className="grid grid-cols-3 max-[900px]:grid-cols-2 max-[640px]:grid-cols-1 gap-5">
            {shown.map((a) => (
              <a
                key={a.url} href={a.url} target="_blank" rel="noopener noreferrer"
                className="relative flex flex-col min-h-[260px] bg-[var(--brand-soft)] rounded-xl p-5 pr-16 no-underline hover:opacity-90"
              >
                {a.image && (
                  <img src={a.image} alt="" className="w-full h-32 object-cover rounded-lg mb-3 bg-[var(--bg)]" loading="lazy" onError={(e) => { e.currentTarget.style.display = 'none'; }} />
                )}
                <span className={`self-start mb-2 inline-block py-0.5 px-2 rounded-full text-xs font-medium capitalize ${SENTIMENT_STYLE[a.sentiment.label].pill}`}>
                  {a.sentiment.label}
                </span>
                <h3 className="m-0 text-lg font-bold text-[var(--navy)] leading-snug line-clamp-3">{a.headline}</h3>
                {a.summary && <p className="mt-2 mb-0 text-[13px] text-[var(--text-2)] leading-snug line-clamp-3">{a.summary}</p>}
                <p className="mt-auto mb-0 pt-3 text-[13px] text-[var(--text-2)]">
                  {a.source}{a.source && a.datetime ? ' • ' : ''}{a.datetime && new Date(a.datetime).toLocaleDateString('en', { month: '2-digit', day: '2-digit', year: 'numeric' })}
                </p>
                <span aria-hidden="true" className="absolute right-5 bottom-5 w-8 h-8 rounded-full grid place-items-center bg-[var(--bg)] text-[var(--navy)] text-base">↗</span>
              </a>
            ))}
          </div>
        </>
      )}
    </section>
  );
}
