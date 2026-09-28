// Pure options maths for the strategy builder. A leg is { kind: 'call' | 'put' | 'stock', side: 1 (long) | -1 (short), strike, qty, premium }.
// Option legs are in contracts of 100 shares; a stock leg is in shares and `premium` is its entry price.

export const MULT = 100;

/** Standard normal CDF (Abramowitz-Stegun 7.1.26 erf, error below 1.5e-7). */
export function cdf(x) {
  const z = Math.abs(x) / Math.SQRT2;
  const t = 1 / (1 + 0.3275911 * z);
  const poly = t * (0.254829592 + t * (-0.284496736 + t * (1.421413741 + t * (-1.453152027 + t * 1.061405429))));
  const erf = 1 - poly * Math.exp(-z * z);
  return x >= 0 ? 0.5 * (1 + erf) : 0.5 * (1 - erf);
}

/** Black-Scholes price per share (continuous dividend yield q); intrinsic value when t or sigma is 0. */
export function bs(kind, s, k, t, r, q, sigma) {
  if (t <= 0 || sigma <= 0) return kind === 'call' ? Math.max(s - k, 0) : Math.max(k - s, 0);
  const d1 = (Math.log(s / k) + (r - q + (sigma * sigma) / 2) * t) / (sigma * Math.sqrt(t));
  const d2 = d1 - sigma * Math.sqrt(t);
  return kind === 'call'
    ? s * Math.exp(-q * t) * cdf(d1) - k * Math.exp(-r * t) * cdf(d2)
    : k * Math.exp(-r * t) * cdf(-d2) - s * Math.exp(-q * t) * cdf(-d1);
}

const intrinsic = (kind, s, k) => (kind === 'call' ? Math.max(s - k, 0) : Math.max(k - s, 0));

/** Profit or loss in dollars of the whole position if the stock is at `s` on the expiry day. */
export function payoff(legs, s) {
  return legs.reduce((sum, l) => sum + (l.kind === 'stock'
    ? l.side * l.qty * (s - l.premium)
    : l.side * l.qty * MULT * (intrinsic(l.kind, s, l.strike) - l.premium)), 0);
}

/** Theoretical profit or loss today (`t` years left, volatility `sigma`) if the stock were at `s`. */
export function valueToday(legs, s, t, r, q, sigma) {
  return legs.reduce((sum, l) => sum + (l.kind === 'stock'
    ? l.side * l.qty * (s - l.premium)
    : l.side * l.qty * MULT * (bs(l.kind, s, l.strike, t, r, q, sigma) - l.premium)), 0);
}

/** What the option legs cost (+) or bring in (-) up front, in dollars (the stock leg is not counted). */
export const netPremium = (legs) => legs.filter((l) => l.kind !== 'stock').reduce((n, l) => n + l.side * l.qty * MULT * l.premium, 0);

/** Maximum profit / loss (null = unlimited), break-even prices and the model's chance of a profit at expiry.
 * The chance uses a lognormal stock price with the risk-free drift: a model, not a forecast. */
export function analyse(legs, spot, t, r, q, sigma) {
  const top = spot * 3;
  const n = 1200;
  const xs = Array.from({ length: n + 1 }, (_, i) => (top * i) / n);
  const ys = xs.map((x) => payoff(legs, x));
  const tol = 1e-7 * (1 + Math.max(...ys.map(Math.abs)));
  const slopeEnd = ys[n] - ys[n - 1];
  const maxProfit = slopeEnd > tol ? null : Math.max(...ys);
  const maxLoss = slopeEnd < -tol ? null : Math.min(...ys);
  const breakevens = [];
  for (let i = 1; i <= n; i += 1) {
    if ((ys[i - 1] < 0 && ys[i] >= 0) || (ys[i - 1] > 0 && ys[i] <= 0)) {
      breakevens.push(xs[i - 1] + ((0 - ys[i - 1]) / (ys[i] - ys[i - 1])) * (xs[i] - xs[i - 1]));
    }
  }
  let pop = null;
  if (t > 0 && sigma > 0) {
    const mu = Math.log(spot) + (r - q - (sigma * sigma) / 2) * t;
    const sd = sigma * Math.sqrt(t);
    const F = (x) => (x <= 0 ? 0 : cdf((Math.log(x) - mu) / sd));
    pop = 0;
    for (let i = 0; i < n; i += 1) if (payoff(legs, (xs[i] + xs[i + 1]) / 2) > 0) pop += F(xs[i + 1]) - F(xs[i]);
  }
  return { maxProfit, maxLoss, breakevens, pop };
}

export const PRESETS = [
  ['long-call', 'Long call'], ['long-put', 'Long put'], ['covered-call', 'Covered call'], ['protective-put', 'Protective put'],
  ['bull-call', 'Bull call spread'], ['bear-put', 'Bear put spread'], ['straddle', 'Long straddle'], ['strangle', 'Long strangle'], ['condor', 'Iron condor'],
];

/** The legs of a preset around `spot`; strikes are snapped with `snap`, premiums are Black-Scholes prices at `sigma` (the user can overwrite them). */
export function preset(name, spot, t, r, q, sigma, snap = (x) => x) {
  const p = (kind, k) => +bs(kind, spot, k, t, r, q, sigma).toFixed(2);
  const opt = (kind, side, pct) => { const k = snap(spot * (1 + pct)); return { kind, side, strike: k, qty: 1, premium: p(kind, k) }; };
  const stock = { kind: 'stock', side: 1, strike: null, qty: 100, premium: +spot.toFixed(2) };
  switch (name) {
    case 'long-call': return [opt('call', 1, 0)];
    case 'long-put': return [opt('put', 1, 0)];
    case 'covered-call': return [stock, opt('call', -1, 0.05)];
    case 'protective-put': return [stock, opt('put', 1, -0.05)];
    case 'bull-call': return [opt('call', 1, 0), opt('call', -1, 0.05)];
    case 'bear-put': return [opt('put', 1, 0), opt('put', -1, -0.05)];
    case 'straddle': return [opt('call', 1, 0), opt('put', 1, 0)];
    case 'strangle': return [opt('call', 1, 0.05), opt('put', 1, -0.05)];
    case 'condor': return [opt('put', 1, -0.1), opt('put', -1, -0.05), opt('call', -1, 0.05), opt('call', 1, 0.1)];
    default: return [];
  }
}
