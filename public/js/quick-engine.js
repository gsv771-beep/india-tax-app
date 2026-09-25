/**
 * The one-number answer: a CTC in, the monthly in-hand pay and old-vs-new regime out, plus how far the
 * old regime is from winning and what the deductions a person actually has do to that.
 *
 *   quickAnswer({ ctc, basicPct, city, rentMonthly, homeLoanInterest, other80c, healthSelf, nps1b }, rates)
 *   ladder(rates)  -> the same answer at common CTCs, for the table shown before anything is typed
 *
 * The salary split is the in-hand calculator's own (salary.js), with its defaults (Basic 40% of CTC, HRA
 * 50% of Basic, employer PF and gratuity inside the CTC, ₹2,400 professional tax), so following a link
 * from here to that calculator shows the same figure. Pure; no DOM.
 */
import { salaryBreakdown } from '../engine/salary-split.js';
import { compareRegimes, mergeInputs } from './tax-engine.js';
import { breakEven } from './tax-insights.js';

export const QUICK_DEFAULTS = { basicPct: 40, hraPct: 50, professionalTax: 2400, city: 'Other' };
export const LADDER_CTCS = [600000, 800000, 1000000, 1200000, 1500000, 1800000, 2000000, 2500000, 3000000, 4000000, 5000000];
export const LIMIT_80C = 150000;

const num = (v) => (Number.isFinite(+v) && +v > 0 ? +v : 0);

/**
 * Old-regime deductions as the tax engine actually allowed them, caps applied (80C with PF inside the
 * ₹1.5 lakh, 80D, 80CCD(1B), home-loan interest set off up to ₹2 lakh, the HRA exemption worked out).
 */
function claimed(oldIncome, pay) {
  const via = (id) => (oldIncome.via.find((v) => v.id === id) || {}).amount || 0;
  const hra = Math.max(0, (oldIncome.hraWorking && oldIncome.hraWorking.exempt) || 0);
  const c = { epf: pay.employeePf, s80c: via('80c'), homeLoan: Math.max(0, oldIncome.hpLossSetOff || 0), health: via('80d'), nps: via('80ccd1b'), hra };
  return { ...c, total: c.s80c + c.homeLoan + c.health + c.nps + c.hra };
}

export function quickAnswer(q, rates) {
  const ctc = num(q.ctc);
  if (!ctc) return null;
  const store = {
    ctc, basicPct: num(q.basicPct) || QUICK_DEFAULTS.basicPct, hraPct: q.hraPct != null ? +q.hraPct : QUICK_DEFAULTS.hraPct,
    conveyance: 0, variable: 0, variableInCtc: 'ctc', includeEmployerPf: true, includeGratuity: true, employerNpsPct: 0,
    professionalTax: q.professionalTax != null ? num(q.professionalTax) : QUICK_DEFAULTS.professionalTax,
    city: q.city || QUICK_DEFAULTS.city, rentPaid: 12 * num(q.rentMonthly),
    other80c: num(q.other80c), nps1b: num(q.nps1b), healthSelf: num(q.healthSelf), homeLoanInterest: num(q.homeLoanInterest), ageBand: q.ageBand || 'below_60', regime: 'best',
  };
  const pay = salaryBreakdown(store, rates);
  if (pay.error) return { error: pay.error };
  const inputs = mergeInputs(pay.inputs);
  const cmp = compareRegimes(inputs, rates);
  const be = breakEven(inputs, rates);
  const tax = { new: cmp.new.tax.total, old: cmp.old.tax.total };
  const better = tax.old < tax.new ? 'old' : 'new';          // a tie goes to the new regime: nothing to prove to the employer
  const inHand = (r) => pay.grossSalary - pay.employeePf - pay.professionalTax - tax[r];
  const c = claimed(cmp.old.income, pay);
  const deductionsNow = c.total;
  return {
    ctc, store, pay, cmp, be, tax, better,
    same: tax.old === tax.new,
    saves: Math.abs(tax.old - tax.new),
    inHand: { new: inHand('new'), old: inHand('old'), best: inHand(better) },
    monthly: { new: inHand('new') / 12, old: inHand('old') / 12, best: inHand(better) / 12 },
    claimed: c,
    // old-regime deductions, in total, at which the two regimes cost the same
    needed: be.kind === 'need' ? deductionsNow + be.extra : be.kind === 'cushion' ? deductionsNow - be.cushion : null,
    room80c: Math.max(0, LIMIT_80C - Math.min(LIMIT_80C, c.epf)),
  };
}

/** The answer at common CTCs with nothing but the default split: what the page shows before a number is typed. */
export function ladder(rates, ctcs = LADDER_CTCS) {
  return ctcs.map((ctc) => {
    const a = quickAnswer({ ctc }, rates);
    return { ctc, monthly: a.monthly.best, newTax: a.tax.new, oldTax: a.tax.old, better: a.better, saves: a.saves, oldNeeds: a.be.kind === 'need' ? a.needed : null };
  });
}
