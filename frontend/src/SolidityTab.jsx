import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useApi } from './api.js';
import Plot from './Plot.jsx';
import {
  ROW_BTN, SCORE_CELL, SCORE_FIRST_CELL, SCORE_FIRST_HEAD_CELL, SCORE_HEAD_CELL, SCORE_ROW_SELECTED, SCORE_ROW_SUB,
  SCORE_SMALL, SCORE_TABLE, Seg, WARN_CELL,
} from './ui.jsx';

const MODES = [['annual', 'Annual'], ['quarterly', 'Quarterly']];
const dm = (iso) => `${iso.slice(8, 10)}/${iso.slice(5, 7)}`;
const f2 = (v) => v.toFixed(2);

const ALTMAN_PARTS = [
  ['x1', 'Working capital / total assets'], ['x2', 'Retained earnings / total assets'], ['x3', 'EBIT / total assets'],
  ['x4', 'Market cap / total liabilities'], ['x5', 'Sales / total assets'],
];
const PIOTROSKI_SIGNALS = [
  'Positive net income', 'Positive operating cash flow', 'Return on assets improved', 'Cash flow above net income',
  'Long-term debt ratio did not rise', 'Current ratio improved', 'No new shares issued', 'Gross margin improved', 'Asset turnover improved',
];
const BENEISH_PARTS = [
  ['DSRI', 'Days sales in receivables index'], ['GMI', 'Gross margin index'], ['AQI', 'Asset quality index'], ['SGI', 'Sales growth index'],
  ['DEPI', 'Depreciation index'], ['SGAI', 'SG&A index'], ['TATA', 'Total accruals to assets'], ['LVGI', 'Leverage index'],
];

// Each metric: how to read/format the score, when to flag it, and its component rows.
const METRICS = [
  {
    key: 'altman', label: 'Altman Z-Score', get: (c) => c.altman.z, fmt: f2, flag: (v, th) => v < th.altmanDistress,
    zone: (v, th) => (v > th.altmanSafe ? 'Safe zone' : v >= th.altmanDistress ? 'Grey zone' : 'Distress zone'),
    lines: (th) => [[th.altmanDistress, 'distress below'], [th.altmanSafe, 'safe above']],
    parts: ALTMAN_PARTS.map(([k, label]) => ({ label, get: (c) => c.altman[k], fmt: f2 })),
  },
  {
    key: 'piotroski', label: 'Piotroski F-Score', get: (c) => c.piotroski.f, fmt: String, flag: (v) => v <= 2,
    zone: (v) => (v >= 8 ? 'Strong' : v >= 3 ? 'Average' : 'Weak'),
    lines: () => [[2.5, 'weak at or below 2'], [7.5, 'strong at 8 or 9']],
    parts: PIOTROSKI_SIGNALS.map((label, i) => ({ label: `${i + 1}. ${label}`, get: (c) => c.piotroski.signals[i], fmt: (v) => (v ? '✓' : '✗') })),
  },
  {
    key: 'beneish', label: 'Beneish M-Score', get: (c) => c.beneish.m, fmt: f2, flag: (v, th) => v > th.beneish,
    zone: (v, th) => (v > th.beneish ? 'Possible manipulator' : 'Unlikely manipulator'),
    lines: (th) => [[th.beneish, 'manipulation risk above']],
    parts: BENEISH_PARTS.map(([k, label]) => ({
      label, get: (c) => c.beneish.indices[k], fmt: f2, mark: (c) => (c.beneish.imputed.includes(k) ? '*' : ''),
    })),
  },
];

const Tile = ({ label, value, sub }) => (
  <div className="bg-[var(--surface)] rounded-lg py-3 px-3.5">
    <div className="text-[var(--text-2)] text-[13px]">{label}</div>
    <div className="text-2xl font-semibold tabular-nums">{value}</div>
    <div className="text-[var(--text-2)] text-xs">{sub}</div>
  </div>
);

