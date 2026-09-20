/**
 * "Your money at a glance" on the landing page. With a salary in the profile it shows the connected
 * picture (tax -> take-home -> after EMIs -> ten years of investing -> home budget -> goals), each line
 * linking to the tool that owns it. Without one it asks for the CTC alone and seeds the profile.
 */
import { el, inr, pct, setChildren } from './util.js';
import { getProfile, updateProfile, onProfileChange } from './profile-store.js';
import { fromSalaryStore } from '../engine/profile.js';
import { baseRates, loadMixRates } from './mix-rates.js';
import { snapshot, seedFromCtc } from './snapshot-engine.js';

const SOURCE = 'snapshot';
const EQ_KEY = 'taxcompass.snapshot-equity.v1';

export function initSnapshot({ rates, schemes, loanPolicy }) {
  const slot = document.getElementById('home-snapshot');
  if (!slot) return;
  let mix = baseRates(schemes);
  let equityPct = 60; try { equityPct = +localStorage.getItem(EQ_KEY) || 60; } catch {}

  const paint = (p) => {
    const s = snapshot(p, { rates, mix, loanPolicy, equityPct });
    setChildren(slot, [s ? card(s, p) : starter()]);
    slot.hidden = false;
  };

  function starter() {
    const input = el('input', { type: 'number', min: 0, step: 50000, placeholder: 'e.g. 1800000', inputmode: 'numeric', 'aria-label': 'Your annual CTC in rupees' });
    const go = el('button', { type: 'button', class: 'btn' }, 'Show me');
    const submit = () => {
      const ctc = +input.value;
      if (!(ctc > 0)) { input.focus(); return; }
      const { store, breakdown } = seedFromCtc(getProfile(), ctc, rates);
      if (breakdown.error) return;
      updateProfile((d) => fromSalaryStore(d, store, breakdown), SOURCE);
    };
    go.addEventListener('click', submit);
    input.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); submit(); } });
    return el('div', { class: 'card snap-start' }, [
      el('div', { class: 'snap-title' }, 'Start with one number'),
      el('p', { class: 'muted' }, 'Your annual CTC is enough for a first picture: tax, take-home, what you could invest, what home you could carry. Refine it in any tool later; everything stays in your browser.'),
      el('div', { class: 'snap-form' }, [el('label', {}, ['Annual CTC (₹)', input]), go]),
    ]);
  }

  function card(s, p) {
    const row = (label, value, note, href, linkText) => el('div', { class: 'snap-row' }, [
      el('div', { class: 'snap-label' }, label),
      el('div', { class: 'snap-value' }, value),
      el('div', { class: 'snap-note' }, [note, href ? [' ', el('a', { href }, linkText || 'Open →')] : null]),
    ]);
    const t = s.tax, th = s.takeHome, inv = s.invest, h = s.home;
    const rows = [
      row('Income tax', `${inr(t.annual)} a year`, t.otherSaves > 0 ? `${t.regime} regime, ${pct(t.effectiveRate)} of CTC. The ${t.otherRegime} regime would save ${inr(t.otherSaves)}.` : `${t.regime} regime, ${pct(t.effectiveRate)} of CTC; the cheaper one for you.`, '/tax', 'Compare regimes →'),
      row('Take-home', `${inr(th.monthly)} a month`, `${pct(th.pctOfCtc)} of CTC after PF, professional tax and income tax.`, '/calculators/salary', 'See the split →'),
      s.loans.count ? row('After EMIs', `${inr(s.loans.afterEmi)} a month`, `${s.loans.count} loan${s.loans.count > 1 ? 's' : ''}, ${inr(s.loans.emi)} a month in EMIs.`, '/calculators/emi', 'Prepay or step up →') : null,
      s.surplus.fromBudget || s.loans.count ? row(s.surplus.fromBudget ? 'Free each month' : 'Free before expenses', `${inr(s.surplus.monthly)} a month`, s.surplus.fromBudget ? 'From your budget: what is left after expenses and EMIs.' : 'Take-home after EMIs; the budget tool takes expenses off this.', '/calculators/budget', s.surplus.fromBudget ? 'Budget →' : 'Add expenses →') : null,
      inv.monthly > 0 || inv.held > 0 ? row(`In ${inv.years} years`, inr(inv.fv), `${inv.monthly > 0 ? (inv.assumedShare ? `If you invested ${Math.round(inv.assumedShare * 100)}% of it, ${inr(inv.monthly)} a month,` : `Investing ${inr(inv.monthly)} a month`) : ''}${inv.monthly > 0 && inv.held > 0 ? ' plus ' : ''}${inv.held > 0 ? `the ${inr(inv.held)} you hold` : ''} at a ${inv.equityPct}% equity mix (about ${inv.ratePct.toFixed(1)}% a year); ${inr(inv.fvBad)} in a bad stretch.`, '/calculators/compare', 'Where to put it →') : null,
      h.kind === 'have'
        ? row('Home loan', `${inr(h.outstanding)} left`, `EMI ${inr(h.emi)} a month, about ${h.yearsLeft} years to go at ${h.ratePct}%.`, '/calculators/emi', 'What prepaying does →')
        : h.price > 0 ? row('Home you could carry', `about ${inr(Math.round(h.price / 100000) * 100000)}`, `A rule of thumb: EMI ${inr(h.emi)} (half your take-home) at ${h.ratePct}% for 20 years, with ${inr(h.down)} down. Stamp duty and GST come on top.`, '/calculators/home', 'True cost →') : null,
      s.goals.length
        ? row('Goals', `${inr(s.goalSip)} a month`, s.goals.map((g) => `${g.name}: ${inr(g.target)} in ${g.years} years needs ${inr(g.sip)} a month`).join('; ') + '.', '/calculators/goal', 'Plan a goal →')
        : row('Goals', 'none yet', 'A child’s education, a house, retirement: say what and when, and see the SIP.', '/calculators/goal', 'Add one →'),
      s.emergency.fund > 0 ? row('Emergency fund', `${s.emergency.monthsCovered.toFixed(1)} months`, `${inr(s.emergency.fund)} against a take-home of ${inr(th.monthly)}; six months is the usual floor.`, null) : null,
    ];
    const range = el('input', { type: 'range', min: 0, max: 100, step: 10, value: equityPct, 'aria-label': 'Equity share' });
    range.addEventListener('input', () => { equityPct = +range.value; try { localStorage.setItem(EQ_KEY, String(equityPct)); } catch {} paint(getProfile()); });
    return el('div', { class: 'card snap' }, [
      el('div', { class: 'snap-head' }, [el('div', { class: 'snap-title' }, 'Your money at a glance'), el('div', { class: 'muted small' }, `On a CTC of ${inr(s.ctc)}. Every line opens the tool that works it out in full.`)]),
      el('div', { class: 'snap-rows' }, rows),
      el('div', { class: 'snap-foot' }, [
        el('label', { class: 'snap-mix' }, [`Equity share for the ten-year line: ${equityPct}%`, range]),
        el('div', { class: 'muted small' }, s.assumptions),
        el('div', { class: 'muted small' }, ['Change any figure under ', el('a', { href: '#profile-panel', onclick: (e) => { e.preventDefault(); document.querySelector('.profile-toggle')?.click(); document.getElementById('profile-panel').scrollIntoView({ block: 'start', behavior: 'smooth' }); } }, 'Your profile'), ', or in the tool itself; this picture follows.']),
      ]),
    ]);
  }

  paint(getProfile());
  onProfileChange(paint, SOURCE);
  window.addEventListener('profilechange', (e) => { if (e.detail.source === SOURCE) paint(e.detail.profile); });
  loadMixRates(schemes).then((r) => { mix = r; paint(getProfile()); });
}
