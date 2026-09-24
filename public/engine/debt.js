/**
 * Debt triage: several loans and a card, one pot of money. Which to clear first, what it costs either
 * way, and whether the next rupee should go to a prepayment or into the market. Pure.
 *
 *   debtPlan({ debts[], extra, method })  -> { months, totalInterest, order[], schedule[], freedAt[] }
 *   compareMethods(...)                   -> { avalanche, snowball, saving, monthsSaved }
 *   prepayVsInvest({...})                 -> { prepayRate, investRate, better, gap, why }
 *
 * A debt is { name, balance, ratePct, minPayment, kind?: 'card' | 'personal' | 'home' | ... }.
 * A balance under a rupee counts as cleared: paise left over by a rounded EMI are not another month.
 * Interest is charged monthly on the outstanding balance, which is how every one of these actually works;
 * a credit card's 3.5% a month is shown as the 42%+ a year it really is.
 */

const num = (v) => (Number.isFinite(+v) ? +v : 0);
const clamp0 = (v) => Math.max(0, v);
const MAX_MONTHS = 600;

export function normaliseDebts(list) {
  return (Array.isArray(list) ? list : []).map((d, i) => ({
    name: String(d && d.name ? d.name : `Loan ${i + 1}`).slice(0, 40),
    balance: clamp0(num(d && d.balance)),
    ratePct: clamp0(num(d && d.ratePct)),
    minPayment: clamp0(num(d && d.minPayment)),
    kind: d && d.kind ? String(d.kind) : 'other',
  })).filter((d) => d.balance > 0);
}

/** Effective annual cost of a rate charged monthly: a card's "3.5% a month" is 51% a year. */
export function effectiveAnnual(ratePct) {
  const m = num(ratePct) / 1200;
  return (Math.pow(1 + m, 12) - 1) * 100;
}

/**
 * Pay every minimum, then throw everything spare at one debt until it dies, then roll that payment
 * into the next. 'avalanche' picks the highest rate, 'snowball' the smallest balance.
 */
export function debtPlan({ debts, extra = 0, method = 'avalanche' }) {
  const list = normaliseDebts(debts).map((d) => ({ ...d }));
  if (!list.length) return { months: 0, totalInterest: 0, order: [], schedule: [], freedAt: [], impossible: false };
  const spare = clamp0(num(extra));
  const order = [];      // cleared, in the order they went
  const focus = [];      // what the spare money was aimed at, in turn
  const freedAt = [];
  const schedule = [];
  let totalInterest = 0, month = 0;
  const rank = (a, b) => (method === 'snowball' ? a.balance - b.balance || b.ratePct - a.ratePct : b.ratePct - a.ratePct || a.balance - b.balance);

  while (list.some((d) => d.balance > 0) && month < MAX_MONTHS) {
    month++;
    let pool = spare;
    // interest first, then the minimums
    for (const d of list) {
      if (d.balance <= 0) continue;
      const interest = d.balance * (d.ratePct / 1200);
      d.balance += interest;
      totalInterest += interest;
    }
    for (const d of list) {
      if (d.balance <= 0) continue;
      const pay = Math.min(d.minPayment, d.balance);
      d.balance -= pay;
      if (d.balance <= 1) { d.balance = 0; freedAt.push({ name: d.name, month }); order.push(d.name); pool += d.minPayment - pay; }
    }
    // everything spare (plus the payments of debts already cleared) to the target
    const targets = list.filter((d) => d.balance > 0).sort(rank);
    if (targets.length && focus[focus.length - 1] !== targets[0].name) focus.push(targets[0].name);
    const cleared = list.filter((d) => d.balance === 0).reduce((s, d) => s + d.minPayment, 0);
    pool += cleared;
    for (const d of targets) {
      if (pool <= 0) break;
      const pay = Math.min(pool, d.balance);
      d.balance -= pay; pool -= pay;
      if (d.balance <= 1) { d.balance = 0; freedAt.push({ name: d.name, month }); order.push(d.name); }
    }
    schedule.push({ month, outstanding: Math.round(list.reduce((s, d) => s + d.balance, 0)), interestSoFar: Math.round(totalInterest) });
  }
  const impossible = list.some((d) => d.balance > 0);
  return {
    months: month, years: +(month / 12).toFixed(1), totalInterest: Math.round(totalInterest),
    order: [...new Set(order)], focus: [...new Set(focus)], freedAt, schedule, impossible,
    note: impossible ? 'The minimum payments do not even cover the interest, so the balances never clear. Raise what you pay each month, or talk to the lender about restructuring before the interest compounds further.' : null,
  };
}

