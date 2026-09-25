import { useMemo } from 'react';
import { useApi } from './api.js';
import { cap, useRows } from './rows.js';
import { MUTED, RANK_BADGE, SCORE_CELL, SCORE_FIRST_CELL, SCORE_HEAD_CELL, SCORE_ROW_SELECTED, SCORE_SMALL, SCORE_TABLE } from './ui.jsx';

export const SCAN_SIZES = ['30', '50', '100'];
const TOP = 20;
const MIN_ESTIMATES = 2; // a "fair value" from a single method is too fragile to rank on
const SUMMARY = (symbol) => `/api/fair-value/${encodeURIComponent(symbol)}/summary`;

const px = (v) => (v == null ? '–' : v.toLocaleString('en', { minimumFractionDigits: 2, maximumFractionDigits: 2 }));
const signed = (v) => (v == null ? '–' : `${v >= 0 ? '+' : ''}${(v * 100).toFixed(1)}%`);
const upClass = (v) => (v == null ? '' : v >= 0 ? 'text-[var(--pos)]' : 'text-[var(--err)]');
const vs = (v, price) => (v == null ? '' : ` (${signed(v / price - 1)})`);

const FILTER = 'inline-flex items-center gap-1.5 text-[var(--text-2)]';

/**
 * The TOP most undervalued (`direction` = 'under') or overvalued ('over') companies among the largest companies of a market /
 * sector / industry, ranked by the upside of the Fair value tab's median-of-methods estimate (default assumptions). Filters live
 * in the parent so switching between the two lists reuses the same scan.
 */
