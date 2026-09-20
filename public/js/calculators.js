import { inr, pct, el, debounce, setChildren, disclaimer, animateNumber, isBlankAfterReset, markBlankAfterReset, clearBlankAfterReset, beginPrompt } from './util.js';
import { lineChart, columnChart, shortINR } from './charts.js';
import { renderFundPanel } from './funds.js';
import { calcExportCard } from './calc-export-card.js';
import { setHandoff, takeHandoff, handoffNote, fill } from './handoff.js';
import { getProfile, updateProfile, onProfileChange } from './profile-store.js';
import { fromLoanInputs } from '../engine/profile.js';
import { attachSlider } from './amount-input.js';

let appData = null;
let currentCalc = null;

/** Remember a calculator's inputs in the browser and restore them next time. */
const CALC_STORE = 'taxcompass.calc.v1';
function remember(name, inputs) {
  let all; try { all = JSON.parse(localStorage.getItem(CALC_STORE) || '{}'); } catch { all = {}; }
  const saved = Array.isArray(all[name]) ? all[name] : [];
  inputs.forEach((inp, i) => {
    if (saved[i] != null && saved[i] !== '') { inp.value = saved[i]; if (inp.tagName === 'SELECT') inp.dispatchEvent(new Event('change')); }
  });
  const persist = () => {
    clearBlankAfterReset(name);
    let a; try { a = JSON.parse(localStorage.getItem(CALC_STORE) || '{}'); } catch { a = {}; }
    a[name] = inputs.map((x) => x.value);
    try { localStorage.setItem(CALC_STORE, JSON.stringify(a)); } catch {}
  };
  inputs.forEach((inp) => { inp.addEventListener('input', persist); inp.addEventListener('change', persist); });
}

// Formulas follow data/formulas.json. SIP uses the annuity-due form (instalment at start of month).

export function emi(P, annualRatePct, years) {
  const r = annualRatePct / 12 / 100;
  const n = Math.round(years * 12);
  if (n <= 0 || P <= 0) return { emi: 0, total: 0, interest: 0, n: 0, r };
  const e = r === 0 ? P / n : (P * r * Math.pow(1 + r, n)) / (Math.pow(1 + r, n) - 1);
  return { emi: e, total: e * n, interest: e * n - P, n, r };
}

function emiFor(balance, r, months) {
  if (months <= 0) return balance;
  return r === 0 ? balance / months : (balance * r * Math.pow(1 + r, months)) / (Math.pow(1 + r, months) - 1);
}

/**
 * Month-by-month loan simulator.
 * opts: { principal, annualRatePct, tenureMonths,
 *         stepUpPct      EMI rises by this % once a year (or)
 *         stepUpAmount   EMI rises by this many rupees once a year,
 *         lumpsum: {amount, atMonth}, annualPrepay (paid at the end of every year, from year startYear),
 *         annualPrepayStartYear, mode: 'reduce_tenure' | 'reduce_emi' }
 * Step-up always shortens tenure; `mode` only governs how prepayments are applied.
 */
export function simulateLoan(opts) {
  const { principal: P, annualRatePct, tenureMonths: N } = opts;
  const r = annualRatePct / 12 / 100;
  const stepUpPct = (opts.stepUpPct || 0) / 100;
  const stepUpAmount = opts.stepUpAmount || 0;
  const lump = opts.lumpsum || { amount: 0, atMonth: 0 };
  const annual = opts.annualPrepay || 0;
  const startYear = opts.annualPrepayStartYear || 1;
  const mode = opts.mode || 'reduce_tenure';
  const baseEmi = emiFor(P, r, N);

  let bal = P, cur = baseEmi, m = 0, totalInterest = 0, totalPaid = 0, totalPrepaid = 0, maxEmi = baseEmi;
  const years = [];
  let yr = { year: 1, principal: 0, interest: 0, prepaid: 0, emi: cur };
  const cap = N + 600;
  let insufficient = false;

  while (bal > 0.5 && m < cap) {
    m++;
    if (m > 1 && (m - 1) % 12 === 0) {
      if (stepUpPct > 0) cur *= 1 + stepUpPct;
      else if (stepUpAmount > 0) cur += stepUpAmount;
      yr.emi = cur;
    }
    const interest = bal * r;
    const pay = Math.min(cur, bal + interest);
    const principalPart = pay - interest;
    if (principalPart <= 0) { insufficient = true; break; }
    bal -= principalPart;
    totalInterest += interest; totalPaid += pay;
    yr.interest += interest; yr.principal += principalPart;
    maxEmi = Math.max(maxEmi, cur);

    let prepaid = 0;
    if (lump.amount > 0 && m === lump.atMonth) prepaid += Math.min(lump.amount, bal);
    if (annual > 0 && m % 12 === 0 && m / 12 >= startYear) prepaid += Math.min(annual, bal - prepaid);
    if (prepaid > 0) {
      bal -= prepaid; totalPaid += prepaid; totalPrepaid += prepaid; yr.prepaid += prepaid;
      if (mode === 'reduce_emi' && bal > 0.5 && N - m > 0) cur = emiFor(bal, r, N - m);
    }
    if (m % 12 === 0 || bal <= 0.5) {
      yr.balance = Math.max(0, bal);
      years.push(yr);
      yr = { year: years.length + 1, principal: 0, interest: 0, prepaid: 0, emi: cur };
    }
  }
  return { emi: baseEmi, finalEmi: cur, maxEmi, months: m, totalInterest, totalPaid, totalPrepaid, years, insufficient };
}

