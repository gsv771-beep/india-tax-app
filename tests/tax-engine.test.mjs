// Regression tests from docs/calculation_engine_spec.md section 3.
// Run: npm test   (or: node tests/tax-engine.test.mjs)

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { computeRegime, compareRegimes, AGE_BANDS } from '../public/js/tax-engine.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const rates = JSON.parse(readFileSync(path.join(here, '../public/data/tax_rates.json'), 'utf8'));

let failures = 0;
function check(name, actual, expected) {
  const ok = Math.abs(actual - expected) < 0.5;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}: got ${actual}, expected ${expected}`);
  if (!ok) failures++;
}
function checkTrue(name, cond, detail = '') {
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${detail ? ' (' + detail + ')' : ''}`);
  if (!cond) failures++;
}

// T1: salary 12L, no deductions, new regime -> 0
{
  const r = computeRegime({ salary: { gross: 1200000 } }, 'new', rates);
  check('T1 slab income after std deduction', r.tax.slabIncome, 1125000);
  check('T1 slab tax', r.tax.slabTax, 52500);
  check('T1 total tax', r.tax.total, 0);
}

// T2: total income exactly 12L, new regime -> 0
{
  const r = computeRegime({ otherIncome: { other: 1200000 } }, 'new', rates);
  check('T2 slab tax', r.tax.slabTax, 60000);
  check('T2 rebate', r.tax.rebate, 60000);
  check('T2 total tax', r.tax.total, 0);
}

// T3: total income 12.5L, new regime -> 52,000 after marginal relief and cess
{
  const r = computeRegime({ otherIncome: { other: 1250000 } }, 'new', rates);
  check('T3 slab tax', r.tax.slabTax, 67500);
  check('T3 payable before cess', r.tax.taxPlusSurcharge, 50000);
  check('T3 total tax', r.tax.total, 52000);
}

// T4: total income 12.75L, new regime -> 74,100
{
  const r = computeRegime({ otherIncome: { other: 1275000 } }, 'new', rates);
  check('T4 relief no longer binds', r.tax.rebateRelief, 0);
  check('T4 total tax', r.tax.total, 74100);
}

// T5: 10L slab income + 1L STCG, new regime -> STCG tax survives the rebate
{
  const r = computeRegime({ otherIncome: { other: 1000000 }, capitalGains: { stcgEquity: 100000 } }, 'new', rates);
  check('T5 total income', r.tax.totalIncome, 1100000);
  check('T5 slab tax rebated', r.tax.slabTaxAfterRebate, 0);
  check('T5 STCG tax not rebated', r.tax.specialTax, 20000);
  check('T5 total tax', r.tax.total, 20800);
}

// T6: old regime, 51L -> tax + surcharge after relief = 14,12,500
{
  const r = computeRegime({ otherIncome: { other: 5100000 } }, 'old', rates);
  check('T6 slab tax', r.tax.slabTax, 1342500);
  check('T6 surcharge before relief', r.tax.surcharge, 134250);
  check('T6 marginal relief', r.tax.surchargeRelief, 64250);
  check('T6 tax + surcharge after relief', r.tax.taxPlusSurcharge, 1412500);
  check('T6 total with cess', r.tax.total, 1469000);
}

// T7: 82-year-old, 5L, old vs new -> both zero, by different paths
{
  const inputs = { ageBand: AGE_BANDS.super_senior, otherIncome: { other: 500000 } };
  const o = computeRegime(inputs, 'old', rates);
  const n = computeRegime(inputs, 'new', rates);
  check('T7 old slab tax (Rs 5L exemption)', o.tax.slabTax, 0);
  check('T7 old total', o.tax.total, 0);
  check('T7 new slab tax before rebate', n.tax.slabTax, 5000);
  check('T7 new rebate', n.tax.rebate, 5000);
  check('T7 new total', n.tax.total, 0);
}

