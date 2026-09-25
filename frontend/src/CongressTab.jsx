import { useCallback, useEffect, useMemo, useState } from 'react';
import { useApi } from './api.js';
import Plot from './Plot.jsx';
import { num } from './ui.jsx';

const RANGES = ['2Y', '5Y', '10Y', 'Max'];
const CHAMBERS = [['', 'All chambers'], ['house', 'House'], ['senate', 'Senate']];
const TYPES = [['', 'All trades'], ['purchase', 'Buy'], ['sale', 'Sell']];
const PAGE_SIZES = ['25', '50', '100'];
const MIN_AMOUNTS = [['', 'Any amount'], ['15000', '$15,000+'], ['50000', '$50,000+'], ['100000', '$100,000+'], ['250000', '$250,000+'], ['500000', '$500,000+'], ['1000000', '$1,000,000+']];
const TYPE_LABEL = { purchase: 'Buy', sale: 'Sell', exchange: 'Exchange' };
const TYPE_STYLE = {
  purchase: 'bg-[var(--pos)]/15 text-[var(--pos)]',
  sale: 'bg-[var(--err)]/15 text-[var(--err)]',
  exchange: 'bg-[var(--surface)] text-[var(--text-2)]',
};

/** "TX17" -> "TX-17"; a bare senate state code is shown as-is. */
function formatSeat(chamber, state) {
  if (!state) return '';
  if (chamber !== 'house') return state;
  const m = state.match(/^([A-Z]{2})(\d+)$/);
  return m ? `${m[1]}-${parseInt(m[2], 10)}` : state;
}

function quartersInRange(quarters, range) {
  if (range === 'Max' || !quarters.length) return quarters;
  const cutoffYear = quarters.at(-1).year - parseInt(range, 10) + 1;
  return quarters.filter((q) => q.year >= cutoffYear);
}

function SummaryChart({ quarters, priceLabel }) {
  const hasPrice = quarters.some((q) => q.price != null);
  const build = useCallback((t) => {
    const data = [
      {
        x: quarters.map((q) => q.label), y: quarters.map((q) => q.buy), name: 'Buy', type: 'bar',
        marker: { color: t.up }, hovertemplate: '$%{y:,.0f}<extra>Buy</extra>',
      },
      {
        x: quarters.map((q) => q.label), y: quarters.map((q) => q.sell), name: 'Sell', type: 'bar',
        marker: { color: t.down }, hovertemplate: '$%{y:,.0f}<extra>Sell</extra>',
      },
    ];
    if (hasPrice) {
      data.push({
        x: quarters.map((q) => q.label), y: quarters.map((q) => q.price), name: priceLabel, type: 'scatter', mode: 'lines',
        yaxis: 'y2', line: { color: t.series, width: 1.5 }, connectgaps: true, hovertemplate: `%{y:,.2f}<extra>${priceLabel}</extra>`,
      });
    }
    return {
      data,
      layout: {
        barmode: 'group', showlegend: true, legend: { orientation: 'h', x: 0.5, xanchor: 'center', y: -0.18 },
        margin: { l: 64, r: hasPrice ? 56 : 16, t: 16, b: 56 },
        xaxis: { type: 'category' }, yaxis: { title: { text: 'Disclosed trade value ($)' } },
        ...(hasPrice ? { yaxis2: { title: { text: priceLabel }, overlaying: 'y', side: 'right', showgrid: false, zeroline: false, rangemode: 'tozero' } } : {}),
      },
    };
  }, [quarters, hasPrice, priceLabel]);
  return <Plot build={build} className="h-[320px]" />;
}

const PARTY_STYLE = {
  D: 'bg-blue-600/15 text-blue-600',
  R: 'bg-[var(--err)]/15 text-[var(--err)]',
  I: 'bg-[var(--surface)] text-[var(--text-2)]',
};
const PARTY_NAME = { D: 'Democrat', R: 'Republican', I: 'Independent' };

/** Official portrait (unitedstates/images, public domain) with the letter avatar as fallback. */
function Avatar({ name, bioguide }) {
  const [failed, setFailed] = useState(false);
  const initial = (name || '?').trim().slice(0, 1).toUpperCase();
  if (bioguide && !failed) {
    return (
      <img
        src={`https://unitedstates.github.io/images/congress/225x275/${bioguide}.jpg`} alt="" loading="lazy"
        className="w-8 h-8 rounded-full object-cover object-top shrink-0" onError={() => setFailed(true)}
      />
    );
  }
  return (
    <span className="w-8 h-8 rounded-full grid place-items-center text-sm font-bold text-[var(--brand)] bg-[var(--brand-soft)] shrink-0" aria-hidden="true">
      {initial}
    </span>
  );
}

