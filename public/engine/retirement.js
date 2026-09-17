/**
 * Retirement, kept simple: will the money last?
 * Year by year: what you have and what you add grow until you stop working; then expenses, rising
 * with inflation, are drawn from the pot while it keeps earning. Pure; no forecasts, just the
 * assumptions you can see.
 *
 * retirement({ age, retireAt, planUntil, monthlyExpenses, expensesAfterPct, saved, monthlyInvesting,
 *              stepUpPct, inflationPct, growBeforePct, growAfterPct })
 *   -> { lastsUntil, shortfallAt, corpusAtRetirement, corpusNeeded, gapSip, years[], ... }
 */

const num = (v) => (Number.isFinite(+v) ? +v : 0);

export function retirement(o) {
  const age = Math.round(num(o.age)), retireAt = Math.round(num(o.retireAt)), planUntil = Math.round(num(o.planUntil) || 85);
  const infl = num(o.inflationPct) / 100, gBefore = num(o.growBeforePct) / 100, gAfter = num(o.growAfterPct) / 100;
  const after = num(o.expensesAfterPct) / 100 || 1;
  const stepUp = num(o.stepUpPct) / 100;
  const years = [];
  let corpus = num(o.saved), monthly = num(o.monthlyInvesting), spend = num(o.monthlyExpenses) * 12;
  let lastsUntil = null, shortfallAt = null;

  // accumulation: investing through the year, growing at gBefore
  for (let a = age; a < retireAt; a++) {
    corpus = corpus * (1 + gBefore) + monthly * 12 * (1 + gBefore / 2);
    years.push({ age: a + 1, corpus, phase: 'saving', added: monthly * 12 });
    monthly *= 1 + stepUp;
    spend *= 1 + infl;
  }
  const corpusAtRetirement = corpus;
  const firstYearSpend = spend * after;

  // drawdown: spend rises with inflation; the pot earns gAfter on what is left
  let s = firstYearSpend;
  for (let a = retireAt; a < planUntil; a++) {
    corpus = (corpus - s) * (1 + gAfter);
    years.push({ age: a + 1, corpus: Math.max(0, corpus), phase: 'spending', spent: s });
    if (corpus <= 0 && lastsUntil == null && a + 1 < planUntil) { lastsUntil = a + 1; shortfallAt = a + 1; }
    s *= 1 + infl;
  }
  if (lastsUntil == null) lastsUntil = planUntil;

  // corpus that would last exactly to planUntil: solve backwards
  let need = 0;
  s = firstYearSpend * Math.pow(1 + infl, planUntil - retireAt - 1);
  for (let a = planUntil - 1; a >= retireAt; a--) { need = need / (1 + gAfter) + s; s /= 1 + infl; }
  const corpusNeeded = need;
  const gap = Math.max(0, corpusNeeded - corpusAtRetirement);
  // extra monthly SIP from now that closes the gap (flat, no step-up, growing at gBefore)
  const n = Math.max(1, retireAt - age);
  const fvFactor = (Math.pow(1 + gBefore, n) - 1) / gBefore * 12 * (1 + gBefore / 2);
  const gapSip = gBefore > 0 ? gap / fvFactor : gap / (n * 12);
  const surplusAtEnd = Math.max(0, corpus);

  return { age, retireAt, planUntil, corpusAtRetirement, corpusNeeded, gap, gapSip, lastsUntil, shortfallAt, surplusAtEnd, firstYearSpend, years };
}
