/**
 * Two job offers side by side: what each actually puts in the bank, month by month and in its first
 * two years, after PF, professional tax and income tax under whichever regime is cheaper. Pure (no DOM).
 *
 * The traps it exists for: a headline CTC that counts variable pay at 100% when it rarely pays that,
 * a joining bonus that is taxed at the top of the slab and paid back if you leave early, employer PF
 * and gratuity that sit inside the CTC but never reach the bank, and stock that is taxed as salary
 * when it vests but is only worth what the shares fetch.
 *
 *   offerYear(o, rates, { year }) -> { monthly, cash, tax, regime, stockNet, retirement, ... } | { error }
 *   compareOffers(a, b, rates)    -> { a: [y1, y2], b: [y1, y2], diff: { monthly, y1, y2, twoYears, withStock, retirement } }
 *
 * o: { ctc (headline, as on the offer letter), variablePct (target, % of CTC), variableOnTop (paid over
 *      and above the CTC rather than inside it), payoutPct (what you expect to be paid, % of target),
 *      joiningBonus + bonusKind ('joining' | 'retention'; paid once, in year 1), relocation (once, year 1)
 *      + relocationBills (reimbursed against bills, so not taxed), stockPerYear (ESOP/RSU value vesting
 *      each year), basicPct (of CTC), pfInCtc, city ('metro'|'other'), rentMonthly, professionalTax,
 *      hikePct (expected raise for year 2, on fixed pay) }
 */
import { salaryBreakdown } from './salary-split.js';
import { compareRegimes } from '../js/tax-engine.js';

export const OFFER_DEFAULTS = {
  ctc: '', variablePct: 0, variableOnTop: false, payoutPct: 100, joiningBonus: 0, bonusKind: 'joining',
  relocation: 0, relocationBills: false, stockPerYear: 0, basicPct: 40, pfInCtc: true, city: 'metro', rentMonthly: 0,
  professionalTax: 2400, hikePct: 0,
};

const num = (v, d = 0) => (v === '' || v == null || !isFinite(+v) ? d : +v);

export function offerYear(raw, rates, { year = 1 } = {}) {
  const o = { ...OFFER_DEFAULTS, ...raw };
  const ctc = num(o.ctc);
  if (!(ctc > 0)) return { error: 'Enter the CTC on the offer letter.' };
  const onTop = o.variableOnTop === true;
  const variablePct = Math.min(onTop ? 100 : 60, Math.max(0, num(o.variablePct)));
  const payoutPct = Math.min(200, Math.max(0, num(o.payoutPct, 100)));
  const target = ctc * variablePct / 100;
  // year 2: the fixed part rises by the expected hike; the variable target stays as offered
  const grow = year === 2 ? 1 + Math.max(0, num(o.hikePct)) / 100 : 1;
  const fixedBase = onTop ? ctc : ctc - target;
  const fixedCtc = fixedBase * grow;
  const expected = target * payoutPct / 100;
  const bonus = year === 1 ? Math.max(0, num(o.joiningBonus)) : 0;
  const relocation = year === 1 ? Math.max(0, num(o.relocation)) : 0;
  const relocationTaxable = o.relocationBills ? 0 : relocation;
  const stock = Math.max(0, num(o.stockPerYear));
  // Basic is quoted as a share of the CTC; keep the same rupee Basic when the variable part is set aside
  const basicPctOfFixed = fixedBase > 0 ? num(o.basicPct, 40) * ctc / fixedBase : 0;
  const metro = o.city === 'metro';
  const b = salaryBreakdown({
    ctc: fixedCtc, basicPct: basicPctOfFixed, hraPct: metro ? 50 : 40, includeEmployerPf: o.pfInCtc !== false, includeGratuity: true,
    professionalTax: num(o.professionalTax, 2400), city: metro ? 'Mumbai' : 'Other', rentPaid: num(o.rentMonthly) * 12, regime: 'best',
  }, rates);
  if (b.error) return { error: `Basic at ${num(o.basicPct, 40)}% leaves no room for the rest of the CTC. Lower it.` };

  // everything taxable on top of the fixed salary: variable pay, the bonus, taxable relocation, vested stock
  const taxWith = (extra) => compareRegimes({ ...b.inputs, salary: { ...b.inputs.salary, gross: b.inputs.salary.gross + extra } }, rates);
  const cashExtra = expected + bonus + relocationTaxable;
  const all = taxWith(cashExtra + stock);
  const regime = all.better === 'old' ? 'old' : 'new';
  const taxAll = all[regime].tax.total;
  const tax = stock > 0 ? taxWith(cashExtra)[regime].tax.total : taxAll;     // the tax on what is paid in cash
  const stockTax = taxAll - tax;                                              // what vesting adds to the year's tax
  const bonusTax = bonus > 0 ? tax - taxWith(cashExtra - bonus)[regime].tax.total : 0;

  const gross = b.grossSalary + expected + bonus + relocation;
  const cash = gross - b.employeePf - b.professionalTax - tax;
  // the month's pay carries its share of the tax on the taxable pay; the lump sums carry theirs
  const taxable = b.grossSalary + cashExtra;
  const fixedShareOfTax = taxable > 0 ? tax * b.grossSalary / taxable : 0;
  const monthly = (b.grossSalary - b.employeePf - b.professionalTax - fixedShareOfTax) / 12;
  const employerPfOutside = o.pfInCtc === false ? 0.12 * b.basic : 0;
  return {
    year, ctc, fixedCtc, target, expected, variableOnTop: onTop, variableShortfall: target - expected,
    bonus, bonusKind: o.bonusKind === 'retention' ? 'retention' : 'joining', bonusTax,
    joining: bonus, joiningTax: bonusTax,                                      // older names, kept for callers
    relocation, relocationTaxable, stock, stockTax, stockNet: stock - stockTax,
    basic: b.basic, grossSalary: b.grossSalary, gross, employeePf: b.employeePf, professionalTax: b.professionalTax,
    tax, taxAll, regime, otherRegimeTax: all[regime === 'old' ? 'new' : 'old'].tax.total,
    monthly, cash, cashWithStock: cash + stock - stockTax,
    // saved for you rather than paid to you: both sides of PF, and gratuity (yours only after 5 years)
    pf: b.employeePf + b.employerPf + employerPfOutside, gratuity: b.gratuity,
    retirement: b.employeePf + b.employerPf + employerPfOutside + b.gratuity,
    employerPfOutside,
    // the package as you would add it up: the CTC plus whatever is paid on top of it
    totalPackage: ctc + (onTop ? target : 0) + employerPfOutside,
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
      withStock: d((x) => x[0].cashWithStock + x[1].cashWithStock),
      retirement: d((x) => x[0].retirement + x[1].retirement),
      headline: num(b.ctc) - num(a.ctc),
    },
    hasStock: A[0].stock > 0 || B[0].stock > 0,
  };
}
