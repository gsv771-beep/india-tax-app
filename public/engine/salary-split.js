/**
 * CTC to in-hand: the salary split and both regimes' tax. Pure (no DOM), so the edge middleware can
 * render salary pages with the same arithmetic as the in-hand calculator (js/salary.js re-exports it).
 */
import { compareRegimes } from '../js/tax-engine.js';

/**
 * p: { ctc, basicPct (of CTC), hraPct (of basic), conveyance (per year), variable (per year),
 *      variableInCtc (default true; false = paid on top of the CTC), variableMonthly, includeEmployerPf, includeGratuity, employerNpsPct (of basic),
 *      professionalTax, city, rentPaid, other80c, nps1b, healthSelf, homeLoanInterest, ageBand, regime: 'best'|'old'|'new', fy }
 *
 * Special allowance is the balancing figure: everything in the CTC that the other components do not
 * account for. Conveyance allowance and variable pay are ordinary taxable salary (the old Rs 1,600 a
 * month conveyance exemption went when the standard deduction came back), so they change the break-up,
 * not the tax. Variable pay paid once a year is kept out of the monthly figure, with the tax split in
 * proportion to pay, because that is what lands in the bank each month.
 */
export function salaryBreakdown(p, rates) {
  const ctc = Math.max(0, +p.ctc || 0);
  const basic = ctc * ((+p.basicPct || 0) / 100);
  const hra = basic * ((+p.hraPct || 0) / 100);
  const employerPf = p.includeEmployerPf === false ? 0 : 0.12 * basic;
  const gratuity = p.includeGratuity === false ? 0 : 0.0481 * basic;
  const employerNps = basic * ((+p.employerNpsPct || 0) / 100);
  const conveyance = Math.max(0, +p.conveyance || 0);
  const variable = Math.max(0, +p.variable || 0);
  // variable pay is either carved out of the CTC or paid on top of it; the second is common for sales roles
  const variableInCtc = p.variableInCtc !== false && p.variableInCtc !== 'top';   // 'ctc' | 'top' (older saves used a boolean)
  const special = ctc - basic - hra - conveyance - (variableInCtc ? variable : 0) - employerPf - gratuity - employerNps;
  if (special < 0) return { error: 'The components add up to more than the CTC. Reduce Basic, HRA, conveyance, variable pay or the employer contributions, or mark variable pay as paid on top of the CTC.' };
  const grossSalary = basic + hra + conveyance + variable + special; // what is paid to you through the year, before deductions
  const employeePf = 0.12 * basic;
  const professionalTax = Math.max(0, +p.professionalTax || 0);

  const inputs = {
    fy: p.fy || 'FY2026-27', ageBand: p.ageBand || 'below_60', resident: true,
    salary: { gross: grossSalary + employerNps, basicDa: basic, hraReceived: hra, rentPaid: +p.rentPaid || 0, city: p.city || 'Other', professionalTax },
    employer: { npsContribution: employerNps, isGovernment: false, totalRetirementContribution: employerPf + employerNps },
    deductions: { includeEpf: true, epfEmployee: employeePf, s80c: +p.other80c || 0, nps1b: +p.nps1b || 0, healthSelf: +p.healthSelf || 0 },
    // not asked on this page; carried from the profile so the regime chosen here matches the tax page
    houseProperty: { selfOccupiedInterest: Math.max(0, +p.homeLoanInterest || 0), letOut: { rent: 0, municipalTax: 0, interest: 0 } },
  };
  const cmp = compareRegimes(inputs, rates);
  const regime = p.regime === 'old' || p.regime === 'new' ? p.regime : (cmp.better === 'old' ? 'old' : 'new');
  const taxFor = (r) => cmp[r].tax.total;
  const inHandFor = (r) => grossSalary - employeePf - professionalTax - taxFor(r);
  const tax = taxFor(regime);
  const annual = inHandFor(regime);
  // variable pay paid once a year: keep it out of the monthly figure, and split the tax by share of pay
  const variableApart = variable > 0 && p.variableMonthly !== true && p.variableMonthly !== 'monthly';
  const variableTax = variableApart && grossSalary > 0 ? tax * (variable / grossSalary) : 0;
  const fixedAnnual = annual - (variableApart ? variable - variableTax : 0);
  return {
    ctc, totalPackage: ctc + (variableInCtc ? 0 : variable), variableInCtc,
    basic, hra, conveyance, variable, variableApart, variableTax, variableNet: variable - variableTax,
    special, employerPf, gratuity, employerNps, grossSalary, employeePf, professionalTax,
    regime, tax, cmp, annual, monthly: fixedAnnual / 12, fixedAnnual,
    inHandOld: inHandFor('old'), inHandNew: inHandFor('new'),
    takeHomePct: ctc + (variableInCtc ? 0 : variable) ? annual / (ctc + (variableInCtc ? 0 : variable)) : 0,
    inputs,
  };
}
