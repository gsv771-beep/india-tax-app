// Insurance and debt triage engines. Run: node tests/protection.test.mjs
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { lifeCover, healthCover, policyDecision, irr } from '../public/engine/insurance.js';
import { debtPlan, compareMethods, prepayVsInvest, effectiveAnnual, normaliseDebts } from '../public/engine/debt.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const data = JSON.parse(readFileSync(path.join(here, '../public/data/insurance.json'), 'utf8'));
let failures = 0;
const ok = (name, cond, detail = '') => { console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${detail ? ' (' + detail + ')' : ''}`); if (!cond) failures++; };
const near = (name, a, e, tol = 1) => ok(name, Math.abs(a - e) <= tol, `got ${Math.round(a)}, expected ${Math.round(e)}`);

// ---- life cover ----
{
  const o = { annualIncome: 2400000, age: 35, retireAt: 60, monthlySpendOfFamily: 100000, loans: 5000000, goalsTotal: 3000000, savings: 2000000, existingCover: 5000000, realReturnPct: 3 };
  const r = lifeCover(o, data);
  const factor = (1 - Math.pow(1.03, -25)) / 0.03;
  near('life: income need is the present value of household spending to retirement', r.incomeNeed, 1200000 * factor, 2);
  near('life: cover needed adds loans and goals, takes off savings and existing cover', r.need, 1200000 * factor + 5000000 + 3000000 - 7000000, 2);
  ok('life: the parts add up to the need', Math.abs(r.parts.reduce((s, p) => s + p.sign * p.amount, 0) - r.need) <= 2);
  ok('life: premium scales with cover and sits inside the published band', r.premium > 0 && r.premium >= r.premiumRange[0] && r.premium <= r.premiumRange[1]);
  ok('life: a smoker pays more', lifeCover({ ...o, smoker: true }, data).premium > r.premium);
  ok('life: an older buyer pays much more for the same cover', lifeCover({ ...o, age: 50, monthlySpendOfFamily: 0, annualIncome: 0, loans: 10000000, savings: 0, existingCover: 0 }, data).perCrore > lifeCover({ ...o, age: 28 }, data).perCrore * 2);
  ok('life: no need when savings and cover already exceed everything', lifeCover({ ...o, savings: 100000000 }, data).need === 0);
  near('life: with no spending figure it replaces 70% of income', lifeCover({ ...o, monthlySpendOfFamily: 0, loans: 0, goalsTotal: 0, savings: 0, existingCover: 0 }, data).incomeNeed, 2400000 * 0.7 * factor, 2);
}
// ---- health cover ----
{
  const r = healthCover({ age: 35, adults: 2, children: 1, metro: true }, data);
  ok('health: base plus top-up reach the suggested total for a metro', r.base === 1000000 && r.total === 5000000 && r.topUp === 4000000);
  ok('health: the top-up costs far less per rupee than the base', r.topUpPremium / r.topUp < r.basePremium / r.base);
  ok('health: more members and a metro cost more', healthCover({ age: 35, adults: 2, children: 2, metro: true }, data).premium > r.premium && r.premium > healthCover({ age: 35, adults: 2, children: 1, metro: false }, data).premium * 0.9);
  ok('health: an existing base larger than the suggestion is kept', healthCover({ age: 35, adults: 1, children: 0, metro: false, existingBase: 1500000 }, data).base === 1500000);
  ok('health: premium rises steeply with age', healthCover({ age: 60, adults: 1, children: 0, metro: false }, data).premium > healthCover({ age: 30, adults: 1, children: 0, metro: false }, data).premium * 2);
}
// ---- a traditional policy ----
{
  const o = { sumAssured: 1000000, annualPremium: 50000, termYears: 20, yearsPaid: 8, investReturnPct: 10, termPremium: 12000 };
  const r = policyDecision(o, data);
  near('policy: maturity if continued = SA + simple bonus for every year + final bonus', r.maturityIfContinued, 1000000 + 1000 * 44 * 20 + 1000 * 60, 1);
  near('policy: paid-up sum assured is proportionate to the premiums paid', r.paidUpSA, 1000000 * 8 / 20, 1);
  near('policy: surrender value estimated from the table (55% at year 8)', r.surrender, 50000 * 8 * 0.55, 1);
  ok('policy: three options, each valued at the same maturity date', r.options.length === 3 && r.options.every((x) => Number.isFinite(x.atMaturity)));
  // eight years in, most of the cost is already sunk, so paying on usually wins: the point of the tool
  ok('policy: late in the policy, keeping it wins even against a 10% alternative', r.best === 'continue', r.options.map((x) => `${x.id} ${x.atMaturity}`).join(', '));
  ok('policy: the forward return on the premiums still to be paid is high for the same reason', r.options[0].irr > 0.12 && r.options[0].irr < 0.5, String(r.options[0].irr));
  const early = policyDecision({ ...o, yearsPaid: 3, investReturnPct: 12 }, data);
  ok('policy: three years in, with a 12% alternative, surrendering wins', early.best === 'surrender', early.options.map((x) => `${x.id} ${x.atMaturity}`).join(', '));
  const low = policyDecision({ ...o, yearsPaid: 3, investReturnPct: 3 }, data);
  ok('policy: with a 3% alternative, keeping it wins at any stage', low.best === 'continue', low.options.map((x) => `${x.id} ${x.atMaturity}`).join(', '));
  ok('policy: a premium above 10% of the sum assured loses the 10(10D) exemption', policyDecision({ ...o, annualPremium: 150000 }, data).taxNote != null && r.taxNote === null);
  ok('policy: a fully paid policy has nothing left to decide', policyDecision({ ...o, yearsPaid: 20 }, data).left === 0);
  near('irr: a doubling over 10 years is about 7.2%', irr([{ t: 0, amount: -100 }, { t: 10, amount: 200 }]) * 100, 7.18, 0.05);
}
// ---- debt triage ----
{
  const debts = [
    { name: 'Credit card', balance: 200000, ratePct: 42, minPayment: 10000, kind: 'card' },
    { name: 'Personal loan', balance: 500000, ratePct: 15, minPayment: 15000, kind: 'personal' },
    { name: 'Car loan', balance: 300000, ratePct: 9, minPayment: 9000, kind: 'car' },
  ];
  const a = debtPlan({ debts, extra: 20000, method: 'avalanche' });
  const s = debtPlan({ debts, extra: 20000, method: 'snowball' });
  ok('debt: avalanche clears the card first, snowball the smallest balance', a.order[0] === 'Credit card' && s.order[0] === 'Credit card');
  ok('debt: everything is cleared and the schedule ends at zero', !a.impossible && a.schedule[a.schedule.length - 1].outstanding === 0);
  ok('debt: avalanche never costs more interest than snowball', a.totalInterest <= s.totalInterest);
  const c = compareMethods({ debts, extra: 20000 });
  ok('compare: the saving is the interest difference', c.saving === s.totalInterest - a.totalInterest && c.firstAvalanche === 'Credit card');
  const slower = debtPlan({ debts, extra: 0, method: 'avalanche' });
  ok('debt: paying only the minimums takes longer and costs more', slower.months > a.months && slower.totalInterest > a.totalInterest);
  const stuck = debtPlan({ debts: [{ name: 'Card', balance: 300000, ratePct: 42, minPayment: 2000 }], extra: 0 });
  ok('debt: minimums below the interest are called out, not silently looped', stuck.impossible && /never clear/.test(stuck.note));
  near('a card at 3.5% a month is 51% a year', effectiveAnnual(42), 51.1, 0.2);
  ok('normalise drops empty rows and clamps negatives', normaliseDebts([{ name: 'x', balance: 0 }, { name: 'y', balance: -5 }, { balance: 100 }]).length === 1);
  const both = compareMethods({ debts: [{ name: 'Small', balance: 20000, ratePct: 12, minPayment: 2000 }, { name: 'Big', balance: 400000, ratePct: 18, minPayment: 10000 }], extra: 5000 });
  ok('compare: the spare money is aimed differently even when the small debt clears itself first', both.firstAvalanche === 'Big' && both.firstSnowball === 'Small');
  ok('debt: focus is where the money is aimed, order is what actually cleared', a.focus[0] === 'Credit card' && a.order.length === 3);
}
// ---- prepay or invest ----
{
  const home = prepayVsInvest({ loanRatePct: 8.5, investReturnPct: 12, slabRate: 0.3, regime: 'old', kind: 'home', interestDeductibleLeft: 200000 });
  near('prepay: a deductible home loan really costs the rate less the slab', home.prepayRate, 8.5 * 0.7, 0.01);
  ok('prepay: investing wins against a cheap deductible loan', home.better === 'invest' && home.deductible);
  const card = prepayVsInvest({ loanRatePct: 42, investReturnPct: 12, slabRate: 0.3, regime: 'new', kind: 'card' });
  ok('prepay: nothing beats clearing a card', card.better === 'prepay' && card.prepayRate === 42);
  const close = prepayVsInvest({ loanRatePct: 10.5, investReturnPct: 12, slabRate: 0.3, regime: 'new', kind: 'personal' });
  ok('prepay: a near-tie says either, rather than pretending to be precise', close.better === 'either', String(close.gap));
  ok('prepay: the new regime gives no relief, so the sticker rate is the cost', prepayVsInvest({ loanRatePct: 8.5, investReturnPct: 12, slabRate: 0.3, regime: 'new', kind: 'home', interestDeductibleLeft: 200000 }).prepayRate === 8.5);
}

console.log(failures ? `\n${failures} failure(s)` : '\nAll protection tests passed');
process.exit(failures ? 1 : 0);
