// Advance tax schedule and NPS projection. Run: node tests/planning.test.mjs
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { advanceTaxPlan, fyStartYear } from '../public/js/advance-tax.js';
import { npsProjection } from '../public/js/nps.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const rates = JSON.parse(readFileSync(path.join(here, '../public/data/tax_rates.json'), 'utf8'));

let failures = 0;
const ok = (name, cond, detail = '') => { console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${detail ? ' (' + detail + ')' : ''}`); if (!cond) failures++; };
const near = (name, a, e, tol = 1) => ok(name, Math.abs(a - e) <= tol, `got ${Math.round(a)}, expected ${e}`);
const fy = 2026;
const plan = (p) => advanceTaxPlan({ fy, today: new Date(Date.UTC(2026, 8, 13)), ...p }, rates);

ok('fy start year for Sept 2026 is 2026', fyStartYear(new Date(2026, 8, 13)) === 2026);
ok('fy start year for Feb 2027 is 2026', fyStartYear(new Date(2027, 1, 1)) === 2026);

// 1L net liability, nothing paid: 234C = 15k*3% + 45k*3% + 75k*3% + 100k*1% = 5,050; 234B for 4 months = 4,000
{
  const p = plan({ totalTax: 100000, tds: 0, paid: [0, 0, 0, 0], balanceMonth: 4 });
  ok('required', p.required && p.net === 100000);
  ok('four instalments', p.rows.length === 4 && p.rows.map((r) => r.cumDue).join() === '15000,45000,75000,100000');
  near('234C interest', p.interest234C, 5050, 0.01);
  near('234B interest for 4 months', p.interest234B, 4000, 0.01);
  // today is 13 Sep 2026: June has passed, 15 September is still ahead
  ok('June instalment marked passed, September is next', p.rows[0].past && !p.rows[1].past && p.nextDue === p.rows[1], p.nextDue && p.nextDue.label);
  ok('next instalment shortfall is cumulative due', p.nextDue.shortfall === 45000);
}
// tolerance: 12.5% paid by June -> no interest on instalment 1 despite shortfall
{
  const p = plan({ totalTax: 100000, paid: [12500, 12500, 12500, 12500], balanceMonth: 1 });
  ok('June within 12% tolerance', p.rows[0].tolerated && p.rows[0].interest === 0 && p.rows[0].shortfall === 2500);
  ok('September not within 36% tolerance', !p.rows[1].tolerated && p.rows[1].interest > 0);
}
// fully paid on time: no interest
{
  const p = plan({ totalTax: 100000, paid: [15000, 45000, 75000, 100000], balanceMonth: 4 });
  ok('fully paid: zero interest', p.total === 0 && p.nextDue === null);
}
// 90% rule: 92k paid -> no 234B, but 234C on the March shortfall
{
  const p = plan({ totalTax: 100000, paid: [15000, 45000, 75000, 92000], balanceMonth: 4 });
  ok('no 234B when 90% paid', p.interest234B === 0);
  near('234C on March shortfall 8,000 x 1%', p.rows[3].interest, 80, 0.01);
}
// TDS reduces the liability; below threshold not required
{
  const p = plan({ totalTax: 100000, tds: 92000 });
  ok('net 8,000 is below threshold: not required', !p.required && /10,000/.test(p.reason));
}
ok('senior with no business income is exempt', !plan({ totalTax: 500000, seniorNoBusiness: true }).required);
// presumptive: single instalment on 15 March
{
  const p = plan({ totalTax: 100000, presumptive: true, paid: [0, 0, 0, 0], balanceMonth: 2 });
  ok('presumptive: one instalment', p.rows.length === 1 && p.rows[0].cumDue === 100000);
  near('presumptive 234C is one month', p.rows[0].interest, 1000, 0.01);
}
// rounding down to hundreds for interest base
{
  const p = plan({ totalTax: 10150, paid: [0, 0, 0, 0], balanceMonth: 1 });
  near('first instalment 1,523 -> interest on 1,500', p.rows[0].interest, 1500 * 0.01 * 3, 0.01);
}

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