// T8: private employee, Basic+DA 20L, employer NPS 2.8L -> 2L old, 2.8L new
{
  const inputs = { salary: { gross: 3000000, basicDa: 2000000 }, employer: { npsContribution: 280000, isGovernment: false } };
  const o = computeRegime(inputs, 'old', rates);
  const n = computeRegime(inputs, 'new', rates);
  const find = (r) => (r.income.via.find((v) => v.id === '80ccd2') || { amount: 0 }).amount;
  check('T8 old regime 80CCD(2) capped at 10%', find(o), 200000);
  check('T8 new regime 80CCD(2) at 14%', find(n), 280000);
}

// T9: let-out property loss clamp
{
  const inputs = { salary: { gross: 2000000 }, houseProperty: { letOut: { rent: 300000, interest: 800000 } } };
  const o = computeRegime(inputs, 'old', rates);
  const n = computeRegime(inputs, 'new', rates);
  check('T9 old set-off against salary capped at 2L', o.income.hpLossSetOff, 200000);
  check('T9 old carried forward', o.income.hpLossCarried, 390000);
  check('T9 new set-off is zero', n.income.hpLossSetOff, 0);
  check('T9 new loss extinguished', n.income.hpLossExtinguished, 590000);
  check('T9 new HP income clamped to zero', n.income.lines.find((l) => l.id === 'hp_income').amount, 0);
}

// T10: NRI, 11L, new regime -> no rebate
{
  const r = computeRegime({ resident: false, otherIncome: { other: 1100000 } }, 'new', rates);
  check('T10 rebate', r.tax.rebate, 0);
  check('T10 total tax', r.tax.total, 52000);
}

// Extra: HRA formula (old regime, metro), 4-city list by default
{
  const inputs = { salary: { gross: 1200000, basicDa: 600000, hraReceived: 240000, rentPaid: 300000, city: 'Mumbai' } };
  const o = computeRegime(inputs, 'old', rates);
  // least of 2,40,000 / 50% of 6L = 3,00,000 / 3,00,000 - 60,000 = 2,40,000
  check('HRA exemption (metro)', -o.income.lines.find((l) => l.id === 'hra').amount, 240000);
  const b = computeRegime({ ...inputs, salary: { ...inputs.salary, city: 'Bengaluru' } }, 'old', rates);
  // Bengaluru is non-metro unless the 8-city flag is on: 40% of 6L = 2,40,000 -> still 2,40,000 here
  check('HRA exemption (Bengaluru, flag off)', -b.income.lines.find((l) => l.id === 'hra').amount, 240000);
  const n = computeRegime(inputs, 'new', rates);
  check('HRA not available in new regime', n.income.lines.find((l) => l.id === 'hra').amount, 0);
}

// Extra: employee EPF counted in 80C automatically from Basic + DA
{
  const via80c = (r) => (r.income.via.find((v) => v.id === '80c') || { amount: 0 }).amount;
  const auto = computeRegime({ salary: { gross: 1500000, basicDa: 600000 } }, 'old', rates);
  check('EPF auto: 12% of 6L Basic+DA = 72,000 in 80C', via80c(auto), 72000);
  check('EPF auto is reported on the income object', auto.income.epfEmployee, 72000);
  const plusOther = computeRegime({ salary: { gross: 1500000, basicDa: 600000 }, deductions: { s80c: 100000 } }, 'old', rates);
  check('EPF + other 80C capped at 1.5L', via80c(plusOther), 150000);
  const override = computeRegime({ salary: { gross: 1500000, basicDa: 600000 }, deductions: { epfEmployee: 21600 } }, 'old', rates);
  check('typed EPF amount overrides the 12% estimate', via80c(override), 21600);
  const off = computeRegime({ salary: { gross: 1500000, basicDa: 600000 }, deductions: { includeEpf: false } }, 'old', rates);
  check('EPF switched off: no 80C', via80c(off), 0);
  const noSalary = computeRegime({ otherIncome: { other: 1500000 }, salary: { basicDa: 600000 } }, 'old', rates);
  check('no salary income: no EPF assumed', via80c(noSalary), 0);
  const newRegime = computeRegime({ salary: { gross: 1500000, basicDa: 600000 } }, 'new', rates);
  check('new regime: EPF does not create an 80C deduction', via80c(newRegime), 0);
}

