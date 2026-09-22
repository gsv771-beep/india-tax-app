/**
 * /calculators with nothing chosen: the decision each tool answers, not a list of calculators.
 * Questions are grouped by what a person is actually deciding, and where the profile already knows
 * something the card says it in their own figures ("On ₹1,15,900 a month you could carry about ₹87 L").
 * The tabs above still open a tool directly.
 */
import { el, inr } from './util.js';
import { getProfile } from './profile-store.js';
import { isEmptyProfile } from '../engine/profile.js';
import { baseRates } from './mix-rates.js';
import { snapshot } from './snapshot-engine.js';

const GROUPS = [
  {
    title: 'Money coming in',
    items: [
      { href: '/calculators/salary', icon: '💼', q: 'What will actually reach my bank?', d: 'CTC to monthly take-home: Basic, HRA, conveyance, variable pay, PF, professional tax and income tax.', line: (s) => (s && s.kind !== 'business' ? `About ${inr(s.takeHome.monthly)} a month on your figures.` : null) },
      { href: '/tax', icon: '💰', q: 'Old regime or new?', d: 'Both computed line by line, what moves your tax, and how far you are from the other one winning.', line: (s) => (s ? `${s.tax.regime} regime is cheaper for you today${s.tax.otherSaves > 0 ? `, by ${inr(s.tax.otherSaves)}` : ''}.` : null) },
      { href: '/calculators/budget', icon: '🧾', q: 'Where does it all go?', d: 'Expenses by category against your take-home, and what is genuinely free at the end of the month.', line: (s) => (s && s.surplus.fromBudget ? `${inr(s.surplus.monthly)} free each month.` : null) },
    ],
  },
  {
    title: 'Big commitments',
    items: [
      { href: '/calculators/home', icon: '🏠', q: 'Should I buy this home?', d: 'Stamp duty, registration, GST and builder charges by city, then the loan, down payment and the stage-wise payment plan.', line: (s) => (s && s.home.kind === 'budget' && s.home.price > 0 ? `A rule of thumb says about ${inr(Math.round(s.home.price / 100000) * 100000)} is within reach.` : null) },
      { href: '/calculators/emi', icon: '🏦', q: 'Can I carry this EMI?', d: 'EMI, total interest, and what a step-up or a prepayment saves; the loan can come from price and down payment.', line: (s) => (s && s.loans.count ? `You pay ${inr(s.loans.emi)} a month in EMIs today.` : null) },
      { href: '/calculators/capital-gains', icon: '📑', q: 'What will I owe if I sell?', d: 'Shares, funds or property: the gain, the exemptions, and the reliefs that cut the tax if you reinvest.', line: () => null },
    ],
  },
  {
    title: 'Money going out to work',
    items: [
      { href: '/calculators/compare', icon: '📈', q: 'Where should this money go?', d: 'PPF, FD, debt and equity funds, gold and NPS compared after tax, at your slab and your horizon.', line: (s) => (s && s.surplus.monthly > 0 ? `You have about ${inr(s.surplus.monthly)} a month to place.` : null) },
      { href: '/calculators/sip', icon: '📊', q: 'What will my SIP grow into?', d: 'A monthly SIP with step-ups and lump sums, against what fund categories have actually returned.', line: () => null },
      { href: '/nps', icon: '🏛️', q: 'Is NPS worth it for me?', d: 'How it works, the corpus and pension at 60, and the one deduction the new regime still allows.', line: () => null },
    ],
  },
  {
    title: 'Where it all has to end up',
    items: [
      { href: '/calculators/goal', icon: '🎯', q: 'Will I reach the goal?', d: 'A child’s education or wedding, a house, a car: today’s cost, the cost when it arrives, and the SIP that gets there.', line: (s) => (s && s.goals.length ? `${s.goals.length} goal${s.goals.length > 1 ? 's' : ''} need ${inr(s.goalSip)} a month.` : null) },
      { href: '/calculators/retirement', icon: '🌅', q: 'Will the money last?', d: 'What you have, what you add, what you will spend: the year it runs out, and what closes the gap.', line: () => null },
    ],
  },
];

export function renderCalcIndex(appData) {
  let s = null;
  try {
    const p = getProfile();
    if (!isEmptyProfile(p)) s = snapshot(p, { rates: appData.rates, mix: baseRates(appData.schemes), loanPolicy: appData.loanPolicy });
  } catch { s = null; }
  return el('div', { class: 'calc-index' }, [
    el('p', { class: 'muted' }, s ? 'Pick the decision you are making. Your figures are already in each one; every tool writes back what it learns.' : 'Pick the decision you are making. Fill in any tool and the rest start from the same figures, kept in this browser.'),
    ...GROUPS.map((g) => el('div', { class: 'decide-block' }, [
      el('h2', { class: 'decide-title' }, g.title),
      el('div', { class: 'decide-grid' }, g.items.map((it) => {
        const line = it.line(s);
        return el('a', { class: 'decide', href: it.href }, [
          el('span', { class: 'ico', 'aria-hidden': 'true' }, it.icon),
          el('strong', {}, it.q),
          el('span', {}, it.d),
          line ? el('span', { class: 'decide-yours' }, line) : null,
        ]);
      })),
    ])),
  ]);
}
