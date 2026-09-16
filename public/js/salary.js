/**
 * In-hand salary calculator: CTC -> salary structure -> deductions -> monthly take-home,
 * using the tax engine for income tax under either regime.
 */
import { inr, pct, el, setChildren, disclaimer, animateNumber, isBlankAfterReset, clearBlankAfterReset, beginPrompt } from './util.js';
import { compareRegimes } from './tax-engine.js';
import { waterfallChart } from './charts.js';
import { setHandoff } from './handoff.js';
import { calcExportCard } from './calc-export-card.js';
import { getProfile, updateProfile } from './profile-store.js';
import { toSalaryStore, fromSalaryStore, isEmptyProfile } from '../engine/profile.js';

const SOURCE = 'calc:salary';

/**
 * p: { ctc, basicPct (of CTC), hraPct (of basic), includeEmployerPf, includeGratuity, employerNpsPct (of basic),
 *      professionalTax, city, rentPaid, other80c, nps1b, healthSelf, ageBand, regime: 'best'|'old'|'new', fy }
 */
export function salaryBreakdown(p, rates) {
  const ctc = Math.max(0, +p.ctc || 0);
  const basic = ctc * ((+p.basicPct || 0) / 100);
  const hra = basic * ((+p.hraPct || 0) / 100);
  const employerPf = p.includeEmployerPf === false ? 0 : 0.12 * basic;
  const gratuity = p.includeGratuity === false ? 0 : 0.0481 * basic;
  const employerNps = basic * ((+p.employerNpsPct || 0) / 100);
  const special = ctc - basic - hra - employerPf - gratuity - employerNps;
  if (special < 0) return { error: 'These percentages add up to more than the CTC. Reduce Basic, HRA or the employer contributions.' };
  const grossSalary = basic + hra + special; // what is paid to you through the year, before deductions
  const employeePf = 0.12 * basic;
  const professionalTax = Math.max(0, +p.professionalTax || 0);

  const inputs = {
    fy: p.fy || 'FY2026-27', ageBand: p.ageBand || 'below_60', resident: true,
    salary: { gross: grossSalary + employerNps, basicDa: basic, hraReceived: hra, rentPaid: +p.rentPaid || 0, city: p.city || 'Other', professionalTax },
    employer: { npsContribution: employerNps, isGovernment: false, totalRetirementContribution: employerPf + employerNps },
    deductions: { includeEpf: true, epfEmployee: employeePf, s80c: +p.other80c || 0, nps1b: +p.nps1b || 0, healthSelf: +p.healthSelf || 0 },
  };
  const cmp = compareRegimes(inputs, rates);
  const regime = p.regime === 'old' || p.regime === 'new' ? p.regime : (cmp.better === 'old' ? 'old' : 'new');
  const taxFor = (r) => cmp[r].tax.total;
  const inHandFor = (r) => grossSalary - employeePf - professionalTax - taxFor(r);
  const tax = taxFor(regime);
  const annual = inHandFor(regime);
  return {
    ctc, basic, hra, special, employerPf, gratuity, employerNps, grossSalary, employeePf, professionalTax,
    regime, tax, cmp, annual, monthly: annual / 12,
    inHandOld: inHandFor('old'), inHandNew: inHandFor('new'),
    takeHomePct: ctc ? annual / ctc : 0,
    inputs,
  };
}

const STORE = 'taxcompass.salary.v1';

