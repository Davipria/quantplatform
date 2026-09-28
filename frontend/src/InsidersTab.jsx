import { useMemo, useState } from 'react';
import { useApi } from './api.js';
import { SummaryChart } from './CongressTab.jsx';
import { big, num } from './ui.jsx';

const RANGES = ['1Y', '3Y', '5Y', 'Max'];
const PAGE = 100;
const TYPES = [['', 'Buys and sales'], ['buy', 'Buys only'], ['sell', 'Sales only']];
const TYPE_LABEL = { buy: 'Buy', sell: 'Sell' };
const TYPE_STYLE = { buy: 'bg-[var(--pos)]/15 text-[var(--pos)]', sell: 'bg-[var(--err)]/15 text-[var(--err)]' };
const CHIP = 'inline-block py-0 px-1.5 rounded-full text-[11px] font-semibold align-middle bg-[var(--surface)] text-[var(--text-2)]';
const usd = (v) => `$${big(v)}`;

const Tile = ({ label, value, sub, warn }) => (
  <div className="bg-[var(--surface)] rounded-lg py-3 px-3.5">
    <div className="text-[var(--text-2)] text-[13px]">{label}</div>
    <div className="text-2xl font-semibold tabular-nums">{value}</div>
    <div className={`text-xs ${warn ? 'text-[var(--pos)] font-semibold' : 'text-[var(--text-2)]'}`}>{sub}</div>
  </div>
);

/** Start date (YYYY-MM-DD) of a range pill, '' for Max. */
function cutoffFor(range) {
  return range === 'Max' ? '' : new Date(Date.now() - parseInt(range, 10) * 365.25 * 864e5).toISOString().slice(0, 10);
}

/** One row per insider: what they bought and sold in the chosen range, biggest net seller or buyer first. */
function byInsider(trades) {
  const map = new Map();
  for (const t of trades) {
    const p = map.get(t.insider) ?? { name: t.insider, role: t.role, buy: 0, sell: 0, count: 0, last: t.date };
    p[t.type] += t.value;
    p.count += 1;
    if (t.date > p.last) p.last = t.date;
    map.set(t.insider, p);
  }
  return [...map.values()].sort((a, b) => Math.abs(b.buy - b.sell) - Math.abs(a.buy - a.sell));
}

