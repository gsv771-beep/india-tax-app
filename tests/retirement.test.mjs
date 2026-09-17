// Retirement: will the money last? Run: node tests/retirement.test.mjs
import { retirement } from '../public/engine/retirement.js';
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
console.log(failures === 0 ? '\nAll retirement tests passed.' : `\n${failures} retirement test(s) FAILED.`);
process.exit(failures === 0 ? 0 : 1);