// Extra: slab breakdown, HRA working, marginal relief working
{
  const r = computeRegime({ otherIncome: { other: 1250000 } }, 'new', rates);
  const sum = r.tax.slabRows.reduce((s, x) => s + x.tax, 0);
  check('slab rows sum to slab tax', sum, r.tax.slabTax);
  check('slab rows cover the whole slab income', r.tax.slabRows.reduce((s, x) => s + x.amount, 0), r.tax.slabIncome);
  checkTrue('slab rows: first band is nil-rate up to 4L', r.tax.slabRows[0].to === 400000 && r.tax.slabRows[0].rate === 0);
  checkTrue('rebate rule exposed for the new regime', r.tax.rebateRule.threshold === 1200000 && r.tax.rebateRule.marginalReliefAvailable === true);
  check('T3 relief is reported through rebateRelief', r.tax.rebateRelief, 17500);

  const old = computeRegime({ otherIncome: { other: 520000 } }, 'old', rates);
  checkTrue('old regime rebate rule: no marginal relief by default', old.tax.rebateRule.marginalReliefAvailable === false && old.tax.rebate === 0 && old.tax.rebateRelief === 0);

  const s = computeRegime({ otherIncome: { other: 5100000 } }, 'old', rates);
  const w = s.tax.surchargeReliefWorking;
  checkTrue('surcharge relief working present', !!w && w.threshold === 5000000 && w.excessIncome === 100000);
  check('surcharge working: relief matches T6', w.relief, 64250);
  check('surcharge working: tax at threshold', w.taxAtThreshold, 1312500);
  const s2 = computeRegime({ otherIncome: { other: 6000000 } }, 'old', rates);
  checkTrue('no surcharge relief well above the threshold, but working still reported', s2.tax.surchargeReliefWorking && s2.tax.surchargeReliefWorking.relief === 0 && s2.tax.surchargeRelief === 0);

  const h = computeRegime({ salary: { gross: 1200000, basicDa: 600000, hraReceived: 240000, rentPaid: 300000, city: 'Mumbai' } }, 'old', rates);
  const hw = h.income.hraWorking;
  checkTrue('HRA working has three limbs', hw && hw.limbs.length === 3);
  check('HRA limb (a) received', hw.limbs[0].value, 240000);
  check('HRA limb (b) 50% of Basic+DA in a metro', hw.limbs[1].value, 300000);
  check('HRA limb (c) rent minus 10% of Basic+DA', hw.limbs[2].value, 240000);
  check('HRA exempt equals the least limb', hw.exempt, 240000);
  checkTrue('HRA working flags metro and applies in old regime', hw.metro === true && hw.appliesInRegime === true);
  const hn = computeRegime({ salary: { gross: 1200000, basicDa: 600000, hraReceived: 240000, rentPaid: 300000, city: 'Mumbai' } }, 'new', rates);
  checkTrue('new regime: HRA working reported but not applied', hn.income.hraWorking && hn.income.hraWorking.appliesInRegime === false && hn.income.lines.find((l) => l.id === 'hra').amount === 0);
  const hm = computeRegime({ salary: { gross: 1200000, basicDa: 600000, hraReceived: 240000 } }, 'old', rates);
  checkTrue('HRA without rent: working says rent is missing and exempt is 0', hm.income.hraWorking.missing === 'rent' && hm.income.hraWorking.exempt === 0);
  const hlow = computeRegime({ salary: { gross: 1200000, basicDa: 600000, hraReceived: 240000, rentPaid: 50000, city: 'Pune' } }, 'old', rates);
  checkTrue('rent below 10% of Basic+DA gives nil exemption, not negative', hlow.income.hraWorking.exempt === 0 && hlow.income.hraWorking.least === -10000);
}

// Extra: compareRegimes picks a winner and reports the saving
{
  const c = compareRegimes({ salary: { gross: 1500000 } }, rates);
  checkTrue('compare: new regime wins for 15L salary with no deductions', c.better === 'new', `old ${c.old.tax.total}, new ${c.new.tax.total}`);
}

console.log(failures === 0 ? '\nAll tests passed.' : `\n${failures} test(s) FAILED.`);
process.exit(failures === 0 ? 0 : 1);
