/**
 * In-hand salary calculator: CTC -> salary structure -> deductions -> monthly take-home,
 * using the tax engine for income tax under either regime.
 */
import { inr, pct, el, setChildren, disclaimer, animateNumber, isBlankAfterReset, clearBlankAfterReset, beginPrompt } from './util.js';
import { salaryBreakdown } from '../engine/salary-split.js';
import { setHandoff } from './handoff.js';
import { calcExportCard } from './calc-export-card.js';
import { getProfile, updateProfile } from './profile-store.js';
import { toSalaryStore, fromSalaryStore, isEmptyProfile } from '../engine/profile.js';
import { attachSlider, pctToggle, enhanceMoneyInputs } from './amount-input.js';
import { resultLayout } from './result-layout.js';

const SOURCE = 'calc:salary';

// the arithmetic lives in engine/salary-split.js so the edge can use it; re-exported for existing callers
export { salaryBreakdown };

const STORE = 'taxcompass.salary.v1';

export function renderSalary(data) {
  const rates = data.rates;
  let saved = {}; try { saved = JSON.parse(localStorage.getItem(STORE) || '{}'); } catch {}
  // The shared profile wins over this calculator's own memory whenever it has anything in it.
  const profile = getProfile();
  const fromProfile = isEmptyProfile(profile) || isBlankAfterReset('salary') ? {} : toSalaryStore(profile);
  const st = { ctc: '', basicPct: 40, hraPct: 50, conveyance: 0, variable: 0, variableInCtc: 'ctc', variableMonthly: 'yearly', includeEmployerPf: true, includeGratuity: true, employerNpsPct: 0, professionalTax: 2400, city: 'Other', rentPaid: 0, other80c: 0, nps1b: 0, healthSelf: 0, ageBand: 'below_60', regime: 'best', ...saved, ...fromProfile };
  const save = () => {
    clearBlankAfterReset('salary');
    try { localStorage.setItem(STORE, JSON.stringify(st)); } catch {}
    if (!(+st.ctc > 0)) return;
    const r = salaryBreakdown(st, rates);
    if (!r.error) updateProfile((p) => fromSalaryStore(p, st, r), SOURCE);
  };

  const field = (key, label, attrs = {}, hint) => {
    let input;
    if (attrs.options) input = el('select', {}, attrs.options.map(([v, t]) => el('option', { value: v, selected: String(v) === String(st[key]) }, t)));
    else if (attrs.type === 'checkbox') { input = el('input', { type: 'checkbox' }); input.checked = !!st[key]; }
    else input = el('input', { type: 'number', min: 0, step: attrs.step || 1, value: st[key], placeholder: attrs.placeholder });
    input.addEventListener(attrs.options || attrs.type === 'checkbox' ? 'change' : 'input', () => { st[key] = attrs.type === 'checkbox' ? input.checked : input.value; save(); render(); });
    return attrs.type === 'checkbox' ? el('label', { class: 'check' }, [input, label]) : el('label', {}, [label, hint ? el('small', {}, hint) : null, input]);
  };
  const out = el('div');
  let last = null;
  const exportCard = calcExportCard('salary', () => last);
  const variableField = field('variable', 'Variable pay or bonus per year (₹)', { step: 10000 }, 'target amount; 0 if none');
  const ctcField = field('ctc', 'Annual CTC (₹)', { step: 10000, placeholder: 'e.g. 1200000' }, 'cost to company, as on your offer letter');
  attachSlider(ctcField.querySelector('input'), { max: 100000000, step: 50000 });
  pctToggle({ input: variableField.querySelector('input'), baseInput: ctcField.querySelector('input'), defaultPct: 10, name: 'salary.variable', hint: 'CTC', max: 60 });
  const inputs = el('div', { class: 'card inputs' }, [
    ctcField,
    el('div', { class: 'two' }, [field('basicPct', 'Basic as % of CTC', { step: 1 }, 'usually 35 to 50%'), field('hraPct', 'HRA as % of Basic', { step: 5 }, '50% in metros, 40% elsewhere')]),
    field('conveyance', 'Conveyance allowance per year (₹)', { step: 1000 }, 'taxable since 2018; it only changes the break-up'),
    variableField,
    el('div', { class: 'two' }, [
      field('variableInCtc', 'Variable pay is', { options: [['ctc', 'Part of my CTC'], ['top', 'Paid on top of my CTC']] }),
      field('variableMonthly', 'Paid', { options: [['yearly', 'Once a year, separately'], ['monthly', 'Every month with salary']] }),
    ]),
    el('div', { class: 'opts' }, [
      el('div', { class: 'opt-title' }, 'Inside the CTC'),
      field('includeEmployerPf', 'Employer PF at 12% of Basic is part of my CTC', { type: 'checkbox' }),
      field('includeGratuity', 'Gratuity provision (4.81% of Basic) is part of my CTC', { type: 'checkbox' }),
      field('employerNpsPct', 'Employer NPS as % of Basic', { step: 1 }, '0 if none; up to 14% is deductible in both regimes'),
    ]),
    el('div', { class: 'opts' }, [
      el('div', { class: 'opt-title' }, 'Tax details'),
      el('div', { class: 'two' }, [field('city', 'City', { options: ['Other', 'Delhi', 'Mumbai', 'Kolkata', 'Chennai', 'Bengaluru', 'Hyderabad', 'Pune', 'Ahmedabad'].map((c) => [c, c]) }), field('rentPaid', 'Annual rent paid (₹)', { step: 1000 })]),
      field('professionalTax', 'Professional tax per year (₹)', { step: 100 }, 'about ₹2,400 to ₹2,500 in most states; 0 where not levied'),
      el('div', { class: 'two' }, [field('other80c', 'Other 80C investments (₹)', { step: 1000 }, 'beyond EPF'), field('nps1b', 'Own NPS, 80CCD(1B) (₹)', { step: 1000 })]),
      el('div', { class: 'two' }, [field('healthSelf', 'Health insurance premium (₹)', { step: 500 }), field('ageBand', 'Age', { options: [['below_60', 'Below 60'], ['senior_60_to_79', '60 to 79'], ['super_senior_80_plus', '80 and above']] })]),
      field('regime', 'Tax regime for TDS', { options: [['best', 'Whichever is lower (recommended)'], ['new', 'New regime'], ['old', 'Old regime']] }),
    ]),
  ]);

  function render() {
    if (!(+st.ctc > 0)) { setChildren(out, [beginPrompt('Enter your annual CTC to begin.')]); return; }
    const r = salaryBreakdown(st, rates);
    if (r.error) { setChildren(out, [el('div', { class: 'notice warn' }, r.error)]); return; }
    last = { st: { ...st }, r };
    const stat = (k, v, cls = '') => { const val = el('div', { class: 'v' }); animateNumber(val, 'salary:' + k, v); return el('div', { class: 'stat ' + cls }, [el('div', { class: 'k' }, k), val]); };
    const otherRegime = r.regime === 'old' ? 'new' : 'old';
    const otherInHand = r.regime === 'old' ? r.inHandNew : r.inHandOld;
    const breakup = el('div', { class: 'table-wrap' }, el('table', { class: 'compare' }, [
      el('thead', {}, el('tr', {}, [el('th', {}, 'Component'), el('th', {}, 'Per year'), el('th', {}, 'Per month')])),
      el('tbody', {}, [
        ['Basic', r.basic], ['HRA', r.hra], r.conveyance ? ['Conveyance allowance', r.conveyance] : null, r.variable ? ['Variable pay', r.variable] : null, ['Special allowance (the balance)', r.special], r.employerNps ? ['Employer NPS (in salary, deducted under 80CCD(2))', r.employerNps] : null,
        ['Gross salary', r.grossSalary, 'subtotal'],
        ['Less: your PF (12% of Basic)', -r.employeePf], r.professionalTax ? ['Less: professional tax', -r.professionalTax] : null, [`Less: income tax, ${r.regime} regime (TDS)`, -r.tax],
        ['In hand', r.annual, 'total'],
      ].filter(Boolean).map(([label, v, cls]) => el('tr', { class: cls || '' }, [el('td', {}, label), el('td', { class: v < 0 ? 'neg' : '' }, inr(v)), el('td', { class: v < 0 ? 'neg' : '' }, inr(v / 12))]))),
    ]));
    setChildren(out, resultLayout({
      key: 'salary',
      answer: [
        el('div', { class: 'stats' }, [
          stat(r.variableApart ? 'Monthly in hand, fixed pay' : 'Monthly in hand', inr(r.monthly), 'hi'),
          stat('Yearly in hand', inr(r.annual)),
          stat(`Income tax, ${r.regime} regime`, inr(r.tax)),
          stat(r.variableInCtc ? 'Take-home as % of CTC' : 'Take-home as % of package', pct(r.takeHomePct, 0)),
        ]),
        el('p', { class: 'explain' }, `You take home about ${inr(r.monthly)} a month${r.variableApart ? ' from fixed pay' : ''}, ${pct(r.takeHomePct, 0)} of your ${r.variableInCtc ? 'CTC' : 'package'}.`),
      ],
      why: [
        el('p', {}, `Of a ${inr(r.ctc)} CTC, ${inr(r.grossSalary)} is paid to you as salary; employer PF of ${inr(r.employerPf)} and gratuity of ${inr(r.gratuity)} are yours but not paid monthly. From the salary come your own PF (${inr(r.employeePf)}), professional tax and ${inr(r.tax)} of income tax under the ${r.regime} regime.${Math.abs(otherInHand - r.annual) > 1 ? ` Under the ${otherRegime} regime you would take home ${inr(otherInHand / 12)} a month.` : ''}`),
        r.variableApart ? el('p', {}, `Variable pay of ${inr(r.variable)}${r.variableInCtc ? ' (carved out of the CTC)' : ` on top of the ${inr(r.ctc)} CTC, so the package is ${inr(r.totalPackage)}`} is kept out of the monthly figure because it is paid separately: about ${inr(r.variableNet)} of it reaches you after tax, when it is paid and to the extent targets are met.`) : null,
      ],
      next: [
        { label: 'Plan where it goes', note: `Put ${inr(r.monthly)} a month into a budget and see what is genuinely free`, href: '/calculators/budget', onclick: () => setHandoff('budget', { income: Math.round(r.monthly) }, 'salary'), primary: true },
        { label: 'Check the regime', note: 'Both regimes line by line, and what would flip the answer', onclick: () => openInTaxComparison(r) },
        { label: 'What home can this carry?', note: 'The true cost of buying, then the loan', href: '/calculators/home' },
      ],
      details: [
        breakup,
        el('p', { class: 'muted small' }, `Conveyance allowance is fully taxable (the ₹1,600 a month exemption ended in 2018, except for employees with a disability). HRA exemption${r.inputs.salary.rentPaid ? ' has been applied from the rent you entered' : ' needs the rent you pay; enter it above'}. Variable pay is split out of the tax in proportion to pay. Meal cards and other perquisites are not modelled; add them to the CTC if they are paid in cash.`),
      ],
      detailsLabel: 'Show the component-by-component working',
      foot: [disclaimer('tax')],
    }));
  }
  render();
  return el('div', { class: 'calc' }, [inputs, el('div', {}, [out, exportCard])]);
}

function openInTaxComparison(r) {
  const KEY = 'taxcompass.inputs.v1';
  let s; try { s = JSON.parse(localStorage.getItem(KEY) || 'null') || {}; } catch { s = {}; }
  const i = r.inputs;
  s.fy = i.fy; s.ageBand = i.ageBand; s.resident = true;
  s.salary = { ...(s.salary || {}), gross: Math.round(i.salary.gross), basicDa: Math.round(i.salary.basicDa), hraReceived: Math.round(i.salary.hraReceived), rentPaid: i.salary.rentPaid, city: i.salary.city, professionalTax: i.salary.professionalTax };
  s.employer = { ...(s.employer || {}), npsContribution: Math.round(i.employer.npsContribution), isGovernment: false, totalRetirementContribution: Math.round(i.employer.totalRetirementContribution) };
  s.deductions = { ...(s.deductions || {}), includeEpf: true, epfEmployee: Math.round(i.deductions.epfEmployee), s80c: i.deductions.s80c, nps1b: i.deductions.nps1b, healthSelf: i.deductions.healthSelf };
  try { localStorage.setItem(KEY, JSON.stringify(s)); } catch {}
  location.href = '/tax';
}