export default function InsidersTab({ symbol }) {
  const [range, setRange] = useState('5Y');
  const [type, setType] = useState('');
  const [shown, setShown] = useState(PAGE);
  const { data: d, error, loading } = useApi(`/api/insiders/${encodeURIComponent(symbol)}`);

  const cutoff = cutoffFor(range);
  const trades = useMemo(() => (d ? d.trades.filter((t) => t.date >= cutoff) : []), [d, cutoff]);
  const quarters = useMemo(() => (d ? d.quarters.filter((q) => q.year >= Number(cutoff.slice(0, 4))) : []), [d, cutoff]);
  const clusters = useMemo(() => (d ? d.clusters.filter((c) => c.end >= cutoff) : []), [d, cutoff]);
  const insiders = useMemo(() => byInsider(trades), [trades]);
  const rows = useMemo(() => trades.filter((t) => !type || t.type === type), [trades, type]);

  if (loading) return <p className="text-[var(--text-2)] py-6">Loading insider trades (the first load of a company can take up to a minute)…</p>;
  if (error) return <p className="text-[var(--err)] py-6">{error.message}</p>;

  const t = d.tiles;
  const net = t.buyValue - t.sellValue;
  return (
    <>
      <h2>Insider activity — {symbol}</h2>
      <p className="text-[var(--text-2)] text-[13px] mb-3">
        SEC Form 4 filings via Massive. Only open-market purchases and sales by officers, directors and 10% owners: pay-related grants, option
        exercises and tax withholding are left out. Insiders sell for many private reasons, so a purchase says more than a sale.
        Filings arrive up to 2 business days after the trade.
      </p>

      <div className="grid grid-cols-[repeat(auto-fit,minmax(190px,1fr))] gap-3">
        <Tile label="Bought, last 12 months" value={usd(t.buyValue)} sub={`${t.buyCount} trades by ${t.buyers} insiders`} />
        <Tile label="Sold, last 12 months" value={usd(t.sellValue)} sub={`${t.sellCount} trades by ${t.sellers} insiders`} />
        <Tile label="Net, last 12 months" value={`${net >= 0 ? '+' : '−'}${usd(Math.abs(net))}`} sub={net >= 0 ? 'net buying' : 'net selling'} />
        <Tile
          label="Sales under a 10b5-1 plan" value={t.planShare == null ? '–' : `${(t.planShare * 100).toFixed(0)}%`}
          sub="of sales value; pre-scheduled, a weaker signal"
        />
        <Tile
          label="Last purchase" value={t.lastBuy ? usd(t.lastBuy.value) : 'None'}
          sub={t.lastBuy ? `${t.lastBuy.date} · ${t.lastBuy.insider}` : `none since ${d.oldest}`}
        />
        <Tile
          label="Cluster buying" value={t.clusterRecent ? 'Yes' : 'No'} warn={t.clusterRecent}
          sub={t.clusterRecent ? '3+ insiders bought within 30 days, last 90 days' : `${d.clusters.length} in the loaded history`}
        />
      </div>

      <div className="flex flex-wrap gap-2 mt-5 mb-2">
        {RANGES.map((r) => (
          <button
            key={r} type="button" aria-pressed={r === range}
            className={`rounded-full py-1 px-3 text-[13px] border border-[var(--border)] ${r === range ? 'bg-[var(--brand-soft)] border-[var(--brand)] font-semibold' : 'bg-transparent'}`}
            onClick={() => { setRange(r); setShown(PAGE); }}
          >
            {r}
          </button>
        ))}
      </div>
      <SummaryChart quarters={quarters} priceLabel="Stock price" yTitle="Insider trade value ($)" />
      {d.truncated && (
        <p className="text-[var(--text-2)] text-[13px] mt-1">Very active seller: sales older than {d.oldest} are not loaded, so earlier quarters understate selling.</p>
      )}

      {clusters.length > 0 && (
        <>
          <h3 className="mt-6">Cluster buying</h3>
          <p className="text-[var(--text-2)] text-[13px] mb-1.5">Three or more different insiders buying within 30 days of each other.</p>
          <div className="overflow-auto border border-[var(--border)] rounded-md">
            <table>
              <thead><tr><th className="text-left">Period</th><th>Insiders</th><th>Total bought</th></tr></thead>
              <tbody>
                {[...clusters].reverse().map((c) => (
                  <tr key={c.start}><td className="text-left">{c.start} → {c.end}</td><td>{c.insiders}</td><td>{usd(c.value)}</td></tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}

      <h3 className="mt-6">By insider</h3>
      <p className="text-[var(--text-2)] text-[13px] mb-1.5">In the selected range, largest net position change first.</p>
      <div className="max-h-[360px] overflow-auto border border-[var(--border)] rounded-md">
        <table>
          <thead>
            <tr><th className="text-left">Insider</th><th className="text-left">Role</th><th>Bought</th><th>Sold</th><th>Net</th><th>Trades</th><th>Last trade</th></tr>
          </thead>
          <tbody>
            {insiders.slice(0, 40).map((p) => {
              const n = p.buy - p.sell;
              return (
                <tr key={p.name}>
                  <td className="text-left font-semibold whitespace-nowrap">{p.name}</td>
                  <td className="text-left text-[var(--text-2)] max-w-[240px] truncate" title={p.role}>{p.role}</td>
                  <td>{p.buy ? usd(p.buy) : '–'}</td>
                  <td>{p.sell ? usd(p.sell) : '–'}</td>
                  <td className={n >= 0 ? 'text-[var(--pos)]' : 'text-[var(--err)]'}>{n >= 0 ? '+' : '−'}{usd(Math.abs(n))}</td>
                  <td>{p.count}</td>
                  <td>{p.last}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <div className="flex flex-wrap items-end gap-3 mt-6 mb-2">
        <h3 className="m-0">Transactions</h3>
        <select aria-label="Trade type" value={type} onChange={(e) => { setType(e.target.value); setShown(PAGE); }}>
          {TYPES.map(([v, label]) => <option key={v} value={v}>{label}</option>)}
        </select>
        <span className="text-[13px] text-[var(--text-2)]">{num(rows.length)} trades</span>
      </div>
      {rows.length === 0 ? (
        <p className="text-[var(--text-2)] py-4">No trades in this range.</p>
      ) : (
        <>
          <div className="overflow-auto border border-[var(--border)] rounded-md">
            <table>
              <thead>
                <tr>
                  <th className="text-left">Trade date</th><th className="text-left">Insider</th><th>Type</th><th>Shares</th><th>Price</th>
                  <th>Value</th><th>Owned after</th><th className="text-left">Notes</th><th>Filing</th>
                </tr>
              </thead>
              <tbody>
                {rows.slice(0, shown).map((r, i) => (
                  <tr key={`${r.url}-${r.date}-${r.insider}-${i}`}>
                    <td className="text-left whitespace-nowrap">{r.date}</td>
                    <td className="text-left">
                      <span className="block font-semibold whitespace-nowrap">{r.insider}</span>
                      <span className="block text-[var(--text-2)] text-xs max-w-[240px] truncate" title={r.role}>{r.role}</span>
                    </td>
                    <td><span className={`inline-block py-0.5 px-2 rounded-full text-xs font-medium ${TYPE_STYLE[r.type]}`}>{TYPE_LABEL[r.type]}</span></td>
                    <td>{num(r.shares)}</td>
                    <td>{r.price != null ? `$${r.price.toFixed(2)}` : '–'}</td>
                    <td className="whitespace-nowrap">{usd(r.value)}</td>
                    <td>{num(r.owned)}</td>
                    <td className="text-left whitespace-nowrap">
                      {r.plan && <span className={CHIP} title="Sale under a pre-arranged Rule 10b5-1 trading plan">10b5-1</span>}{' '}
                      {r.late && <span className={CHIP} title="Filed after the 2-business-day deadline">late</span>}
                    </td>
                    <td>
                      {r.url && <a href={r.url} target="_blank" rel="noopener noreferrer" aria-label="View the SEC filing" className="text-[var(--brand)]">↗</a>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {rows.length > shown && (
            <div className="text-center mt-3">
              <button type="button" className="rounded-full py-1.5 px-4" onClick={() => setShown((n) => n + PAGE)}>Show more</button>
            </div>
          )}
        </>
      )}
    </>
  );
}
