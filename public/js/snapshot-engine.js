/**
 * Your money at a glance: one profile in, one connected picture out.
 *   CTC -> tax under your regime (and what the other would save) -> take-home a month -> after EMIs
 *   -> what the free money becomes in ten years at your equity share -> a rule-of-thumb home budget
 *   -> each goal's SIP. Every line names the tool that owns it. Pure; the page supplies the rates.
 *
 * snapshot(profile, { rates, mix, loanPolicy, equityPct, years })
 *   -> null when the profile has no salary, else { pay, tax, takeHome, loans, surplus, invest, home, goals, emergency, assumptions }
 */
import { salaryBreakdown } from './salary.js';
import { toSalaryStore, emiFor } from '../engine/profile.js';
import { mixReturn } from '../engine/mix.js';
import { sipFV, lumpsumFV } from './calculators.js';
import { requiredSip } from '../engine/goal.js';

const num = (v) => (Number.isFinite(+v) ? +v : 0);

export function snapshot(p, { rates, mix, loanPolicy, equityPct = 60, years = 10 }) {
  if (!(num(p.income.ctc) > 0)) return null;
  const pay = salaryBreakdown(toSalaryStore(p), rates);
  if (pay.error) return null;
  const other = pay.regime === 'old' ? 'new' : 'old';
  const otherTax = pay.cmp[other].tax.total;
  const tax = { regime: pay.regime, annual: pay.tax, monthly: pay.tax / 12, otherRegime: other, otherSaves: Math.max(0, pay.tax - otherTax), effectiveRate: pay.tax / pay.ctc };
  const takeHome = { monthly: pay.monthly, annual: pay.annual, pctOfCtc: pay.takeHomePct };

  const emis = p.loans.reduce((s, l) => s + num(l.emi), 0);
  const loans = { count: p.loans.length, emi: emis, afterEmi: pay.monthly - emis, list: p.loans.map((l) => ({ type: l.type, outstanding: num(l.outstanding), emi: num(l.emi), yearsLeft: Math.round(num(l.remainingMonths) / 12) })) };

  // free money: what the budget tool says if it has been used, else take-home after EMIs (before expenses)
  const fromBudget = num(p.cashflow.monthlySurplus) > 0;
  const surplus = { monthly: fromBudget ? num(p.cashflow.monthlySurplus) : Math.max(0, loans.afterEmi), fromBudget };

  const m = mixReturn(equityPct, mix);
  const held = Object.values(p.investments || {}).reduce((s, v) => s + num(v), 0);
  // what goes into investing each month: the budget's surplus if known, else a 30% share of take-home after EMIs (nobody invests the whole of it)
  const investing = fromBudget ? surplus.monthly : Math.round(0.3 * Math.max(0, loans.afterEmi));
  const fvSip = investing > 0 ? sipFV(investing, m.typical, years).fv : 0;
  const fvHeld = held > 0 ? lumpsumFV(held, m.typical, years).fv : 0;
  const invest = { monthly: investing, assumedShare: fromBudget ? 0 : 0.3, held, years, equityPct, ratePct: m.typical, badPct: m.bad, fvSip, fvHeld, fv: fvSip + fvHeld, fvBad: (investing > 0 ? sipFV(investing, m.bad, years).fv : 0) + (held > 0 ? lumpsumFV(held, m.bad, years).fv : 0) };

  // home: a rule of thumb, not eligibility: EMI at half of take-home after other EMIs, 20 years, 20% down
  const ratePct = num(loanPolicy && loanPolicy.rate && loanPolicy.rate.default_pct) || 8;
  const existingHome = p.loans.find((l) => l.type === 'home' && num(l.outstanding) > 0);
  let home;
  if (existingHome) home = { kind: 'have', outstanding: num(existingHome.outstanding), emi: num(existingHome.emi), yearsLeft: Math.round(num(existingHome.remainingMonths) / 12), ratePct: num(existingHome.rate) };
  else {
    const maxEmi = Math.max(0, 0.5 * pay.monthly - emis);
    const months = 240, r = ratePct / 1200;
    const loan = maxEmi > 0 ? maxEmi * (Math.pow(1 + r, months) - 1) / (r * Math.pow(1 + r, months)) : 0;
    const price = loan / 0.8;
    home = { kind: 'budget', price, loan, down: price - loan, emi: maxEmi, ratePct, years: 20 };
  }

  const goals = (p.horizon.goals || []).filter((g) => num(g.years) > 0 && num(g.target) > 0).map((g) => ({ name: g.name, years: num(g.years), target: num(g.target), sip: requiredSip(num(g.target), m.typical, num(g.years)) }));
  const goalSip = goals.reduce((s, g) => s + g.sip, 0);

  const monthsCovered = num(p.cashflow.emergencyFund) > 0 && pay.monthly > 0 ? num(p.cashflow.emergencyFund) / pay.monthly : 0;
  const emergency = { fund: num(p.cashflow.emergencyFund), monthsCovered };

  return {
    ctc: pay.ctc, pay, tax, takeHome, loans, surplus, invest, home, goals, goalSip, emergency,
    assumptions: `Tax under the ${pay.regime} regime with your profile’s deductions; ${equityPct}% equity mix earning about ${m.typical.toFixed(1)}% a year (equity ${mix.equity}%, safe ${mix.safe}%); home budget at ${ratePct}% for 20 years with 20% down.`,
  };
}

/** A starter profile from a CTC alone: 40% basic, 50% of basic as HRA, employer PF and gratuity on basic. */
export function seedFromCtc(p, ctc, rates) {
  const st = { ...toSalaryStore(p), ctc: Math.max(0, num(ctc)), basicPct: 40, hraPct: 50, includeEmployerPf: true, includeGratuity: true, employerNpsPct: 0 };
  return { store: st, breakdown: salaryBreakdown(st, rates) };
}
