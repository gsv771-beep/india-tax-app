/**
 * The two rates behind every "X% equity" mix, each with a source label:
 *   equity: broad equity funds (Large Cap category), median 5-year rolling return from the AMFI history,
 *           with the category's worst 5-year window alongside;
 *   safe:   the notified PPF rate (tax-free, guaranteed).
 * Until the fund file arrives (or if it is missing) the published NPS equity 10-year figure stands in,
 * so nothing is ever a typed-in guess. The page shows the label next to the number either way.
 */
import { loadFunds, summariseCategories } from './funds.js';

export function baseRates(schemes) {
  const ss = schemes.small_savings_rates_q2_fy2026_27;
  const npsE = schemes.nps.historical_returns_by_asset_class.E_equity;
  return {
    equity: npsE['10yr'], equityWorst: Math.min(npsE['1yr'], npsE['3yr'], npsE['5yr']), safe: ss.ppf.rate, ssy: ss.ssy.rate,
    sources: { equity: 'NPS equity (E) 10-year return, as published', safe: `PPF, ${ss._effective}` },
    fundsPending: true,
  };
}

/** Resolves to the rates with the fund history folded in; falls back to baseRates on any failure. */
export async function loadMixRates(schemes) {
  const base = baseRates(schemes);
  try {
    const data = await loadFunds();
    const cats = summariseCategories(data, 5);
    const lc = cats.find((c) => c.category === 'Large Cap') || cats.find((c) => c.category === 'Index Fund (Equity)');
    if (!lc) return base;
    return { ...base, fundsPending: false, equity: +lc.typical.toFixed(1), equityWorst: +lc.low.toFixed(1), sources: { ...base.sources, equity: `${lc.category} funds: median 5-year rolling return across ${lc.count} funds; worst 5-year window ${lc.low.toFixed(1)}%, best ${lc.high.toFixed(1)}%` } };
  } catch {
    // history unavailable: keep the published NPS figure and say so, rather than waiting on it
    return { ...base, fundsPending: false, sources: { ...base.sources, equity: `${base.sources.equity} (fund history unavailable just now)` } };
  }
}