function TradeRow({ t }) {
  return (
    <tr>
      <td className="text-left">
        <div className="flex items-center gap-2">
          <Avatar name={t.politician} bioguide={t.bioguide} />
          <span>
            <span className="block font-semibold whitespace-nowrap">
              {t.politician}
              {t.party && (
                <span title={PARTY_NAME[t.party]} className={`ml-1.5 inline-block py-0 px-1.5 rounded-full text-[11px] font-semibold align-middle ${PARTY_STYLE[t.party]}`}>
                  {t.party}
                </span>
              )}
            </span>
            <span className="block text-[var(--text-2)] text-xs whitespace-nowrap">
              {t.chamber === 'house' ? 'Representative' : 'Senator'}{t.state ? ` · ${formatSeat(t.chamber, t.state)}` : ''}
            </span>
          </span>
        </div>
      </td>
      <td className="text-left">
        <span className="font-semibold">{t.ticker ?? '–'}</span>
        {t.asset && <span className="block text-[var(--text-2)] text-xs max-w-[260px] truncate" title={t.asset}>{t.asset}</span>}
      </td>
      <td>
        <span className={`inline-block py-0.5 px-2 rounded-full text-xs font-medium ${TYPE_STYLE[t.type] ?? TYPE_STYLE.exchange}`}>
          {TYPE_LABEL[t.type] ?? t.type ?? '–'}
        </span>
      </td>
      <td>{t.disclosureDate}</td>
      <td>{t.transactionDate}</td>
      <td className="whitespace-nowrap">{t.amountRange ?? '–'}</td>
      <td>
        {t.filingUrl && (
          <a href={t.filingUrl} target="_blank" rel="noopener noreferrer" aria-label={`View ${t.politician}'s filing`} className="text-[var(--brand)]">
            ↗
          </a>
        )}
      </td>
    </tr>
  );
}

