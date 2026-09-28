import { useCallback, useEffect, useMemo, useState } from 'react';
import { useApi } from './api.js';
import { MULT, PRESETS, analyse, bs, netPremium, payoff, preset, valueToday } from './options.js';
import Plot from './Plot.jsx';
import { num } from './ui.jsx';

const usd = (v, d = 2) => (v == null ? '–' : `${v < 0 ? '−' : ''}$${Math.abs(v).toLocaleString('en', { minimumFractionDigits: d, maximumFractionDigits: d })}`);
const pct = (v, d = 1) => (v == null ? '–' : `${(v * 100).toFixed(d)}%`);
const LEG_KINDS = [['call', 'Call'], ['put', 'Put'], ['stock', 'Stock']];

const Tile = ({ label, value, sub }) => (
  <div className="bg-[var(--surface)] rounded-lg py-3 px-3.5">
    <div className="text-[var(--text-2)] text-[13px]">{label}</div>
    <div className="text-2xl font-semibold tabular-nums">{value}</div>
    <div className="text-xs text-[var(--text-2)]">{sub}</div>
  </div>
);
const Field = ({ label, children }) => <label className="inline-flex flex-col gap-1 text-[var(--text-2)] text-[13px]">{label}{children}</label>;
const Warnings = ({ list }) => list?.map((w) => <p key={w} className="text-[13px] text-[var(--err)] mt-1 mb-0">{w}</p>);

function ContractResult({ c, onUseIv }) {
  const g = c.greeks;
  const history = useCallback((t) => ({
    data: [{ x: c.bars.map((b) => b.date), y: c.bars.map((b) => b.close), type: 'scatter', mode: 'lines+markers', marker: { size: 4 }, line: { color: t.brand, width: 2 }, hovertemplate: '$%{y:.2f}<extra>Last price</extra>' }],
    layout: { margin: { l: 50, r: 16, t: 8, b: 32 }, yaxis: { tickprefix: '$', rangemode: 'tozero' } },
  }), [c]);
  return (
    <>
      <h3 className="mt-5 mb-1">{c.symbol} {c.expiry} {c.strike} {c.type}</h3>
      <div className="grid grid-cols-[repeat(auto-fit,minmax(170px,1fr))] gap-3">
        <Tile label="Last traded price" value={usd(c.lastPrice)} sub={`${usd(c.lastPrice * MULT, 0)} per contract · ${c.lastDate} · ${num(c.volume)} traded`} />
        <Tile label="Implied volatility" value={pct(c.iv)} sub={c.realisedVol ? `stock's recent realised: ${pct(c.realisedVol)}` : ''} />
        <Tile label="Delta" value={g ? g.delta.toFixed(2) : '–'} sub={g ? `the option moves about ${usd(Math.abs(g.delta))} per $1 in the stock` : ''} />
        <Tile label="Gamma" value={g ? g.gamma.toFixed(3) : '–'} sub="change in delta per $1" />
        <Tile label="Theta, a day" value={g ? usd(g.theta) : '–'} sub={g ? `${usd(g.theta * MULT, 0)} per contract per day` : ''} />
        <Tile label="Vega" value={g ? usd(g.vega) : '–'} sub="per 1 point of volatility" />
        <Tile label="Intrinsic / time value" value={`${usd(c.intrinsic)} / ${usd(c.timeValue)}`} sub={`stock ${usd(c.underlying)} on ${c.lastDate}`} />
        <Tile label="Break-even at expiry" value={usd(c.breakeven)} sub={`${((c.breakeven / c.underlying - 1) * 100).toFixed(1)}% from the stock`} />
      </div>
      <Warnings list={c.warnings} />
      {c.iv && <button type="button" className="mt-2 rounded-full py-1 px-3 text-[13px]" onClick={() => onUseIv(c.iv * 100)}>Use {(c.iv * 100).toFixed(1)}% in the strategy builder</button>}
      <h4 className="mt-4 mb-0.5 font-semibold">Last price, recent sessions</h4>
      <Plot build={history} className="h-[220px]" />
      <p className="text-[var(--text-2)] text-xs mt-1">
        Computed with Black-Scholes from the last traded price, the stock's close that day, the Treasury rate ({pct(c.rate, 2)}) and the stock's dividend yield ({pct(c.divYield, 2)}). Stock options can be exercised early;
        the model treats them as European, which is approximate for deep in-the-money puts and around dividends.
      </p>
    </>
  );
}

