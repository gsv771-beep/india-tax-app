/**
 * Home loan eligibility the way a lender's credit desk works it out: the loan you get is the
 * smallest of what your repayment capacity (FOIR), the RBI loan-to-value cap and your age allow,
 * after a credit-score gate. Pure functions; conventions come from data/loan_policy.json.
 *
 * loanEligibility(inputs, policy) -> see the return block at the bottom.
 * inputs: {
 *   netMonthly, grossMonthly, variablePayMonthly, rentalMonthly, coApplicantMonthly,
 *   existingEmi, creditCardOutstanding,
 *   creditScore (0 = not known), age (0 = not known), employment: 'salaried' | 'self_employed',
 *   ratePct (base rate before score premium), tenureYears (wanted),
 *   propertyPrice (0 = no property yet), loanWanted (0 = as much as allowed),
 *   overrides: { incomeBasis, foir, loanEndAge, maxTenureYears }   optional, from the assumptions panel
 * }
 */

const num = (v) => (Number.isFinite(+v) ? +v : 0);

/** Principal that a given EMI services over n months at monthly rate r. */
export function principalForEmi(emi, annualRatePct, months) {
  const r = annualRatePct / 1200;
  if (emi <= 0 || months <= 0) return 0;
  if (r === 0) return emi * months;
  return (emi * (Math.pow(1 + r, months) - 1)) / (r * Math.pow(1 + r, months));
}

export function emiFor(P, annualRatePct, months) {
  const r = annualRatePct / 1200;
  if (P <= 0 || months <= 0) return 0;
  return r === 0 ? P / months : (P * r * Math.pow(1 + r, months)) / (Math.pow(1 + r, months) - 1);
}

/** RBI cap: the largest loan such that loan <= ltv(loan) x price, across the bands. */
export function maxLoanByLtv(price, policy) {
  let best = 0;
  for (const b of policy.ltv.bands) {
    const cap = b.loan_upto == null ? Infinity : b.loan_upto;
    best = Math.max(best, Math.min(cap, price * b.max_ltv));
  }
  return best;
}

export function ltvRateFor(loan, policy) {
  const b = policy.ltv.bands.find((x) => x.loan_upto == null || loan <= x.loan_upto);
  return b ? b.max_ltv : policy.ltv.bands.at(-1).max_ltv;
}

export function foirFor(income, employment, policy) {
  const b = policy.foir.bands.find((x) => x.income_upto == null || income <= x.income_upto);
  return b ? b[employment === 'self_employed' ? 'self_employed' : 'salaried'] : 0.5;
}

export function scorePremiumBps(score, policy) {
  if (!score) return 0;
  const row = [...policy.credit_score.premium_bps].sort((a, b) => b.score_from - a.score_from).find((r) => score >= r.score_from);
  return row ? row.bps : policy.credit_score.premium_bps.at(-1).bps;
}

