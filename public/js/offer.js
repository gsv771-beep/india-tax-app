/**
 * Offer comparison: two offers (or your current job and an offer) side by side. What each puts in
 * the bank every month and in its first two years, and where the headline CTC overstates it.
 * Engine: engine/offer.js. Offer A starts from the CTC in the profile; nothing is written back.
 */
import { inr, inrShort, el, setChildren, disclaimer, debounce, isBlankAfterReset, clearBlankAfterReset, beginPrompt } from './util.js';
import { compareOffers, OFFER_DEFAULTS } from '../engine/offer.js';
import { getProfile } from './profile-store.js';
import { isEmptyProfile, ctcOf } from '../engine/profile.js';
import { attachSlider, enhanceMoneyInputs } from './amount-input.js';
import { resultLayout } from './result-layout.js';

const STORE = 'taxcompass.offer.v1';
const signed = (n) => `${n >= 0 ? '+' : '−'}${inr(Math.abs(n))}`;

export function renderOffer({ rates }) {
  const blank = isBlankAfterReset('offer');
  let saved = {}; try { saved = JSON.parse(localStorage.getItem(STORE) || '{}'); } catch {}
  const st = {
    a: { name: 'Current job', ...OFFER_DEFAULTS, ...(saved.a || {}) },
    b: { name: 'New offer', ...OFFER_DEFAULTS, ...(saved.b || {}) },
  };
  if (!saved.a && !blank) { const p = getProfile(); if (!isEmptyProfile(p) && ctcOf(p.income) > 0) st.a.ctc = Math.round(ctcOf(p.income)); }
  const save = () => { clearBlankAfterReset('offer'); try { localStorage.setItem(STORE, JSON.stringify(st)); } catch {} };
  const out = el('div');
  const rerender = debounce(() => paint(), 80);

  function column(key) {
    const o = st[key];
    const num = (field, label, attrs = {}, hint) => {
      const input = el('input', { type: 'number', min: attrs.min ?? 0, max: attrs.max, step: attrs.step || 1, value: o[field] === '' ? '' : o[field], placeholder: attrs.placeholder });
      input.addEventListener('input', () => { o[field] = input.value === '' ? '' : +input.value; save(); rerender(); });
      if (attrs.slider) attachSlider(input, attrs.slider);
      return el('label', {}, [el('span', { class: 'lbl' }, label), hint ? el('small', {}, hint) : null, input]);
    };
    const name = el('input', { type: 'text', maxlength: 30, value: o.name, 'aria-label': `Name for offer ${key.toUpperCase()}` });
    name.addEventListener('input', () => { o.name = name.value.trim() || (key === 'a' ? 'Current job' : 'New offer'); save(); rerender(); });
    const city = el('select', {}, [['metro', 'Metro: Mumbai, Delhi, Kolkata, Chennai'], ['other', 'Elsewhere, including Bengaluru, Pune, Hyderabad']].map(([v, t]) => el('option', { value: v, selected: o.city === v }, t)));
    city.addEventListener('change', () => { o.city = city.value; save(); paint(); });
    const pf = el('input', { type: 'checkbox' }); pf.checked = o.pfInCtc !== false;
    pf.addEventListener('change', () => { o.pfInCtc = pf.checked; save(); paint(); });
    return el('div', { class: `card inputs offer-col offer-${key}` }, [
      el('div', { class: 'offer-name' }, [el('span', { class: 'offer-tag' }, key.toUpperCase()), name]),
      num('ctc', 'CTC on the offer letter (₹ a year)', { step: 50000, placeholder: 'e.g. 2400000', slider: { max: 20000000, step: 50000 } }),
      el('div', { class: 'two' }, [
        num('variablePct', 'Variable pay (% of CTC)', { step: 1, max: 60 }, 'the target, inside the CTC'),
        num('payoutPct', 'You expect it to pay (%)', { step: 5, max: 200 }, 'of the target; 100 if unsure'),
      ]),
      num('joiningBonus', 'Joining bonus (₹, paid once)', { step: 25000, placeholder: '0' }, 'often repayable if you leave within a year'),
      el('label', {}, [el('span', { class: 'lbl' }, 'City'), city]),
      num('rentMonthly', 'Rent you will pay (₹ a month)', { step: 1000, placeholder: '0' }, 'for the HRA exemption in the old regime'),
      el('details', { class: 'opts fold' }, [
        el('summary', {}, 'Salary structure and year 2'),
        num('basicPct', 'Basic (% of CTC)', { step: 1, max: 80 }, '40% is common; check the annexure'),
        el('label', { class: 'check' }, [pf, 'Employer PF is inside the CTC (the usual case)']),
        num('hikePct', 'Hike you expect for year 2 (%)', { step: 1, max: 100 }, 'on the fixed pay'),
      ]),
    ]);
  }

  function paint() {
    const ready = +st.a.ctc > 0 && +st.b.ctc > 0;
    if (!ready) { setChildren(out, [beginPrompt(+st.a.ctc > 0 ? 'Now enter the other offer’s CTC.' : 'Enter the CTC of both offers.')]); return; }
    const r = compareOffers(st.a, st.b, rates);
    if (r.error) { setChildren(out, [el('div', { class: 'notice error' }, r.error)]); return; }
    const [A1, A2] = r.a, [B1, B2] = r.b, d = r.diff;
    const A = st.a.name, B = st.b.name;
    const twoYearWinner = d.twoYears >= 0 ? B : A, monthlyWinner = d.monthly >= 0 ? B : A;
    const stat = (k, v, cls = '') => el('div', { class: 'stat ' + cls }, [el('div', { class: 'k' }, k), el('div', { class: 'v' }, v)]);
    const pair = (a, b) => `A ${inr(a)} · B ${inr(b)}`;
    const split = Math.sign(d.twoYears) !== Math.sign(d.monthly) && Math.abs(d.monthly) * 12 > 12000;

    // where the headline CTC overstates what arrives, offer by offer
    const traps = [];
    for (const [o, y1] of [[st.a, A1], [st.b, B1]]) {
      if (y1.variableShortfall > 0) traps.push(`${o.name}: ${inr(y1.target)} of the CTC is variable pay; at ${o.payoutPct}% payout ${inr(y1.variableShortfall)} of it never arrives.`);
      if (y1.joining > 0) traps.push(`${o.name}: the ${inr(y1.joining)} joining bonus is year 1 only, taxed on top of your salary (${inr(y1.joiningTax)} of it goes in tax), and usually repaid if you leave within 12 months.`);
      if (o.pfInCtc === false) traps.push(`${o.name}: employer PF is paid on top of the CTC, so this offer saves ${inr(y1.employerPfOutside)} a year more for you than its CTC says.`);
    }
    traps.push(`Both: ${inr(A1.retirement)} and ${inr(B1.retirement)} a year of the CTC is PF and gratuity: yours, but saved, not paid. Gratuity is yours only after 5 years with the employer.`);

    const rows = [
      ['Headline CTC', (y) => y.ctc],
      ['Fixed pay', (y) => y.grossSalary],
      ['Variable pay you expect', (y) => y.expected],
      ['Joining bonus', (y) => y.joining],
      ['Your PF (12% of Basic)', (y) => -y.employeePf],
      ['Professional tax', (y) => -y.professionalTax],
      ['Income tax', (y) => -y.tax, (y) => `${y.regime} regime`],
      ['In the bank this year', (y) => y.cash, null, true],
      ['Each month, before lump sums', (y) => y.monthly],
      ['Saved for you: PF and gratuity', (y) => y.retirement],
    ];
    const table = (y1a, y1b, title) => el('div', {}, [
      el('div', { class: 'viz-title' }, title),
      el('div', { class: 'table-wrap' }, el('table', { class: 'compare offer-table' }, [
        el('thead', {}, el('tr', {}, [el('th', {}, ''), el('th', {}, A), el('th', {}, B), el('th', {}, 'Difference')])),
        el('tbody', {}, rows.map(([label, f, note, total]) => el('tr', { class: total ? 'total' : '' }, [
          el('td', {}, label), el('td', {}, [inr(f(y1a)), note ? el('small', { class: 'muted' }, ` ${note(y1a)}`) : null]),
          el('td', {}, [inr(f(y1b)), note ? el('small', { class: 'muted' }, ` ${note(y1b)}`) : null]), el('td', {}, signed(f(y1b) - f(y1a))),
        ]))),
      ])),
    ]);

    setChildren(out, resultLayout({
      key: 'offer',
      answer: [
        el('div', { class: 'stats' }, [
          stat('Each month', pair(A1.monthly, B1.monthly)),
          stat('Year 1 in the bank', pair(A1.cash, B1.cash)),
          stat('Two years together', `${twoYearWinner} by ${inrShort(Math.abs(d.twoYears))}`, 'hi'),
        ]),
        el('p', { class: 'explain' }, split
          ? `${twoYearWinner} puts ${inr(Math.abs(d.twoYears))} more in your bank over two years, but ${monthlyWinner} pays ${inr(Math.abs(d.monthly))} more every month. The difference is lump sums: variable pay and a joining bonus, the money least certain to arrive.`
          : `${twoYearWinner} puts ${inr(Math.abs(d.twoYears))} more in your bank over two years, and ${inr(Math.abs(d.monthly))} ${d.monthly >= 0 === (twoYearWinner === B) ? 'more' : 'less'} each month. The headline CTCs differ by ${inr(Math.abs(d.headline))}.`),
      ],
      why: [el('ul', { class: 'offer-why' }, traps.map((t) => el('li', {}, t)))],
      next: [
        { label: 'See each salary split in full', note: 'Basic, HRA, PF and tax for one CTC', href: `/calculators/salary?ctc=${Math.round(+st.b.ctc)}`, primary: true },
        { label: 'Would the old regime win with your deductions?', note: 'Rent, home loan, 80C and NPS', href: `/tax?ctc=${Math.round(+st.b.ctc)}` },
        { label: 'What the difference becomes if invested', note: 'Put the extra each month in a SIP', href: '/calculators/sip' },
      ],
      details: [
        table(A1, B1, 'Year 1, line by line'),
        table(A2, B2, `Year 2${+st.a.hikePct || +st.b.hikePct ? ', with the hikes you expect' : ''}: no joining bonus`),
        el('p', { class: 'muted small' }, 'Assumes the salary structure on the left (Basic as a share of the CTC, HRA half of Basic in a metro or 40% elsewhere, gratuity at 4.81% of Basic inside the CTC), ₹2,400 professional tax, age under 60, FY 2026-27 rates, and whichever regime is cheaper for each offer. Variable pay and the joining bonus are taxed with the year’s salary. Stock options and insurance are left out: value them separately.'),
      ],
      detailsLabel: 'Show both offers line by line, year 1 and year 2',
      foot: [disclaimer('tax')],
    }));
  }

  const inputs = el('div', { class: 'offer-inputs' }, [column('a'), column('b')]);
  enhanceMoneyInputs(inputs);
  paint();
  return el('div', { class: 'calc offer-calc' }, [inputs, out]);
}
