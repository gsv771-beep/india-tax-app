/**
 * Risk as a share, not a return: "60% equity, 40% safe" is something people can picture, "12% a year"
 * is not. The expected return follows from the mix and two labelled rates (broad equity funds from
 * the AMFI history, safe money from the notified PPF rate), so no return figure is ever typed in
 * blind. Pure; the rates come in from the page.
 */

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, Number.isFinite(+v) ? +v : lo));

/** How much of money needed in `years` can sensibly sit in equity: nothing under 3 years, a little under 5, half under 7. */
export function equityCap(years) {
  const y = Number.isFinite(+years) ? +years : 0;
  if (y < 3) return 0;
  if (y < 5) return 30;
  if (y < 7) return 50;
  return 100;
}

/**
 * mixReturn(equityPct, { equity, safe, equityWorst }) -> { equityPct, typical, bad }
 * typical: the blended rate; bad: the same blend using the equity category's worst rolling window, so a
 * plan can be shown against a stretch investors have actually lived through.
 */
export function mixReturn(equityPct, rates) {
  const e = clamp(equityPct, 0, 100) / 100;
  const equity = +rates.equity || 0, safe = +rates.safe || 0;
  const worst = Number.isFinite(+rates.equityWorst) ? +rates.equityWorst : equity;
  return { equityPct: e * 100, typical: +(e * equity + (1 - e) * safe).toFixed(2), bad: +(e * worst + (1 - e) * safe).toFixed(2) };
}

/** A plain label for a mix. */
export function describeMix(equityPct) {
  const e = clamp(equityPct, 0, 100);
  if (e === 0) return 'All safe (PPF, EPF, deposits, debt funds)';
  if (e < 35) return 'Mostly safe, a little equity';
  if (e < 65) return 'Half and half';
  if (e < 100) return 'Mostly equity, some safe';
  return 'All equity';
}

/** The presets a page can offer as a starting point; the slider stays free. */
export const MIX_PRESETS = [
  { equityPct: 20, label: 'Careful (20% equity)' },
  { equityPct: 50, label: 'Balanced (50%)' },
  { equityPct: 70, label: 'Growth (70%)' },
  { equityPct: 90, label: 'Aggressive (90%)' },
];