export default function ValueRankTab({ symbol, direction, filters, setFilters, options }) {
  const { market, sector, industry, size } = filters;
  const set = (k) => (e) => setFilters((f) => ({ ...f, [k]: e.target.value, ...(k === 'sector' ? { industry: '' } : {}) }));
  const industries = options?.sectors.find((x) => x.name === sector)?.industries ?? [];
  const q = encodeURIComponent;
  const universe = useApi(`/api/rankings/universe?kind=market&size=${size}&market=${market}&sector=${q(sector)}&industry=${q(industry)}`);
  const companies = universe.data?.companies;
  const rows = useRows(companies, SUMMARY);

  const loaded = companies ? companies.filter((c) => rows[c.symbol]).length : 0;
  const ranked = useMemo(() => {
    const ok = Object.values(rows).filter((r) => !r.failed && r.upside != null && r.estimates >= MIN_ESTIMATES);
    return ok.sort((a, b) => (direction === 'under' ? b.upside - a.upside : a.upside - b.upside)).slice(0, TOP);
  }, [rows, direction]);
  const skipped = Object.values(rows).filter((r) => r.failed || r.upside == null || r.estimates < MIN_ESTIMATES).length;

  return (
    <>
      <div className="flex flex-wrap gap-4 mb-3">
        <label className={FILTER}>
          Market
          <select aria-label="Market" value={market} onChange={set('market')}>
            {(options?.markets ?? [{ id: 'us', label: 'United States' }]).map((m) => <option key={m.id} value={m.id}>{m.label}</option>)}
          </select>
        </label>
        <label className={FILTER}>
          Sector
          <select aria-label="Sector" value={sector} onChange={set('sector')}>
            <option value="">All sectors</option>
            {(options?.sectors ?? []).map((x) => <option key={x.name}>{x.name}</option>)}
          </select>
        </label>
        <label className={FILTER}>
          Industry
          <select aria-label="Industry" value={industry} disabled={!sector} onChange={set('industry')}>
            <option value="">{sector ? 'All industries' : 'choose a sector first'}</option>
            {industries.map((i) => <option key={i}>{i}</option>)}
          </select>
        </label>
        <label className={FILTER}>
          Scan the largest
          <select aria-label="Companies scanned" value={size} onChange={set('size')}>
            {SCAN_SIZES.map((s) => <option key={s}>{s}</option>)}
          </select>
          companies
        </label>
      </div>

      {universe.loading && <p className="text-[var(--text-2)] py-6">Loading the list of companies… (the first time takes 10 to 60 seconds, more for 100 companies)</p>}
      {universe.error && <p className="text-[var(--err)] py-6">Could not build the list: {universe.error.message}</p>}

      {companies && (
        <>
          <p className="text-[var(--text-2)] text-[13px]">
            {universe.data.group}: {loaded} of {companies.length} companies valued
            {loaded < companies.length ? ' (the list reorders as results arrive; a cold scan takes about a second per company, and large scans can hit Yahoo’s rate limit)' : ''}
            {skipped ? ` · ${skipped} left out (fewer than ${MIN_ESTIMATES} estimates or no data)` : ''}.
          </p>
          <div className="overflow-x-auto border border-[var(--border)] rounded-lg">
            <table className={SCORE_TABLE}>
              <thead>
                <tr>
                  <th className={`${SCORE_CELL} ${SCORE_HEAD_CELL} ${SCORE_FIRST_CELL} min-w-[300px] bg-[var(--surface)]`}>Company</th>
                  {[
                    ['Country', ''], ['Sector', ''], ['Market cap', 'local currency'], ['Price', ''], ['Fair value', 'median of methods'],
                    [direction === 'under' ? 'Upside ▼' : 'Downside ▲', 'fair value vs price'], ['DCF', 'default assumptions'],
                    ['Multiples', 'median, 10y history'], ['Analysts', 'mean target'], ['Estimates', 'methods used'],
                  ].map(([h, sub]) => (
                    <th key={h} className={`${SCORE_CELL} ${SCORE_HEAD_CELL}`}>{h}<small className={SCORE_SMALL}>{sub || ' '}</small></th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {ranked.map((r, i) => (
                  <tr key={r.symbol} className={r.symbol === symbol ? SCORE_ROW_SELECTED : ''}>
                    <th scope="row" className={`${SCORE_CELL} ${SCORE_FIRST_CELL} min-w-[300px]`}>
                      <span className={RANK_BADGE}>{i + 1}.</span>
                      <b>{r.symbol}</b> <span className={MUTED}>{r.name}</span>{r.symbol === symbol ? ' ◄' : ''}
                      {r.warning && <span title={r.warning} className="ml-1 text-[var(--warn-text)]">⚠</span>}
                    </th>
                    <td className={SCORE_CELL}>{r.country ?? '–'}</td>
                    <td className={SCORE_CELL}>{r.sector ?? '–'}</td>
                    <td className={SCORE_CELL}>{r.marketCap ? cap(r.marketCap) : '–'}</td>
                    <td className={SCORE_CELL}>{px(r.price)} <span className={MUTED}>{r.currency}</span></td>
                    <td className={`${SCORE_CELL} font-semibold`}>{px(r.fairValue)}</td>
                    <td className={`${SCORE_CELL} font-semibold ${upClass(r.upside)}`}>{signed(r.upside)}</td>
                    <td className={SCORE_CELL}>{px(r.dcf)}<span className={MUTED}>{vs(r.dcf, r.price)}</span></td>
                    <td className={SCORE_CELL}>{px(r.multiples)}<span className={MUTED}>{vs(r.multiples, r.price)}</span></td>
                    <td className={SCORE_CELL}>{px(r.analysts)}<span className={MUTED}>{vs(r.analysts, r.price)}</span></td>
                    <td className={SCORE_CELL}>{r.estimates}</td>
                  </tr>
                ))}
                {!ranked.length && (
                  <tr><td colSpan={11} className={`${SCORE_CELL} ${MUTED} text-left`}>{loaded < companies.length ? 'valuing companies…' : 'no company could be valued'}</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </>
      )}

      <p className="text-[var(--text-2)] text-[13px]">
        Scans the largest companies (by market cap) domiciled in the chosen market, optionally within a sector or industry, and keeps the {TOP} with
        the {direction === 'under' ? 'largest upside' : 'largest downside'}: fair value = the median of the Fair value tab's estimates with its default
        assumptions (DCF, each historical multiple at its 10-year median, analysts' mean target), compared with today's price. Companies with fewer
        than {MIN_ESTIMATES} estimates are left out. Outside the US most rows have only the DCF and analyst targets (historical multiples need Finnhub,
        which covers US listings only); banks and insurers usually lack a DCF. ⚠ = hover for a data caveat (e.g. currency conversion). A large gap
        between price and fair value often means the models miss something (a turnaround, a one-off cash flow, a cyclical peak), so treat these
        lists as a starting point for the Fair value tab, not as buy or sell signals.
      </p>
    </>
  );
}