function ScoreChart({ metric, cols, thresholds }) {
  const build = useCallback((t) => {
    const lines = metric.lines(thresholds);
    const values = cols.map((c) => metric.get(c)).filter((v) => v != null);
    const all = [...values, ...lines.map(([y]) => y)];
    const pad = (Math.max(...all) - Math.min(...all)) * 0.12 || 1;
    return {
      data: [{
        type: 'scatter', mode: 'lines+markers', x: cols.map((c) => (c.isTtm ? c.asOf ?? c.date : c.date)), y: cols.map((c) => metric.get(c)),
        customdata: cols.map((c) => (c.isTtm ? 'TTM' : c.date)), connectgaps: false,
        line: { color: t.series, width: 2 }, marker: { size: 6 },
        hovertemplate: `%{customdata}: %{y:.2f}<extra>${metric.label}</extra>`,
      }],
      layout: {
        hovermode: 'closest', margin: { l: 52, r: 16, t: 24, b: 32 }, yaxis: { range: [Math.min(...all) - pad, Math.max(...all) + pad] },
        shapes: lines.map(([y]) => ({ type: 'line', xref: 'paper', x0: 0, x1: 1, y0: y, y1: y, line: { color: t.muted, width: 1, dash: 'dot' } })),
        annotations: lines.map(([y, text]) => ({
          xref: 'paper', x: 0, y, xanchor: 'left', yanchor: 'bottom', showarrow: false, text, font: { size: 10, color: t.text2 },
        })),
      },
    };
  }, [metric, cols, thresholds]);
  return <Plot build={build} />;
}