export function loanEligibility(inputsIn, policy) {
  const i = { employment: 'salaried', ratePct: policy.rate.default_pct, tenureYears: 20, overrides: {}, ...inputsIn };
  const o = i.overrides || {};
  const employment = i.employment === 'self_employed' ? 'self_employed' : 'salaried';
  const warnings = [];

  // --- income the lender counts ---
  const basis = o.incomeBasis || policy.foir.income_basis;
  const own = basis === 'gross' ? num(i.grossMonthly) || num(i.netMonthly) : num(i.netMonthly) || num(i.grossMonthly);
  const h = policy.income_haircuts;
  const variable = num(i.variablePayMonthly) * h.variable_pay;
  const rental = num(i.rentalMonthly) * h.rental_income;
  const co = num(i.coApplicantMonthly) * h.co_applicant;
  const counted = own + variable + rental + co;
  const income = { basis, own, variable, rental, coApplicant: co, counted };

  // --- obligations ---
  const cardObligation = num(i.creditCardOutstanding) * policy.obligations.credit_card_pct_of_outstanding;
  const existingEmi = num(i.existingEmi) + cardObligation;

  // --- credit gate and rate ---
  const score = num(i.creditScore);
  const premiumBps = scorePremiumBps(score, policy);
  const rate = { base: num(i.ratePct), premiumBps, effective: num(i.ratePct) + premiumBps / 100 };
  const rejected = score > 0 && score < policy.credit_score.reject_below;
  if (rejected) warnings.push(`A credit score of ${score} is below the ${policy.credit_score.reject_below} most lenders will consider. Income does not rescue this; the score has to come up first.`);
  else if (score > 0 && score < policy.credit_score.best_rate_from) warnings.push(`A score of ${score} usually means a rate about ${premiumBps / 100}% above the best offer. Above ${policy.credit_score.best_rate_from} unlocks the best pricing.`);
  if (!score) warnings.push('No credit score entered: assuming 750+. Most lenders price the rate on it and refuse below about 650.');

  // --- FOIR capacity ---
  const foir = o.foir != null ? num(o.foir) : foirFor(counted, employment, policy);
  const maxEmi = Math.max(0, counted * foir - existingEmi);
  const foirNow = counted > 0 ? existingEmi / counted : 0;

  // --- tenure by age ---
  const endBy = o.loanEndAge != null ? num(o.loanEndAge) : policy.age.loan_must_end_by[employment];
  const maxTenure = o.maxTenureYears != null ? num(o.maxTenureYears) : policy.age.max_tenure_years;
  const age = num(i.age);
  const allowedByAge = age > 0 ? Math.max(0, Math.min(maxTenure, endBy - age)) : maxTenure;
  const wanted = Math.max(1, Math.min(num(i.tenureYears) || 20, maxTenure));
  const used = Math.max(0, Math.min(wanted, allowedByAge));
  const tenure = { wanted, allowedByAge, used, endBy, ageKnown: age > 0 };
  if (age > 0 && allowedByAge < wanted) warnings.push(`At ${age}, a lender that wants the loan closed by ${endBy} allows ${allowedByAge} years, not ${wanted}.`);
  if (age > 0 && allowedByAge <= 0) warnings.push(`At ${age} the loan cannot run past ${endBy} at this lender; look for one with a later cutoff or a younger co-applicant as the main borrower.`);

  // --- the three caps ---
  const months = used * 12;
  const maxByFoir = principalForEmi(maxEmi, rate.effective, months);
  const price = num(i.propertyPrice);
  const maxByLtv = price > 0 ? maxLoanByLtv(price, policy) : Infinity;
  let maxLoan = rejected ? 0 : Math.min(maxByFoir, maxByLtv);
  let binding = rejected ? 'credit' : maxByFoir <= maxByLtv ? 'foir' : 'ltv';
  if (!rejected && age > 0 && allowedByAge < wanted && binding === 'foir') binding = 'tenure';
  if (!rejected && maxLoan <= 0) binding = maxEmi <= 0 ? 'foir' : binding;

  const loanWanted = num(i.loanWanted);
  const loan = loanWanted > 0 ? Math.min(loanWanted, maxLoan) : maxLoan;
  const emi = emiFor(loan, rate.effective, months);
  const foirAfter = counted > 0 ? (existingEmi + emi) / counted : 0;
  const shortfall = loanWanted > 0 ? Math.max(0, loanWanted - maxLoan) : 0;

  // --- levers: what would raise the ceiling, in rupees ---
  const levers = [];
  const recompute = (patch) => loanEligibility({ ...inputsIn, ...patch, _noLevers: true }, policy).maxLoan;
  if (!rejected && !i._noLevers) {
    if (num(i.existingEmi) > 0) levers.push({ id: 'clear_emis', label: `Close the existing EMIs (₹${Math.round(num(i.existingEmi)).toLocaleString('en-IN')}/month)`, gain: recompute({ existingEmi: 0, creditCardOutstanding: 0 }) - maxLoan });
    if (num(i.creditCardOutstanding) > 0) levers.push({ id: 'clear_cards', label: 'Pay off credit-card balances before applying', gain: recompute({ creditCardOutstanding: 0 }) - maxLoan });
    if (!num(i.coApplicantMonthly)) levers.push({ id: 'co_applicant', label: 'Add a co-applicant earning ₹50,000/month', gain: recompute({ coApplicantMonthly: 50000 }) - maxLoan });
    if (age > 0 && allowedByAge < wanted) levers.push({ id: 'later_cutoff', label: `A lender that lets the loan run to 70 (e.g. SBI)`, gain: recompute({ overrides: { ...o, loanEndAge: 70 } }) - maxLoan });
    if (wanted < allowedByAge) levers.push({ id: 'longer_tenure', label: `Take the full ${allowedByAge} years instead of ${wanted}`, gain: recompute({ tenureYears: allowedByAge }) - maxLoan });
    if (score > 0 && score < policy.credit_score.best_rate_from) levers.push({ id: 'score', label: `Raise the score to ${policy.credit_score.best_rate_from}+ (rate ${premiumBps / 100}% lower)`, gain: recompute({ creditScore: policy.credit_score.best_rate_from }) - maxLoan });
    if (binding === 'ltv' && price > 0) levers.push({ id: 'ltv', label: 'The RBI cap binds: a bigger loan needs a pricier property or a bigger down payment, not more income', gain: 0, info: true });
  }
  const meaningful = levers.filter((l) => l.info || l.gain > 1000).sort((a, b) => b.gain - a.gain);

  const minIncome = policy.minimum_profile.min_net_monthly_income;
  if (own > 0 && own < minIncome) warnings.push(`Own income below ₹${minIncome.toLocaleString('en-IN')}/month: many lenders will not open a file at all.`);

  return {
    income, foir: { rate: foir, before: foirNow, after: foirAfter }, existingEmi, cardObligation, maxEmi,
    rate, tenure, employment,
    maxByFoir, maxByLtv: Number.isFinite(maxByLtv) ? maxByLtv : null, ltvRate: price > 0 ? ltvRateFor(Math.max(1, maxLoan), policy) : null,
    maxLoan, binding, rejected, loanWanted, loan, emi, shortfall,
    levers: meaningful, warnings,
  };
}