export function renderSalary(data) {
  const rates = data.rates;
  let saved = {}; try { saved = JSON.parse(localStorage.getItem(STORE) || '{}'); } catch {}
  // The shared profile wins over this calculator's own memory whenever it has anything in it.
  const profile = getProfile();
  const fromProfile = isEmptyProfile(profile) || isBlankAfterReset('salary') ? {} : toSalaryStore(profile);
  const st = { ctc: '', basicPct: 40, hraPct: 50, includeEmployerPf: true, includeGratuity: true, employerNpsPct: 0, professionalTax: 2400, city: 'Other', rentPaid: 0, other80c: 0, nps1b: 0, healthSelf: 0, ageBand: 'below_60', regime: 'best', ...saved, ...fromProfile };
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
  const inputs = el('div', { class: 'card inputs' }, [
    field('ctc', 'Annual CTC (₹)', { step: 10000, placeholder: 'e.g. 1200000' }, 'cost to company, as on your offer letter'),
    el('div', { class: 'two' }, [field('basicPct', 'Basic as % of CTC', { step: 1 }, 'usually 35 to 50%'), field('hraPct', 'HRA as % of Basic', { step: 5 }, '50% in metros, 40% elsewhere')]),
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
    const steps = [
      { label: 'Cost to company', value: r.ctc, kind: 'start' },
      r.employerPf ? { label: 'Employer PF', value: r.employerPf, kind: 'minus' } : null,
      r.gratuity ? { label: 'Gratuity provision', value: r.gratuity, kind: 'minus' } : null,
      r.employerNps ? { label: 'Employer NPS', value: r.employerNps, kind: 'minus' } : null,
      { label: 'Gross salary paid to you', value: r.grossSalary, kind: 'total' },
      { label: 'Your PF contribution', value: r.employeePf, kind: 'minus' },
      r.professionalTax ? { label: 'Professional tax', value: r.professionalTax, kind: 'minus' } : null,
      { label: `Income tax (${r.regime} regime)`, value: r.tax, kind: 'minus' },
      { label: 'In hand for the year', value: r.annual, kind: 'total' },
    ].filter(Boolean);
    const otherRegime = r.regime === 'old' ? 'new' : 'old';
    const otherInHand = r.regime === 'old' ? r.inHandNew : r.inHandOld;
    setChildren(out, [
      el('div', { class: 'stats' }, [
        stat('Monthly in hand', inr(r.monthly), 'hi'),
        stat('Yearly in hand', inr(r.annual)),
        stat(`Income tax, ${r.regime} regime`, inr(r.tax)),
        stat('Take-home as % of CTC', pct(r.takeHomePct, 0)),
      ]),
      el('p', { class: 'explain' }, `Of a ${inr(r.ctc)} CTC, ${inr(r.grossSalary)} is paid to you as salary; the rest goes to your PF and gratuity. After your own PF, professional tax and ${inr(r.tax)} of income tax under the ${r.regime} regime, you take home about ${inr(r.monthly)} a month.${Math.abs(otherInHand - r.annual) > 1 ? ` Under the ${otherRegime} regime it would be ${inr(otherInHand / 12)} a month.` : ''}`),
      el('div', { class: 'card', style: 'padding:12px 14px;margin-bottom:12px' }, [el('div', { class: 'viz-title' }, 'From CTC to in-hand'), waterfallChart({ steps, max: r.ctc, color: '#1d6b3d' })]),
      el('div', { class: 'table-wrap' }, el('table', { class: 'compare' }, [
        el('thead', {}, el('tr', {}, [el('th', {}, 'Component'), el('th', {}, 'Per year'), el('th', {}, 'Per month')])),
        el('tbody', {}, [
          ['Basic', r.basic], ['HRA', r.hra], ['Special allowance', r.special], r.employerNps ? ['Employer NPS (in salary, deducted under 80CCD(2))', r.employerNps] : null,
          ['Gross salary', r.grossSalary, 'subtotal'],
          ['Less: your PF (12% of Basic)', -r.employeePf], r.professionalTax ? ['Less: professional tax', -r.professionalTax] : null, [`Less: income tax, ${r.regime} regime (TDS)`, -r.tax],
          ['In hand', r.annual, 'total'],
        ].filter(Boolean).map(([label, v, cls]) => el('tr', { class: cls || '' }, [el('td', {}, label), el('td', { class: v < 0 ? 'neg' : '' }, inr(v)), el('td', { class: v < 0 ? 'neg' : '' }, inr(v / 12))]))),
      ])),
      el('p', { class: 'muted small' }, `Employer PF ${inr(r.employerPf)} and gratuity ${inr(r.gratuity)} are yours but not paid monthly. HRA exemption${r.inputs.salary.rentPaid ? ' has been applied from the rent you entered' : ' needs the rent you pay; enter it above'}. Bonuses, variable pay, meal cards and other perquisites are not modelled; add them to CTC if they are paid in cash.`),
      el('div', { class: 'btn-row' }, [
        el('a', { class: 'btn', href: '/calculators/budget', onclick: () => setHandoff('budget', { income: Math.round(r.monthly) }, 'salary') }, `Plan a monthly budget with ${inr(r.monthly)}`),
        el('button', { type: 'button', class: 'btn secondary', onclick: () => openInTaxComparison(r) }, 'Open the full tax comparison with these figures'),
      ]),
      disclaimer('tax'),
    ]);
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
