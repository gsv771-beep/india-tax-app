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
import { setHandoff } from './handoff.js';

const STORE = 'taxcompass.offer.v1';
const signed = (n) => `${n >= 0 ? '+' : '−'}${inr(Math.abs(n))}`;

export function renderOffer({ rates }) {
  const blank = isBlankAfterReset('offer');
  let saved = {}; try { saved = JSON.parse(localStorage.getItem(STORE) || '{}'); } catch {}
  // the current job may pay a retention bonus rather than a joining one
  const st = {
    a: { name: 'Current job', ...OFFER_DEFAULTS, bonusKind: 'retention', ...(saved.a || {}) },
    b: { name: 'New offer', ...OFFER_DEFAULTS, ...(saved.b || {}) },
  };
  if (!saved.a && !blank) { const p = getProfile(); if (!isEmptyProfile(p) && ctcOf(p.income) > 0) st.a.ctc = Math.round(ctcOf(p.income)); }
  const save = () => { clearBlankAfterReset('offer'); try { localStorage.setItem(STORE, JSON.stringify(st)); } catch {} };
  const out = el('div');
  const rerender = debounce(() => paint(), 80);

  function column(key) {
    const o = st[key];
    // every figure gets a drag line and an Indian comma-grouped echo, attached once the label holds it
    const num = (field, label, attrs = {}, hint) => {
      const input = el('input', { type: 'number', min: attrs.min ?? 0, max: attrs.max, step: attrs.step || 1, value: o[field] === '' ? '' : o[field], placeholder: attrs.placeholder });
      input.addEventListener('input', () => { o[field] = input.value === '' ? '' : +input.value; save(); rerender(); });
      const node = el('label', {}, [el('span', { class: 'lbl' }, label), hint ? el('small', {}, hint) : null, input]);
      if (attrs.slider) attachSlider(input, attrs.slider);
      return node;
    };
    const select = (field, options, onChange) => {
      const sel = el('select', {}, options.map(([v, t]) => el('option', { value: v, selected: String(o[field]) === String(v) }, t)));
      sel.addEventListener('change', () => { o[field] = sel.value === 'true' ? true : sel.value === 'false' ? false : sel.value; save(); onChange ? onChange() : paint(); });
      return sel;
    };
    const check = (field, label) => {
      const box = el('input', { type: 'checkbox' }); box.checked = !!o[field];
      box.addEventListener('change', () => { o[field] = box.checked; save(); paint(); });
      return el('label', { class: 'check' }, [box, label]);
    };
    const name = el('input', { type: 'text', maxlength: 30, value: o.name, 'aria-label': `Name for offer ${key.toUpperCase()}` });
    name.addEventListener('input', () => { o.name = name.value.trim() || (key === 'a' ? 'Current job' : 'New offer'); save(); rerender(); });
    const pf = el('input', { type: 'checkbox' }); pf.checked = o.pfInCtc === true;
    pf.addEventListener('change', () => { o.pfInCtc = pf.checked; save(); paint(); });
    const bonusLabel = () => (o.bonusKind === 'retention' ? 'Retention bonus (₹, paid once)' : 'Joining bonus (₹, paid once)');
    const bonusField = num('joiningBonus', bonusLabel(), { step: 25000, placeholder: '0', slider: { max: 2000000, step: 25000 } }, 'counted in year 1; usually repaid if you leave early');
    const kind = select('bonusKind', [['joining', 'Joining bonus'], ['retention', 'Retention bonus']], () => { bonusField.querySelector('.lbl').textContent = bonusLabel(); paint(); });
    // the payout and where the variable pay sits only matter once there is some
    const variablePctField = num('variablePct', 'Variable pay (% of CTC)', { step: 1, max: 100, slider: { max: 50, step: 1 } }, 'the target; 0 if none');
    const variableMore = el('div', { class: 'offer-variable-more' }, [
      num('payoutPct', 'You expect it to pay (%)', { step: 5, max: 200, slider: { max: 150, step: 5 } }, 'of the target; 100 if unsure'),
      el('label', {}, [el('span', { class: 'lbl' }, 'Variable pay is'), select('variableOnTop', [['false', 'inside the CTC (the usual case)'], ['true', 'paid over and above the CTC']])]),
    ]);
    const syncVariable = () => { variableMore.hidden = !(+o.variablePct > 0); };
    variablePctField.querySelector('input').addEventListener('input', syncVariable);
    syncVariable();
    const variableBlock = el('div', { class: 'offer-sub' }, [variablePctField, variableMore]);
    return el('div', { class: `card inputs offer-col offer-${key}` }, [
      el('div', { class: 'offer-name' }, [el('span', { class: 'offer-tag' }, key.toUpperCase()), name]),
      num('ctc', 'CTC on the offer letter (₹ a year)', { step: 50000, placeholder: 'e.g. 2400000', slider: { max: 20000000, step: 50000 } }),
      variableBlock,
      el('div', { class: 'offer-sub' }, [
        el('label', {}, [el('span', { class: 'lbl' }, 'One-time bonus'), kind]),
        bonusField,
      ]),
      // the rest only matters to some offers: one fold, open when something in it is already filled
      el('details', { class: 'opts fold', open: +o.relocation > 0 || +o.stockPerYear > 0 || +o.rentMonthly > 0 || o.city !== 'metro' || +o.basicPct !== 40 || o.pfInCtc === true || +o.hikePct > 0 }, [
        el('summary', {}, key === 'a' ? 'More: stock, rent, structure' : 'More: relocation, stock, rent, structure'),
        key === 'a' ? null : el('div', { class: 'offer-sub' }, [
          num('relocation', 'Relocation allowance (₹, paid once)', { step: 10000, placeholder: '0', slider: { max: 500000, step: 10000 } }, 'year 1'),
          check('relocationBills', 'Reimbursed against bills, so not taxed'),
        ]),
        num('stockPerYear', 'Stock vesting each year (₹, ESOP or RSU)', { step: 25000, placeholder: '0', slider: { max: 5000000, step: 25000 } }, 'at today’s share price; taxed as salary when it vests; not cash'),
        el('label', {}, [el('span', { class: 'lbl' }, 'City'), select('city', [['metro', 'Metro: Mumbai, Delhi, Kolkata, Chennai'], ['other', 'Elsewhere, including Bengaluru, Pune, Hyderabad']])]),
        num('rentMonthly', 'Rent you will pay (₹ a month)', { step: 1000, placeholder: '0', slider: { max: 200000, step: 1000 } }, 'for the HRA exemption in the old regime'),
        num('basicPct', 'Basic (% of CTC)', { step: 1, max: 80, slider: { min: 20, max: 70, step: 1 } }, '40% is common; check the annexure'),
        el('label', { class: 'check' }, [pf, 'Employer PF and gratuity are inside this CTC (only if the offer letter says so)']),
        num('hikePct', 'Hike you expect for year 2 (%)', { step: 1, max: 100, slider: { max: 50, step: 1 } }, 'on the fixed pay'),
      ]),
    ]);
  }

  function paint() {
    const ready = +st.a.ctc > 0 && +st.b.ctc > 0;
    if (!ready) { setChildren(out, [beginPrompt(+st.a.ctc > 0 ? 'Now enter the other offer’s CTC.' : 'Enter the CTC of both offers.')]); return; }
    const r = compareOffers({ ...st.a, relocation: 0 }, st.b, rates);
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
      if (y1.variableShortfall > 0) traps.push(`${o.name}: ${inr(y1.target)} of variable pay${y1.variableOnTop ? ' on top of the CTC' : ' inside the CTC'}; at ${o.payoutPct}% payout ${inr(y1.variableShortfall)} of it never arrives.`);
      else if (y1.variableOnTop && y1.target > 0) traps.push(`${o.name}: the ${inr(y1.target)} variable pay is on top of the CTC, so the package is ${inr(y1.totalPackage)} if it pays in full.`);
      if (y1.bonus > 0) traps.push(y1.bonusKind === 'retention'
        ? `${o.name}: the ${inr(y1.bonus)} retention bonus is taxed on top of your salary (${inr(y1.bonusTax)} of it goes in tax), and is paid only if you stay to the date it names.`
        : `${o.name}: the ${inr(y1.bonus)} joining bonus is year 1 only, taxed on top of your salary (${inr(y1.bonusTax)} of it goes in tax), and usually repaid if you leave within 12 months.`);
      if (y1.relocation > 0) traps.push(y1.relocationTaxable > 0
        ? `${o.name}: the ${inr(y1.relocation)} relocation allowance is taxed as salary here. Reimbursed against actual moving bills it is usually tax-free: ask HR how they pay it.`
        : `${o.name}: the ${inr(y1.relocation)} relocation is reimbursed against bills, so it is not taxed.`);
      if (y1.stock > 0) traps.push(`${o.name}: ${inr(y1.stock)} of stock vests each year and is taxed as salary when it does (${inr(y1.stockTax)}), leaving ${inr(y1.stockNet)}, if the share price holds. It is not cash: unlisted ESOPs can take years to sell, or never.`);
      if (o.pfInCtc === true) traps.push(`${o.name}: employer PF and gratuity (${inr(y1.retirement - y1.employeePf)} a year) are carved out of this CTC, so less of it is paid as salary.`);
    }
    traps.push(`Both: ${inr(A1.retirement)} and ${inr(B1.retirement)} a year goes into PF and gratuity: yours, but saved, not paid. Gratuity is yours only after 5 years with the employer.`);

    const rows = [
      ['Headline CTC', (y) => y.ctc],
      ['Fixed pay', (y) => y.grossSalary],
      ['Variable pay you expect', (y) => y.expected, (y) => (y.variableOnTop ? 'on top' : '')],
      ['One-time bonus', (y) => y.bonus, (y) => (y.bonus ? y.bonusKind : '')],
      ['Relocation', (y) => y.relocation],
      ['Your PF (12% of Basic)', (y) => -y.employeePf],
      ['Professional tax', (y) => -y.professionalTax],
      ['Income tax on your pay', (y) => -y.tax, (y) => `${y.regime} regime`],
      ['In the bank this year', (y) => y.cash, null, true],
      ['Each month, before lump sums', (y) => y.monthly],
      ...(r.hasStock ? [['Stock vesting (not cash)', (y) => y.stock], ['Tax on the stock', (y) => -y.stockTax], ['With the stock, after its tax', (y) => y.cashWithStock, null, true]] : []),
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
      key: 'offer', whyOpen: true,
      answer: [
        el('div', { class: 'stats' }, [
          stat('Each month', pair(A1.monthly, B1.monthly)),
          stat('Year 1 in the bank', pair(A1.cash, B1.cash)),
          stat('Two years in cash', `${twoYearWinner} by ${inrShort(Math.abs(d.twoYears))}`, 'hi'),
          r.hasStock ? stat('Two years with stock', `${d.withStock >= 0 ? B : A} by ${inrShort(Math.abs(d.withStock))}`) : null,
        ]),
        el('p', { class: 'explain' }, split
          ? `${twoYearWinner} puts ${inr(Math.abs(d.twoYears))} more in your bank over two years, but ${monthlyWinner} pays ${inr(Math.abs(d.monthly))} more every month. The difference is lump sums: variable pay and one-time bonuses, the money least certain to arrive.`
          : `${twoYearWinner} puts ${inr(Math.abs(d.twoYears))} more in your bank over two years, and ${inr(Math.abs(d.monthly))} ${d.monthly >= 0 === (twoYearWinner === B) ? 'more' : 'less'} each month. The headline CTCs differ by ${inr(Math.abs(d.headline))}.`),
      ],
      why: [el('ul', { class: 'offer-why' }, traps.map((t) => el('li', {}, t)))],
      next: [
        { label: 'See each salary split in full', note: 'Basic, HRA, PF and tax for one CTC', href: `/calculators/salary?ctc=${Math.round(+st.b.ctc)}`, primary: true },
        { label: 'Would the old regime win with your deductions?', note: 'Rent, home loan, 80C and NPS', href: `/tax?ctc=${Math.round(+st.b.ctc)}` },
        { label: `Plan your savings on ${B}’s pay`, note: `${inr(B1.monthly)} a month into the savings calculator`, href: '/calculators/budget', onclick: () => setHandoff('budget', { income: Math.round(B1.monthly) }, 'offer') },
        { label: `Or on ${A}’s`, note: `${inr(A1.monthly)} a month`, href: '/calculators/budget', onclick: () => setHandoff('budget', { income: Math.round(A1.monthly) }, 'offer') },
      ],
      details: [
        table(A1, B1, 'Year 1, line by line'),
        table(A2, B2, `Year 2${+st.a.hikePct || +st.b.hikePct ? ', with the hikes you expect' : ''}: no one-time bonus or relocation`),
        el('p', { class: 'muted small' }, 'Assumes the salary structure on the left (Basic as a share of the CTC, HRA half of Basic in a metro or 40% elsewhere, employer PF and gratuity (4.81% of Basic) on top of the CTC unless you say otherwise), ₹2,400 professional tax, age under 60, FY 2026-27 rates, and whichever regime is cheaper for each offer. Variable pay, bonuses and taxable relocation are taxed with the year’s salary. Stock is taken at the value you enter, taxed as salary in the year it vests, and kept out of the cash figures; insurance and other benefits are left out.'),
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
