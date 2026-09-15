/**
 * Phase-wise payment of a home purchase: who pays what, when, and what the loan costs before
 * the EMI starts. Under construction, the builder demands the price in stages; your own money goes
 * first, the bank disburses the rest stage by stage, and until the last disbursement you pay
 * pre-EMI interest only on what has been released. A ready or resale home is one stage at month 0.
 *
 * paymentPlan({ price, tranches, downPayment, loan, ratePct, tenureMonths, gstRate, upfrontCharges }, opts)
 *   tranches: [{ label, pct (of price), month (0 = booking) }]
 *   downPayment: your money towards the price (the bank never funds charges)
 *   loan: the sanctioned amount available for disbursement
 *   gstRate: 0 for ready / resale; 0.05 or 0.01 under construction, charged on each stage and paid by you
 *   upfrontCharges: stamp duty, registration, fees, builder extras - paid by you at month 0
 * Pure; no DOM.
 */

const num = (v) => (Number.isFinite(+v) ? +v : 0);

export const PLAN_PRESETS = {
  construction_linked: {
    label: 'Construction-linked, about 3 years',
    note: 'The commonest plan for a flat bought off-plan: each demand follows a construction milestone. Builders vary the stages; edit them to match your cost sheet.',
    tranches: [
      { label: 'Booking', pct: 10, month: 0 },
      { label: 'Agreement and registration', pct: 10, month: 1 },
      { label: 'Plinth complete', pct: 10, month: 4 },
      { label: '5th slab', pct: 10, month: 8 },
      { label: '10th slab', pct: 10, month: 12 },
      { label: 'Top slab', pct: 10, month: 18 },
      { label: 'Brickwork and plaster', pct: 10, month: 22 },
      { label: 'Flooring and fittings', pct: 10, month: 26 },
      { label: 'Finishing and external work', pct: 10, month: 30 },
      { label: 'Possession', pct: 10, month: 36 },
    ],
  },
  time_linked: {
    label: 'Time-linked, quarterly over 3 years',
    note: 'Demands arrive on dates, whatever the site looks like. Common with plotted developments and some large townships.',
    tranches: [
      { label: 'Booking', pct: 10, month: 0 },
      { label: 'Agreement', pct: 15, month: 1 },
      ...Array.from({ length: 10 }, (_, k) => ({ label: `Instalment ${k + 1}`, pct: 7, month: 3 * (k + 1) })),
      { label: 'Possession', pct: 5, month: 36 },
    ],
  },
  down_payment_plan: {
    label: 'Down-payment plan, 10:85:5',
    note: 'Almost everything within a month of booking, in exchange for a discount. The bank disburses nearly the whole loan up front, so the EMI starts almost immediately.',
    tranches: [
      { label: 'Booking', pct: 10, month: 0 },
      { label: 'Within 30 days', pct: 85, month: 1 },
      { label: 'Possession', pct: 5, month: 30 },
    ],
  },
  single: {
    label: 'One payment on registration',
    note: 'Ready-to-move or resale: the whole price changes hands at registration and the EMI starts the next month.',
    tranches: [{ label: 'On registration', pct: 100, month: 0 }],
  },
};

export function presetFor(status) {
  return status === 'under_construction' ? 'construction_linked' : 'single';
}

export function paymentPlan(inputs) {
  const price = num(inputs.price);
  const rate = num(inputs.ratePct) / 1200;
  const tenureMonths = Math.max(1, Math.round(num(inputs.tenureMonths) || 240));
  const gstRate = num(inputs.gstRate);
  const upfront = num(inputs.upfrontCharges);
  const loanAvailable = Math.max(0, num(inputs.loan));
  const warnings = [];

  const tranches = (inputs.tranches || []).map((t) => ({ label: String(t.label || 'Stage'), pct: num(t.pct), month: Math.max(0, Math.round(num(t.month))) })).filter((t) => t.pct > 0).sort((a, b) => a.month - b.month);
  const pctTotal = tranches.reduce((s, t) => s + t.pct, 0);
  if (tranches.length === 0) warnings.push('No payment stages: add at least one.');
  else if (Math.abs(pctTotal - 100) > 0.01) warnings.push(`The stages add up to ${+pctTotal.toFixed(2)}% of the price, not 100%. The plan below uses them as entered.`);

  let ownLeft = Math.max(0, num(inputs.downPayment));
  let bankLeft = loanAvailable;
  let disbursed = 0;
  let shortfall = 0;
  const rows = [];
  for (const t of tranches) {
    const due = price * t.pct / 100;
    const gst = due * gstRate;
    let fromYou = Math.min(ownLeft, due);
    ownLeft -= fromYou;
    let fromBank = Math.min(bankLeft, due - fromYou);
    bankLeft -= fromBank;
    const gap = due - fromYou - fromBank;   // neither your down payment nor the loan covers it
    if (gap > 0.5) { shortfall += gap; fromYou += gap; }
    disbursed += fromBank;
    rows.push({ month: t.month, label: t.label, pct: t.pct, due, gst, fromYou: fromYou + gst + (rows.length === 0 ? upfront : 0), fromBank, cumulativeLoan: disbursed, upfront: rows.length === 0 ? upfront : 0, uncovered: gap > 0.5 ? gap : 0 });
  }
  if (shortfall > 0.5) warnings.push(`Your down payment and the loan together fall ${Math.round(shortfall).toLocaleString('en-IN')} short of the price; that gap is shown as paid by you.`);

  // Pre-EMI interest: charged monthly on whatever has been disbursed, from the first disbursement to the last.
  const lastMonth = rows.length ? rows.at(-1).month : 0;
  const disbursedBy = (m) => rows.filter((r) => r.month <= m).reduce((s, r) => s + r.fromBank, 0);
  let preEmiTotal = 0;
  const preEmiByMonth = [];
  const finalLoan = disbursed;
  for (let m = 0; m < lastMonth; m++) {
    const interest = disbursedBy(m) * rate;
    preEmiByMonth.push({ month: m + 1, interest, disbursed: disbursedBy(m) });
    preEmiTotal += interest;
  }
  // attach the pre-EMI paid between each stage and the next to the row, for a compact table
  for (let k = 0; k < rows.length; k++) {
    const from = rows[k].month, to = k + 1 < rows.length ? rows[k + 1].month : lastMonth;
    rows[k].preEmiUntilNext = preEmiByMonth.filter((x) => x.month > from && x.month <= to).reduce((s, x) => s + x.interest, 0);
  }

  const emi = finalLoan > 0 ? (rate === 0 ? finalLoan / tenureMonths : (finalLoan * rate * Math.pow(1 + rate, tenureMonths)) / (Math.pow(1 + rate, tenureMonths) - 1)) : 0;
  const emiStartMonth = lastMonth + 1;
  const youByPossession = rows.reduce((s, r) => s + r.fromYou, 0) + preEmiTotal;
  const cashAtBooking = rows.length ? rows[0].fromYou : upfront;

  return {
    rows, tranches, pctTotal, price, loan: finalLoan, loanUnused: Math.max(0, loanAvailable - finalLoan), downPaymentUsed: num(inputs.downPayment) - ownLeft, downPaymentUnused: ownLeft,
    gstTotal: rows.reduce((s, r) => s + r.gst, 0), upfront,
    preEmiTotal, preEmiByMonth, constructionMonths: lastMonth, emi, emiStartMonth, tenureMonths,
    cashAtBooking, youByPossession, shortfall, warnings,
  };
}
