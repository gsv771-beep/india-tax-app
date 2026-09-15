// NPS projection. Run: node tests/planning.test.mjs
import { npsProjection } from '../public/js/nps.js';

let failures = 0;
const ok = (name, cond, detail = '') => { console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${detail ? ' (' + detail + ')' : ''}`); if (!cond) failures++; };
const near = (name, a, e, tol = 1) => ok(name, Math.abs(a - e) <= tol, `got ${Math.round(a)}, expected ${e}`);
// NPS projection: 5,000 a month for 30 years at 10%, no step-up, 40% annuity at 6%
{
  const r = npsProjection({ age: 30, retireAge: 60, monthly: 5000, stepUpPct: 0, returnPct: 10, annuityPct: 40, annuityRatePct: 6 });
  ok('30 years', r.years === 30);
  near('invested 18L', r.invested, 1800000, 1);
  ok('corpus around 1.13 crore', r.corpus > 11000000 && r.corpus < 11600000, String(Math.round(r.corpus)));
  near('annuity corpus is 40%', r.annuityCorpus, r.corpus * 0.4, 1);
  near('lump sum all tax-free at 60%', r.lumpTaxable, 0, 0.01);
  near('pension = annuity corpus x 6% / 12', r.pension, (r.corpus * 0.4 * 0.06) / 12, 1);
}
// 80% lump sum: 20% slice taxable
{
  const r = npsProjection({ age: 40, retireAge: 60, monthly: 10000, employerMonthly: 5000, stepUpPct: 5, returnPct: 9, annuityPct: 20, annuityRatePct: 6.5 });
  near('taxable slice is 20% of corpus', r.lumpTaxable, r.corpus * 0.2, 1);
  ok('employer contribution counted', r.monthly === 15000);
}
ok('annuity share floors at 20%', npsProjection({ age: 30, monthly: 1000, annuityPct: 5, returnPct: 8 }).annuityShare === 0.2);

console.log(failures === 0 ? '\nAll planning tests passed.' : `\n${failures} test(s) FAILED.`);
process.exit(failures === 0 ? 0 : 1);