export default function CongressTab({ symbol }) {
  const [range, setRange] = useState('5Y');
  const [chamber, setChamber] = useState('');
  const [type, setType] = useState('');
  const [minAmount, setMinAmount] = useState('');
  const [companyOnly, setCompanyOnly] = useState(false);
  const [draft, setDraft] = useState('');
  const [q, setQ] = useState('');
  const [page, setPage] = useState(0);
  const [pageSize, setPageSize] = useState('50');

  useEffect(() => {
    const timer = setTimeout(() => setQ(draft.trim()), 400); // wait for a pause in typing, like the header search box
    return () => clearTimeout(timer);
  }, [draft]);
  useEffect(() => setPage(0), [chamber, type, q, pageSize, minAmount, companyOnly]);

  const tickerFilter = companyOnly ? symbol : '';
  const summaryApi = useApi(companyOnly ? `/api/congress/summary?ticker=${encodeURIComponent(symbol)}` : '/api/congress/summary');
  const listApi = useApi(
    `/api/congress/trades?page=${page}&pageSize=${pageSize}&chamber=${chamber}&type=${type}&q=${encodeURIComponent(q)}`
    + `&ticker=${encodeURIComponent(tickerFilter)}&minAmount=${minAmount}`,
  );
  const shownQuarters = useMemo(
    () => (summaryApi.data ? quartersInRange(summaryApi.data.quarters, range) : []),
    [summaryApi.data, range],
  );

  return (
    <>
      <h2>Politicians{companyOnly ? ` — ${symbol}` : ''}</h2>
      {/* Bargo's free-tier terms require a visible, above-the-fold credit for the Senate data it supplies. */}
      <p className="text-[var(--text-2)] text-[13px] mb-3">
        House trades: official House Clerk disclosures, via a public mirror. Senate trades (last ~3 months): the{' '}
        <a href="https://www.bargo.ai/free-apis/congress" target="_blank" rel="noopener noreferrer" className="text-[var(--brand)]">
          Bargo Congress Trades API
        </a>. Disclosures can lag the actual trade by up to 45 days; dollar amounts are the reported range, not an exact figure.
      </p>

      <label className="inline-flex items-center gap-1.5 text-[var(--text-2)] mb-2">
        <input type="checkbox" checked={companyOnly} onChange={(e) => setCompanyOnly(e.target.checked)} /> This company only ({symbol})
      </label>

      {summaryApi.error ? (
        <p className="text-[var(--err)] py-4">
          {companyOnly ? `No congressional trades found for ${symbol}.` : `Could not load the trade summary: ${summaryApi.error.message}`}
        </p>
      ) : summaryApi.loading ? (
        <p className="text-[var(--text-2)] py-4">Loading…</p>
      ) : (
        <>
          <div className="flex flex-wrap gap-2 mb-2">
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
          <SummaryChart quarters={shownQuarters} priceLabel={summaryApi.data.priceLabel ?? 'Stock price'} />
        </>
      )}

      {summaryApi.data && !summaryApi.data.senateAvailable && (
        <p className="text-[var(--text-2)] text-[13px] mt-2">
          Senate data is temporarily unavailable (Bargo's free daily quota was reached) — House trades still show below.
        </p>
      )}

      <div className="flex flex-wrap items-end gap-3 mt-6 mb-3">
        <label className="inline-flex flex-col gap-1 text-[var(--text-2)] text-[13px]">
          Chamber
          <select aria-label="Chamber" value={chamber} onChange={(e) => setChamber(e.target.value)}>
            {CHAMBERS.map(([v, label]) => <option key={v} value={v}>{label}</option>)}
          </select>
        </label>
        <label className="inline-flex flex-col gap-1 text-[var(--text-2)] text-[13px]">
          Trade type
          <select aria-label="Trade type" value={type} onChange={(e) => setType(e.target.value)}>
            {TYPES.map(([v, label]) => <option key={v} value={v}>{label}</option>)}
          </select>
        </label>
        <label className="inline-flex flex-col gap-1 text-[var(--text-2)] text-[13px]">
          Minimum amount
          <select aria-label="Minimum amount" value={minAmount} onChange={(e) => setMinAmount(e.target.value)}>
            {MIN_AMOUNTS.map(([v, label]) => <option key={v} value={v}>{label}</option>)}
          </select>
        </label>
        <label className="inline-flex flex-col gap-1 text-[var(--text-2)] text-[13px]">
          Rows
          <select aria-label="Rows per page" value={pageSize} onChange={(e) => setPageSize(e.target.value)}>
            {PAGE_SIZES.map((s) => <option key={s}>{s}</option>)}
          </select>
        </label>
        <label className="inline-flex flex-col gap-1 text-[var(--text-2)] text-[13px] flex-1 min-w-[180px]">
          Search politician{companyOnly ? '' : ' or ticker'}
          <input
            type="text" value={draft} onChange={(e) => setDraft(e.target.value)}
            placeholder={companyOnly ? 'e.g. Pelosi' : 'e.g. Pelosi or NVDA'} className="w-full normal-case"
          />
        </label>
      </div>

      {listApi.error ? (
        <p className="text-[var(--err)] py-4">Could not load trades: {listApi.error.message}</p>
      ) : listApi.loading || !listApi.data ? (
        <p className="text-[var(--text-2)] py-4">Loading…</p>
      ) : listApi.data.trades.length === 0 ? (
        <p className="text-[var(--text-2)] py-4">No trades match these filters.</p>
      ) : (
        <>
          <div className="overflow-auto border border-[var(--border)] rounded-md">
            <table>
              <thead>
                <tr>
                  <th className="text-left">Politician</th>
                  <th className="text-left">Asset</th>
                  <th>Type</th>
                  <th>Publication date</th>
                  <th>Transaction date</th>
                  <th>Amount</th>
                  <th>Filing</th>
                </tr>
              </thead>
              <tbody>
                {listApi.data.trades.map((t, i) => <TradeRow key={`${t.source}-${t.filingUrl}-${t.ticker}-${i}`} t={t} />)}
              </tbody>
            </table>
          </div>
          <div className="flex items-center justify-center gap-3 mt-4">
            <button
              type="button" aria-label="Previous page" disabled={page === 0}
              className="border-0 bg-transparent p-0 w-8 h-8 rounded-full grid place-items-center text-lg disabled:opacity-30"
              onClick={() => setPage((p) => Math.max(0, p - 1))}
            >
              ‹
            </button>
            <span className="text-[13px] text-[var(--text-2)] tabular-nums">
              Page {listApi.data.page + 1} of {num(listApi.data.pages)} · {num(listApi.data.total)} trades
            </span>
            <button
              type="button" aria-label="Next page" disabled={page >= listApi.data.pages - 1}
              className="border-0 bg-transparent p-0 w-8 h-8 rounded-full grid place-items-center text-lg disabled:opacity-30"
              onClick={() => setPage((p) => Math.min(listApi.data.pages - 1, p + 1))}
            >
              ›
            </button>
          </div>
        </>
      )}
    </>
  );
}
