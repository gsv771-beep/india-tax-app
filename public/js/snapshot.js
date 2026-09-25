/**
 * "Your money at a glance" on the landing page. With a salary in the profile it shows the connected
 * picture (tax -> take-home -> after EMIs -> ten years of investing -> home budget -> goals), each line
 * linking to the tool that owns it. Without one it asks for the CTC alone and seeds the profile.
 */
import { el, inr, inrShort, pct, setChildren } from './util.js';
import { getProfile, updateProfile, onProfileChange } from './profile-store.js';
import { fromSalaryStore } from '../engine/profile.js';
import { attachSlider } from './amount-input.js';
import { baseRates, loadMixRates } from './mix-rates.js';
import { snapshot, seedFromCtc } from './snapshot-engine.js';

const SOURCE = 'snapshot';
const EQ_KEY = 'taxcompass.snapshot-equity.v1';

export function initSnapshot({ rates, schemes, loanPolicy }) {
  const slot = document.getElementById('home-snapshot');
  if (!slot) return;
  let mix = baseRates(schemes);
  let equityPct = 60; try { equityPct = +localStorage.getItem(EQ_KEY) || 60; } catch {}

  // The quick answer above this card takes the CTC and shows tax and take-home; this card follows with
  // what the rest of the money does. Business income, which the quick answer does not take, keeps the
  // whole card, and so does the receipts starter.
  const paint = (p) => {
    const s = snapshot(p, { rates, mix, loanPolicy, equityPct });
    const bizProfile = p.person.employment === 'self_employed' || p.person.employment === 'both';
    if (!s && !bizProfile) { setChildren(slot, []); slot.hidden = true; return; }
    setChildren(slot, [s ? card(s, p) : starter()]);
    slot.hidden = false;
  };

  function starter() {
    let type = 'salary';
    const ctc = el('input', { type: 'number', min: 0, step: 50000, placeholder: 'e.g. 1800000', inputmode: 'numeric', 'aria-label': 'Your annual CTC in rupees' });
    const receipts = el('input', { type: 'number', min: 0, step: 50000, placeholder: 'e.g. 3000000', inputmode: 'numeric', 'aria-label': 'What your business or practice received last year' });
    const kind = el('select', { 'aria-label': 'Profession or business' }, [el('option', { value: 'profession' }, 'Profession: doctor, CA, consultant, freelancer, IT'), el('option', { value: 'business' }, 'Business or trade: shop, agency, manufacturing')]);
    const go = el('button', { type: 'button', class: 'btn' }, 'Show me');
    const ctcRow = el('label', {}, ['Annual CTC (₹)', ctc]);
    const recRow = el('label', {}, ['Receipts or turnover last year (₹)', receipts]);
    const kindRow = el('label', {}, ['It is a', kind]);
    const segs = ['salary', 'business', 'both'].map((t) => el('button', { type: 'button', class: 'seg' + (t === type ? ' on' : ''), 'aria-pressed': String(t === type) }, t === 'salary' ? 'Salary' : t === 'business' ? 'Business or profession' : 'Both'));
    const show = () => { ctcRow.hidden = type === 'business'; recRow.hidden = type === 'salary'; kindRow.hidden = type === 'salary'; segs.forEach((b, i) => { const on = ['salary', 'business', 'both'][i] === type; b.classList.toggle('on', on); b.setAttribute('aria-pressed', String(on)); }); };
    segs.forEach((b, i) => b.addEventListener('click', () => { type = ['salary', 'business', 'both'][i]; show(); }));
    const submit = () => {
      const c = +ctc.value, r = +receipts.value;
      if (type !== 'business' && !(c > 0)) { ctc.focus(); return; }
      if (type !== 'salary' && !(r > 0)) { receipts.focus(); return; }
      updateProfile((d) => {
        let out = d;
        if (type !== 'business') { const { store, breakdown } = seedFromCtc(d, c, rates); if (!breakdown.error) out = fromSalaryStore(d, store, breakdown); }
        out.person.employment = type === 'salary' ? 'salaried' : type === 'business' ? 'self_employed' : 'both';
        if (type !== 'salary') out.business = { ...out.business, receipts: r, kind: kind.value, presumptive: true };
        else out.business = { ...out.business, receipts: 0 };
        return out;
      }, SOURCE);
    };
    go.addEventListener('click', submit);
    [ctc, receipts].forEach((i) => i.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); submit(); } }));
    show();
    return el('div', { class: 'card snap-start' }, [
      el('div', { class: 'snap-title' }, 'Start with one number'),
      el('p', { class: 'muted' }, 'One figure gives the first picture: your tax, take-home, what you could invest and the home you could carry.'),
      el('div', { class: 'income-type' }, [el('span', { class: 'income-type-label' }, 'My income comes from'), el('span', { class: 'seg-group' }, segs)]),
      el('div', { class: 'snap-form' }, [ctcRow, recRow, kindRow, go]),
    ]);
  }

  function card(s, p) {
    const row = (label, value, note, href, linkText) => el('div', { class: 'snap-row' }, [
      el('div', { class: 'snap-label' }, label),
      el('div', { class: 'snap-value' }, value),
      el('div', { class: 'snap-note' }, [note, href ? [' ', el('a', { href }, linkText || 'Open →')] : null]),
    ]);
    const t = s.tax, th = s.takeHome, inv = s.invest, h = s.home;
    const extrasOnly = s.kind === 'salary';   // tax and take-home are already in the quick answer
    const rows = [
      extrasOnly ? null : row('Income tax', `${inr(t.annual)} a year`, `${t.otherSaves > 0 ? `${t.regime} regime, ${pct(t.effectiveRate)} of ${s.kind === 'salary' ? 'CTC' : 'income'}. The ${t.otherRegime} regime would save ${inr(t.otherSaves)}.` : `${t.regime} regime, ${pct(t.effectiveRate)} of ${s.kind === 'salary' ? 'CTC' : 'income'}; the cheaper one for you.`}${t.tds > 0 ? ` TDS of ${inr(t.tds)} already deducted${t.refund > 0 ? `; refund of ${inr(t.refund)} due` : `; ${inr(t.netPayable)} still to pay`}.` : ''}`, '/tax', s.kind === 'salary' ? 'Compare regimes →' : 'Tax and advance tax →'),
      extrasOnly ? null : row(s.kind === 'salary' ? 'Take-home' : 'Left after tax', `${inr(th.monthly)} a month`, s.kind === 'salary' ? `${pct(th.pctOfCtc)} of CTC after PF, professional tax and income tax.` : s.kind === 'business' ? `${s.business.presumptive ? `Presumptive income of ${inr(s.business.income)} on ${inr(s.business.receipts)} of receipts` : `Income of ${inr(s.business.income)} after expenses`}, less tax.` : `Salary take-home plus ${inr(s.business.income)} of business income, less tax.`, s.kind === 'salary' ? '/calculators/salary' : '/tax', s.kind === 'salary' ? 'See the split →' : 'How it is worked out →'),
      s.loans.count ? row('After EMIs', `${inr(s.loans.afterEmi)} a month`, `${s.loans.count} loan${s.loans.count > 1 ? 's' : ''}, ${inr(s.loans.emi)} a month in EMIs.`, '/calculators/emi', 'Prepay or step up →') : null,
      s.surplus.fromBudget || s.loans.count ? row(s.surplus.fromBudget ? 'Free each month' : 'Free before expenses', `${inr(s.surplus.monthly)} a month`, s.surplus.fromBudget ? 'From your budget: what is left after expenses and EMIs.' : 'Take-home after EMIs; the budget tool takes expenses off this.', '/calculators/budget', s.surplus.fromBudget ? 'Budget →' : 'Add expenses →') : null,
      inv.monthly > 0 || inv.held > 0 ? row(`In ${inv.years} years`, inrShort(inv.fv), `${inv.monthly > 0 ? (inv.assumedShare ? `If you invested ${Math.round(inv.assumedShare * 100)}% of it, ${inr(inv.monthly)} a month,` : `Investing ${inr(inv.monthly)} a month`) : ''}${inv.monthly > 0 && inv.held > 0 ? ' plus ' : ''}${inv.held > 0 ? `the ${inr(inv.held)} you hold` : ''} at a ${inv.equityPct}% equity mix (about ${inv.ratePct.toFixed(1)}% a year); ${inrShort(inv.fvBad)} in a bad stretch.`, '/calculators/compare', 'Where to put it →') : null,
      h.kind === 'have'
        ? row('Home loan', `${inr(h.outstanding)} left`, `EMI ${inr(h.emi)} a month, about ${h.yearsLeft} years to go at ${h.ratePct}%.`, '/calculators/emi', 'What prepaying does →')
        : h.price > 0 ? row('Rough home-price range', `about ${inrShort(h.price)}`, `A conservative first screen: total EMIs within 35% of take-home, at ${h.ratePct}% for 20 years, with ${inrShort(h.down)} down. Existing expenses, lender rules, stamp duty and GST can lower this.`, '/calculators/home', 'Check the true cost →') : null,
      s.goals.length
        ? row('Goals', `${inr(s.goalSip)} a month`, s.goals.map((g) => `${g.name}: ${inrShort(g.target)} in ${g.years} years needs ${inr(g.sip)} a month`).join('; ') + '.', '/calculators/goal', 'Plan a goal →')
        : row('Goals', 'Add your first', 'A child’s education, a house, retirement: say what and when, and see the SIP that gets there.', '/calculators/goal', 'Plan a goal →'),
      s.emergency.fund > 0 ? row('Emergency fund', `${s.emergency.monthsCovered.toFixed(1)} months`, `${inr(s.emergency.fund)} against a take-home of ${inr(th.monthly)}; six months is the usual floor.`, null) : null,
    ];
    const range = el('input', { type: 'range', min: 0, max: 100, step: 10, value: equityPct, 'aria-label': 'Equity share' });
    range.addEventListener('input', () => { equityPct = +range.value; try { localStorage.setItem(EQ_KEY, String(equityPct)); } catch {} paint(getProfile()); });
    return el('div', { class: 'card snap' }, [
      el('div', { class: 'snap-head' }, [el('div', { class: 'snap-title' }, extrasOnly ? 'What else this salary means' : 'Your money at a glance'), el('div', { class: 'muted small' }, `On ${s.kind === 'salary' ? `a CTC of ${inr(s.ctc)}` : s.kind === 'business' ? `receipts of ${inr(s.business.receipts)}` : `a CTC of ${inr(s.ctc)} and receipts of ${inr(s.business.receipts)}`}. Every line opens the tool that works it out in full.`)]),
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
