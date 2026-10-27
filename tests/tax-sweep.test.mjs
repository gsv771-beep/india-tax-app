// An independent check of the tax engine. Run: node tests/tax-sweep.test.mjs
// The slabs, rebates, surcharges and cess below are typed in from the Finance Act, not read from
// public/data/tax_rates.json, so a wrong edit to the rates file (or to the engine) shows up here.
// Salary only, resident, under 60, no deductions beyond the standard deduction; FY 2025-26 and
// FY 2026-27 (the rates are the same in both years, so both must give the same answer).
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { compareRegimes, mergeInputs } from '../public/js/tax-engine.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const rates = JSON.parse(readFileSync(path.join(here, '../public/data/tax_rates.json'), 'utf8'));
let failures = 0;
const ok = (name, cond, detail = '') => { if (!cond) { console.log(`FAIL  ${name}${detail ? ' (' + detail + ')' : ''}`); failures++; } };

const L = 100000, CR = 10000000;
const NEW = { sd: 75000, bands: [[4 * L, 0], [8 * L, .05], [12 * L, .10], [16 * L, .15], [20 * L, .20], [24 * L, .25], [Infinity, .30]], rebateUpTo: 12 * L, marginalRebate: true, surcharge: [[50 * L, .10], [CR, .15], [2 * CR, .25]] };
const OLD = { sd: 50000, bands: [[2.5 * L, 0], [5 * L, .05], [10 * L, .20], [Infinity, .30]], rebateUpTo: 5 * L, marginalRebate: false, surcharge: [[50 * L, .10], [CR, .15], [2 * CR, .25], [5 * CR, .37]] };

const slab = (income, bands) => { let tax = 0, lo = 0; for (const [hi, r] of bands) { if (income > lo) tax += (Math.min(income, hi) - lo) * r; lo = hi; } return tax; };
function expected(gross, R) {
  const taxable = Math.max(0, gross - R.sd);
  let tax = slab(taxable, R.bands);
  if (taxable <= R.rebateUpTo) tax = 0;
  else if (R.marginalRebate) tax = Math.min(tax, taxable - R.rebateUpTo);   // the new regime's relief just above ₹12 lakh
  // surcharge, with marginal relief: crossing a threshold never costs more than the income above it
  let s = 0, at = 0;
  for (const [t, r] of R.surcharge) if (taxable > t) { s = r; at = t; }
  let withS = tax * (1 + s);
  if (s > 0) {
    const prev = R.surcharge.filter(([t]) => t < at).at(-1);
    const atThreshold = slab(at, R.bands) * (1 + (prev ? prev[1] : 0));
    withS = Math.min(withS, atThreshold + (taxable - at));
  }
  return withS * 1.04;   // health and education cess
}

const incomes = [];
for (let g = 3 * L; g <= 30 * L; g += 25000) incomes.push(g);                  // every ₹25,000 to ₹30 lakh
for (let g = 30 * L; g <= 3 * CR; g += 5 * L) incomes.push(g);                 // every ₹5 lakh to ₹3 crore
incomes.push(12.75 * L, 12.76 * L, 12.8 * L, 13 * L, 5.5 * L, 5.51 * L, 50.75 * L, 51 * L, 52 * L, 1.0075 * CR, 1.01 * CR, 2.0075 * CR, 2.05 * CR, 5 * CR, 5.0075 * CR, 5.1 * CR, 10 * CR);

let checked = 0, worst = 0;
for (const fy of ['FY2025-26', 'FY2026-27']) {
  for (const gross of incomes) {
    const inp = mergeInputs({ fy, ageBand: 'below_60', resident: true, salary: { gross, professionalTax: 0 }, deductions: { includeEpf: false } });
    const r = compareRegimes(inp, rates);
    for (const [name, R] of [['new', NEW], ['old', OLD]]) {
      const want = expected(gross, R), got = r[name].tax.total;
      const diff = Math.abs(got - want);
      worst = Math.max(worst, diff);
      checked++;
      // the engine rounds income and tax to the nearest ₹10 (sections 288A, 288B): allow that, nothing more
      ok(`${fy} ${name} regime, gross ₹${gross.toLocaleString('en-IN')}`, diff <= 15, `engine ${Math.round(got)}, expected ${Math.round(want)}`);
    }
  }
}
// the two years carry the same rates, so the same salary is taxed the same
for (const gross of [6 * L, 12.75 * L, 25 * L, 1.5 * CR]) {
  const t = (fy) => compareRegimes(mergeInputs({ fy, salary: { gross, professionalTax: 0 }, deductions: { includeEpf: false } }), rates);
  ok(`₹${gross / L} lakh: FY 2025-26 and FY 2026-27 agree`, t('FY2025-26').new.tax.total === t('FY2026-27').new.tax.total && t('FY2025-26').old.tax.total === t('FY2026-27').old.tax.total);
}
console.log(`${checked} cases checked against an independent slab calculation; largest gap ₹${Math.round(worst)}.`);
console.log(failures ? `\n${failures} failure(s)` : '\nAll tax sweep tests passed');
process.exit(failures ? 1 : 0);