export function amortisationByYear(P, annualRatePct, years) {
  return simulateLoan({ principal: P, annualRatePct, tenureMonths: Math.round(years * 12) }).years;
}

export function lumpsumFV(P, annualRatePct, years) {
  const r = annualRatePct / 100;
  const fv = P * Math.pow(1 + r, years);
  return { fv, gain: fv - P, absReturn: P > 0 ? (fv - P) / P : 0 };
}

/**
 * SIP future value. Step up the instalment once a year by a percentage OR a fixed amount.
 * `lumpsums`: [{ amount, atYear }] one-off amounts added at the END of year atYear (0 = today,
 * before the first instalment). A lump sum with monthly = 0 is the plain lumpsum calculator.
 */
export function sipFV(monthly, annualRatePct, years, stepUpPct = 0, stepUpAmount = 0, lumpsums = []) {
  const i = annualRatePct / 12 / 100;
  let bal = 0, amt = monthly, invested = 0;
  const lumpAt = (y) => lumpsums.reduce((s, l) => s + (Math.round(+l.atYear || 0) === y && +l.amount > 0 ? +l.amount : 0), 0);
  const l0 = lumpAt(0); bal += l0; invested += l0;
  for (let y = 0; y < years; y++) {
    for (let m = 0; m < 12; m++) {
      bal = (bal + amt) * (1 + i);
      invested += amt;
    }
    const l = lumpAt(y + 1); bal += l; invested += l;
    if (stepUpPct > 0) amt *= 1 + stepUpPct / 100;
    else if (stepUpAmount > 0) amt += stepUpAmount;
  }
  return { fv: bal, invested, gain: bal - invested, finalMonthly: amt };
}

export function requiredSip(target, annualRatePct, years) {
  const i = annualRatePct / 12 / 100;
  const n = years * 12;
  if (n <= 0) return 0;
  if (i === 0) return target / n;
  return (target * i) / ((Math.pow(1 + i, n) - 1) * (1 + i));
}

// ---------- UI ----------

export function initCalculators(data) {
  appData = data;
  // A change to the shared profile made anywhere else rebuilds the calculator on screen so it pre-fills afresh.
  onProfileChange(debounce((p, source) => {
    if (currentCalc && source !== 'calc:' + currentCalc) mount(currentCalc);
  }, 200));
}

/** Called by the router for /calculators/<name>. */
export function showCalc(name) {
  const key = VIEWS[name] ? name : 'emi';
  if (key === currentCalc) return;
  currentCalc = key;
  document.querySelectorAll('#calc-tabs [data-calc]').forEach((b) => b.classList.toggle('active', b.dataset.calc === key));
  mount(key);
}
/** Render a view into the calculator body; the heavier views load their module on first use. */
function mount(key) {
  const body = document.getElementById('calc-body');
  const view = VIEWS[key]();
  if (typeof view.then === 'function') {
    body.replaceChildren(el('div', { class: 'skeleton calc-skeleton', 'aria-busy': 'true' }));
    view.then((node) => { if (currentCalc === key) body.replaceChildren(withReset(key, node)); }).catch((e) => { body.replaceChildren(el('div', { class: 'notice error' }, 'Could not load this calculator. ' + e.message)); });
  } else body.replaceChildren(withReset(key, view));
}

// What each calculator remembers in the browser. Reset clears only that; the shared profile is untouched,
// so anything a calculator pre-fills from the profile comes back after the reset.
const CALC_KEYS = {
  emi: { calc: ['emi', 'emi-price'] }, sip: { calc: ['sip'], keys: ['taxcompass.sip-lumps.v1'] }, goal: { calc: ['goal2'], keys: ['taxcompass.goal.v1'] },
  salary: { keys: ['taxcompass.salary.v1'] }, budget: { keys: ['taxcompass.budget.v1'] },
  'capital-gains': { keys: ['taxcompass.capgains.v1', 'taxcompass.broker.v1', 'taxcompass.capgains-mode.v1'] }, compare: { keys: ['taxcompass.compare.v1'] }, retirement: { keys: ['taxcompass.retirement.v1'] }, home: { keys: ['taxcompass.home.v1'] },
};
function resetCalc(key) {
  const spec = CALC_KEYS[key] || {};
  try {
    for (const k of spec.keys || []) localStorage.removeItem(k);
    if (spec.calc) {
      const all = JSON.parse(localStorage.getItem(CALC_STORE) || '{}');
      for (const c of spec.calc) delete all[c];
      localStorage.setItem(CALC_STORE, JSON.stringify(all));
    }
  } catch {}
  markBlankAfterReset(key);
  for (const c of spec.calc || []) markBlankAfterReset(c);
  currentCalc = null;
  showCalc(key);
}
/** Append a Reset button to the calculator's inputs card (or the view itself if it has none). */
function withReset(key, view) {
  const target = view.querySelector('.card.inputs') || view;
  target.append(el('div', { class: 'form-actions' }, el('button', { type: 'button', class: 'btn secondary', onclick: () => resetCalc(key) }, 'Reset')));
  return view;
}

