/**
 * Known-answer tests: engine output against figures supplied by the product owner, not derived
 * from the engine itself. Every `TODO` below is a placeholder waiting for that figure.
 *
 *   node tests/known-answers.test.mjs           TODO cases print the engine's current value and are
 *                                               reported as pending; only filled-in cases can fail.
 *   node tests/known-answers.test.mjs --strict  pending cases count as failures (flip CI to this once
 *                                               every value is in).
 *
 * To fill a case in: replace TODO with the expected number (rupees, or the amount named in the label).
 * Cases whose engine function does not exist yet (gratuity, bootstrap) are listed as PENDING MODULE.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { computeRegime, DEFAULT_FLAGS } from '../public/js/tax-engine.js';
import { emi, amortisationByYear } from '../public/js/calculators.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const rates = JSON.parse(readFileSync(path.join(here, '../public/data/tax_rates.json'), 'utf8'));
const STRICT = process.argv.includes('--strict');

export const TODO = Symbol('TODO: expected value');
let failures = 0;
const pending = [];
const missing = [];

/** actual vs expected within tol rupees; expected may be TODO. */
function known(name, actual, expected, tol = 0.5) {
  if (expected === TODO) {
    pending.push({ name, actual });
    console.log(`TODO  ${name}: engine gives ${fmt(actual)} (expected value not yet supplied)`);
    if (STRICT) failures++;
    return;
  }
  const ok = Math.abs(actual - expected) <= tol;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}: got ${fmt(actual)}, expected ${fmt(expected)}`);
  if (!ok) failures++;
}
const fmt = (n) => (typeof n === 'number' ? (Number.isInteger(n) ? String(n) : n.toFixed(2)) : String(n));
const section = (t) => console.log(`\n== ${t} ==`);
const tax = (inputs, regime, flags = DEFAULT_FLAGS) => computeRegime(inputs, regime, rates, flags);

// ---------------------------------------------------------------------------------------------
section('A. Old vs new regime, salary only');
// Resident, below 60, FY 2026-27. Gross salary only: the standard deduction is the sole relief
// (50,000 old / 75,000 new). No Basic+DA given, so no EPF is imputed into 80C. Total tax incl. cess.
for (const gross of [800000, 1500000, 3000000, 6000000, 10000000]) {
  known(`A. old regime, gross salary ${gross}: total tax`, tax({ salary: { gross } }, 'old').tax.total, TODO);
  known(`A. new regime, gross salary ${gross}: total tax`, tax({ salary: { gross } }, 'new').tax.total, TODO);
}

// ---------------------------------------------------------------------------------------------
section('B. Section 87A / s.156 rebate cliff and marginal relief');
// Income entered as "other income" so total income equals the figure exactly (no standard deduction).
// New regime threshold 12,00,000, rebate 60,000; marginal relief band runs to 12,70,588.
for (const income of [1200000, 1200001, 1250000, 1270588, 1270589, 1275000]) {
  const r = tax({ otherIncome: { other: income } }, 'new').tax;
  known(`B. new regime, total income ${income}: tax before cess (after rebate and relief)`, r.taxPlusSurcharge, TODO);
  known(`B. new regime, total income ${income}: total tax incl. cess`, r.total, TODO);
}
// Old regime: 5,00,000 threshold, 12,500 rebate, modelled as a hard cliff (flag oldRegimeRebateMarginalRelief=false).
for (const income of [500000, 500001]) {
  known(`B. old regime, total income ${income}: total tax incl. cess`, tax({ otherIncome: { other: income } }, 'old').tax.total, TODO);
}

// ---------------------------------------------------------------------------------------------
section('C. HRA exemption, metro 50% vs non-metro 40% of Basic+DA');
// Basic+DA 6,00,000, HRA received 3,00,000, rent paid 4,20,000, gross salary 15,00,000, old regime.
// Limbs: received 3,00,000; 50%/40% of basic = 3,00,000 / 2,40,000; rent less 10% of basic = 3,60,000.
const hraInputs = (city) => ({ salary: { gross: 1500000, basicDa: 600000, hraReceived: 300000, rentPaid: 420000, city } });
known('C. HRA exempt, Mumbai (metro)', tax(hraInputs('Mumbai'), 'old').income.hraWorking.exempt, TODO);
known('C. HRA exempt, Bengaluru (non-metro under the four-city rule)', tax(hraInputs('Bengaluru'), 'old').income.hraWorking.exempt, TODO);
known('C. HRA exempt, new regime is nil', tax(hraInputs('Mumbai'), 'new').income.lines.find((l) => l.id === 'hra').amount, 0);

// ---------------------------------------------------------------------------------------------
section('D. Section 24(b) self-occupied interest at the 2,00,000 cap');
// Gross salary 15,00,000; self-occupied home loan interest as stated. The deduction line is negative.
const sop = (interest, regime) => tax({ salary: { gross: 1500000 }, houseProperty: { selfOccupiedInterest: interest } }, regime);
const sopLine = (r) => -r.income.lines.find((l) => l.id === 'hp_interest_sop').amount;
known('D. old regime, interest exactly 2,00,000: deduction taken', sopLine(sop(200000, 'old')), TODO);
known('D. old regime, interest 2,50,000: deduction capped', sopLine(sop(250000, 'old')), TODO);
known('D. old regime, interest 2,00,000: total tax', sop(200000, 'old').tax.total, TODO);
known('D. new regime, interest 2,00,000: deduction is nil', sopLine(sop(200000, 'new')), 0);
known('D. new regime, interest 2,00,000: total tax equals the no-loan case', sop(200000, 'new').tax.total, tax({ salary: { gross: 1500000 } }, 'new').tax.total);

// ---------------------------------------------------------------------------------------------
section('E. LTCG on listed equity at the 1,25,000 exemption, 12.5% above');
// Other income 20,00,000 so no basic exemption is left to set off against gains. New regime.
const ltcg = (g) => tax({ otherIncome: { other: 2000000 }, capitalGains: { ltcgEquity: g } }, 'new').tax;
known('E. LTCG 1,25,000: special-rate tax', ltcg(125000).specialTax, TODO);
known('E. LTCG 1,25,001: special-rate tax', ltcg(125001).specialTax, TODO, 0.01);
known('E. LTCG 3,25,000: special-rate tax (12.5% of 2,00,000)', ltcg(325000).specialTax, TODO);
known('E. LTCG 3,25,000: total tax incl. cess', ltcg(325000).total, TODO);

// ---------------------------------------------------------------------------------------------
section('F. Section 80CCD(2) employer NPS at 14% (new) and 10% (old, private sector)');
// Gross salary 25,00,000 incl. the employer NPS, Basic+DA 10,00,000, private employer.
const ccd2 = (contribution, regime) => {
  const r = tax({ salary: { gross: 2500000, basicDa: 1000000 }, employer: { npsContribution: contribution, isGovernment: false } }, regime);
  const line = r.income.via.find((v) => v.id === '80ccd2');
  return line ? line.amount : 0;
};
known('F. new regime, contribution exactly 14% (1,40,000): deduction', ccd2(140000, 'new'), TODO);
known('F. new regime, contribution 1,50,000: deduction capped at 14%', ccd2(150000, 'new'), TODO);
known('F. old regime, contribution exactly 10% (1,00,000): deduction', ccd2(100000, 'old'), TODO);
known('F. old regime, contribution 1,40,000: deduction capped at 10%', ccd2(140000, 'old'), TODO);

// ---------------------------------------------------------------------------------------------
section('G. EMI and amortisation against a known schedule');
// 50,00,000 at 8.5% for 20 years, monthly rests.
{
  const e = emi(5000000, 8.5, 20);
  const sched = amortisationByYear(5000000, 8.5, 20);
  known('G. EMI', e.emi, TODO, 0.01);
  known('G. total interest over the loan', e.interest, TODO, 1);
  known('G. year 1 interest', sched[0].interest, TODO, 1);
  known('G. year 1 principal repaid', sched[0].principal, TODO, 1);
  known('G. balance after year 10', sched[9].balance, TODO, 1);
  known('G. balance after year 20 is nil', sched[19].balance, 0, 1);
}

// ---------------------------------------------------------------------------------------------
section('H. Gratuity: 4-years-240-days eligibility and the 20,00,000 cap');
// Engine function lands with the salary structure work (Phase 2): gratuity({ monthlyBasicDa, years, days }).
// Expected: 15/26 x monthly Basic+DA x completed years (a part-year over 6 months counts as a full year),
// nil below 4 years 240 days, exempt up to 20,00,000 for employees covered by the Payment of Gratuity Act.
const gratuityMod = await import('../public/engine/retirement.js').catch(() => null);
if (!gratuityMod || !gratuityMod.gratuity) {
  missing.push('H. gratuity (public/engine/retirement.js)');
  console.log('PENDING MODULE  public/engine/retirement.js not built yet; 5 gratuity cases waiting');
} else {
  const g = gratuityMod.gratuity;
  known('H. 4 years 239 days, basic 50,000/month: not eligible', g({ monthlyBasicDa: 50000, years: 4, days: 239 }).amount, 0);
  known('H. 4 years 240 days, basic 50,000/month: eligible, counts as 5 years', g({ monthlyBasicDa: 50000, years: 4, days: 240 }).amount, TODO);
  known('H. 10 years 5 months, basic 50,000/month: 10 years', g({ monthlyBasicDa: 50000, years: 10, days: 150 }).amount, TODO);
  known('H. 10 years 7 months, basic 50,000/month: 11 years', g({ monthlyBasicDa: 50000, years: 10, days: 210 }).amount, TODO);
  known('H. 30 years, basic 2,00,000/month: exempt capped at 20,00,000', g({ monthlyBasicDa: 200000, years: 30, days: 0 }).exempt, TODO);
}

// ---------------------------------------------------------------------------------------------
section('I. Block bootstrap statistical properties');
// Engine function lands with the surplus allocation work (Phase 3):
// blockBootstrap(series, { horizonMonths, paths, blockMonths, seed }) -> array of paths of monthly returns.
// Property: the mean and variance of sampled monthly returns must match the source series within tolerance.
const bootMod = await import('../public/engine/bootstrap.js').catch(() => null);
if (!bootMod || !bootMod.blockBootstrap) {
  missing.push('I. block bootstrap (public/engine/bootstrap.js)');
  console.log('PENDING MODULE  public/engine/bootstrap.js not built yet; 2 statistical cases waiting');
} else {
  // A synthetic series is fine for testing the *statistical* property; the product itself must never use one.
  const series = Array.from({ length: 324 }, (_, i) => 0.01 + 0.04 * Math.sin(i / 7) + ((i * 7919) % 13) / 1000 - 0.006);
  const mean = (a) => a.reduce((s, x) => s + x, 0) / a.length;
  const variance = (a) => { const m = mean(a); return mean(a.map((x) => (x - m) ** 2)); };
  const paths = bootMod.blockBootstrap(series, { horizonMonths: 180, paths: 2000, blockMonths: 12, seed: 42 });
  const flat = paths.flat();
  known('I. sampled mean matches source mean (tolerance 5% of source std)', mean(flat), mean(series), 0.05 * Math.sqrt(variance(series)));
  known('I. sampled variance matches source variance (tolerance 10%)', variance(flat), variance(series), 0.1 * variance(series));
}

// ---------------------------------------------------------------------------------------------
console.log('\n---- summary ----');
if (pending.length) {
  console.log(`${pending.length} case(s) still carry TODO placeholders:`);
  for (const p of pending) console.log(`  - ${p.name}  [engine: ${fmt(p.actual)}]`);
}
if (missing.length) console.log(`Waiting on engine modules: ${missing.join('; ')}`);
console.log(failures === 0 ? `\nKnown-answer tests: no failures${STRICT ? '' : ' (pending cases are not failures without --strict)'}.` : `\n${failures} known-answer test(s) FAILED.`);
process.exit(failures === 0 ? 0 : 1);
