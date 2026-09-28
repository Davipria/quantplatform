import { useMemo, useState } from 'react';
import { useApi } from './api.js';
import { big, num } from './ui.jsx';

const LAST_FUND = 'quant.fund';
const CHIP = 'inline-block py-0.5 px-2 rounded-full text-xs font-medium';
const STATUS = {
  new: ['New', 'bg-[var(--pos)]/15 text-[var(--pos)]'], added: ['Added', 'bg-[var(--pos)]/15 text-[var(--pos)]'],
  reduced: ['Reduced', 'bg-[var(--err)]/15 text-[var(--err)]'], unchanged: ['Unchanged', 'bg-[var(--surface)] text-[var(--text-2)]'],
};
const label = (s) => (s ? s.replace(/_/g, ' ').replace(/^./, (c) => c.toUpperCase()) : '');
const usd = (v) => `$${big(v)}`;

const Tile = ({ label: l, value, sub }) => (
  <div className="bg-[var(--surface)] rounded-lg py-3 px-3.5">
    <div className="text-[var(--text-2)] text-[13px]">{l}</div>
    <div className="text-2xl font-semibold tabular-nums">{value}</div>
    <div className="text-xs text-[var(--text-2)]">{sub}</div>
  </div>
);

function Pills({ options, value, onChange }) {
  return (
    <div className="flex flex-wrap gap-2 mb-3">
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

function initialFund() {
  try {
    return localStorage.getItem(LAST_FUND) || '0001067983';
  } catch {
    return '0001067983';
  }
}

function Funds() {
  const [cik, setCik] = useState(initialFund);
  const list = useApi('/api/funds');
  const { data: d, error, loading } = useApi(`/api/funds/${cik}`);
  const choose = (c) => {
    setCik(c);
    try {
      localStorage.setItem(LAST_FUND, c);
    } catch { /* private mode: just don't remember it */ }
  };
  const fund = list.data?.find((f) => f.cik === cik);
  return (
    <>
      <p className="text-[var(--text-2)] text-[13px] mb-3">
        What well-known investors held at the end of their latest quarter, from their SEC 13F filings (published 45 days after quarter end, so up to 6 weeks old).
        Only long positions in US-listed securities are reported: no short positions, no foreign stocks, nothing bought or sold since. Copying a fund's list is not a strategy.
      </p>
      <Pills options={(list.data ?? [{ cik, name: cik }]).map((f) => [f.cik, f.name])} value={cik} onChange={choose} />
      {loading && <p className="text-[var(--text-2)] py-4">Loading…</p>}
      {error && <p className="text-[var(--err)] py-4">{error.message}</p>}
      {d && (
        <>
          <h3 className="mt-2 mb-1">{d.name} <span className="font-normal text-[var(--text-2)] text-sm">{fund?.manager ? `· ${fund.manager}` : ''} · quarter ended {d.period}</span></h3>
          <div className="grid grid-cols-[repeat(auto-fit,minmax(170px,1fr))] gap-3">
            <Tile label="Portfolio value" value={usd(d.totalValue)} sub="US long positions" />
            <Tile label="Positions" value={num(d.positions)} sub={`top 10 = ${d.top10Share.toFixed(0)}% of the value`} />
            <Tile label="New positions" value={d.counts.new} sub={d.previousPeriod ? `vs ${d.previousPeriod}` : 'no earlier filing loaded'} />
            <Tile label="Added / reduced" value={`${d.counts.added} / ${d.counts.reduced}`} sub="share count up / down by 1% or more" />
            <Tile label="Sold out" value={d.soldOutCount} sub="held last quarter, not now" />
          </div>
          {d.noticePeriod && (
            <p className="text-[var(--text-2)] text-[13px] mt-2">The fund's filing for the quarter ended {d.noticePeriod} is a notice (holdings are reported by another entity), so the latest positions shown are from {d.period}.</p>
          )}
          {d.valuesScaled && <p className="text-[var(--text-2)] text-[13px] mt-2">This filer reports values in thousands of dollars; they were multiplied by 1,000.</p>}
          {d.truncated && <p className="text-[var(--text-2)] text-[13px] mt-2">The filing list was cut at 1,000 rows, so the earliest quarter may be incomplete.</p>}

          <h3 className="mt-6">Holdings</h3>
          <div className="max-h-[560px] overflow-auto border border-[var(--border)] rounded-md">
            <table>
              <thead>
                <tr><th className="text-left">Company</th><th>Weight</th><th>Shares</th><th>Value</th><th className="text-left">Change vs {d.previousPeriod ?? 'last quarter'}</th></tr>
              </thead>
              <tbody>
                {d.holdings.map((h) => (
                  <tr key={`${h.name}-${h.class}`}>
                    <td className="text-left"><span className="font-semibold">{h.name}</span> <span className="text-[var(--text-2)] text-xs">{h.class}{h.bonds ? ' · bonds' : ''}</span></td>
                    <td>
                      <span className="inline-block h-1.5 rounded-full bg-[var(--brand)] align-middle mr-1.5" style={{ width: `${Math.min(60, h.weight * 2.4)}px` }} />
                      {h.weight.toFixed(1)}%
                    </td>
                    <td>{num(h.shares)}</td><td>{usd(h.value)}</td>
                    <td className="text-left whitespace-nowrap">
                      {h.status && <span className={`${CHIP} ${STATUS[h.status][1]}`}>{STATUS[h.status][0]}</span>}
                      {h.change != null && h.status !== 'unchanged' && <span className="ml-1.5 text-[var(--text-2)] text-xs">{h.change >= 0 ? '+' : ''}{(h.change * 100).toFixed(0)}% shares</span>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {d.positions > d.holdings.length && <p className="text-[var(--text-2)] text-xs mt-1">The {d.holdings.length} largest of {d.positions} positions.</p>}

          {d.soldOut.length > 0 && (
            <>
              <h3 className="mt-6">Sold out since {d.previousPeriod}</h3>
              <div className="overflow-auto border border-[var(--border)] rounded-md max-w-[640px]">
                <table>
                  <thead><tr><th className="text-left">Company</th><th>Shares held before</th><th>Value then</th></tr></thead>
                  <tbody>{d.soldOut.map((h) => <tr key={h.name}><td className="text-left">{h.name}</td><td>{num(h.shares)}</td><td>{usd(h.value)}</td></tr>)}</tbody>
                </table>
              </div>
            </>
          )}
          {d.filingUrl && <p className="text-xs mt-3"><a href={d.filingUrl} target="_blank" rel="noopener noreferrer" className="text-[var(--brand)]">Open the SEC filing ↗</a></p>}
        </>
      )}
    </>
  );
}

function RiskCard({ c, tone }) {
  return (
    <div className="border border-[var(--border)] rounded-lg p-3 bg-[var(--bg)]">
      <div className="flex flex-wrap items-baseline gap-2">
        <b>{label(c.tertiary)}</b>
        <span className={`${CHIP} ${tone}`}>{label(c.primary)}</span>
      </div>
      <div className="text-[var(--text-2)] text-xs">{label(c.secondary)} · {c.count} paragraph{c.count === 1 ? '' : 's'}</div>
      {c.texts.map((t, i) => <p key={i} className="text-[13px] mt-1.5 mb-0 text-[var(--text-2)] leading-snug">“{t}{t.length >= 500 ? '…' : ''}”</p>)}
    </div>
  );
}

function Risks({ symbol }) {
  const { data: d, error, loading } = useApi(`/api/risk-factors/${encodeURIComponent(symbol)}`);
  if (loading) return <p className="text-[var(--text-2)] py-4">Loading…</p>;
  if (error) return <p className="text-[var(--err)] py-4">{error.message}</p>;
  return (
    <>
      <p className="text-[var(--text-2)] text-[13px] mb-3">
        The risk-factor section of a company's 10-K, classified by Massive into categories. The latest filing ({d.latest}) is compared with the one before it
        {d.previous ? ` (${d.previous})` : ''}: a category that appears now and not before is a risk the company started to warn about. The newest 10-K can be missing
        (Massive processes filings with a delay). Companies write these sections with lawyers, so read a change as a hint to go and read the text, not as news by itself.
      </p>
      <div className="grid grid-cols-[repeat(auto-fit,minmax(170px,1fr))] gap-3">
        <Tile label="Latest filing" value={d.latest} sub={`${d.filings[0].paragraphs} risk paragraphs`} />
        <Tile label="Previous filing" value={d.previous ?? '–'} sub={d.previous ? `${d.filings[1].paragraphs} risk paragraphs` : 'only one filing available'} />
        <Tile label="New categories" value={d.previous ? d.new.length : '–'} sub="in the latest, not the previous" />
        <Tile label="Dropped categories" value={d.previous ? d.dropped.length : '–'} sub="in the previous, not the latest" />
      </div>

      {d.previous && (
        <>
          <h3 className="mt-6">New risks in {d.latest}</h3>
          {d.new.length === 0 ? <p className="text-[var(--text-2)]">No new categories.</p> : (
            <div className="grid grid-cols-2 max-[900px]:grid-cols-1 gap-3">{d.new.map((c) => <RiskCard key={c.tertiary} c={c} tone="bg-[var(--err)]/15 text-[var(--err)]" />)}</div>
          )}
          <h3 className="mt-6">No longer mentioned</h3>
          {d.dropped.length === 0 ? <p className="text-[var(--text-2)]">Nothing was dropped.</p> : (
            <div className="grid grid-cols-2 max-[900px]:grid-cols-1 gap-3">{d.dropped.map((c) => <RiskCard key={c.tertiary} c={c} tone="bg-[var(--surface)] text-[var(--text-2)]" />)}</div>
          )}
          {d.changed.length > 0 && (
            <>
              <h3 className="mt-6">More or less emphasis</h3>
              <div className="overflow-auto border border-[var(--border)] rounded-md max-w-[760px]">
                <table>
                  <thead><tr><th className="text-left">Category</th><th className="text-left">Area</th><th>Paragraphs before</th><th>Paragraphs now</th></tr></thead>
                  <tbody>
                    {d.changed.map((c) => (
                      <tr key={c.tertiary}><td className="text-left">{label(c.tertiary)}</td><td className="text-left text-[var(--text-2)]">{label(c.primary)}</td><td>{c.before}</td>
                        <td className={c.after > c.before ? 'text-[var(--err)]' : 'text-[var(--pos)]'}>{c.after}</td></tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          )}
        </>
      )}

      <h3 className="mt-6">By area</h3>
      <div className="overflow-auto border border-[var(--border)] rounded-md max-w-[560px]">
        <table>
          <thead><tr><th className="text-left">Area</th><th>{d.previous ?? 'Before'}</th><th>{d.latest}</th></tr></thead>
          <tbody>{d.byPrimary.map((p) => <tr key={p.primary}><td className="text-left">{label(p.primary)}</td><td>{p.before ?? '–'}</td><td>{p.after}</td></tr>)}</tbody>
        </table>
      </div>

      <h3 className="mt-6">All categories in {d.latest}</h3>
      <div className="max-h-[420px] overflow-auto border border-[var(--border)] rounded-md">
        <table>
          <thead><tr><th className="text-left">Category</th><th className="text-left">Area</th><th>Paragraphs</th></tr></thead>
          <tbody>{d.categories.map((c) => <tr key={c.tertiary}><td className="text-left">{label(c.tertiary)}</td><td className="text-left text-[var(--text-2)]">{label(c.primary)}</td><td>{c.count}</td></tr>)}</tbody>
        </table>
      </div>
    </>
  );
}

export default function FilingsTab({ symbol }) {
  const [view, setView] = useState('funds');
  const options = useMemo(() => [['funds', 'Fund portfolios (13F)'], ['risks', `Risk factors · ${symbol}`]], [symbol]);
  return (
    <>
      <h2>Filings</h2>
      <Pills options={options} value={view} onChange={setView} />
      {view === 'funds' ? <Funds /> : <Risks symbol={symbol} />}
    </>
  );
}