/** Both orders, and what the difference is worth. */
export function compareMethods({ debts, extra = 0 }) {
  const avalanche = debtPlan({ debts, extra, method: 'avalanche' });
  const snowball = debtPlan({ debts, extra, method: 'snowball' });
  return {
    avalanche, snowball,
    saving: Math.round(snowball.totalInterest - avalanche.totalInterest),
    monthsSaved: snowball.months - avalanche.months,
    firstAvalanche: avalanche.focus[0] || avalanche.order[0] || null,   // where the spare money goes first
    firstSnowball: snowball.focus[0] || snowball.order[0] || null,
  };
}

/**
 * The next spare rupee: prepay a loan or invest it? Compare like with like, after tax.
 * A prepayment earns the loan's rate, risk-free and tax-free, except that a home loan in the old
 * regime is partly paid for by the taxman: relief on the interest makes the real cost lower, so
 * prepaying it earns less than the sticker rate.
 *
 * o: { loanRatePct, investReturnPct, slabRate, regime, kind, interestDeductibleLeft, capitalGainsTaxPct }
 */
export function prepayVsInvest(o) {
  const loanRate = num(o.loanRatePct);
  const slab = num(o.slabRate);          // 0.30 for a 30% slab
  const oldRegime = o.regime === 'old';
  const deductible = o.kind === 'home' && oldRegime && num(o.interestDeductibleLeft) > 0;
  const effectiveLoanRate = deductible ? loanRate * (1 - slab) : loanRate;
  const invest = num(o.investReturnPct);
  const cgt = num(o.capitalGainsTaxPct != null ? o.capitalGainsTaxPct : 12.5) / 100;
  const investAfterTax = invest * (1 - cgt);
  const gap = investAfterTax - effectiveLoanRate;
  return {
    prepayRate: +effectiveLoanRate.toFixed(2), stickerRate: +loanRate.toFixed(2), investRate: +investAfterTax.toFixed(2),
    deductible, better: Math.abs(gap) < 0.25 ? 'either' : gap > 0 ? 'invest' : 'prepay', gap: +gap.toFixed(2),
    why: deductible
      ? `Interest on a home loan you live in is deductible in the old regime, so a ${loanRate}% loan really costs ${effectiveLoanRate.toFixed(1)}% after relief at your ${Math.round(slab * 100)}% slab. Prepaying earns that, certainly and tax-free; the ${invest}% you hope for from the market is ${investAfterTax.toFixed(1)}% after ${Math.round(cgt * 100)}% tax, and is not certain.`
      : `Prepaying earns ${effectiveLoanRate.toFixed(1)}% with no risk and no tax. The ${invest}% you hope for is ${investAfterTax.toFixed(1)}% after ${Math.round(cgt * 100)}% tax, and can be much less in a bad decade.`,
  };
}

/** The order the tools should suggest before any of this: emergency money, then the expensive debt. */
export const TRIAGE_RULES = [
  'Pay every minimum first. A missed payment costs more in late fees and credit score than any strategy saves.',
  'Keep one month of expenses aside before attacking the debt, or the next surprise goes back on the card.',
  'Clear anything above about 15% a year before investing a rupee: no fund beats a credit card.',
  'A card balance rolled over loses the interest-free period on new spending too, so the real cost is higher than the rate suggests.',
  'Ask for a lower rate before you restructure: a balance transfer to a personal loan, or a top-up on a secured loan, usually halves the rate.',
  'Prepay when the rate is high and certain; invest when the loan is cheap and the money is not needed for years.',
];
