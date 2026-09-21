// Your money at a glance: the connected picture from one profile. Run: node tests/snapshot.test.mjs
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { snapshot, seedFromCtc } from '../public/js/snapshot-engine.js';
import { emptyProfile, fromSalaryStore, normaliseProfile } from '../public/engine/profile.js';
import { salaryBreakdown } from '../public/js/salary.js';
import { toSalaryStore } from '../public/engine/profile.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const rates = JSON.parse(readFileSync(path.join(here, '../public/data/tax_rates.json'), 'utf8'));
const loanPolicy = JSON.parse(readFileSync(path.join(here, '../public/data/loan_policy.json'), 'utf8'));
const mix = { equity: 14.5, equityWorst: 1.7, safe: 7.1, ssy: 8.2, sources: { equity: 't', safe: 't' } };
let failures = 0;
const ok = (name, cond, detail = '') => { console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${detail ? ' (' + detail + ')' : ''}`); if (!cond) failures++; };
const near = (name, a, e, tol = 1) => ok(name, Math.abs(a - e) <= tol, `got ${Math.round(a)}, expected ${Math.round(e)}`);

ok('empty profile -> no snapshot', snapshot(emptyProfile(), { rates, mix, loanPolicy }) === null);

// a CTC alone seeds a profile, and the snapshot agrees with the salary calculator
{
  const { store, breakdown } = seedFromCtc(emptyProfile(), 1800000, rates);
  const p = fromSalaryStore(emptyProfile(), store, breakdown);
  near('seed: CTC round-trips', p.income.ctc, 1800000, 2);
  const s = snapshot(p, { rates, mix, loanPolicy, equityPct: 60, years: 10 });
  const pay = salaryBreakdown(toSalaryStore(p), rates);
  near('take-home matches the salary calculator', s.takeHome.monthly, pay.monthly, 1);
  near('tax matches the salary calculator', s.tax.annual, pay.tax, 1);
  ok('the other regime is named, and never claims a negative saving', ['old', 'new'].includes(s.tax.otherRegime) && s.tax.otherSaves >= 0);
  ok('no loans: free money is take-home', s.loans.count === 0 && s.surplus.monthly === s.takeHome.monthly && !s.surplus.fromBudget);
  ok('no budget: the ten-year line assumes 30% of take-home is invested', s.invest.assumedShare === 0.3 && Math.abs(s.invest.monthly - Math.round(0.3 * pay.monthly)) <= 1);
  ok('ten-year line grows that at the mix rate', s.invest.fv > s.invest.monthly * 120 && s.invest.fvBad < s.invest.fv);
  ok('home budget: EMI is half of take-home, price = loan / 0.8', s.home.kind === 'budget' && Math.abs(s.home.emi - 0.5 * pay.monthly) < 1 && Math.abs(s.home.price * 0.8 - s.home.loan) < 1);
  ok('home budget uses the policy rate', s.home.ratePct === loanPolicy.rate.default_pct);
  ok('no goals yet', s.goals.length === 0 && s.goalSip === 0);
}

// loans, budget surplus, goals and an emergency fund all flow through
{
  const { store, breakdown } = seedFromCtc(emptyProfile(), 4500000, rates);
  const p = normaliseProfile(fromSalaryStore(emptyProfile(), store, breakdown));
  p.loans.push({ type: 'home', outstanding: 6000000, rate: 8.5, remainingMonths: 180, emi: 59000, propertyUse: 'self_occupied' });
  p.cashflow.monthlySurplus = 60000; p.cashflow.emergencyFund = 900000;
  p.investments.equity = 2000000;
  p.horizon.goals.push({ name: 'Retirement', years: 25, target: 50000000 }, { name: 'College', years: 12, target: 8000000 });
  const s = snapshot(p, { rates, mix, loanPolicy, equityPct: 60, years: 10 });
  near('after EMIs = take-home minus EMIs', s.loans.afterEmi, s.takeHome.monthly - 59000, 1);
  ok('budget surplus wins over the after-EMI figure, and is what gets invested', s.surplus.fromBudget && s.surplus.monthly === 60000 && s.invest.monthly === 60000 && s.invest.assumedShare === 0);
  ok('holdings are included in the ten-year line', s.invest.held === 2000000 && s.invest.fvHeld > 2000000 && s.invest.fv === s.invest.fvSip + s.invest.fvHeld);
  ok('an existing home loan replaces the budget line', s.home.kind === 'have' && s.home.outstanding === 6000000 && s.home.yearsLeft === 15);
  ok('goals: two rows, SIPs positive, total is the sum', s.goals.length === 2 && s.goals.every((g) => g.sip > 0) && Math.abs(s.goalSip - s.goals[0].sip - s.goals[1].sip) < 0.01);
  ok('emergency fund in months of take-home', Math.abs(s.emergency.monthsCovered - 900000 / s.takeHome.monthly) < 0.01);
  ok('assumptions sentence names regime, mix and home rate', /regime/.test(s.assumptions) && /60% equity/.test(s.assumptions) && /20 years/.test(s.assumptions));
  const safer = snapshot(p, { rates, mix, loanPolicy, equityPct: 0, years: 10 });
  ok('a lower equity share lowers the ten-year figure and the goal SIPs rise', safer.invest.fv < s.invest.fv && safer.goalSip > s.goalSip);
}

// business and both
{
  const p = normaliseProfile({ person: { employment: 'self_employed' }, business: { receipts: 3000000, kind: 'profession', presumptive: true, tds: 240000 }, location: { city: 'Pune', rentPaid: 300000, housing: 'rent' } });
  const s = snapshot(p, { rates, mix, loanPolicy, equityPct: 60, years: 10 });
  ok('business: snapshot exists without a salary', s && s.kind === 'business' && s.ctc === 0 && s.business.receipts === 3000000);
  near('business: presumptive income is half of receipts', s.business.income, 1500000);
  ok('business: TDS and refund flow to the tax line', s.tax.tds === 240000 && s.tax.refund > 0 && s.tax.netPayable === 0);
  near('business: left after tax = income less tax, per month', s.takeHome.monthly, (1500000 - s.tax.annual) / 12, 1);
  ok('business: home budget builds on what is left after tax', s.home.kind === 'budget' && Math.abs(s.home.emi - 0.5 * s.takeHome.monthly) < 1);
  const both = normaliseProfile({ ...fromSalaryStore(emptyProfile(), seedFromCtc(emptyProfile(), 1800000, rates).store, seedFromCtc(emptyProfile(), 1800000, rates).breakdown), person: { employment: 'both' }, business: { receipts: 1200000, kind: 'profession', presumptive: true } });
  const b = snapshot(both, { rates, mix, loanPolicy, equityPct: 60, years: 10 });
  ok('both: salary and receipts in one picture, tax on the combined income', b.kind === 'both' && b.ctc === 1800000 && b.business.income === 600000 && b.tax.annual > snapshot(fromSalaryStore(emptyProfile(), seedFromCtc(emptyProfile(), 1800000, rates).store, seedFromCtc(emptyProfile(), 1800000, rates).breakdown), { rates, mix, loanPolicy }).tax.annual);
  ok('salary-only profile with business receipts but employment salaried ignores the receipts', snapshot({ ...both, person: { ...both.person, employment: 'salaried' } }, { rates, mix, loanPolicy }).kind === 'salary');
}

console.log(failures ? `\n${failures} failure(s)` : '\nAll snapshot tests passed');
process.exit(failures ? 1 : 0);
