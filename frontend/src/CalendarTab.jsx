import { useMemo, useState } from 'react';
import { useApi } from './api.js';
import { big, num } from './ui.jsx';

const WINDOWS = [[7, 'Next 7 days'], [14, 'Next 14 days'], [30, 'Next 30 days']];
const MIN_YIELDS = [['0', 'Any yield'], ['2', '2% or more'], ['4', '4% or more'], ['6', '6% or more']];
const IPO_STATUS = [['pending', 'Pending'], ['postponed', 'Postponed'], ['history', 'Priced recently']];
const CHIP = 'inline-block py-0 px-1.5 rounded-full text-[11px] font-semibold align-middle bg-[var(--surface)] text-[var(--text-2)]';
const money = (v, d = 2) => (v == null ? '–' : `$${v.toLocaleString('en', { minimumFractionDigits: d, maximumFractionDigits: d })}`);
const weekday = (iso) => new Date(`${iso}T12:00:00`).toLocaleDateString('en', { weekday: 'short' });

function Pills({ options, value, onChange }) {
  return (
    <div className="flex flex-wrap gap-2">
      {options.map(([v, text]) => (
        <button
          key={v} type="button" aria-pressed={v === value}
          className={`rounded-full py-1 px-3 text-[13px] border border-[var(--border)] ${v === value ? 'bg-[var(--brand-soft)] border-[var(--brand)] font-semibold' : 'bg-transparent'}`}
          onClick={() => onChange(v)}
        >
          {text}
        </button>
      ))}
    </div>
  );
}

