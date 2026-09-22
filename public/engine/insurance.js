/**
 * Protection: how much life cover, how much health cover, and what to do with a traditional policy.
 * Pure; every rate comes in from data/insurance.json so nothing is hard-coded.
 *
 *   lifeCover(o, data)      -> { need, gap, parts[], premium, rules }
 *   healthCover(o, data)    -> { base, topUp, total, premium, rules }
 *   policyDecision(o, data) -> { options[{id, label, atMaturity, irr, why}], best, freedPremium, note }
 */

const num = (v) => (Number.isFinite(+v) ? +v : 0);
const clamp0 = (v) => Math.max(0, v);

function bandFor(list, age, key = 'annual_premium') {
  const b = list.find((x) => age >= x.age_from && age <= x.age_to) || list[list.length - 1];
  return b ? b[key] : 0;
}

/**
 * Life cover: what the family needs if the income stops tomorrow. Income to replace until you would
 * have retired, discounted at the real return (growth above inflation), plus debts and goals still to
 * fund, less what is already there. This is the human-life-value method, kept to one screen.
 *
 * o: { annualIncome, age, retireAt, monthlySpendOfFamily, loans, goalsTotal, savings, existingCover,
 *      realReturnPct, smoker }
 */
export function lifeCover(o, data) {
  const age = Math.round(num(o.age)) || 30;
  const retireAt = Math.max(age + 1, Math.round(num(o.retireAt)) || 60);
  const years = retireAt - age;
  const real = num(o.realReturnPct) / 100;
  // the family needs what it actually spends, not the whole salary; default to 70% of income when spending is unknown
  const replace = num(o.monthlySpendOfFamily) > 0 ? num(o.monthlySpendOfFamily) * 12 : num(o.annualIncome) * 0.7;
  const factor = real > 0 ? (1 - Math.pow(1 + real, -years)) / real : years;   // present value of 1 a year for `years`
  const incomeNeed = replace * factor;
  const loans = clamp0(num(o.loans));
  const goals = clamp0(num(o.goalsTotal));
  const have = clamp0(num(o.savings)) + clamp0(num(o.existingCover));
  const need = clamp0(incomeNeed + loans + goals - have);
  const parts = [
    { id: 'income', label: `Replace ${inrish(replace)} a year of household spending for ${years} years`, amount: Math.round(incomeNeed), sign: 1 },
    loans > 0 ? { id: 'loans', label: 'Clear the loans outstanding', amount: Math.round(loans), sign: 1 } : null,
    goals > 0 ? { id: 'goals', label: 'Fund the goals still to be met', amount: Math.round(goals), sign: 1 } : null,
    clamp0(num(o.savings)) > 0 ? { id: 'savings', label: 'Less: what you have already saved', amount: Math.round(num(o.savings)), sign: -1 } : null,
    clamp0(num(o.existingCover)) > 0 ? { id: 'cover', label: 'Less: cover you already hold', amount: Math.round(num(o.existingCover)), sign: -1 } : null,
  ].filter(Boolean);
  const t = data.term_life;
  const perCrore = bandFor(t.per_crore_by_age, age);
  const loading = o.smoker ? 1 + num(t.smoker_loading) : 1;
  const crores = need / 10000000;
  const premium = Math.round(crores * perCrore * loading);
  const band = (t.per_crore_by_age.find((x) => age >= x.age_from && age <= x.age_to) || {}).range || [perCrore, perCrore];
  return {
    need: Math.round(need), years, replace: Math.round(replace), incomeNeed: Math.round(incomeNeed), have: Math.round(have),
    parts, premium, premiumRange: [Math.round(crores * band[0] * loading), Math.round(crores * band[1] * loading)],
    perCrore: Math.round(perCrore * loading), coverTo: retireAt, rules: t.rules,
    pctOfIncome: num(o.annualIncome) > 0 ? premium / num(o.annualIncome) : 0,
  };
}
const inrish = (n) => '₹' + Math.round(n).toLocaleString('en-IN');

/**
 * Health cover: a base policy plus a super top-up, sized by city and family, with an indicative premium.
 * o: { age, adults, children, metro, existingBase, employerCover }
 */
export function healthCover(o, data) {
  const h = data.health;
  const age = Math.round(num(o.age)) || 30;
  const adults = Math.max(1, Math.round(num(o.adults)) || 1);
  const children = clamp0(Math.round(num(o.children)));
  const metro = !!o.metro;
  const suggestedBase = (metro ? h.suggested_base_lakh.metro : h.suggested_base_lakh.other) * 100000;
  const suggestedTotal = (metro ? h.suggested_total_lakh.metro : h.suggested_total_lakh.other) * 100000;
  const base = Math.max(suggestedBase, clamp0(num(o.existingBase)));
  const topUp = clamp0(suggestedTotal - base);
  const perLakh = bandFor(h.base_floater_per_lakh_by_age, age, 'annual_premium_per_lakh');
  const members = 1 + (adults - 1) + children;
  const memberLoad = 1 + (members - 1) * num(h.extra_per_additional_member);
  const cityLoad = metro ? 1 + num(h.metro_loading) : 1;
  const basePremium = (base / 100000) * perLakh * memberLoad * cityLoad;
  const topUpPremium = (topUp / 100000) * perLakh * num(h.super_topup_per_lakh_factor) * memberLoad * cityLoad;
  return {
    base: Math.round(base), topUp: Math.round(topUp), total: Math.round(base + topUp),
    basePremium: Math.round(basePremium), topUpPremium: Math.round(topUpPremium), premium: Math.round(basePremium + topUpPremium),
    members, metro, employerCover: clamp0(num(o.employerCover)), rules: h.rules,
  };
}

