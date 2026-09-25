export const x = (v, d = 1) => `${v.toFixed(d)}x`;
export const num = (v, d = 0) => (v == null ? '–' : v.toLocaleString('en', { maximumFractionDigits: d }));

/** 1.2T / 45.3B / 870M / 12,500 */
export function big(v) {
  const a = Math.abs(v);
  const [div, unit] = a >= 1e12 ? [1e12, 'T'] : a >= 1e9 ? [1e9, 'B'] : a >= 1e6 ? [1e6, 'M'] : [1, ''];
  return `${(v / div).toLocaleString('en', { maximumFractionDigits: div === 1 ? 2 : 1 })}${unit}`;
}

export function median(sorted) {
  const m = sorted.length >> 1;
  return sorted.length % 2 ? sorted[m] : (sorted[m - 1] + sorted[m]) / 2;
}

const SEG_BTN = 'rounded-none -ml-px py-[5px] px-3 first:rounded-l-md first:ml-0 last:rounded-r-md';
const SEG_BTN_ACTIVE = 'bg-[var(--series)] border-[var(--series)] text-white relative';

/** Segmented control: options are [value, label] pairs. */
export function Seg({ options, value, onChange }) {
  return (
    <div className="inline-flex">
      {options.map(([v, label]) => (
        <button key={v} className={`${SEG_BTN} ${v === value ? SEG_BTN_ACTIVE : ''}`} onClick={() => onChange(v)}>
          {label}
        </button>
      ))}
    </div>
  );
}

// Shared by the wide, sticky-first-column tables (Solidity scores, Rankings, Compare).
export const SCORE_TABLE = 'border-separate border-spacing-0 min-w-full tabular-nums text-[13px]';
export const SCORE_CELL = 'py-2 px-3 text-right whitespace-nowrap bg-[var(--bg)] border-t border-[var(--border)]';
export const SCORE_HEAD_CELL = 'static bg-[var(--surface)] border-t-0 font-semibold';
export const SCORE_FIRST_CELL = 'text-left sticky left-0 z-[1] min-w-[230px] border-r border-[var(--border)]';
export const SCORE_FIRST_HEAD_CELL = 'bg-[var(--surface)]';
export const SCORE_SMALL = 'block text-[var(--text-2)] font-normal text-[11px]';
export const SCORE_ROW_SELECTED = '[&>th]:bg-[var(--surface)] [&>td]:bg-[var(--surface)]';
export const SCORE_ROW_SUB = 'text-[var(--text-2)] text-xs [&>td]:pt-1 [&>td]:pb-1 [&>th]:pt-1 [&>th]:pb-1 [&>td]:border-t-transparent [&>th]:border-t-transparent [&>th]:pl-6 [&>th]:font-normal';
export const WARN_CELL = 'text-[var(--err)] font-semibold';
export const BEST_CELL = 'font-bold text-[var(--text)]';
export const ROW_BTN = 'border-0 bg-transparent p-0 font-semibold text-left text-[var(--text)] aria-pressed:underline aria-pressed:underline-offset-4 aria-pressed:decoration-[var(--series)]';
export const RANK_BADGE = 'inline-block min-w-[26px] text-[var(--text-2)]';
export const MUTED = 'text-[var(--text-2)] font-normal';
export const RANK_MEDIAN_ROW = '[&>td]:border-t-2 [&>td]:border-[var(--border)] [&>th]:border-t-2 [&>th]:border-[var(--border)] font-semibold text-[var(--text)] text-[13px]';

export function DataTable({ headers, rows }) {
  return (
    <div className="max-h-[360px] overflow-auto border border-[var(--border)] rounded-md mt-2">
      <table>
        <thead>
          <tr>{headers.map((h) => <th key={h}>{h}</th>)}</tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={i}>{r.map((c, i) => <td key={i}>{c}</td>)}</tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