function Dividends({ data, onOpen }) {
  const [days, setDays] = useState(14);
  const [minYield, setMinYield] = useState('0');
  const [q, setQ] = useState('');
  const rows = useMemo(() => {
    const text = q.trim().toLowerCase();
    return data.rows.filter((r) => r.days <= days && (Number(minYield) === 0 || (r.yield ?? 0) >= Number(minYield))
      && (!text || r.ticker.toLowerCase().includes(text) || r.name.toLowerCase().includes(text)));
  }, [data, days, minYield, q]);
  return (
    <>
      <p className="text-[var(--text-2)] text-[13px] mb-3">
        Cash dividends with an ex-dividend date coming up. To receive a dividend you must own the shares before the ex-date (buy at the latest the day before);
        the share price usually drops by about the dividend on the ex-date. The estimated yield is the payment times the payments per year divided by the latest
        stored price{data.commonStocksOnly ? '' : ' (not available yet: it needs the price data collected by the Market tab, and all listed tickers are shown)'}. A high yield can signal a price that fell or a payout that may be cut.
      </p>
      <div className="flex flex-wrap items-end gap-3 mb-3">
        <Pills options={WINDOWS} value={days} onChange={setDays} />
        <label className="inline-flex flex-col gap-1 text-[var(--text-2)] text-[13px]">
          Estimated yield
          <select aria-label="Minimum yield" value={minYield} onChange={(e) => setMinYield(e.target.value)}>{MIN_YIELDS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select>
        </label>
        <label className="inline-flex flex-col gap-1 text-[var(--text-2)] text-[13px] flex-1 min-w-[160px]">
          Search
          <input type="text" value={q} onChange={(e) => setQ(e.target.value)} placeholder="ticker or company" className="w-full normal-case" />
        </label>
        <span className="text-[13px] text-[var(--text-2)] pb-2">{num(rows.length)} dividends</span>
      </div>
      {rows.length === 0 ? <p className="text-[var(--text-2)] py-4">No dividends match.</p> : (
        <div className="max-h-[640px] overflow-auto border border-[var(--border)] rounded-md">
          <table>
            <thead>
              <tr><th className="text-left">Ex-dividend date</th><th className="text-left">Company</th><th>Dividend</th><th>Est. yield</th><th className="text-left">Frequency</th><th>Record date</th><th>Pay date</th></tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={`${r.ticker}-${r.exDate}-${r.amount}`}>
                  <td className="text-left whitespace-nowrap">{weekday(r.exDate)} {r.exDate}{r.days === 0 && <span className={`${CHIP} ml-1.5`}>today</span>}</td>
                  <td className="text-left">
                    <button type="button" className="border-0 bg-transparent p-0 font-semibold text-[var(--brand)]" onClick={() => onOpen?.(r.ticker)}>{r.ticker}</button>
                    <span className="ml-2 text-[var(--text-2)] text-xs">{r.name}</span>
                  </td>
                  <td className="whitespace-nowrap">{money(r.amount, r.amount < 0.1 ? 4 : 2)}{r.special && <span className={`${CHIP} ml-1.5`}>special</span>}</td>
                  <td>{r.yield == null ? '–' : `${r.yield.toFixed(1)}%`}</td>
                  <td className="text-left text-[var(--text-2)]">{r.frequency ?? '–'}</td>
                  <td>{r.recordDate ?? '–'}</td><td>{r.payDate ?? '–'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}

function Ipos({ rows }) {
  const [status, setStatus] = useState('pending');
  const shown = useMemo(() => rows.filter((r) => (status === 'pending' ? ['pending', 'new'].includes(r.ipo_status) : r.ipo_status === status)), [rows, status]);
  const counts = (s) => rows.filter((r) => (s === 'pending' ? ['pending', 'new'].includes(r.ipo_status) : r.ipo_status === s)).length;
  return (
    <>
      <p className="text-[var(--text-2)] text-[13px] mb-3">
        Initial public offerings filed with the exchanges. "Pending" offers have a planned price range but no guarantee of a date; postponed ones were pulled for now; "priced" ones have gone ahead.
        The offer size is the maximum shares at the top of the range. New issues are very volatile and often trade far from their offer price on day one.
      </p>
      <div className="mb-3"><Pills options={IPO_STATUS.map(([v, l]) => [v, `${l} (${counts(v)})`])} value={status} onChange={setStatus} /></div>
      {shown.length === 0 ? <p className="text-[var(--text-2)] py-4">None.</p> : (
        <div className="max-h-[640px] overflow-auto border border-[var(--border)] rounded-md">
          <table>
            <thead><tr><th className="text-left">Company</th><th>Price range</th><th>Offer size</th><th>Shares offered</th><th className="text-left">Exchange</th><th className="text-left">Security</th><th>Announced</th><th>Updated</th></tr></thead>
            <tbody>
              {shown.map((r) => (
                <tr key={`${r.ticker}-${r.issuer_name}`}>
                  <td className="text-left"><span className="font-semibold">{r.ticker}</span> <span className="text-[var(--text-2)] text-xs">{r.issuer_name}</span></td>
                  <td className="whitespace-nowrap">
                    {r.final_issue_price != null ? <>{money(r.final_issue_price)} <span className="text-[var(--text-2)] text-xs">final</span></>
                      : r.lowest_offer_price == null ? '–' : r.lowest_offer_price === r.highest_offer_price ? money(r.lowest_offer_price) : `${money(r.lowest_offer_price)} – ${money(r.highest_offer_price)}`}
                  </td>
                  <td>{r.total_offer_size ? `$${big(r.total_offer_size)}` : '–'}</td><td>{num(r.max_shares_offered)}</td>
                  <td className="text-left">{r.primary_exchange ?? '–'}</td><td className="text-left text-[var(--text-2)]">{r.security_description ?? '–'}</td>
                  <td>{r.announced_date ?? '–'}</td><td>{r.last_updated ?? '–'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}

export default function CalendarTab({ onOpen }) {
  const [view, setView] = useState('dividends');
  const { data: d, error, loading } = useApi('/api/calendar');
  return (
    <>
      <h2>Calendars</h2>
      <div className="mb-3"><Pills options={[['dividends', 'Ex-dividend dates'], ['ipos', 'IPOs']]} value={view} onChange={setView} /></div>
      {loading && <p className="text-[var(--text-2)] py-4">Loading (the first load can take up to a minute)…</p>}
      {error && <p className="text-[var(--err)] py-4">{error.message}</p>}
      {d && (view === 'dividends' ? <Dividends data={d.dividends} onOpen={onOpen} /> : <Ipos rows={d.ipos} />)}
    </>
  );
}
