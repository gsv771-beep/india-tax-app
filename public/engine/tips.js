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

/** A loan paid month by month, with an extra payment at the end of every year: { months, interest }. */
export function loanWithYearlyExtra(principal, ratePct, years, extra = 0) {
  const r = ratePct / 1200, n = years * 12;
  const emi = (principal * r * (1 + r) ** n) / ((1 + r) ** n - 1);
  let bal = principal, m = 0, interest = 0;
  while (bal > 0.5 && m < n + 600) {
    m++;
    const int = bal * r;
    bal -= Math.min(emi, bal + int) - int;
    interest += int;
    if (extra > 0 && m % 12 === 0 && bal > 0.5) bal -= Math.min(extra, bal);
  }
  return { emi, months: m, interest };
}

function sipTip() {
  const target = 1e7, years = 7, rate = 12;
  const monthly = up(target / sipValue(1, rate, years), 100);
  return {
    id: 'sip-crore', hook: '₹1 crore in 7 years?',
    text: `A SIP of about ${inr(monthly)} a month gets there, if it earns ${rate}% a year. Returns are not guaranteed.`,
    cta: 'See how it adds up', href: '/calculators/sip',
    handoff: { to: 'sip', values: { monthly, years, ratePct: rate, stepUpPct: 0, fresh: true, note: 'the ₹1 crore in 7 years example' } },
    check: { value: sipValue(monthly, rate, years) },
  };
}

function loanTip() {
  const principal = 5e6, rate = 8.5, years = 20, target = years - 5;
  const base = loanWithYearlyExtra(principal, rate, years);
  // the smallest yearly extra, in steps of ₹5,000, that closes the loan in 15 years
  let lo = 0, hi = principal;
  while (hi - lo > 5000) { const mid = (lo + hi) / 2; if (loanWithYearlyExtra(principal, rate, years, mid).months <= target * 12) hi = mid; else lo = mid; }
  const extra = up(hi, 5000);
  const withExtra = loanWithYearlyExtra(principal, rate, years, extra);
  return {
    id: 'loan-early', hook: 'Close your home loan 5 years early',
    text: `On a ₹50 lakh, 20-year loan at ${rate}%, paying ${inr(extra)} extra once a year (a bonus is enough) closes it in ${target} years and saves ${words(base.interest - withExtra.interest)} of interest.`,
    cta: 'See how', href: '/calculators/emi',
    handoff: { to: 'emi', values: { principal, ratePct: rate, years, annualPrepay: extra, fresh: true, note: 'the close-5-years-early example' } },
    check: { months: withExtra.months, saved: base.interest - withExtra.interest },
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
