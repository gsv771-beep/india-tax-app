/**
 * Two job offers side by side: what each actually puts in the bank, month by month and in its first
 * two years, after PF, professional tax and income tax under whichever regime is cheaper. Pure (no DOM).
 *
 * The traps it exists for: a headline CTC that counts variable pay at 100% when it rarely pays that,
 * a joining bonus that is taxed at the top of the slab and paid back if you leave early, and employer
 * PF and gratuity that sit inside the CTC but never reach the bank.
 *
 *   offerYear(o, rates, { year }) -> { monthly, cash, tax, regime, retirement, ... } | { error }
 *   compareOffers(a, b, rates)    -> { a: [y1, y2], b: [y1, y2], diff: { monthly, y1, y2, twoYears, retirement } }
 *
 * o: { ctc (headline, as on the offer letter), variablePct (of CTC, the target), payoutPct (what you
 *      expect actually to be paid, % of the target), joiningBonus (paid once, in year 1),
 *      basicPct (of CTC), pfInCtc (employer PF inside the CTC, the usual case), city ('metro'|'other'),
 *      rentMonthly, professionalTax, hikePct (expected raise for year 2, on fixed pay) }
 */
import { salaryBreakdown } from './salary-split.js';
import { compareRegimes } from '../js/tax-engine.js';

export const OFFER_DEFAULTS = { ctc: '', variablePct: 0, payoutPct: 100, joiningBonus: 0, basicPct: 40, pfInCtc: true, city: 'metro', rentMonthly: 0, professionalTax: 2400, hikePct: 0 };

const num = (v, d = 0) => (v === '' || v == null || !isFinite(+v) ? d : +v);

export function offerYear(raw, rates, { year = 1 } = {}) {
  const o = { ...OFFER_DEFAULTS, ...raw };
  const ctc = num(o.ctc);
  if (!(ctc > 0)) return { error: 'Enter the CTC on the offer letter.' };
  const variablePct = Math.min(60, Math.max(0, num(o.variablePct)));
  const payoutPct = Math.min(200, Math.max(0, num(o.payoutPct, 100)));
  const target = ctc * variablePct / 100;
  // year 2: the fixed part rises by the expected hike; variable stays a share of the (old) CTC
  const grow = year === 2 ? 1 + Math.max(0, num(o.hikePct)) / 100 : 1;
  const fixedCtc = (ctc - target) * grow;
  const expected = target * payoutPct / 100;
  const joining = year === 1 ? Math.max(0, num(o.joiningBonus)) : 0;
  // Basic is quoted as a share of the CTC; keep the same rupee Basic when the variable part is set aside
  const basicPctOfFixed = ctc - target > 0 ? num(o.basicPct, 40) * ctc / (ctc - target) : 0;
  const metro = o.city === 'metro';
  const b = salaryBreakdown({
    ctc: fixedCtc, basicPct: basicPctOfFixed, hraPct: metro ? 50 : 40, includeEmployerPf: o.pfInCtc !== false, includeGratuity: true,
    professionalTax: num(o.professionalTax, 2400), city: metro ? 'Mumbai' : 'Other', rentPaid: num(o.rentMonthly) * 12, regime: 'best',
  }, rates);
  if (b.error) return { error: `Basic at ${num(o.basicPct, 40)}% leaves no room for the rest of the CTC. Lower it.` };

  // the variable pay and the joining bonus are salary like any other: tax the year's total, both regimes
  const extra = expected + joining;
  const inputs = { ...b.inputs, salary: { ...b.inputs.salary, gross: b.inputs.salary.gross + extra } };
  const cmp = compareRegimes(inputs, rates);
  const regime = cmp.better === 'old' ? 'old' : 'new';
  const tax = cmp[regime].tax.total;
  const gross = b.grossSalary + extra;
  const cash = gross - b.employeePf - b.professionalTax - tax;
  // the month's pay carries its share of the year's tax; the lump sums carry theirs
  const fixedShareOfTax = gross > 0 ? tax * b.grossSalary / gross : 0;
  const monthly = (b.grossSalary - b.employeePf - b.professionalTax - fixedShareOfTax) / 12;
  const employerPfOutside = o.pfInCtc === false ? 0.12 * b.basic : 0;
  // what the joining bonus adds to the year's tax: the extra tax with it against without it
  let joiningTax = 0;
  if (joining > 0) {
    const without = compareRegimes({ ...inputs, salary: { ...inputs.salary, gross: inputs.salary.gross - joining } }, rates);
    joiningTax = tax - Math.min(without.old.tax.total, without.new.tax.total);
  }
  return {
    year, ctc, fixedCtc, target, expected, joining, variableShortfall: target - expected,
    basic: b.basic, grossSalary: b.grossSalary, gross, employeePf: b.employeePf, professionalTax: b.professionalTax,
    tax, regime, otherRegimeTax: cmp[regime === 'old' ? 'new' : 'old'].tax.total,
    monthly, cash, lumpNet: extra - (tax - fixedShareOfTax), joiningTax,
    // saved for you rather than paid to you: both sides of PF, and gratuity (yours only after 5 years)
    pf: b.employeePf + b.employerPf + employerPfOutside, gratuity: b.gratuity,
    retirement: b.employeePf + b.employerPf + employerPfOutside + b.gratuity,
    employerPfOutside,
  };
}

export function compareOffers(a, b, rates) {
  const A = [offerYear(a, rates, { year: 1 }), offerYear(a, rates, { year: 2 })];
  const B = [offerYear(b, rates, { year: 1 }), offerYear(b, rates, { year: 2 })];
  if (A[0].error || B[0].error) return { a: A, b: B, error: A[0].error || B[0].error };
  const d = (f) => f(B) - f(A);
  return {
    a: A, b: B,
    diff: {
      monthly: d((x) => x[0].monthly),
      y1: d((x) => x[0].cash),
      y2: d((x) => x[1].cash),
      twoYears: d((x) => x[0].cash + x[1].cash),
      retirement: d((x) => x[0].retirement + x[1].retirement),
      headline: num(b.ctc) - num(a.ctc),
    },
  };
}