function Move({ m }) {
  return (
    <div className="mt-4 rounded-lg bg-[var(--surface)] py-3 px-4">
      <h3 className="m-0 mb-1">Expected move to {m.expiry}: about ±{usd(m.move)} (±{m.movePct.toFixed(1)}%)</h3>
      <p className="text-sm m-0">
        The at-the-money straddle (the {m.strike} call {usd(m.callPrice)} + the {m.strike} put {usd(m.putPrice)}, last trades of {m.date}, stock {usd(m.underlying)}) costs {usd(m.straddle)}: the options market
        prices a move of roughly that size over the next {m.days} days, i.e. a range of {usd(m.low)} to {usd(m.high)}.
        {m.realisedMove != null && <> For comparison, one standard deviation at the stock's recent realised volatility is ±{usd(m.realisedMove)}.</>}
      </p>
      <Warnings list={m.warnings} />
    </div>
  );
}

function Builder({ ctx, spotDefault, expiryInfo, ivFromContract }) {
  const [spot, setSpot] = useState(String(spotDefault));
  const [days, setDays] = useState(String(Math.max(expiryInfo?.days ?? 30, 1)));
  const [iv, setIv] = useState(ctx.realisedVol ? (ctx.realisedVol * 100).toFixed(1) : '30');
  const [rate, setRate] = useState((ctx.rate * 100).toFixed(2));
  const [div, setDiv] = useState((ctx.divYield * 100).toFixed(2));
  const [name, setName] = useState('bull-call');
  const [legs, setLegs] = useState([]);

  const S = Number(spot) || 0, T = Math.max(Number(days), 0) / 365, r = Number(rate) / 100, q = Number(div) / 100, sigma = Number(iv) / 100;
  const strikes = useMemo(() => (expiryInfo ? [...new Set([...expiryInfo.calls, ...expiryInfo.puts])].sort((a, b) => a - b) : []), [expiryInfo]);
  const snap = useCallback((x) => (strikes.length ? strikes.reduce((best, k) => (Math.abs(k - x) < Math.abs(best - x) ? k : best), strikes[0]) : Math.round(x)), [strikes]);
  const build = useCallback((n) => preset(n, S, T, r, q, sigma, snap), [S, T, r, q, sigma, snap]);

  useEffect(() => { setDays(String(Math.max(expiryInfo?.days ?? 30, 1))); }, [expiryInfo?.date]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { if (ivFromContract) setIv(ivFromContract.toFixed(1)); }, [ivFromContract]);
  useEffect(() => { if (S > 0 && sigma > 0) setLegs(build(name)); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const change = (i, patch) => setLegs((ls) => ls.map((l, j) => (j === i ? { ...l, ...patch } : l)));
  const reprice = () => setLegs((ls) => ls.map((l) => (l.kind === 'stock' ? l : { ...l, premium: +bs(l.kind, S, l.strike, T, r, q, sigma).toFixed(2) })));
  const valid = S > 0 && sigma > 0 && legs.length > 0 && legs.every((l) => l.qty > 0 && (l.kind === 'stock' ? l.premium > 0 : l.strike > 0 && l.premium >= 0));
  const res = useMemo(() => (valid ? analyse(legs, S, T, r, q, sigma) : null), [valid, legs, S, T, r, q, sigma]);
  const net = valid ? netPremium(legs) : 0;

  const chart = useCallback((t) => {
    const xs = Array.from({ length: 161 }, (_, i) => S * (0.6 + (0.8 * i) / 160));
    const expiry = xs.map((x) => payoff(legs, x));
    const today = xs.map((x) => valueToday(legs, x, T, r, q, sigma));
    return {
      data: [
        { x: xs, y: expiry, name: 'At expiry', type: 'scatter', mode: 'lines', fill: 'tozeroy', fillcolor: 'rgba(60,100,200,0.10)', line: { color: t.brand, width: 2.4 }, hovertemplate: '%{y:$,.0f}<extra>At expiry</extra>' },
        { x: xs, y: today, name: `Today (model, ${days} days left)`, type: 'scatter', mode: 'lines', line: { color: t.muted, width: 1.6, dash: 'dash' }, hovertemplate: '%{y:$,.0f}<extra>Today (model)</extra>' },
        { x: res.breakevens, y: res.breakevens.map(() => 0), name: 'Break-even', type: 'scatter', mode: 'markers', marker: { size: 9, color: t.down }, hovertemplate: '%{x:$,.2f}<extra>Break-even</extra>' },
      ],
      layout: {
        showlegend: true, legend: { orientation: 'h', x: 0.5, xanchor: 'center', y: -0.16 }, margin: { l: 64, r: 16, t: 8, b: 48 },
        xaxis: { title: { text: 'Stock price at expiry' }, tickprefix: '$' }, yaxis: { title: { text: 'Profit or loss' }, tickprefix: '$', zeroline: true, zerolinecolor: t.border },
        shapes: [{ type: 'line', xref: 'x', yref: 'paper', x0: S, x1: S, y0: 0, y1: 1, line: { color: t.text2, width: 1, dash: 'dot' } }],
      },
    };
  }, [legs, S, T, r, q, sigma, days, res]);

  return (
    <>
      <div className="flex flex-wrap items-end gap-3 mb-3">
        <Field label="Strategy">
          <select aria-label="Strategy" value={name} onChange={(e) => { setName(e.target.value); setLegs(build(e.target.value)); }}>{PRESETS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select>
        </Field>
        <Field label="Stock price"><input type="number" step="0.01" value={spot} onChange={(e) => setSpot(e.target.value)} aria-label="Stock price" /></Field>
        <Field label="Days to expiry"><input type="number" step="1" min="1" value={days} onChange={(e) => setDays(e.target.value)} aria-label="Days to expiry" /></Field>
        <Field label="Volatility %"><input type="number" step="0.5" value={iv} onChange={(e) => setIv(e.target.value)} aria-label="Volatility" /></Field>
        <Field label="Rate %"><input type="number" step="0.05" value={rate} onChange={(e) => setRate(e.target.value)} aria-label="Rate" /></Field>
        <Field label="Dividend yield %"><input type="number" step="0.05" value={div} onChange={(e) => setDiv(e.target.value)} aria-label="Dividend yield" /></Field>
        <button type="button" className="rounded-full py-1.5 px-3 text-[13px]" onClick={() => setLegs(build(name))}>Rebuild around these inputs</button>
      </div>

      <div className="overflow-auto border border-[var(--border)] rounded-md">
        <table>
          <thead><tr><th className="text-left">Leg</th><th>Long / short</th><th>Strike</th><th>Quantity</th><th>Price paid or received, per share</th><th /></tr></thead>
          <tbody>
            {legs.map((l, i) => (
              <tr key={i}>
                <td className="text-left"><select aria-label={`Leg ${i + 1} type`} value={l.kind} onChange={(e) => change(i, { kind: e.target.value, strike: e.target.value === 'stock' ? null : (l.strike ?? snap(S)), qty: e.target.value === 'stock' ? 100 : 1, premium: e.target.value === 'stock' ? +S.toFixed(2) : +bs(e.target.value, S, l.strike ?? snap(S), T, r, q, sigma).toFixed(2) })}>{LEG_KINDS.map(([v, t]) => <option key={v} value={v}>{t}</option>)}</select></td>
                <td><select aria-label={`Leg ${i + 1} side`} value={l.side} onChange={(e) => change(i, { side: Number(e.target.value) })}><option value={1}>Long (buy)</option><option value={-1}>Short (sell)</option></select></td>
                <td>{l.kind === 'stock' ? '–' : <input type="number" step="0.5" value={l.strike ?? ''} aria-label={`Leg ${i + 1} strike`} onChange={(e) => change(i, { strike: Number(e.target.value) })} />}</td>
                <td><input type="number" min="1" step="1" value={l.qty} aria-label={`Leg ${i + 1} quantity`} onChange={(e) => change(i, { qty: Number(e.target.value) })} /> <span className="text-xs text-[var(--text-2)]">{l.kind === 'stock' ? 'shares' : 'contracts'}</span></td>
                <td><input type="number" step="0.01" value={l.premium} aria-label={`Leg ${i + 1} price`} onChange={(e) => change(i, { premium: Number(e.target.value) })} /></td>
                <td><button type="button" aria-label={`Remove leg ${i + 1}`} className="border-0 bg-transparent p-1 text-[var(--text-2)]" onClick={() => setLegs((ls) => ls.filter((_, j) => j !== i))}>✕</button></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="flex flex-wrap gap-2 mt-2">
        <button type="button" className="rounded-full py-1 px-3 text-[13px]" onClick={() => setLegs((ls) => [...ls, { kind: 'call', side: 1, strike: snap(S), qty: 1, premium: +bs('call', S, snap(S), T, r, q, sigma).toFixed(2) }])}>+ Add a leg</button>
        <button type="button" className="rounded-full py-1 px-3 text-[13px]" onClick={reprice}>Reprice option legs with the model</button>
      </div>
      <p className="text-[var(--text-2)] text-xs mt-1">Prices start as Black-Scholes values at the volatility above; real quotes differ, so replace them with the prices you can actually trade. One option contract covers 100 shares.</p>

      {!valid || !res ? <p className="text-[var(--err)] py-4">Fill in the stock price, volatility and at least one leg with valid numbers.</p> : (
        <>
          <div className="grid grid-cols-[repeat(auto-fit,minmax(170px,1fr))] gap-3 mt-4">
            <Tile label={net >= 0 ? 'Net debit (you pay)' : 'Net credit (you receive)'} value={usd(Math.abs(net), 0)} sub="option legs, before commissions" />
            <Tile label="Maximum profit" value={res.maxProfit == null ? 'Unlimited' : usd(res.maxProfit, 0)} sub="at expiry" />
            <Tile label="Maximum loss" value={res.maxLoss == null ? 'Unlimited' : usd(res.maxLoss, 0)} sub="at expiry" />
            <Tile label="Break-even" value={res.breakevens.length ? res.breakevens.map((b) => usd(b)).join(' · ') : '–'} sub="stock price at expiry" />
            <Tile label="Chance of profit" value={res.pop == null ? '–' : pct(res.pop, 0)} sub="model: lognormal prices at this volatility" />
          </div>
          <Plot build={chart} className="h-[360px]" />
        </>
      )}
    </>
  );
}

export default function OptionsTab({ symbol, quote }) {
  const exp = useApi(`/api/options/${encodeURIComponent(symbol)}/expirations`);
  const [expiry, setExpiry] = useState('');
  const [kind, setKind] = useState('call');
  const [strike, setStrike] = useState('');
  const [contractUrl, setContractUrl] = useState(null);
  const [moveUrl, setMoveUrl] = useState(null);
  const [useIv, setUseIv] = useState(null);
  const contract = useApi(contractUrl);
  const move = useApi(moveUrl);

  const d = exp.data;
  const spot = quote?.price ?? d?.spot;
  const list = d?.expirations ?? [];
  const info = list.find((e) => e.date === expiry);
  useEffect(() => {
    if (!d || expiry) return;
    const first = list.find((e) => e.days >= 20) ?? list[0];
    if (first) setExpiry(first.date);
  }, [d]); // eslint-disable-line react-hooks/exhaustive-deps
  const strikes = info ? (kind === 'call' ? info.calls : info.puts) : [];
  useEffect(() => {
    if (!strikes.length || !spot) return;
    if (!strikes.includes(Number(strike))) setStrike(String(strikes.reduce((b, k) => (Math.abs(k - spot) < Math.abs(b - spot) ? k : b), strikes[0])));
  }, [expiry, kind, strikes.length]); // eslint-disable-line react-hooks/exhaustive-deps

  if (exp.loading) return <p className="text-[var(--text-2)] py-6">Loading the option contracts of {symbol} (the first load can take up to a minute)…</p>;
  if (exp.error) return <p className="text-[var(--err)] py-6">{exp.error.message}</p>;
  const enc = encodeURIComponent(symbol);
  return (
    <>
      <h2>Options — {symbol}</h2>
      <p className="text-[var(--text-2)] text-[13px] mb-3">
        Massive's free plan has the list of contracts and each contract's daily prices, but no live quotes, Greeks or implied volatility, so those are computed here from a contract's last traded price.
        Prices can be days old for rarely traded contracts. This is a learning and analysis tool: options can lose their whole value, and the strategy builder is a model, not advice.
      </p>

      <h3 className="mt-2 mb-1">Analyse a contract</h3>
      <div className="flex flex-wrap items-end gap-3">
        <Field label="Expiration">
          <select aria-label="Expiration" value={expiry} onChange={(e) => { setExpiry(e.target.value); setContractUrl(null); setMoveUrl(null); }}>
            {list.map((e) => <option key={e.date} value={e.date}>{e.date} ({e.days} d)</option>)}
          </select>
        </Field>
        <Field label="Type">
          <select aria-label="Type" value={kind} onChange={(e) => { setKind(e.target.value); setContractUrl(null); }}><option value="call">Call</option><option value="put">Put</option></select>
        </Field>
        <Field label="Strike">
          <select aria-label="Strike" value={strike} onChange={(e) => { setStrike(e.target.value); setContractUrl(null); }}>{strikes.map((k) => <option key={k} value={k}>{k}</option>)}</select>
        </Field>
        <button type="button" className="rounded-full py-2 px-4 bg-[var(--navy)] border-[var(--navy)] text-white" disabled={!strike} onClick={() => setContractUrl(`/api/options/${enc}/contract?expiry=${expiry}&type=${kind}&strike=${strike}`)}>Analyse contract</button>
        <button type="button" className="rounded-full py-2 px-4" disabled={!expiry} onClick={() => setMoveUrl(`/api/options/${enc}/expected-move?expiry=${expiry}`)}>Expected move to this date</button>
        {spot && <span className="text-[13px] text-[var(--text-2)] pb-2">stock {usd(spot)}</span>}
      </div>
      {d.note && <p className="text-[var(--text-2)] text-xs mt-1">{d.note}</p>}
      {contractUrl && contract.loading && <p className="text-[var(--text-2)] py-3">Loading the contract…</p>}
      {contractUrl && contract.error && <p className="text-[var(--err)] py-3">{contract.error.message}</p>}
      {contractUrl && contract.data && <ContractResult c={contract.data} onUseIv={setUseIv} />}
      {moveUrl && move.loading && <p className="text-[var(--text-2)] py-3">Loading the at-the-money call and put…</p>}
      {moveUrl && move.error && <p className="text-[var(--err)] py-3">{move.error.message}</p>}
      {moveUrl && move.data && <Move m={move.data} />}

      <h3 className="mt-8 mb-1">Strategy builder</h3>
      <p className="text-[var(--text-2)] text-[13px] mb-3">Pick a strategy, adjust the legs and see profit or loss for every stock price at expiry (solid) and today by the model (dashed).</p>
      {spot ? <Builder key={`${symbol}`} ctx={d} spotDefault={spot} expiryInfo={info} ivFromContract={useIv} /> : <p className="text-[var(--text-2)]">Waiting for the stock price…</p>}
    </>
  );
}
