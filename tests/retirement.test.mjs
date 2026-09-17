// Retirement: will the money last? Run: node tests/retirement.test.mjs
import { retirement, buildPlan, drawPlan } from '../public/engine/retirement.js';
let failures = 0;
const ok = (name, cond, detail = '') => { console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${detail ? ' (' + detail + ')' : ''}`); if (!cond) failures++; };
const near = (name, a, e, tol = 1) => ok(name, Math.abs(a - e) <= tol, `got ${Math.round(a)}, expected ${Math.round(e)}`);
const base = { age: 35, retireAt: 60, planUntil: 85, monthlyExpenses: 80000, expensesAfterPct: 80, saved: 2500000, monthlyInvesting: 40000, stepUpPct: 5, inflationPct: 6, growBeforePct: 10, growAfterPct: 7 };
{
  const r = retirement(base);
  ok('50 years of rows, 25 saving then 25 spending', r.years.length === 50 && r.years[24].phase === 'saving' && r.years[25].phase === 'spending');
  ok('corpus at retirement is positive and large', r.corpusAtRetirement > 50000000);
  near('first-year spending = today x inflation^25 x 80%', r.firstYearSpend, 80000 * 12 * Math.pow(1.06, 25) * 0.8, 1);
  ok('corpus needed is the amount that lasts exactly to 85', Math.abs(retirement({ ...base, saved: 0, monthlyInvesting: 0, growBeforePct: 0 }).corpusNeeded - r.corpusNeeded) < 1);
  // a pot of exactly corpusNeeded at retirement runs down to about zero at planUntil
  const exact = retirement({ ...base, age: 60, retireAt: 60, saved: r.corpusNeeded, monthlyInvesting: 0, monthlyExpenses: r.firstYearSpend / 12 / 0.8 });
  ok('exactly the needed corpus lasts to the end with nothing left', exact.gap < 1 && exact.surplusAtEnd < r.corpusNeeded * 0.001);
  ok('gap is zero or the SIP that closes it', r.gap === 0 ? r.gapSip === 0 : r.gapSip > 0);
}
{
  const thin = retirement({ ...base, saved: 0, monthlyInvesting: 5000 });
  ok('too little saved: money runs out before 85', thin.shortfallAt != null && thin.shortfallAt < 85 && thin.lastsUntil === thin.shortfallAt);
  ok('gap SIP closes the gap', Math.abs(retirement({ ...base, saved: 0, monthlyInvesting: 5000 + thin.gapSip, stepUpPct: 0 }).corpusAtRetirement - retirement({ ...base, saved: 0, monthlyInvesting: 5000, stepUpPct: 0 }).corpusAtRetirement - thin.gap) < thin.gap * 0.05);
  const later = retirement({ ...base, saved: 0, monthlyInvesting: 5000, retireAt: 62 });
  ok('retiring later needs less a month to close the gap', later.gapSip < thin.gapSip);
  const hotter = retirement({ ...base, saved: 0, monthlyInvesting: 5000, inflationPct: 7 });
  ok('higher inflation widens the gap', hotter.gap > thin.gap);
}
{
  const rates = { epf: 8.25, ppf: 7.1, scss: 8.2 };
  const plan = buildPlan({ age: 35, monthly: 60000, epfMonthly: 14400, regime: 'old' }, rates);
  ok('build plan adds up to the monthly saving', Math.abs(plan.reduce((s, b) => s + b.amount, 0) - 60000) < 2);
  ok('build plan: EPF first, then NPS at 50,000 a year, then equity, then PPF', plan.map((b) => b.id).join() === 'epf,nps,equity,ppf' || plan.map((b) => b.id).join() === 'epf,nps,equity,ppf,debt');
  near('NPS line is 50,000 a year in the old regime', plan.find((b) => b.id === 'nps').amount, 4167, 1);
  const eq = plan.find((b) => b.id === 'equity');
  ok('equity share at 35 is 70% of what is left after EPF and NPS', Math.abs(eq.amount - (60000 - 14400 - 4167) * 0.7) < 3);
  const older = buildPlan({ age: 58, monthly: 60000, epfMonthly: 0, regime: 'new' }, rates);
  ok('at 58 the equity share drops to 52%', Math.abs(older.find((b) => b.id === 'equity').amount / (60000 - older.find((b) => b.id === 'nps').amount) - 0.52) < 0.01);
  ok('new regime: NPS line points at the employer route', /employer/.test(older.find((b) => b.id === 'nps').label));
  const d = drawPlan({ corpus: 50000000, firstYearSpend: 2000000, retireAt: 60, planUntil: 85 }, rates);
  near('cash bucket is two years of spending', d.buckets[0].amount, 4000000);
  near('income bucket is eight more years', d.buckets[1].amount, 16000000);
  near('growth bucket is the rest', d.buckets[2].amount, 30000000);
  ok('withdrawal rate stated', Math.abs(d.withdrawalRate - 0.04) < 1e-9 && /4\.0%/.test(d.rules[0]));
  ok('SCSS mentioned with the notified rate', /8\.2%/.test(d.buckets[1].where));
  const small = drawPlan({ corpus: 3000000, firstYearSpend: 2000000, retireAt: 60, planUntil: 85 }, rates);
  ok('a small pot fills the cash bucket first and has no growth bucket', small.buckets[0].amount === 3000000 && small.buckets[2].amount === 0);
}

console.log(failures === 0 ? '\nAll retirement tests passed.' : `\n${failures} retirement test(s) FAILED.`);
process.exit(failures === 0 ? 0 : 1);