export default function SolidityTab({ symbol }) {
  const [mode, setMode] = useState('annual');
  const [selected, setSelected] = useState('altman');
  const [showParts, setShowParts] = useState(false);
  const scroller = useRef(null);
  const api = useApi(`/api/solidity/${encodeURIComponent(symbol)}`);
  const cols = useMemo(
    () => (api.data ? [...api.data[mode], ...(api.data.ttm ? [{ ...api.data.ttm, isTtm: true }] : [])] : []),
    [api.data, mode],
  );
  useEffect(() => { // newest columns first in view, like the reference
    if (scroller.current) scroller.current.scrollLeft = scroller.current.scrollWidth;
  }, [cols]);

  if (api.loading) return <p className="text-[var(--text-2)] py-6">Loading…</p>;
  if (api.error) return <p className="text-[var(--err)] py-6">Could not compute the solidity scores for {symbol}: {api.error.message}</p>;
  const th = api.data.thresholds;
  const ttm = api.data.ttm;
  const metric = METRICS.find((m) => m.key === selected);
  const scroll = (dir) => scroller.current?.scrollBy({ left: dir * 480, behavior: 'smooth' });

  if (!cols.length) return <p className="text-[var(--text-2)] py-6">No solidity scores available for {symbol}.</p>;
  const noScores = cols.every((c) => METRICS.every((m) => m.get(c) == null));

  return (
    <>
      <h2>{symbol} · Solidity</h2>
      {noScores && (
        <div className="py-[10px] px-3.5 rounded-lg my-2 bg-[var(--warn-bg)] text-[var(--warn-text)]">
          None of the three scores could be computed for {symbol}: they need a classified balance sheet (current assets and liabilities), so
          banks and insurers are not covered.
        </div>
      )}
      {ttm && (
        <div className="grid grid-cols-[repeat(auto-fit,minmax(150px,1fr))] gap-3 my-3">
          {METRICS.map((m) => {
            const v = m.get(ttm);
            return <Tile key={m.key} label={m.label} value={v == null ? 'n/a' : m.fmt(v)} sub={v == null ? 'not available' : `${m.zone(v, th)} · TTM to ${ttm.date}`} />;
          })}
        </div>
      )}

      <div className="flex flex-wrap gap-4 mb-3">
        <Seg options={MODES} value={mode} onChange={setMode} />
        <label className="inline-flex items-center gap-1.5 text-[var(--text-2)]"><input type="checkbox" checked={showParts} onChange={(e) => setShowParts(e.target.checked)} /> Show components</label>
        <span className="ml-auto inline-flex gap-2">
          <button aria-label="Scroll to earlier periods" onClick={() => scroll(-1)}>←</button>
          <button aria-label="Scroll to later periods" onClick={() => scroll(1)}>→</button>
        </span>
      </div>
      <p className="text-[var(--text-2)] text-[13px]">Click a score to chart it. ⚠ marks a warning level (Altman below {th.altmanDistress}, Piotroski 2 or less, Beneish above {th.beneish}).</p>

      <div className="overflow-x-auto border border-[var(--border)] rounded-lg" ref={scroller}>
        <table className={SCORE_TABLE}>
          <thead>
            <tr>
              <th className={`${SCORE_CELL} ${SCORE_HEAD_CELL} ${SCORE_FIRST_CELL} ${SCORE_FIRST_HEAD_CELL}`}>Breakdown</th>
              {cols.map((c) => (
                <th key={`${c.date}${c.isTtm ? 't' : ''}`} className={`${SCORE_CELL} ${SCORE_HEAD_CELL}`} title={c.isTtm ? `Latest quarter ${c.date}; market cap at ${c.asOf}` : undefined}>
                  {c.isTtm ? 'TTM' : c.date.slice(0, 4)}
                  <small className={SCORE_SMALL}>{dm(c.date)}</small>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {METRICS.map((m) => (
              <Fragment key={m.key}>
                <tr className={m.key === selected ? SCORE_ROW_SELECTED : ''}>
                  <th scope="row" className={`${SCORE_CELL} ${SCORE_FIRST_CELL}`}>
                    <button className={ROW_BTN} aria-pressed={m.key === selected} onClick={() => setSelected(m.key)}>{m.label}</button>
                  </th>
                  {cols.map((c) => {
                    const v = m.get(c);
                    const flag = v != null && m.flag(v, th);
                    return <td key={`${c.date}${c.isTtm ? 't' : ''}`} className={`${SCORE_CELL} ${flag ? WARN_CELL : ''}`}>{v == null ? '–' : `${flag ? '⚠ ' : ''}${m.fmt(v)}`}</td>;
                  })}
                </tr>
                {showParts && m.parts.map((p) => (
                  <tr key={p.label} className={SCORE_ROW_SUB}>
                    <th scope="row" className={`${SCORE_CELL} ${SCORE_FIRST_CELL}`}>{p.label}</th>
                    {cols.map((c) => {
                      const v = p.get(c);
                      return <td key={`${c.date}${c.isTtm ? 't' : ''}`} className={SCORE_CELL}>{v == null ? '–' : `${p.fmt(v)}${p.mark ? p.mark(c) : ''}`}</td>;
                    })}
                  </tr>
                ))}
              </Fragment>
            ))}
          </tbody>
        </table>
      </div>

      <h2>{metric.label}</h2>
      <ScoreChart metric={metric} cols={cols} thresholds={th} />

      <p className="text-[var(--text-2)] text-[13px]">
        <b>Altman Z</b> = 1.2·(working capital ÷ assets) + 1.4·(retained earnings ÷ assets) + 3.3·(EBIT ÷ assets) + 0.6·(market cap ÷ liabilities)
        + 1.0·(sales ÷ assets): a bankruptcy-risk indicator; above 2.99 is the safe zone, below 1.81 the distress zone (built for
        manufacturers, less reliable for other sectors). <b>Piotroski F</b> counts 9 yes/no signals of profitability, leverage and efficiency
        (8–9 strong, 0–2 weak). <b>Beneish M</b> is an 8-variable model of earnings manipulation; above {th.beneish} is a warning.
        Every score compares a period with the same period a year earlier. Computed from the SEC filings Finnhub provides (US filers only);
        quarterly and TTM columns use trailing-12-month figures and the market cap at the period end (TTM: today). Ratios use period-end
        assets. A * beside a Beneish index means the input was not reported and the neutral value 1.0 was used. Providers differ in details,
        so expect small differences from other tools.
      </p>
    </>
  );
}
