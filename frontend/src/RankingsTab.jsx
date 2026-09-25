import { useMemo, useState } from 'react';
import { useApi } from './api.js';
import { COLUMNS, useRows } from './rows.js';
import ValueRankTab from './ValueRankTab.jsx';
import {
  MUTED, RANK_BADGE, ROW_BTN, SCORE_CELL, SCORE_FIRST_CELL, SCORE_HEAD_CELL, SCORE_ROW_SELECTED, SCORE_SMALL, SCORE_TABLE,
  Seg, median,
} from './ui.jsx';

const UNIVERSES = [['peers', 'Direct competitors'], ['market', 'Largest companies'], ['custom', 'My own list']];
const SIZES = ['6', '10', '15', '20', '30'];
function MetricsTable({ symbol }) {
  const [kind, setKind] = useState('peers');
  const [market, setMarket] = useState('us');
  const [sector, setSector] = useState('');
  const [industry, setIndustry] = useState('');
  const [size, setSize] = useState('10');
  const [draft, setDraft] = useState('');
  const [custom, setCustom] = useState('');
  const [sort, setSort] = useState(null); // { key, dir: 1 ascending | -1 descending }

  const options = useApi('/api/rankings/options');
  const industries = options.data?.sectors.find((x) => x.name === sector)?.industries ?? [];
  const key = kind === 'custom' ? custom : kind === 'peers' ? symbol : '';
  const q = encodeURIComponent;
  const universe = useApi(
    kind === 'custom' && !custom ? null
      : `/api/rankings/universe?kind=${kind}&key=${q(key)}&size=${size}&market=${market}&sector=${q(sector)}&industry=${q(industry)}`,
  );
  const companies = universe.data?.companies;
  const rows = useRows(companies);

  const loaded = companies ? companies.filter((c) => rows[c.symbol]).length : 0;

  const ordered = useMemo(() => {
    if (!companies) return [];
    const list = companies.map((c, i) => ({ ...c, i, row: rows[c.symbol] }));
    if (!sort) return list;
    const value = (x) => (x.row && !x.row.failed ? x.row[sort.key] : null);
    return list.sort((a, b) => {
      const [va, vb] = [value(a), value(b)];
      if (va == null || vb == null) return (va == null) - (vb == null) || a.i - b.i; // missing values always last
      return (va - vb) * sort.dir || a.i - b.i;
    });
  }, [companies, rows, sort]);

  const medians = useMemo(() => Object.fromEntries(COLUMNS.map((c) => {
    const vals = Object.values(rows).filter((r) => !r.failed && r[c.key] != null).map((r) => r[c.key]).sort((a, b) => a - b);
    return [c.key, vals.length ? median(vals) : null];
  })), [rows]);

  const clickHeader = (col) => {
    if (sort?.key === col.key) setSort({ key: col.key, dir: -sort.dir });
    else setSort({ key: col.key, dir: col.better === 'low' ? 1 : -1 }); // best first
  };

  const submitList = (e) => {
    e.preventDefault();
    setCustom(draft.trim());
  };

  return (
    <>
      <div className="flex flex-wrap gap-4 mb-3">
        <Seg options={UNIVERSES} value={kind} onChange={setKind} />
        <label className="inline-flex items-center gap-1.5 text-[var(--text-2)]">
          Companies
          <select aria-label="Number of companies" value={size} onChange={(e) => setSize(e.target.value)}>
            {SIZES.map((s) => <option key={s}>{s}</option>)}
          </select>
        </label>
        {kind === 'market' && (
          <>
            <label className="inline-flex items-center gap-1.5 text-[var(--text-2)]">
              Market
              <select aria-label="Market" value={market} onChange={(e) => setMarket(e.target.value)}>
                {(options.data?.markets ?? [{ id: 'us', label: 'United States' }]).map((m) => <option key={m.id} value={m.id}>{m.label}</option>)}
              </select>
            </label>
            <label className="inline-flex items-center gap-1.5 text-[var(--text-2)]">
              Sector
              <select aria-label="Sector" value={sector} onChange={(e) => { setSector(e.target.value); setIndustry(''); }}>
                <option value="">All sectors</option>
                {(options.data?.sectors ?? []).map((x) => <option key={x.name}>{x.name}</option>)}
              </select>
            </label>
            <label className="inline-flex items-center gap-1.5 text-[var(--text-2)]">
              Industry
              <select aria-label="Industry" value={industry} disabled={!sector} onChange={(e) => setIndustry(e.target.value)}>
                <option value="">{sector ? 'All industries' : 'choose a sector first'}</option>
                {industries.map((i) => <option key={i}>{i}</option>)}
              </select>
            </label>
          </>
        )}
        {kind === 'custom' && (
          <form className="flex items-center gap-2" onSubmit={submitList}>
            <input value={draft} onChange={(e) => setDraft(e.target.value)} placeholder="e.g. V, MA, AXP, PYPL" autoComplete="off" spellCheck={false} style={{ width: 240 }} />
            <button type="submit">Load</button>
          </form>
        )}
      </div>

      {kind === 'custom' && !custom && <p className="text-[var(--text-2)] py-6">Type the tickers to compare, separated by commas.</p>}
      {universe.loading && <p className="text-[var(--text-2)] py-6">Loading the list of companies…{kind === 'market' ? ' (the first time takes 10 to 15 seconds for a country group)' : ''}</p>}
      {universe.error && <p className="text-[var(--err)] py-6">Could not build the list: {universe.error.message}</p>}

      {companies && (
        <>
          <p className="text-[var(--text-2)] text-[13px]">
            {universe.data.group}: {companies.length} companies · {loaded} of {companies.length} loaded{loaded < companies.length ? ' (the first load takes a while)' : ''}.
            Click a column to sort; the arrow shows the direction, and the small text says which way is better.
          </p>
          <div className="overflow-x-auto border border-[var(--border)] rounded-lg">
            <table className={SCORE_TABLE}>
              <thead>
                <tr>
                  <th className={`${SCORE_CELL} ${SCORE_HEAD_CELL} ${SCORE_FIRST_CELL} min-w-[300px] bg-[var(--surface)]`}>Company</th>
                  {COLUMNS.map((c) => (
                    <th key={c.key} className={`${SCORE_CELL} ${SCORE_HEAD_CELL}`} aria-sort={sort?.key === c.key ? (sort.dir === 1 ? 'ascending' : 'descending') : 'none'}>
                      <button className={ROW_BTN} onClick={() => clickHeader(c)}>{c.label}{sort?.key === c.key ? (sort.dir === 1 ? ' ▲' : ' ▼') : ''}</button>
                      <small className={SCORE_SMALL}>{c.better === 'low' ? 'lower is better' : c.better === 'high' ? 'higher is better' : ' '}</small>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {ordered.map((x, idx) => {
                  const r = x.row;
                  const me = x.symbol === symbol;
                  return (
                    <tr key={x.symbol} className={me ? SCORE_ROW_SELECTED : ''}>
                      <th scope="row" className={`${SCORE_CELL} ${SCORE_FIRST_CELL} min-w-[300px]`}>
                        {sort && <span className={RANK_BADGE}>{idx + 1}.</span>}
                        <b>{x.symbol}</b> <span className={MUTED}>{r?.name ?? x.name}</span>{me ? ' ◄' : ''}
                      </th>
                      {!r && <td colSpan={COLUMNS.length} className={`${SCORE_CELL} ${MUTED}`}>loading…</td>}
                      {r?.failed && <td colSpan={COLUMNS.length} className={`${SCORE_CELL} ${MUTED}`}>could not load: {r.failed}</td>}
                      {r && !r.failed && COLUMNS.map((c) => (
                        <td key={c.key} className={SCORE_CELL} title={r.errors?.[c.key] ?? (c.key === 'altman' || c.key === 'piotroski' || c.key === 'beneish' ? r.errors?.solidity : undefined)}>
                          {r[c.key] == null ? '–' : c.fmt(r[c.key])}
                        </td>
                      ))}
                    </tr>
                  );
                })}
                <tr>
                  <th scope="row" className={`${SCORE_CELL} ${SCORE_FIRST_CELL} min-w-[300px] pt-1 pb-1 pl-6 border-t-2 border-[var(--border)] font-semibold text-[var(--text)] text-[13px]`}>Median of the group</th>
                  {COLUMNS.map((c) => (
                    <td key={c.key} className={`${SCORE_CELL} pt-1 pb-1 border-t-2 border-[var(--border)] font-semibold text-[var(--text)] text-[13px]`}>
                      {medians[c.key] == null ? '–' : c.fmt(medians[c.key])}
                    </td>
                  ))}
                </tr>
              </tbody>
            </table>
          </div>
        </>
      )}

      <p className="text-[var(--text-2)] text-[13px]">
        Every figure is the one the matching tab shows: EV / EBITDA (trailing 12 months, today's price), ROIC (TTM, else the last fiscal year),
        free cash flow yield (TTM), PEG (next fiscal year's when available), and the Altman, Piotroski and Beneish scores (TTM). ◄ marks
        the company you are looking at. A dash means the figure does not exist for that company (hover it for the reason): banks and
        insurers have no EBITDA or Solidity scores, foreign filers have no SEC-based scores, and free cash flow and ROIC are not meaningful
        for financial companies. "Largest companies" picks by market cap the companies domiciled in the chosen market (a country group such as the European Union), optionally within a sector or industry, one listing per company (its home listing). Rankings help you compare companies with their direct competitors; they are not a buy or sell signal.
      </p>
    </>
  );
}

const VIEWS = [['table', 'Metrics table'], ['under', 'Most undervalued'], ['over', 'Most overvalued']];

export default function RankingsTab({ symbol }) {
  const [view, setView] = useState('table');
  // shared by the two fair-value lists, so switching between them reuses the same scan
  const [filters, setFilters] = useState({ market: 'us', sector: '', industry: '', size: '30' });
  const options = useApi('/api/rankings/options');
  return (
    <>
      <div className="flex flex-wrap items-center gap-4 mt-7 mb-3">
        <h2 className="m-0">Rankings</h2>
        <Seg options={VIEWS} value={view} onChange={setView} />
      </div>
      {view === 'table'
        ? <MetricsTable symbol={symbol} />
        : <ValueRankTab symbol={symbol} direction={view} filters={filters} setFilters={setFilters} options={options.data} />}
    </>
  );
}
