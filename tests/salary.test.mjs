// In-hand salary breakdown. Run: node tests/salary.test.mjs
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { salaryBreakdown } from '../public/js/salary.js';
import { compareRegimes } from '../public/js/tax-engine.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const rates = JSON.parse(readFileSync(path.join(here, '../public/data/tax_rates.json'), 'utf8'));
let failures = 0;
const ok = (name, cond, detail = '') => { console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${detail ? ' (' + detail + ')' : ''}`); if (!cond) failures++; };
const near = (name, a, e, tol = 1) => ok(name, Math.abs(a - e) <= tol, `got ${Math.round(a)}, expected ${Math.round(e)}`);

{
  const r = salaryBreakdown({ ctc: 1200000, basicPct: 40, hraPct: 50, includeEmployerPf: true, includeGratuity: true, professionalTax: 2400, regime: 'best' }, rates);
  near('basic is 40% of CTC', r.basic, 480000);
  near('HRA is 50% of basic', r.hra, 240000);
  near('employer PF 12% of basic', r.employerPf, 57600);
  near('gratuity 4.81% of basic', r.gratuity, 23088);
  near('components add up to CTC', r.basic + r.hra + r.special + r.employerPf + r.gratuity + r.employerNps, 1200000, 0.01);
  near('employee PF 12% of basic', r.employeePf, 57600);
  ok('regime chosen is the lower one', r.regime === (r.cmp.better === 'old' ? 'old' : 'new'));
  near('in hand = gross - employee PF - PT - tax', r.annual, r.grossSalary - r.employeePf - 2400 - r.tax, 0.01);
  near('monthly is annual / 12', r.monthly, r.annual / 12, 0.01);
  ok('take-home share is sensible', r.takeHomePct > 0.7 && r.takeHomePct < 0.95, String(r.takeHomePct));
  // the engine sees the employee PF in 80C under the old regime
  const via80c = r.cmp.old.income.via.find((v) => v.id === '80c');
  near('engine counted employee PF in 80C', via80c.amount, 57600);
}
{
  const r = salaryBreakdown({ ctc: 2400000, basicPct: 40, hraPct: 50, employerNpsPct: 10, professionalTax: 2400, regime: 'new' }, rates);
  near('employer NPS 10% of basic', r.employerNps, 96000);
  ok('employer NPS deducted under 80CCD(2) in new regime', r.cmp.new.income.via.some((v) => v.id === '80ccd2' && Math.abs(v.amount - 96000) < 1));
  ok('forced new regime is respected', r.regime === 'new');
}
{
  const withRent = salaryBreakdown({ ctc: 1500000, basicPct: 40, hraPct: 50, city: 'Mumbai', rentPaid: 300000, professionalTax: 2400, regime: 'old' }, rates);
  const noRent = salaryBreakdown({ ctc: 1500000, basicPct: 40, hraPct: 50, city: 'Mumbai', rentPaid: 0, professionalTax: 2400, regime: 'old' }, rates);
  ok('rent paid raises old-regime in-hand via HRA exemption', withRent.annual > noRent.annual);
}
ok('impossible structure returns an error', !!salaryBreakdown({ ctc: 1000000, basicPct: 80, hraPct: 50 }, rates).error);
ok('zero CTC does not crash', salaryBreakdown({ ctc: 0, basicPct: 40, hraPct: 50 }, rates).monthly === 0);

console.log(failures === 0 ? '\nAll salary tests passed.' : `\n${failures} test(s) FAILED.`);
process.exit(failures === 0 ? 0 : 1);
