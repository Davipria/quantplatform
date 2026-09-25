import { useEffect, useState } from 'react';
import { get } from './api.js';

const CONCURRENCY = 3; // rows fetched at once; the backend also paces Finnhub calls

export const n1 = (v) => v.toFixed(1);
export const n2 = (v) => v.toFixed(2);
export const cap = (v) => (v >= 1e12 ? `${(v / 1e12).toFixed(2)}T` : v >= 1e9 ? `${(v / 1e9).toFixed(0)}B` : `${(v / 1e6).toFixed(0)}M`);

// better: which direction is preferable (default sort direction, header hint, "best" highlight)
export const COLUMNS = [
  { key: 'marketCapUsd', label: 'Market cap (USD)', better: null, fmt: cap },
  { key: 'evEbitda', label: 'EV / EBITDA', better: 'low', fmt: (v) => `${n1(v)}x` },
  { key: 'roic', label: 'ROIC', better: 'high', fmt: (v) => `${n1(v)}%` },
  { key: 'fcfYield', label: 'FCF yield', better: 'high', fmt: (v) => `${n1(v)}%` },
  { key: 'peg', label: 'PEG', better: 'low', fmt: n2 },
  { key: 'altman', label: 'Altman Z', better: 'high', fmt: n1 },
  { key: 'piotroski', label: 'Piotroski F', better: 'high', fmt: (v) => String(v) },
  { key: 'beneish', label: 'Beneish M', better: 'low', fmt: n2 },
  { key: 'newsSentiment', label: 'News sentiment (14d)', better: 'high', fmt: (v) => `${v > 0 ? '+' : ''}${n1(v)}%` },
];

const RANKING_ROW = (symbol) => `/api/rankings/row/${encodeURIComponent(symbol)}`;

/** Fetch the companies' rows a few at a time so a table fills in progressively. Returns { symbol: row | { failed } }. */
export function useRows(companies, urlOf = RANKING_ROW) {
  const [rows, setRows] = useState({});
  useEffect(() => {
    setRows({});
    if (!companies?.length) return undefined;
    let live = true;
    let next = 0;
    const worker = async () => {
      while (live && next < companies.length) {
        const { symbol } = companies[next++];
        let row;
        try {
          row = await get(urlOf(symbol));
        } catch (e) {
          row = { symbol, failed: e.message };
        }
        if (live) setRows((cur) => ({ ...cur, [symbol]: row }));
      }
    };
    for (let i = 0; i < CONCURRENCY; i++) worker();
    return () => {
      live = false;
    };
  }, [companies]); // eslint-disable-line react-hooks/exhaustive-deps -- urlOf is a module-level constant at every call site
  return rows;
}
