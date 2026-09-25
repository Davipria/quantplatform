import Plotly from 'plotly.js-dist-min';
import { useEffect, useRef, useState } from 'react';

const css = (name) => getComputedStyle(document.documentElement).getPropertyValue(name).trim();

const theme = () => ({
  series: css('--series'), muted: css('--muted'), text: css('--text'), text2: css('--text-2'),
  grid: css('--grid'), surface: css('--surface'), border: css('--border'),
  up: css('--up'), down: css('--down'), brand: css('--brand'),
  palette: Array.from({ length: 8 }, (_, i) => css(`--cat-${i + 1}`)), // one colour per company, fixed order
});

function useDarkMode() {
  const query = '(prefers-color-scheme: dark)';
  const [dark, setDark] = useState(() => matchMedia(query).matches);
  useEffect(() => {
    const m = matchMedia(query);
    const onChange = (e) => setDark(e.matches);
    m.addEventListener('change', onChange);
    return () => m.removeEventListener('change', onChange);
  }, []);
  return dark;
}

/**
 * Thin Plotly wrapper. `build(theme)` returns { data, layout }; wrap it in useCallback so the
 * chart only redraws when its inputs change (or the OS colour scheme flips). `onRange([x0, x1])` is called when the user
 * drags a horizontal selection (the chart's layout must set dragmode: 'select'). `className` sets the chart's size
 * (Tailwind height utilities, e.g. "h-[300px]"); defaults to the standard 420px chart height.
 */
export default function Plot({ build, onRange, className = 'h-[420px]' }) {
  const ref = useRef(null);
  const dark = useDarkMode();
  const rangeCb = useRef(onRange);
  rangeCb.current = onRange;

  useEffect(() => {
    const t = theme();
    const { data, layout = {} } = build(t);
    const base = {
      margin: { l: 52, r: 16, t: 24, b: 32 },
      paper_bgcolor: 'rgba(0,0,0,0)', plot_bgcolor: 'rgba(0,0,0,0)',
      font: { color: t.text2, family: 'system-ui, sans-serif', size: 12 },
      hovermode: 'x unified', showlegend: false,
      hoverlabel: { bgcolor: t.surface, bordercolor: t.border, font: { color: t.text } },
    };
    Plotly.react(
      ref.current,
      data,
      {
        ...base, ...layout,
        xaxis: { showgrid: false, linecolor: t.grid, ...layout.xaxis },
        yaxis: { gridcolor: t.grid, zeroline: false, ...layout.yaxis },
      },
      { displayModeBar: false, responsive: true },
    );
    if (ref.current.on) {
      ref.current.removeAllListeners('plotly_selected');
      ref.current.on('plotly_selected', (e) => e?.range?.x && rangeCb.current?.(e.range.x));
    }
  }, [build, dark]);

  useEffect(() => {
    const el = ref.current;
    return () => Plotly.purge(el);
  }, []);

  return <div ref={ref} className={`w-full ${className}`} />;
}