/** Internal rate of return of a cash-flow series (t = years), bisection; null when it cannot be bracketed. */
export function irr(flows, lo = -0.9, hi = 1) {
  const npv = (r) => flows.reduce((s, f) => s + f.amount / Math.pow(1 + r, f.t), 0);
  let a = lo, b = hi, fa = npv(a), fb = npv(b);
  if (!Number.isFinite(fa) || !Number.isFinite(fb) || fa * fb > 0) return null;
  for (let i = 0; i < 200; i++) {
    const m = (a + b) / 2, fm = npv(m);
    if (fa * fm <= 0) { b = m; fb = fm; } else { a = m; fa = fm; }
  }
  return (a + b) / 2;
}

/**
 * A traditional (endowment / money-back) policy: keep paying, stop paying, or surrender?
 * Money already paid is sunk; the question is what the remaining premiums do. Each option is valued at
 * the policy's maturity date so the three are comparable, and the surrender and paid-up options carry
 * the cost of buying the term cover the policy was providing.
 *
 * o: { sumAssured, annualPremium, termYears, yearsPaid, surrenderValue (0 = estimate it),
 *      investReturnPct, termPremium (0 = none needed), bonusPer1000, finalBonusPer1000 }
 */
export function policyDecision(o, data) {
  const tp = data.traditional_policy;
  const sa = clamp0(num(o.sumAssured));
  const prem = clamp0(num(o.annualPremium));
  const term = Math.max(1, Math.round(num(o.termYears)) || 20);
  const paid = Math.min(term, clamp0(Math.round(num(o.yearsPaid))));
  const left = Math.max(0, term - paid);
  const r = num(o.investReturnPct) / 100;
  const bonus = num(o.bonusPer1000) || num(tp.typical_simple_reversionary_bonus_per_1000);
  const finalBonus = term >= num(tp.final_bonus_min_years) ? (num(o.finalBonusPer1000) || num(tp.typical_final_additional_bonus_per_1000)) : 0;
  const termPremium = clamp0(num(o.termPremium));

  // maturity if you keep paying: sum assured + simple bonus for every policy year + final bonus
  const maturityIfContinued = sa + (sa / 1000) * bonus * term + (sa / 1000) * finalBonus;
  // paid-up: the sum assured shrinks in proportion to premiums paid, bonuses already attached stay
  const paidUpSA = sa * (paid / term);
  const maturityIfPaidUp = paidUpSA + (sa / 1000) * bonus * paid;
  // surrender value: what the insurer pays now (a percentage of premiums paid, rising with the year)
  const gsvPct = gsvPctFor(paid, tp.guaranteed_surrender_value_pct_by_year);
  const surrender = num(o.surrenderValue) > 0 ? num(o.surrenderValue) : prem * paid * gsvPct;
  const grow = (amount, years) => amount * Math.pow(1 + r, years);
  const sipTo = (yearly, years) => (r === 0 ? yearly * years : yearly * ((Math.pow(1 + r, years) - 1) / r) * (1 + r));

  const options = [
    {
      id: 'continue', label: 'Keep paying',
      atMaturity: Math.round(maturityIfContinued),
      irr: left > 0 ? irr([...Array.from({ length: left }, (_, k) => ({ t: k, amount: -prem })), { t: left, amount: maturityIfContinued }]) : null,
      why: `Pay ${inrish(prem)} a year for ${left} more year${left === 1 ? '' : 's'} and collect ${inrish(maturityIfContinued)} at maturity. The return shown is on the money still to be paid, not on what is already in.`,
    },
    {
      id: 'paidup', label: 'Stop paying, keep the policy',
      atMaturity: Math.round(maturityIfPaidUp + sipTo(prem, left) - (termPremium ? sipTo(termPremium, left) : 0)),
      irr: null,
      why: `The cover falls to ${inrish(paidUpSA)} and no new bonus accrues, but nothing is lost and ${inrish(maturityIfPaidUp)} is still paid at maturity. The ${inrish(prem)} a year you stop paying is invested instead${termPremium ? `, less ${inrish(termPremium)} a year for term cover` : ''}.`,
    },
    {
      id: 'surrender', label: 'Surrender and invest',
      atMaturity: Math.round(grow(surrender, left) + sipTo(prem, left) - (termPremium ? sipTo(termPremium, left) : 0)),
      irr: null,
      why: `Take ${inrish(surrender)} now${num(o.surrenderValue) > 0 ? '' : ` (an estimate: ${Math.round(gsvPct * 100)}% of the ${inrish(prem * paid)} paid so far)`}, invest it and the freed premiums${termPremium ? `, and buy term cover for ${inrish(termPremium)} a year` : ''}. The cover from this policy ends the day you surrender.`,
    },
  ];
  const best = options.slice().sort((a, b) => b.atMaturity - a.atMaturity)[0];
  return {
    options, best: best.id, maturityIfContinued: Math.round(maturityIfContinued), surrender: Math.round(surrender),
    paidUpSA: Math.round(paidUpSA), left, paid, premiumsPaid: Math.round(prem * paid), freedPremium: prem,
    taxNote: prem > 0.1 * sa ? 'The annual premium is more than 10% of the sum assured, so the maturity proceeds are not exempt under section 10(10D).' : null,
    rules: tp.rules,
  };
}

function gsvPctFor(year, table) {
  let pct = 0;
  for (const row of table) if (year >= row.year) pct = row.pct;
  return pct;
}
