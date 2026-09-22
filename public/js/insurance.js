/**
 * Protection: how much life cover you need, how much health cover, and what to do with a traditional
 * policy that is already running. Pre-fills from the profile (income, age, loans, goals, savings).
 * Engine: engine/insurance.js, rates from data/insurance.json.
 */
import { inr, el, setChildren, disclaimer, debounce, isBlankAfterReset, clearBlankAfterReset, beginPrompt } from './util.js';
import { lifeCover, healthCover, policyDecision } from '../engine/insurance.js';
import { getProfile } from './profile-store.js';
import { isEmptyProfile, grossSalaryOf, INVESTMENT_BUCKETS } from '../engine/profile.js';
import { attachSlider, enhanceMoneyInputs } from './amount-input.js';
import { calcExportCard } from './calc-export-card.js';

const STORE = 'taxcompass.insurance.v1';
const lakh = (n) => `₹${Math.round(n / 100000)} lakh`;

export function renderInsurance({ insurance }) {
  const p = getProfile();
  const blank = isBlankAfterReset('insurance');
  let saved = {}; try { saved = JSON.parse(localStorage.getItem(STORE) || '{}'); } catch {}
  const fromProfile = {};
  if (!blank && !isEmptyProfile(p)) {
    const income = Math.round(grossSalaryOf(p) + (p.business ? p.business.receipts * 0.5 : 0));
    if (income > 0) fromProfile.annualIncome = income;
    if (p.person.age > 0) fromProfile.age = p.person.age;
    const loans = p.loans.reduce((s, l) => s + (l.outstanding || 0), 0);
    if (loans > 0) fromProfile.loans = loans;
    const held = INVESTMENT_BUCKETS.reduce((s, b) => s + (p.investments[b] || 0), 0);
    if (held > 0) fromProfile.savings = held;
    const goals = p.horizon.goals.reduce((s, g) => s + (g.target || 0), 0);
    if (goals > 0) fromProfile.goalsTotal = goals;
    if (p.household.childrenAges.length || p.household.dependents) fromProfile.children = p.household.childrenAges.length;
    if (p.location.metro) fromProfile.metro = true;
  }
  const st = {
    annualIncome: '', age: '', retireAt: 60, monthlySpendOfFamily: '', loans: 0, goalsTotal: 0, savings: 0, existingCover: 0,
    realReturnPct: 3, smoker: false, adults: 2, children: 0, metro: false, existingBase: 0, employerCover: 0,
    hasPolicy: false, sumAssured: 1000000, annualPremium: 50000, termYears: 20, yearsPaid: 5, surrenderValue: 0, investReturnPct: 11,
    ...saved, ...fromProfile,
  };
  const save = () => { clearBlankAfterReset('insurance'); try { localStorage.setItem(STORE, JSON.stringify(st)); } catch {} };

  const out = el('div');
  let last = null;
  const exportCard = calcExportCard('insurance', () => last);
  const rerender = debounce(() => paint(), 80);
  const field = (key, label, attrs = {}, hint) => {
    let input;
    if (attrs.options) input = el('select', {}, attrs.options.map(([v, t]) => el('option', { value: v, selected: String(v) === String(st[key]) }, t)));
    else if (attrs.type === 'checkbox') { input = el('input', { type: 'checkbox' }); input.checked = !!st[key]; }
    else input = el('input', { type: 'number', min: attrs.min ?? 0, max: attrs.max, step: attrs.step || 1, value: st[key] === '' ? '' : st[key], placeholder: attrs.placeholder });
    const immediate = !!attrs.options || attrs.type === 'checkbox';
    input.addEventListener(immediate ? 'change' : 'input', () => {
      st[key] = attrs.type === 'checkbox' ? input.checked : attrs.options ? input.value : input.value === '' ? '' : +input.value;
      save(); immediate ? paint() : rerender();
    });
    const node = attrs.type === 'checkbox' ? el('label', { class: 'check' }, [input, label]) : el('label', {}, [label, hint ? el('small', {}, hint) : null, input]);
    if (attrs.slider) attachSlider(input, { max: attrs.slider, step: attrs.step || 1 });
    return { node, input };
  };

  const F = {
    income: field('annualIncome', 'Your income a year (₹)', { step: 100000, slider: 50000000, placeholder: 'e.g. 1800000' }, 'salary or business income, before tax'),
    age: field('age', 'Your age', { step: 1, max: 75, placeholder: 'e.g. 35' }),
    spend: field('monthlySpendOfFamily', 'What the household spends a month (₹)', { step: 5000, slider: 1000000 }, 'leave blank and 70% of income is used'),
    retireAt: field('retireAt', 'Cover needed until you are', { step: 1, max: 75 }, 'usually your retirement age'),
    loans: field('loans', 'Loans outstanding (₹)', { step: 100000, slider: 50000000 }),
    goals: field('goalsTotal', 'Goals still to fund (₹)', { step: 100000, slider: 50000000 }, 'education, weddings'),
    savings: field('savings', 'Savings and investments (₹)', { step: 100000, slider: 100000000 }),
    cover: field('existingCover', 'Life cover you already have (₹)', { step: 500000, slider: 100000000 }, 'term plans, employer cover, endowment sum assured'),
    smoker: field('smoker', 'I smoke or use tobacco', { type: 'checkbox' }),
    adults: field('adults', 'Adults', { step: 1, min: 1, max: 4 }),
    children: field('children', 'Children', { step: 1, max: 6 }),
    metro: field('metro', 'We live in a metro', { type: 'checkbox' }),
    existingBase: field('existingBase', 'Health policy you already hold (₹)', { step: 100000, slider: 20000000 }, 'your own, not the employer’s'),
    employerCover: field('employerCover', 'Employer health cover (₹)', { step: 100000, slider: 20000000 }, 'ends with the job'),
    hasPolicy: field('hasPolicy', 'I have an endowment, money-back or ULIP policy running', { type: 'checkbox' }),
    sumAssured: field('sumAssured', 'Sum assured (₹)', { step: 100000, slider: 20000000 }),
    annualPremium: field('annualPremium', 'Premium a year (₹)', { step: 5000, slider: 2000000 }),
    termYears: field('termYears', 'Policy term (years)', { step: 1, max: 40 }),
    yearsPaid: field('yearsPaid', 'Years already paid', { step: 1, max: 40 }),
    surrenderValue: field('surrenderValue', 'Surrender value today (₹)', { step: 10000, slider: 20000000 }, 'from the insurer; 0 and it is estimated'),
    investReturnPct: field('investReturnPct', 'What the money would earn elsewhere (% a year)', { step: 0.5, max: 20 }),
  };
  const policyBox = el('div', { class: 'opts' }, [
    el('div', { class: 'opt-title' }, 'A policy you already hold'),
    F.hasPolicy.node,
    el('div', { class: 'policy-fields' }, [
      el('div', { class: 'two' }, [F.sumAssured.node, F.annualPremium.node]),
      el('div', { class: 'two' }, [F.termYears.node, F.yearsPaid.node]),
      el('div', { class: 'two' }, [F.surrenderValue.node, F.investReturnPct.node]),
    ]),
  ]);
  const inputs = el('div', { class: 'card inputs' }, [
    el('div', { class: 'opts', style: 'border-top:0;padding-top:0' }, [
      el('div', { class: 'opt-title' }, 'You and your family'),
      el('div', { class: 'two' }, [F.income.node, F.age.node]),
      F.spend.node,
      el('div', { class: 'two' }, [F.adults.node, F.children.node]),
      el('div', { class: 'two' }, [F.metro.node, F.smoker.node]),
    ]),
    el('details', { class: 'opts fold' }, [
      el('summary', {}, 'What you already have (pre-filled from your profile)'),
      el('div', { class: 'two' }, [F.loans.node, F.goals.node]),
      el('div', { class: 'two' }, [F.savings.node, F.cover.node]),
      el('div', { class: 'two' }, [F.existingBase.node, F.employerCover.node]),
      el('div', { class: 'two' }, [F.retireAt.node, field('realReturnPct', 'Return above inflation on the payout (%)', { step: 0.5, max: 8 }, 'what the family could earn on the money, after inflation').node]),
    ]),
    policyBox,
  ]);

  function syncPolicy() { policyBox.querySelector('.policy-fields').hidden = !st.hasPolicy; }

  function paint() {
    syncPolicy();
    if (!(+st.annualIncome > 0) && !(+st.monthlySpendOfFamily > 0)) { setChildren(out, [beginPrompt('Enter your income to see how much cover your family would need.')]); last = null; return; }
    const life = lifeCover({ ...st, age: +st.age || 30 }, insurance);
    const health = healthCover({ age: +st.age || 30, adults: st.adults, children: st.children, metro: st.metro, existingBase: st.existingBase, employerCover: st.employerCover }, insurance);
    const policy = st.hasPolicy ? policyDecision(st, insurance) : null;
    last = { st: { ...st }, life, health, policy };
    const stat = (k, v, cls = '') => el('div', { class: 'stat ' + cls }, [el('div', { class: 'k' }, k), el('div', { class: 'v' }, v)]);
    const opt = policy ? policy.options.find((o) => o.id === policy.best) : null;
    setChildren(out, [
      el('div', { class: 'stats' }, [
        stat('Life cover you need', life.need > 0 ? inr(life.need) : 'none: you are covered', life.need > 0 ? 'hi' : ''),
        stat('Term premium, about', life.need > 0 ? `${inr(life.premium)} a year` : '—'),
        stat('Health cover to aim for', lakh(health.total)),
        stat('Health premium, about', `${inr(health.premium)} a year`),
      ]),
      life.need > 0
        ? el('p', { class: 'explain' }, `If your income stopped tomorrow, the family needs about ${inr(life.need)}: ${inr(life.replace)} a year of spending for the ${life.years} years to ${life.coverTo}, the loans, and the goals, less what you already hold. Term cover of that size costs roughly ${inr(life.premium)} a year at ${st.age || 30}${st.smoker ? ' as a smoker' : ''}, or ${life.pctOfIncome ? (life.pctOfIncome * 100).toFixed(1) : '0'}% of your income, and the premium is fixed for the whole term.`)
        : el('p', { class: 'explain' }, 'Your savings and the cover you already hold are enough to replace your income, clear the loans and fund the goals. Review it when a loan or a child arrives.'),
      el('div', { class: 'card next-steps' }, [
        el('h3', { style: 'margin-top:0' }, 'How the life cover was worked out'),
        el('div', { class: 'table-wrap' }, el('table', { class: 'compare' }, [
          el('tbody', {}, [...life.parts.map((x) => el('tr', {}, [el('td', {}, x.label), el('td', { class: x.sign < 0 ? 'neg' : '' }, (x.sign < 0 ? '−' : '') + inr(x.amount))])),
            el('tr', { class: 'total' }, [el('td', {}, 'Cover to buy'), el('td', {}, inr(life.need))])]),
        ])),
        el('ul', { class: 'levers' }, life.rules.map((t) => el('li', {}, t))),
      ]),
      el('div', { class: 'card next-steps' }, [
        el('h3', { style: 'margin-top:0' }, `Health: ${lakh(health.base)} base plus ${lakh(health.topUp)} super top-up`),
        el('p', {}, `For ${health.members} ${health.members === 1 ? 'person' : 'people'}${health.metro ? ' in a metro' : ''}, about ${inr(health.basePremium)} a year for the base and ${inr(health.topUpPremium)} for the top-up. A top-up sits above a deductible, which is why ${lakh(health.topUp)} of extra cover costs a fraction of the base.${health.employerCover > 0 ? ` Your employer's ${lakh(health.employerCover)} is useful while the job lasts, and is the deductible the top-up can sit on.` : ''}`),
        el('ul', { class: 'levers' }, health.rules.map((t) => el('li', {}, t))),
      ]),
      policy ? el('div', { class: 'card next-steps' }, [
        el('h3', { style: 'margin-top:0' }, `Your policy: ${opt.label.toLowerCase()}`),
        el('p', {}, `${inr(policy.premiumsPaid)} is already in and cannot be recovered, so the only question is what the ${policy.left} remaining premium${policy.left === 1 ? '' : 's'} do next. Valued at maturity, at ${st.investReturnPct}% elsewhere:`),
        el('div', { class: 'table-wrap' }, el('table', { class: 'compare' }, [
          el('thead', {}, el('tr', {}, [el('th', {}, 'Option'), el('th', {}, 'Worth at maturity'), el('th', {}, 'What it means')])),
          el('tbody', {}, policy.options.map((o) => el('tr', { class: o.id === policy.best ? 'total' : '' }, [el('td', {}, o.label + (o.id === policy.best ? ' ✓' : '')), el('td', {}, inr(o.atMaturity)), el('td', { class: 'small' }, o.why)]))),
        ])),
        policy.options[0].irr != null ? el('p', { class: 'muted small' }, `Paying on earns about ${(policy.options[0].irr * 100).toFixed(1)}% a year on the premiums still to be paid. That looks high because the early years are already sunk; it is not the return on the policy as a whole.`) : null,
        policy.taxNote ? el('div', { class: 'notice warn' }, policy.taxNote) : null,
        el('ul', { class: 'levers' }, policy.rules.map((t) => el('li', {}, t))),
      ]) : null,
      el('p', { class: 'muted small' }, 'Premiums here are indicative ranges for a healthy person buying online, not quotes: yours depends on medicals, smoking, occupation and insurer. Nothing on this page is sold to you, and no insurer pays to be here.'),
      el('div', { class: 'btn-row' }, [
        el('a', { class: 'btn secondary', href: '/tax' }, 'What the premiums save in tax (80C and 80D)'),
        el('a', { class: 'btn secondary', href: '/calculators/goal' }, 'Plan the goals this cover protects'),
      ]),
      disclaimer('invest'),
    ]);
  }
  paint();
  queueMicrotask(() => enhanceMoneyInputs(inputs));
  return el('div', { class: 'calc' }, [inputs, el('div', {}, [out, exportCard])]);
}
