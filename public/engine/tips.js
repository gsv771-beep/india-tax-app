/**
 * "Did you know?" worked examples for Ask TaxCompass. Every figure is computed here with the same
 * arithmetic the calculators use (SIP as an annuity-due compounding monthly, the loan month by month,
 * tax through the quick answer), so following the link shows the same number. Pure: no DOM.
 *
 *   tips(rates) -> [{ id, hook, text, cta, href, handoff?: { to, values } }]
 *   handoff values carry `fresh: true`: the calculator clears extras a visitor left there earlier
 *   (step-ups, lump sums, a property price) so the example reproduces exactly.
 */
import { quickAnswer } from '../js/quick-engine.js';

const inr = (n) => `₹${Math.round(n).toLocaleString('en-IN')}`;
const words = (n) => (n >= 1e7 ? `₹${+(n / 1e7).toFixed(2)} crore` : `₹${+(n / 1e5).toFixed(1)} lakh`);
const up = (n, to) => Math.ceil(n / to) * to;

/** SIP value after `years` (instalment at the start of each month), with an optional yearly step-up. */
export function sipValue(monthly, ratePct, years, stepUpPct = 0) {
  const i = ratePct / 1200;
  let bal = 0, amt = monthly;
  for (let y = 0; y < years; y++) {
    for (let m = 0; m < 12; m++) bal = (bal + amt) * (1 + i);
    amt *= 1 + stepUpPct / 100;
  }
  return bal;
}

/**
 * A loan paid month by month, as the EMI calculator does it: the EMI can rise by a percentage at the
 * start of every year after the first, and an extra payment can go in at the end of every year.
 * Returns { emi (the first), months, interest, finalEmi }.
 */
export function loanSim(principal, ratePct, years, { stepUpPct = 0, extra = 0 } = {}) {
  const r = ratePct / 1200, n = years * 12;
  const emi = (principal * r * (1 + r) ** n) / ((1 + r) ** n - 1);
  let bal = principal, cur = emi, m = 0, interest = 0;
  while (bal > 0.5 && m < n + 600) {
    m++;
    if (m > 1 && (m - 1) % 12 === 0 && stepUpPct > 0) cur *= 1 + stepUpPct / 100;
    const int = bal * r;
    bal -= Math.min(cur, bal + int) - int;
    interest += int;
    if (extra > 0 && m % 12 === 0 && bal > 0.5) bal -= Math.min(extra, bal);
  }
  return { emi, months: m, interest, finalEmi: cur };
}

const span = (months) => { const y = Math.floor(months / 12), m = months % 12; return `${y} years${m ? ` ${m} month${m > 1 ? 's' : ''}` : ''}`; };

function sipTip() {
  const target = 1e7, years = 10, rate = 12, monthly = 35000;
  // the smallest whole-number yearly raise that takes ₹35,000 a month past ₹1 crore
  let step = 0;
  while (sipValue(monthly, rate, years, step) < target && step < 30) step++;
  return {
    id: 'sip-crore', hook: '₹1 crore in 10 years?',
    text: `Start a SIP of ${inr(monthly)} a month and raise it ${step}% every year: at ${rate}% a year it crosses ${words(sipValue(monthly, rate, years, step))} in ${years} years. Without the raise, about ${words(sipValue(monthly, rate, years))}. Returns are not guaranteed.`,
    cta: 'See how it adds up', href: '/calculators/sip',
    handoff: { to: 'sip', values: { monthly, years, ratePct: rate, stepUpPct: step, fresh: true, note: 'the ₹1 crore in 10 years example' } },
    check: { step, value: sipValue(monthly, rate, years, step) },
  };
}

function loanTip() {
  const principal = 5e6, rate = 8.5, years = 20;
  const base = loanSim(principal, rate, years);
  // the smallest whole-number yearly EMI raise that closes the loan at least 5 years early
  let step = 1;
  while (loanSim(principal, rate, years, { stepUpPct: step }).months > (years - 5) * 12 && step < 20) step++;
  const up5 = loanSim(principal, rate, years, { stepUpPct: step });
  return {
    id: 'loan-early', hook: 'Close your home loan 5 years early',
    text: `Raise your EMI by ${step}% a year, as your pay grows, and a ₹50 lakh, 20-year loan at ${rate}% closes in ${span(up5.months)}, saving ${words(base.interest - up5.interest)} of interest. The EMI starts at ${inr(base.emi)}.`,
    cta: 'See how', href: '/calculators/emi',
    handoff: { to: 'emi', values: { principal, ratePct: rate, years, stepUpPct: step, fresh: true, note: 'the close-5-years-early example' } },
    check: { step, months: up5.months, saved: base.interest - up5.interest },
  };
}

function stepUpTip() {
  const monthly = 10000, rate = 12, years = 20, step = 10;
  const flat = sipValue(monthly, rate, years), stepped = sipValue(monthly, rate, years, step);
  return {
    id: 'step-up', hook: 'Raise your SIP 10% a year',
    text: `₹10,000 a month for 20 years at ${rate}% grows to ${words(flat)}. Raise it 10% every year and it becomes ${words(stepped)}.`,
    cta: 'Try your own figures', href: '/calculators/sip',
    handoff: { to: 'sip', values: { monthly, years, ratePct: rate, stepUpPct: step, fresh: true, note: 'the 10% step-up example' } },
    check: { flat, stepped },
  };
}

function zeroTaxTip(rates) {
  // the highest CTC, to the nearest ₹10,000, that pays no income tax in the new regime at the calculator's defaults
  const zero = (ctc) => { const a = quickAnswer({ ctc }, rates); return a && !a.error && a.tax.new === 0; };
  let lo = 1e6, hi = 2e6;
  if (!zero(lo) || zero(hi)) return null;
  while (hi - lo > 10000) { const mid = Math.round((lo + hi) / 2 / 10000) * 10000; if (zero(mid)) lo = mid; else hi = mid; }
  return {
    id: 'zero-tax', hook: `No income tax up to a ${words(lo)} CTC`,
    text: `In the new regime a salary of up to ${words(lo)} CTC pays no income tax at all, after the standard deduction, PF and the rebate. See where yours lands.`,
    cta: 'Check your salary', href: `/tax?ctc=${lo}`,
    check: { ctc: lo },
  };
}

function regimeTip(rates) {
  const ctc = 1800000;
  const a = quickAnswer({ ctc }, rates);
  if (!a || a.error || a.better !== 'new') return null;
  return {
    id: 'regime-18', hook: `The new regime saves ${inr(a.saves)} at ₹18 lakh`,
    text: `At a ₹18 lakh CTC the new regime costs ${inr(a.saves)} a year less, unless your old-regime deductions add up to more than ${words(a.needed)}.`,
    cta: 'Check yours', href: `/tax?ctc=${ctc}`,
    check: { saves: a.saves },
  };
}

let cache = null;
export function tips(rates) {
  if (cache && cache.rates === rates) return cache.list;
  const list = [sipTip(), loanTip(), zeroTaxTip(rates), stepUpTip(), regimeTip(rates)].filter(Boolean);
  cache = { rates, list };
  return list;
}
