/**
 * /calculators with nothing chosen: the decision each tool answers, not a list of calculators.
 * Questions are grouped by what a person is actually deciding, and where the profile already knows
 * something the card says it in their own figures ("On ₹1,15,900 a month you could carry about ₹87 L").
 * The tabs above still open a tool directly.
 */
import { el, inrShort } from './util.js';
import { getProfile } from './profile-store.js';
import { isEmptyProfile } from '../engine/profile.js';
import { baseRates } from './mix-rates.js';
import { snapshot } from './snapshot-engine.js';

// Three bigger decisions. The everyday tools (salary, savings, EMI, SIP, capital gains) are in the menu;
// the rest (offers, debts, goals, idle money, NPS) keep their addresses and are reached from the tools
// that lead to them.
const ITEMS = [
  { href: '/calculators/home', icon: '🏠', q: 'Should I buy this home?', d: 'Stamp duty, registration and builder charges by city, then the loan and the down payment.', line: (s) => (s && s.home.kind === 'budget' && s.home.price > 0 ? `A rule of thumb says about ${inrShort(s.home.price)} is within reach.` : null) },
  { href: '/calculators/car', icon: '🚗', q: 'Which car is cheaper to own?', d: 'Petrol, diesel, hybrid or electric: the cost over the years you keep it, and when a dearer car breaks even.', line: () => null },
  { href: '/calculators/retirement', icon: '🌅', q: 'Retirement: will the money last?', d: 'What you have, what you add and what you will spend: the year it runs out, and what closes the gap.', line: () => null },
];

export function renderCalcIndex(appData) {
  let s = null;
  try {
    const p = getProfile();
    if (!isEmptyProfile(p)) s = snapshot(p, { rates: appData.rates, mix: baseRates(appData.schemes), loanPolicy: appData.loanPolicy });
  } catch { s = null; }
  return el('div', { class: 'calc-index' }, [
    el('div', { class: 'decide-grid' }, ITEMS.map((it) => {
      let line = null; try { line = it.line(s); } catch { line = null; }
      return el('a', { class: 'decide', href: it.href }, [
        el('span', { class: 'ico', 'aria-hidden': 'true' }, it.icon),
        el('strong', {}, it.q),
        el('span', {}, it.d),
        line ? el('span', { class: 'decide-yours' }, line) : null,
      ]);
    })),
  ]);
}