function field(label, attrs, hint) {
  const input = el('input', { type: 'number', ...attrs });
  return { node: el('label', {}, [label, hint ? el('small', {}, hint) : null, input]), input };
}
function selectField(label, options, value, hint) {
  const input = el('select', {}, options.map(([v, t]) => el('option', { value: v, selected: v === value }, t)));
  return { node: el('label', {}, [label, hint ? el('small', {}, hint) : null, input]), input };
}
function stat(k, v, hi = false) {
  const val = el('div', { class: 'v' });
  animateNumber(val, `calc:${currentCalc}:${k}`, v);
  return el('div', { class: 'stat' + (hi ? ' hi' : '') }, [el('div', { class: 'k' }, k), val]);
}
const GREEN = '#1d6b3d', GOLD = '#b7861c', GREY = '#8a948e';
function splitBar(aLabel, a, bLabel, b) {
  const total = a + b || 1;
  return el('div', {}, [
    el('div', { class: 'legend' }, [
      el('span', {}, [el('i', { style: 'background:var(--accent)' }), `${aLabel} ${inr(a)}`]),
      el('span', {}, [el('i', { style: 'background:#c9a227' }), `${bLabel} ${inr(b)}`]),
    ]),
    el('div', { class: 'bar' }, [
      el('span', { class: 'a', style: `width:${(a / total) * 100}%` }),
      el('span', { class: 'b', style: `width:${(b / total) * 100}%` }),
    ]),
  ]);
}
function calcShell(inputs, out) {
  return el('div', { class: 'calc' }, [el('div', { class: 'card inputs' }, inputs), el('div', {}, out)]);
}
function months(n) {
  const y = Math.floor(n / 12), m = n % 12;
  return [y ? `${y} yr${y > 1 ? 's' : ''}` : '', m ? `${m} mo` : ''].filter(Boolean).join(' ') || '0 mo';
}
const v = (f) => +f.input.value || 0;
const RUPEE = '₹';

/** A "none / percent / amount" step-up control. Returns {node, mode(), value()} */
function stepUpControl(labelNoun) {
  const mode = selectField(`Step-up ${labelNoun}`, [
    ['none', 'No step-up'],
    ['pct', `Increase ${labelNoun} by a percentage every year`],
    ['amt', `Increase ${labelNoun} by a fixed amount every year`],
  ], 'none', `As your income grows, raise the ${labelNoun} once a year. Pick a percentage or an amount, not both.`);
  const pctF = field('Increase per year (%)', { value: 10, min: 0, max: 100, step: 1 });
  const amtF = field(`Increase per year (${RUPEE})`, { value: 1000, min: 0, step: 500 });
  pctF.node.hidden = true; amtF.node.hidden = true;
  const sync = () => { pctF.node.hidden = mode.input.value !== 'pct'; amtF.node.hidden = mode.input.value !== 'amt'; };
  mode.input.addEventListener('change', sync);
  return {
    node: el('div', { class: 'opts' }, [mode.node, pctF.node, amtF.node]),
    inputs: [mode.input, pctF.input, amtF.input],
    mode: () => mode.input.value,
    pct: () => (mode.input.value === 'pct' ? v(pctF) : 0),
    amount: () => (mode.input.value === 'amt' ? v(amtF) : 0),
  };
}

