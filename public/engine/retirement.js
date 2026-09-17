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

/**
 * How to build the pot: where each rupee of the monthly saving goes, and why. A rule of thumb with
 * your numbers, not advice: equity share of new savings = 110 - age, kept between 30% and 70%,
 * after the parts that are already decided (EPF) or clearly worth filling first (NPS, PPF).
 *
 * buildPlan({ age, monthly, epfMonthly, regime, equityPct }, rates)
 *   -> [{ id, label, amount, why }]
 */
export function buildPlan(o, rates) {
  const monthly = Math.max(0, num(o.monthly));
  const age = num(o.age) || 35;
  const lines = [];
  let left = monthly;
  const take = (id, label, amount, why) => { const a = Math.min(left, Math.max(0, Math.round(amount))); if (a > 0) { lines.push({ id, label, amount: a, why }); left -= a; } };

  const epf = Math.min(left, Math.max(0, num(o.epfMonthly)));
  if (epf > 0) take('epf', 'EPF, already happening from salary', epf, `${rates.epf}% tax-free, and your employer matches it. Nothing to do; it is the floor of the plan.`);
  // NPS: own contribution up to 50,000 a year for 80CCD(1B) in the old regime; in the new regime the employer route is the one that saves tax
  if (o.regime === 'old') take('nps', 'NPS, your own contribution', 50000 / 12, `Up to ₹50,000 a year is deductible on top of 80C (80CCD(1B)); at 60, 60% comes out tax-free and 40% becomes a pension. Locked till 60, which is the point.`);
  else take('nps', 'NPS, through your employer if you can', Math.min(50000 / 12, left * 0.15), `In the new regime your own NPS gets no deduction, but an employer contribution up to 14% of basic does (80CCD(2)). Ask payroll to restructure; if not, a modest own contribution still buys a tax-free 60% at 60.`);
  // equity: the share the person chose (of everything saved), else a rule of thumb by age applied to what is left
  const chosen = o.equityPct != null && Number.isFinite(+o.equityPct);
  const equityShare = chosen ? Math.max(0, Math.min(1, +o.equityPct / 100)) : Math.max(0.3, Math.min(0.7, (110 - age) / 100));
  const equity = chosen ? Math.min(left, monthly * equityShare) : left * equityShare;
  take('equity', 'Nifty 50 or flexi-cap index fund SIP', equity, `${Math.round(equityShare * 100)}% ${chosen ? 'of your savings, the share you chose' : 'of the rest, from a rule of thumb (110 minus your age)'}. Over 15-25 years broad equity has beaten everything else after tax; it also falls 30-40% now and then, which is why it is rarely 100%.`);
  // PPF up to the cap, then debt
  const ppfMax = 150000 / 12;
  take('ppf', 'PPF', Math.min(ppfMax, left), `${rates.ppf}% tax-free, government-backed, 15-year lock. The safe half that does not need watching; ₹1.5 lakh a year is the cap.`);
  if (left > 0) take('debt', 'Short-duration debt fund or EPF top-up (VPF)', left, `The rest, kept safe. VPF earns EPF’s ${rates.epf}% tax-free up to ₹2.5 lakh of own contributions a year; a debt fund is taxed at slab but can be reached any time.`);
  return lines;
}

/**
 * What to do at retirement with the pot you reach: three buckets, an income floor, and the rules that
 * keep it going. drawPlan({ corpus, firstYearSpend, planUntil, retireAt, npsCorpus }, rates)
 */
export function drawPlan(o, rates) {
  const corpus = Math.max(0, num(o.corpus));
  const spend = Math.max(0, num(o.firstYearSpend));
  const cash = Math.min(corpus, spend * 2);
  const scssCap = 3000000;
  const income = Math.min(corpus - cash, spend * 8);
  const scss = Math.min(income, scssCap * 2);
  const growth = Math.max(0, corpus - cash - income);
  const withdrawalRate = corpus > 0 ? spend / corpus : 0;
  return {
    buckets: [
      { id: 'cash', label: 'Next 2 years of spending', amount: cash, where: 'Savings account, sweep-in FD, liquid fund', why: 'What you live on. Never has to be sold in a bad year.' },
      { id: 'income', label: 'Years 3 to 10', amount: income, where: `Senior Citizen Savings Scheme first (${rates.scss}%, up to ₹30 lakh each for you and your spouse${scss < income ? `; ${'₹' + Math.round(income - scss).toLocaleString('en-IN')} beyond that in` : ', then'} post office deposits, RBI floating-rate bonds, short-duration debt funds)`, why: 'Refills the cash bucket every year. Interest is taxable, but from 60 the slab starts at ₹3 lakh (old regime) and 80TTB exempts ₹50,000 of it.' },
      { id: 'growth', label: 'Years 10 and beyond', amount: growth, where: 'Nifty index fund, balanced advantage fund', why: 'Still growing, because a 25-year retirement needs growth. Sell a year’s worth in good years to top up the income bucket; leave it alone in bad ones.' },
    ],
    withdrawalRate,
    rules: [
      `You are drawing ${(withdrawalRate * 100).toFixed(1)}% of the pot in year one. Under about 4% and it usually lasts; above 5% and it usually does not.`,
      'NPS: take the 60% as a lump sum (tax-free) into the buckets above; the 40% annuity is your income floor, so pick the "with return of purchase price" option only if you want the capital back for heirs and can accept the lower pension.',
      'EPF and PPF come out tax-free; equity funds pay 12.5% on gains above ₹1.25 lakh a year, so sell in slices across years.',
      'Health insurance before you retire, while you can still get it; a ₹10-20 lakh family floater with a super top-up. One hospital stay is the biggest risk to this plan.',
      'Nominations on every account, a will, and one page telling your family where everything is.',
    ],
  };
}
