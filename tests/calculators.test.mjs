// Calculator formulas (worked examples from data/formulas.json), the loan simulator, and fund matching.
// Run: node tests/calculators.test.mjs

import { emi, simulateLoan, lumpsumFV, sipFV, requiredSip } from '../public/js/calculators.js';
import { summariseCategories, matchNear, matchExceeds, fundsFor, metricOf } from '../public/js/funds.js';

let failures = 0;
const near = (name, actual, expected, tol = 1) => { const ok = Math.abs(actual - expected) <= tol; console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}: got ${Math.round(actual)}, expected ${expected}`); if (!ok) failures++; };
const ok = (name, cond, detail = '') => { console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${detail ? ' (' + detail + ')' : ''}`); if (!cond) failures++; };

// Worked examples from formulas.json
near('EMI 50L @ 8.5% 20y', emi(5000000, 8.5, 20).emi, 43391);
near('EMI total interest', emi(5000000, 8.5, 20).interest, 5413840, 500);
near('Lumpsum 10L @ 12% 10y', lumpsumFV(1000000, 12, 10).fv, 3105848);
near('SIP 10k @ 12% 10y (annuity due)', sipFV(10000, 12, 10).fv, 2323391);
// formulas.json labels this figure "approx"; our exact month-by-month result is 33,74,326. Accept within 1.5%.
near('Step-up SIP 10k +10% @ 12% 10y', sipFV(10000, 12, 10, 10).fv, 3352000, 50000);
near('Step-up SIP invested', sipFV(10000, 12, 10, 10).invested, 1912000, 500);
near('Required SIP inverts SIP FV', requiredSip(2323391, 12, 10), 10000, 1);
{
  const amt = sipFV(10000, 12, 10, 0, 1000);
  near('amount step-up SIP invested: 10k rising by 1k a year', amt.invested, 12 * (10000 * 10 + 1000 * 45), 1);
  ok('amount step-up grows the corpus', amt.fv > sipFV(10000, 12, 10).fv);
  near('amount step-up final monthly', amt.finalMonthly, 20000, 0.01);
}

// Loan simulator
{
  const base = simulateLoan({ principal: 5000000, annualRatePct: 8.5, tenureMonths: 240 });
  ok('baseline closes at 240 months', base.months === 240, String(base.months));
  near('baseline interest matches closed form', base.totalInterest, 5413840, 500);
  ok('baseline has 20 yearly rows', base.years.length === 20);
  near('baseline final balance is zero', base.years[19].balance, 0, 1);

  const step = simulateLoan({ principal: 5000000, annualRatePct: 8.5, tenureMonths: 240, stepUpPct: 10 });
  ok('10% step-up shortens tenure a lot', step.months < 130, String(step.months));
  ok('step-up saves interest', step.totalInterest < base.totalInterest - 2000000, String(Math.round(base.totalInterest - step.totalInterest)));
  ok('step-up raises the EMI', step.maxEmi > base.emi * 2);

  const lump = simulateLoan({ principal: 5000000, annualRatePct: 8.5, tenureMonths: 240, lumpsum: { amount: 500000, atMonth: 12 } });
  ok('lumpsum prepayment shortens tenure', lump.months < 240 && lump.months > 150, String(lump.months));
  ok('lumpsum prepayment saves interest', lump.totalInterest < base.totalInterest, String(Math.round(base.totalInterest - lump.totalInterest)));
  near('prepaid total recorded', lump.totalPrepaid, 500000, 1);
  ok('prepayment appears in year 1 row', Math.abs(lump.years[0].prepaid - 500000) < 1);

  const lumpEmi = simulateLoan({ principal: 5000000, annualRatePct: 8.5, tenureMonths: 240, lumpsum: { amount: 500000, atMonth: 12 }, mode: 'reduce_emi' });
  ok('reduce-EMI mode keeps the tenure', lumpEmi.months === 240, String(lumpEmi.months));
  ok('reduce-EMI mode lowers the EMI', lumpEmi.finalEmi < base.emi - 3000, String(Math.round(lumpEmi.finalEmi)));
  ok('reduce tenure saves more interest than reduce EMI', lump.totalInterest < lumpEmi.totalInterest);

  const annual = simulateLoan({ principal: 5000000, annualRatePct: 8.5, tenureMonths: 240, annualPrepay: 100000, annualPrepayStartYear: 2 });
  ok('annual prepayment skips year 1', annual.years[0].prepaid === 0 && annual.years[1].prepaid > 0);
  ok('annual prepayment shortens tenure', annual.months < 240);

  const stepAmt = simulateLoan({ principal: 5000000, annualRatePct: 8.5, tenureMonths: 240, stepUpAmount: 5000 });
  ok('fixed-amount step-up shortens tenure', stepAmt.months < 240 && stepAmt.months > 100, String(stepAmt.months));
  near('fixed-amount step-up: year-2 EMI is base + 5000', stepAmt.years[1].emi, stepAmt.emi + 5000, 1);
  const both = simulateLoan({ principal: 5000000, annualRatePct: 8.5, tenureMonths: 240, stepUpPct: 10, stepUpAmount: 5000 });
  near('percentage step-up is used and amount ignored when both passed', both.years[1].emi, both.emi * 1.1, 1);

  const zero = simulateLoan({ principal: 1200000, annualRatePct: 0, tenureMonths: 12 });
  near('zero-rate loan: EMI is P/n', zero.emi, 100000, 0.01);
  ok('zero-rate loan closes on time', zero.months === 12);
}