const VIEWS = {
  // Loaded on first use: each of these pulls in its own module (and the Excel helpers) only when opened.
  budget: () => import('./budget.js').then((m) => m.renderBudget(appData)),
  'capital-gains': () => import('./capgains.js').then((m) => m.renderCapitalGains(appData)),
  salary: () => import('./salary.js').then((m) => m.renderSalary(appData)),
  home: () => import('./home-buy.js').then((m) => m.renderHomeBuying(appData)),
  compare: () => import('./compare.js').then((m) => m.renderCompare(appData)),
  retirement: () => import('./retirement.js').then((m) => m.renderRetirement(appData)),
  goal: () => import('./goal.js').then((m) => m.renderGoal(appData)),

  emi() {
    let lastEmi = null;
    const P = field(`Loan amount (${RUPEE})`, { value: '', min: 0, step: 50000, placeholder: 'e.g. 5000000' });
    const R = field('Interest rate (% p.a.)', { value: 8.5, min: 0, step: 0.05 });
    const Y = field('Tenure (years)', { value: 20, min: 1, max: 40, step: 1 });
    attachSlider(P.input, { max: 50000000, step: 100000 }); attachSlider(R.input, { min: 0, max: 20, step: 0.05 }); attachSlider(Y.input, { min: 1, max: 30, step: 1 });
    // Optional: work the loan out from the price and the down payment, and estimate pre-EMI interest
    // if the bank releases it in stages while the home is being built.
    const PR = field(`Property price (${RUPEE})`, { value: '', min: 0, step: 100000, placeholder: 'optional' });
    const DP = field(`Down payment (${RUPEE})`, { value: '', min: 0, step: 100000, placeholder: 'optional' });
    const CM = field('Under construction: months until the last release', { value: '', min: 0, max: 120, step: 1, placeholder: '0 or blank = released in one go' }, 'the loan is released evenly over these months; you pay interest only on what is released, then the EMI starts');
    const syncFromPrice = () => { if (v(PR) > 0) { P.input.value = Math.max(0, Math.round(v(PR) - v(DP))); P.input.readOnly = true; P.input.title = 'price less down payment'; } else { P.input.readOnly = false; P.input.title = ''; } };
    const step = stepUpControl('EMI');

    const L = field(`Lump sum amount (${RUPEE})`, { value: 0, min: 0, step: 10000 }, 'leave 0 if none');
    const LM = field('Paid in month number', { value: 12, min: 1, step: 1 }, '12 = end of the first year, 24 = end of the second');
    const A = field(`Extra payment every year (${RUPEE})`, { value: 0, min: 0, step: 10000 }, 'e.g. from an annual bonus; leave 0 if none');
    const AS = field('Starting from year', { value: 1, min: 1, step: 1 });
    const M = selectField('After each prepayment, keep', [
      ['reduce_tenure', 'the same EMI and finish the loan sooner (recommended)'],
      ['reduce_emi', 'the same tenure and pay a lower EMI'],
    ], 'reduce_tenure');
    const out = el('div');
    const fundBox = el('div');
    let fundKey = '';

    const render = () => {
      const p = v(P), r = v(R), y = v(Y), n = Math.round(y * 12);
      if (!(p > 0)) { setChildren(out, [beginPrompt(v(PR) > 0 ? 'The down payment covers the whole price: there is no loan to plan.' : 'Enter the loan amount, or a property price and down payment, to begin.')]); fundKey = ''; return; }
      // pre-EMI while the loan is released evenly over the construction months
      const cm = Math.round(v(CM));
      const preEmi = cm > 0 ? Array.from({ length: cm }, (_, k) => (p * (k + 1) / cm) * (r / 1200)).reduce((s, x) => s + x, 0) : 0;
      const stepPct = step.pct(), stepAmt = step.amount();
      const hasStep = stepPct > 0 || stepAmt > 0;
      const hasLump = v(L) > 0, hasAnnual = v(A) > 0, hasPrepay = hasLump || hasAnnual;
      M.input.disabled = hasStep;
      const mode = hasStep ? 'reduce_tenure' : M.input.value;

      const base = simulateLoan({ principal: p, annualRatePct: r, tenureMonths: n });
      const scen = hasStep || hasPrepay ? simulateLoan({
        principal: p, annualRatePct: r, tenureMonths: n, stepUpPct: stepPct, stepUpAmount: stepAmt,
        lumpsum: { amount: v(L), atMonth: Math.round(v(LM)) }, annualPrepay: v(A), annualPrepayStartYear: Math.round(v(AS)) || 1, mode,
      }) : null;
      const show = scen || base;
      lastEmi = { p, r, y, base, scen, mode, stepPct, stepAmt, lump: v(L), lumpMonth: Math.round(v(LM)), annual: v(A), annualStart: Math.round(v(AS)) || 1, preEmi, cm, price: v(PR), down: v(DP) };
      const saved = scen ? base.totalInterest - scen.totalInterest : 0;
      const monthsSaved = scen ? base.months - scen.months : 0;

      const stats = [stat('Monthly EMI' + (hasStep ? ' (first year)' : ''), inr(base.emi), true)];
      if (v(PR) > 0) stats.push(stat('Loan = price − down payment', inr(p)));
      if (preEmi > 0) stats.push(stat(`Pre-EMI interest, ${cm} months`, inr(preEmi)));
      if (hasStep) stats.push(stat('EMI in the final year', inr(scen.maxEmi)));
      if (scen && mode === 'reduce_emi') stats.push(stat('EMI after prepayments', inr(scen.finalEmi)));
      stats.push(stat('Total interest', inr(show.totalInterest)));
      if (scen) stats.push(stat('Interest saved', inr(saved), saved > 0), stat('Loan closes in', months(scen.months)));
      else stats.push(stat('Total payment', inr(base.totalPaid)));

      // plain-English explanation of what was simulated
      const parts = [];
      if (stepPct > 0) parts.push(`raising the EMI by ${stepPct}% every year`);
      if (stepAmt > 0) parts.push(`raising the EMI by ${inr(stepAmt)} every year`);
      if (hasLump) parts.push(`paying a lump sum of ${inr(v(L))} in month ${Math.round(v(LM))}`);
      if (hasAnnual) parts.push(`paying an extra ${inr(v(A))} at the end of every year from year ${Math.round(v(AS)) || 1}`);
      const listJoin = (a) => (a.length <= 1 ? a.join('') : a.slice(0, -1).join(', ') + ' and ' + a[a.length - 1]);
      let sentence = null;
      if (scen) {
        sentence = mode === 'reduce_emi'
          ? `By ${listJoin(parts)}, while keeping the ${y}-year tenure, your EMI falls to ${inr(scen.finalEmi)} and you pay ${inr(saved)} less interest overall.`
          : `By ${listJoin(parts)}${hasPrepay ? ', while keeping the EMI unchanged after each prepayment' : ''}, the loan closes in ${months(scen.months)} instead of ${months(base.months)}. That is ${months(monthsSaved)} sooner and ${inr(saved)} less interest.`;
      }

      const head = ['Year', hasStep ? 'EMI' : null, 'Principal paid', 'Interest paid', hasPrepay ? 'Prepaid' : null, 'Balance at year end'].filter(Boolean);
      const rows = show.years.map((a) => el('tr', {}, [
        el('td', {}, a.year), hasStep ? el('td', {}, inr(a.emi)) : null, el('td', {}, inr(a.principal)), el('td', {}, inr(a.interest)),
        hasPrepay ? el('td', {}, a.prepaid ? inr(a.prepaid) : '—') : null, el('td', {}, inr(a.balance)),
      ]));

      const balanceSeries = [{ name: scen ? 'Plain EMI' : 'Outstanding balance', color: scen ? GREY : GREEN, dash: !!scen, points: [[0, p], ...base.years.map((a) => [a.year, a.balance])] }];
      if (scen) balanceSeries.push({ name: 'With your changes', color: GREEN, area: true, points: [[0, p], ...scen.years.map((a) => [a.year, a.balance])] });
      const charts = el('div', { class: 'chart-stack' }, [
        el('div', {}, [el('div', { class: 'viz-title' }, 'Outstanding balance over the years'), lineChart({ series: balanceSeries, xFormat: (x) => `Yr ${Math.round(x)}`, xTipFormat: (x) => `End of year ${Math.round(x)}`, height: 220, ariaLabel: 'Loan balance by year' })]),
        el('div', {}, [el('div', { class: 'viz-title' }, 'What each year\'s payments went to'), columnChart({ categories: show.years.map((a) => String(a.year)), series: [{ name: 'Principal', color: GREEN, values: show.years.map((a) => a.principal) }, { name: 'Interest', color: GOLD, values: show.years.map((a) => a.interest) }], xLabel: 'Year', height: 220 })]),
      ]);

      setChildren(out, [
        el('div', { class: 'stats' }, stats),
        sentence ? el('p', { class: 'explain' }, sentence) : null,
        splitBar('Principal', p, 'Interest', show.totalInterest),
        charts,
        scen ? el('div', { class: 'table-wrap' }, el('table', { class: 'compare compare-scen' }, [
          el('thead', {}, el('tr', {}, [el('th', {}, ''), el('th', {}, 'Plain EMI, no changes'), el('th', { class: 'on' }, hasStep && hasPrepay ? 'With step-up and prepayments' : hasStep ? 'With step-up EMI' : 'With prepayments')])),
          el('tbody', {}, [
            el('tr', {}, [el('td', {}, 'Loan closes in'), el('td', {}, months(base.months)), el('td', { class: 'on' }, months(scen.months))]),
            el('tr', {}, [el('td', {}, 'Total interest paid'), el('td', {}, inr(base.totalInterest)), el('td', { class: 'on' }, inr(scen.totalInterest))]),
            el('tr', {}, [el('td', {}, 'Total paid to the bank (EMIs + prepayments)'), el('td', {}, inr(base.totalPaid)), el('td', { class: 'on' }, inr(scen.totalPaid))]),
            el('tr', { class: 'total' }, [el('td', {}, 'Interest saved'), el('td', {}, '—'), el('td', { class: 'on' }, inr(saved))]),
          ]),
        ])) : null,
        !scen && base.totalInterest > p ? el('p', { class: 'notice warn' }, 'You will pay more in interest than the amount you borrowed. Try a step-up EMI or an extra payment every year on the left to see how much it saves.') : null,
        hasPrepay && !hasStep && mode === 'reduce_tenure' ? el('p', { class: 'muted' }, 'Keeping the EMI and finishing sooner almost always saves more interest than lowering the EMI. Change the last option on the left to compare.') : null,
        hasStep ? el('p', { class: 'muted' }, 'With a step-up EMI the loan always closes sooner, so the "lower EMI" option is switched off.') : null,
        scen && scen.insufficient ? el('p', { class: 'notice error' }, 'The EMI does not cover the interest with these inputs.') : null,
        el('h3', {}, 'Year-by-year schedule' + (scen ? ' (with your changes)' : '')),
        el('div', { class: 'table-wrap' }, el('table', { class: 'compare' }, [el('thead', {}, el('tr', {}, head.map((h) => el('th', {}, h)))), el('tbody', {}, rows)])),
        el('p', { class: 'muted' }, `Tax note: for a self-occupied home, interest up to ${RUPEE}2,00,000 is deductible in the old regime only. For a let-out home, interest is deductible in both regimes but a loss cannot be set off against salary in the new regime.`),
        el('div', { class: 'card next-steps' }, [
          el('h3', { style: 'margin-top:0' }, 'Compare with investing'),
          el('p', { class: 'muted small' }, scen ? `Prepaying saves ${inr(saved)} in interest, guaranteed. See what the same money might do in the market, with no guarantee, before you decide.` : 'Set a prepayment on the left to compare it with investing the same money, or plan what to do with the EMI once the loan is over.'),
          el('div', { class: 'btn-row' }, [
            hasAnnual ? el('a', { class: 'btn secondary', href: '/calculators/sip', onclick: () => setHandoff('sip', { monthly: Math.round(v(A) / 12), years: Math.round(base.months / 12), note: `the ${inr(v(A))} a year you would have prepaid, as a monthly SIP` }, 'emi') }, `Invest ${inr(v(A) / 12)} a month instead`) : null,
            hasLump ? el('a', { class: 'btn secondary', href: '/calculators/sip', onclick: () => setHandoff('sip', { amount: Math.round(v(L)), years: Math.round(base.months / 12), note: `the ${inr(v(L))} lump sum you would have prepaid` }, 'emi') }, `Invest the ${inr(v(L))} lump sum instead`) : null,
            el('a', { class: 'btn secondary', href: '/calculators/sip', onclick: () => setHandoff('sip', { monthly: Math.round(base.emi), years: 10, note: `your EMI of ${inr(base.emi)}, continued as a SIP after the loan closes` }, 'emi') }, `After the loan: SIP the ${inr(base.emi)} EMI`),
          ]),
        ]),
        fundBox,
        disclaimer(['loan', 'invest']),
      ]);

      const key = `${r}|${y}`;
      if (key !== fundKey) {
        fundKey = key;
        renderFundPanel(fundBox, {
          mode: 'exceeds', target: r, horizon: y,
          title: 'Invest instead of prepaying?',
          intro: `Prepaying returns exactly your loan rate of ${r}% a year, guaranteed and tax-free. These fund categories have typically returned more than that over ${y >= 5 ? 5 : 3}-year periods, but with losses along the way and taxes on gains. Lower risk first.`,
        });
      }
    };
    remember('emi', [P.input, R.input, Y.input, ...step.inputs, L.input, LM.input, A.input, AS.input, M.input]);
    remember('emi-price', [PR.input, DP.input, CM.input]);
    // Pre-fill from the first loan in the shared profile (a handoff from another tool wins over it);
    // edits to amount, rate or tenure write back to the profile.
    const loan = isBlankAfterReset('emi') ? null : getProfile().loans[0];
    if (loan && loan.outstanding > 0 && !(v(PR) > 0)) { P.input.value = Math.round(loan.outstanding); R.input.value = loan.rate; Y.input.value = Math.max(1, Math.round(loan.remainingMonths / 12)); }
    const emiHandoff = takeHandoff('emi');
    if (emiHandoff) {
      fill(R.input, +(+emiHandoff.values.ratePct).toFixed(2)); fill(Y.input, emiHandoff.values.years);
      if (emiHandoff.values.price > 0) { fill(PR.input, emiHandoff.values.price); fill(DP.input, emiHandoff.values.downPayment || 0); fill(CM.input, emiHandoff.values.constructionMonths || 0); }
      else fill(P.input, emiHandoff.values.principal);
    }
    syncFromPrice();
    [PR, DP, CM].forEach((f) => f.input.addEventListener('input', () => { syncFromPrice(); debounce(render, 80)(); }));
    const writeBack = debounce(() => updateProfile((p) => fromLoanInputs(p, { principal: v(P), ratePct: v(R), years: v(Y) }), 'calc:emi'), 300);
    [P, R, Y].forEach((f) => f.input.addEventListener('input', writeBack));
    [P, R, Y, L, LM, A, AS].forEach((f) => f.input.addEventListener('input', debounce(render, 80)));
    step.inputs.forEach((i) => { i.addEventListener('input', debounce(render, 80)); i.addEventListener('change', render); });
    M.input.addEventListener('change', render);
    render();
    return calcShell([
      emiHandoff ? handoffNote(emiHandoff.from, emiHandoff.values.note ? `Prefilled with ${emiHandoff.values.note}, from ` : undefined) : null,
      P.node, R.node, Y.node,
      el('div', { class: 'opts' }, [
        el('div', { class: 'opt-title' }, 'Buying a home?'),
        el('p', { class: 'opt-help' }, 'Enter the price and your down payment and the loan amount fills itself in. If the home is under construction, say how long the bank will take to release the whole loan.'),
        el('div', { class: 'two' }, [PR.node, DP.node]),
        CM.node,
      ]),
      step.node,
      el('div', { class: 'opts' }, [
        el('div', { class: 'opt-title' }, 'Prepay principal'),
        el('p', { class: 'opt-help' }, 'Paying extra towards the principal cuts the interest you owe. You can make a one-time lump sum payment, an extra payment every year, or both.'),
        el('div', { class: 'sub' }, [el('div', { class: 'sub-title' }, 'One-time lump sum'), el('div', { class: 'two' }, [L.node, LM.node])]),
        el('div', { class: 'sub' }, [el('div', { class: 'sub-title' }, 'Extra payment every year'), el('div', { class: 'two' }, [A.node, AS.node])]),
        M.node,
      ]),
    ], [out, calcExportCard('emi', () => lastEmi)]);
  },

  sip() {
    let lastSip = null;
    const A = field(`Monthly SIP (${RUPEE})`, { value: '', min: 0, step: 500, placeholder: 'e.g. 10000' }, 'leave empty or 0 if you are only investing lump sums');
    const R = field('Expected return (% p.a.)', { value: 12, min: 0, step: 0.5 });
    const Y = field('Years', { value: 10, min: 1, max: 50, step: 1 });
    attachSlider(A.input, { max: 200000, step: 500 }); attachSlider(R.input, { min: 0, max: 20, step: 0.5 }); attachSlider(Y.input, { min: 1, max: 40, step: 1 });
    const step = stepUpControl('SIP');
    // One-off amounts on top of the SIP: today, or at the end of a given year (a bonus, a maturing FD, a sale).
    const lumps = [];
    const lumpList = el('div', { class: 'rows' });
    const lumpsOf = () => lumps.map((l) => ({ amount: v(l.amt), atYear: v(l.yr) })).filter((l) => l.amount > 0);
    const LUMP_KEY = 'taxcompass.sip-lumps.v1';
    const persistLumps = () => { try { localStorage.setItem(LUMP_KEY, JSON.stringify(lumpsOf())); } catch {} };
    const addLump = (amount = 100000, atYear = 0) => {
      const amt = field(`Amount (${RUPEE})`, { value: amount, min: 0, step: 10000 });
      const yr = field('At end of year', { value: atYear, min: 0, max: 50, step: 1 }, '0 = invest it today');
      const entry = { amt, yr, row: null };
      entry.row = el('div', { class: 'lump-row' }, [amt.node, yr.node, el('button', { type: 'button', class: 'btn secondary small-btn', 'aria-label': 'Remove this lump sum', onclick: () => { lumps.splice(lumps.indexOf(entry), 1); entry.row.remove(); persistLumps(); render(); } }, 'Remove')]);
      lumps.push(entry);
      [amt, yr].forEach((f) => f.input.addEventListener('input', () => { persistLumps(); debouncedRender(); }));
      lumpList.append(entry.row);
    };
    const out = el('div');
    const fundBox = el('div');
    let fundKey = '';
    const render = () => {
      const a = v(A), r = v(R), y = v(Y), sp = step.pct(), sa = step.amount(), ls = lumpsOf();
      const lumpTotal = ls.reduce((s, l) => s + l.amount, 0);
      if (!(a > 0) && !(lumpTotal > 0)) { setChildren(out, [beginPrompt('Enter a monthly SIP, or add a lump sum, to begin.')]); fundKey = ''; return; }
      const at = (k, withStep) => sipFV(a, r, k, withStep ? sp : 0, withStep ? sa : 0, ls);
      const flat = at(y, false);
      const stepped = sp > 0 || sa > 0 ? at(y, true) : null;
      const main = stepped || flat;
      const sipOnly = sipFV(a, r, y, sp, sa);
      const yrs = Array.from({ length: y + 1 }, (_, k) => k);
      lastSip = { a, r, y, sp, sa, lumps: ls, main, flat, sipOnly, series: yrs.map((k) => { const s = at(k, !!stepped); return { year: k, invested: s.invested, fv: s.fv }; }) };
      const series = [
        { name: 'Amount invested', color: GREY, dash: true, points: yrs.map((k) => [k, at(k, !!stepped).invested]) },
        { name: stepped ? 'Value with step-up' : 'Value', color: GREEN, area: true, points: yrs.map((k) => [k, at(k, !!stepped).fv]) },
      ];
      if (stepped) series.splice(1, 0, { name: 'Value, flat SIP', color: GOLD, points: yrs.map((k) => [k, at(k, false).fv]) });
      const what = a > 0 && lumpTotal > 0 ? `a ${inr(a)} SIP plus ${inr(lumpTotal)} in lump sums` : a > 0 ? `a ${inr(a)} SIP` : `${inr(lumpTotal)} invested as lump sums`;
      setChildren(out, [
        el('div', { class: 'stats' }, [
          stat('Projected value', inr(main.fv), true),
          stat('Amount invested', inr(main.invested)),
          stat('Wealth gained', inr(main.gain)),
          stepped ? stat('SIP in the final year', inr(sp > 0 ? main.finalMonthly / (1 + sp / 100) : main.finalMonthly - sa)) : lumpTotal > 0 && a > 0 ? stat('Lump sums add', inr(main.fv - sipOnly.fv)) : null,
        ]),
        splitBar('Invested', main.invested, 'Gains', main.gain),
        el('div', { class: 'viz-title' }, 'How it grows'),
        lineChart({ series, xFormat: (x) => `Yr ${Math.round(x)}`, xTipFormat: (x) => `After ${Math.round(x)} years`, height: 240, ariaLabel: 'SIP growth by year' }),
        el('p', { class: 'explain' }, `Over ${y} years at ${r}% a year, ${what} grows to about ${inr(main.fv)}, of which ${inr(main.gain)} is growth.${stepped ? ` A flat SIP would reach ${inr(flat.fv)}; stepping it up ${sp > 0 ? `${sp}%` : inr(sa)} every year adds ${inr(stepped.fv - flat.fv)} for ${inr(stepped.invested - flat.invested)} more invested.` : ''}${lumpTotal > 0 && a > 0 ? ` The lump sums alone account for ${inr(main.fv - sipOnly.fv)} of the final value.` : ''}`),
        el('p', { class: 'muted' }, 'Instalments are assumed at the start of each month (annuity-due), the convention most Indian SIP calculators use; lump sums earn from the end of the year you add them, and everything compounds monthly at the annual rate divided by 12. Returns are illustrative and not guaranteed.'),
        fundBox,
        disclaimer('invest'),
      ]);
      const key = `${r}|${y}`;
      if (key !== fundKey) {
        fundKey = key;
        renderFundPanel(fundBox, {
          mode: 'near', target: r, horizon: y,
          title: `What has historically delivered about ${r}% a year?`,
          intro: `Fund categories whose typical ${y >= 5 ? '5' : '3'}-year rolling return sits close to the ${r}% you assumed, with the worst and best stretches investors in them have actually lived through.${lumpTotal > 0 ? ' A lump sum is exposed to the timing of a single entry, so look hard at the worst window.' : ''}`,
        });
      }
    };
    const debouncedRender = debounce(render, 80);
    remember('sip', [A.input, R.input, Y.input, ...step.inputs]);
    try { for (const l of JSON.parse(localStorage.getItem(LUMP_KEY) || '[]')) addLump(l.amount, l.atYear); } catch {}
    // Pre-fill from the shared profile: the monthly surplus and the nearest goal's horizon.
    if (!isBlankAfterReset('sip')) { const p = getProfile(); if (p.cashflow.monthlySurplus > 0) A.input.value = Math.round(p.cashflow.monthlySurplus); if (p.horizon.goals[0]?.years > 0) Y.input.value = p.horizon.goals[0].years; }
    const handoff = takeHandoff('sip') || takeHandoff('lumpsum');
    if (handoff) {
      if (handoff.values.monthly != null) fill(A.input, handoff.values.monthly);
      if (handoff.values.amount > 0) { fill(A.input, 0); lumpList.replaceChildren(); lumps.length = 0; addLump(handoff.values.amount, 0); persistLumps(); }
      if (handoff.values.years) fill(Y.input, handoff.values.years);
    }
    [A, R, Y].forEach((f) => f.input.addEventListener('input', debouncedRender));
    step.inputs.forEach((i) => { i.addEventListener('input', debouncedRender); i.addEventListener('change', render); });
    render();
    return calcShell([
      handoff ? handoffNote(handoff.from, handoff.values.note ? `Prefilled with ${handoff.values.note}, from ` : undefined) : null,
      A.node, R.node, Y.node, step.node,
      el('div', { class: 'opts' }, [
        el('div', { class: 'opt-title' }, 'Lump sums on top'),
        el('p', { class: 'opt-help' }, 'A bonus, a maturing deposit or money you already have: add it today or at the end of any year, and it compounds alongside the SIP.'),
        lumpList,
        el('button', { type: 'button', class: 'btn secondary small-btn', onclick: () => { addLump(100000, 0); persistLumps(); render(); } }, '+ Add a lump sum'),
      ]),
    ], [out, calcExportCard('sip', () => lastSip)]);
  },

};
