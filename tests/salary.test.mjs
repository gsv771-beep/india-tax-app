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

// ---- the bonus: the CTC carries the target; the payout % moves only what is paid and taxed ----
{
  const base = { ctc: 8000000, basicPct: 40, hraPct: 50, variable: 1500000, includeEmployerPf: false, includeGratuity: false, professionalTax: 2400, city: 'Other' };
  const at = (pct) => salaryBreakdown({ ...base, variablePayoutPct: pct }, rates);
  const t = at(100), hi = at(120), lo = at(80), none = salaryBreakdown({ ...base, variable: 0 }, rates);
  ok('bonus at target: gross salary is the CTC', t.grossSalary === 8000000, String(t.grossSalary));
  ok('a target bonus comes out of the special allowance, not the Basic', t.basic === none.basic && t.special === none.special - 1500000);
  near('bonus at 120%: ₹3 lakh more is paid', hi.grossSalary, 8300000);
  near('bonus at 80%: ₹3 lakh less is paid', lo.grossSalary, 7700000);
  ok('the payout never moves the CTC, Basic or special allowance', [hi, lo].every((r) => r.ctc === t.ctc && r.basic === t.basic && r.special === t.special));
  ok('more bonus, more tax; less bonus, less tax', hi.tax > t.tax && lo.tax < t.tax);
  ok('a missing payout is read as 100%', salaryBreakdown(base, rates).grossSalary === t.grossSalary);
  near('the bonus paid is the target times the payout', hi.variablePaid, 1800000);
  const eng = compareRegimes({ ...t.inputs, salary: { ...t.inputs.salary, gross: 8000000, variablePay: 1500000, variablePayoutPct: 80 } }, rates);
  near('the tax engine taxes the bonus as paid (gross ₹80L with a ₹15L target at 80%)', eng.new.income.lines.find((l) => l.id === 'gross_salary').amount, 7700000);
}

// ---- a bonus paid on top of the CTC: the CTC and its split stay; the bonus adds to what is paid ----
{
  const base = { ctc: 8000000, basicPct: 40, hraPct: 50, variable: 1500000, includeEmployerPf: false, includeGratuity: false, professionalTax: 2400, city: 'Other' };
  const inside = salaryBreakdown(base, rates), top = salaryBreakdown({ ...base, variableInCtc: 'top' }, rates), top80 = salaryBreakdown({ ...base, variableInCtc: 'top', variablePayoutPct: 80 }, rates);
  ok('on top: the special allowance keeps the whole balance of the CTC', top.special === inside.special + 1500000 && top.basic === inside.basic);
  near('on top at 100%: ₹95 lakh is paid', top.grossSalary, 9500000);
  near('on top at 80%: ₹92 lakh is paid', top80.grossSalary, 9200000);
  ok('on top: the package is the CTC plus the target', top.totalPackage === 9500000 && top.ctc === 8000000);
}
// ---- the profile keeps the offer-letter CTC when the bonus is on top (it used to show ₹95 lakh) ----
{
  const { emptyProfile, fromTaxInputs, toTaxInputs, toSalaryStore, fromSalaryStore, ctcHeadline, ctcOf } = await import('../public/engine/profile.js');
  const form = { salary: { gross: 8000000, basicDa: 3200000, hraReceived: 1600000, conveyance: 0, variablePay: 1500000, variableOnTop: true, variablePayoutPct: 100, professionalTax: 2400 }, employer: {}, deductions: {}, incomeType: 'salary' };
  const p = fromTaxInputs(emptyProfile(), form);
  ok('tax form, bonus on top: the profile CTC is the offer-letter ₹80 lakh', p.income.ctc === 8000000 && ctcHeadline(p) === 8000000, String(p.income.ctc));
  ok('... and everything the employer pays is ₹95 lakh', ctcOf(p.income) === 9500000);
  const back = toTaxInputs(p);
  ok('... and it reads back into the form as ₹80 lakh with the bonus on top', back.salary.gross === 8000000 && back.salary.variableOnTop === true && back.salary.variablePay === 1500000);
  const st = toSalaryStore(p);
  ok('... and into the payslip as ₹80 lakh, bonus on top, Basic 40%', st.ctc === 8000000 && st.variableInCtc === 'top' && Math.abs(st.basicPct - 40) < 0.01);
  const r = salaryBreakdown(st, rates);
  const p2 = fromSalaryStore(p, st, r);
  ok('the payslip writes it back unchanged', p2.income.ctc === 8000000 && p2.tax.bonusOnTop === true && ctcOf(p2.income) === 9500000);
  const inside = fromTaxInputs(emptyProfile(), { ...form, salary: { ...form.salary, variableOnTop: false } });
  ok('bonus inside the CTC: the CTC stays ₹80 lakh and nothing is on top', inside.income.ctc === 8000000 && ctcOf(inside.income) === 8000000 && inside.tax.bonusOnTop === false);
}

console.log(failures === 0 ? '\nAll salary tests passed.' : `\n${failures} test(s) FAILED.`);
process.exit(failures === 0 ? 0 : 1);