// Fund matching on a synthetic dataset
{
  const mk = (category, group, r5, r3) => ({ code: Math.random(), name: category + ' fund', house: 'X', category, group, since: '2013-01-01', asOf: '2026-09-12', cagr1: null, cagr3: r3, cagr5: r5, cagr10: null, r3: [r3, r3 - 10, r3 + 10], r5: [r5, r5 - 6, r5 + 6] });
  const data = { _meta: { nav_as_of: '2026-09-12', fund_count: 12 }, funds: [
    mk('Liquid', 'Debt', 6.2, 6.5), mk('Liquid', 'Debt', 6.0, 6.4), mk('Liquid', 'Debt', 6.1, 6.6),
    mk('Balanced Advantage', 'Hybrid', 10.5, 11), mk('Balanced Advantage', 'Hybrid', 10.9, 11.5), mk('Balanced Advantage', 'Hybrid', 11.2, 12),
    mk('Flexi Cap', 'Equity', 14, 16), mk('Flexi Cap', 'Equity', 15, 17), mk('Flexi Cap', 'Equity', 13.5, 15),
    mk('Small Cap', 'Equity', 19, 24), mk('Small Cap', 'Equity', 21, 26), mk('Small Cap', 'Equity', 20, 25),
    mk('Solo', 'Equity', 30, 30), // fewer than 3 funds -> excluded
  ] };
  const cats5 = summariseCategories(data, 10);
  ok('categories with <3 funds are excluded', !cats5.find((c) => c.category === 'Solo'));
  ok('uses 5y rolling median for long horizons', cats5.find((c) => c.category === 'Flexi Cap').typical === 14);
  const cats3 = summariseCategories(data, 3);
  ok('uses 3y rolling median for short horizons', cats3.find((c) => c.category === 'Flexi Cap').typical === 16);

  const m12 = matchNear(cats5, 12);
  ok('12% target matches Balanced Advantage and Flexi Cap', m12.matches.slice(0, 2).map((c) => c.category).sort().join() === 'Balanced Advantage,Flexi Cap', m12.matches.map((c) => c.category).join());
  ok('12% target has no expectation warning', m12.note === null);
  const m30 = matchNear(cats5, 30);
  ok('30% target raises the too-high note', m30.note && m30.note.kind === 'high' && m30.note.best.category === 'Small Cap');
  const m2 = matchNear(cats5, 2);
  ok('2% target raises the conservative note', m2.note && m2.note.kind === 'low');

  const ex = matchExceeds(cats5, 8.5);
  ok('exceeds 8.5% excludes Liquid', !ex.find((c) => c.category === 'Liquid'));
  ok('exceeds is ordered lowest risk first', ex[0].category === 'Balanced Advantage', ex.map((c) => c.category).join());

  const ff = fundsFor(data, 'Flexi Cap', 10, 13.6, 'near');
  ok('fundsFor orders by closeness', ff[0].metric === 13.5 && ff[1].metric === 14);
  ok('metricOf falls back to 3y when 5y missing', metricOf({ r3: [9, 1, 20] }, 10) === 9);
}

console.log(failures === 0 ? '\nAll calculator tests passed.' : `\n${failures} test(s) FAILED.`);
process.exit(failures === 0 ? 0 : 1);
