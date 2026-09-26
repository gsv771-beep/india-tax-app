import { compareRegimes, DEFAULT_FLAGS } from './tax-engine.js';
import { inr, pct, el, setPath, debounce, setChildren, animateNumber } from './util.js';
import { breakEven, headroom, whatIf, breakEvenCurve, taxDrivers, advanceTaxSchedule } from './tax-insights.js';
import { hasBusiness, businessIncome } from './tax-engine.js';
import { attachSlider, pctToggle, enhanceMoneyInputs } from './amount-input.js';
import { rememberFold } from './result-layout.js';
import { emailWorkbookCard } from './email-card.js';
import { lineChart, shortINR } from './charts.js';
import { shareCard } from './share-card.js';
import { termify } from './tooltips.js';
import { countEvent } from './feedback.js';
import { getProfile, updateProfile, onProfileChange } from './profile-store.js';
import { toTaxInputs, fromTaxInputs, isEmptyProfile, clearSalary } from '../engine/profile.js';

const OLD_COLOR = '#b7861c', NEW_COLOR = '#1d6b3d';
const FY_SHORT = { 'FY2026-27': 'FY 2026-27', 'FY2025-26': 'FY 2025-26' };

const STORAGE_KEY = 'taxcompass.inputs.v1';
let lastInputs = null;
const extras = { s80c: 0, nps1b: 0, health: 0 }; // what-if slider state, survives re-renders

export function initTax({ rates, onboarding }) {
  const form = document.getElementById('tax-form');
  const flags = { ...DEFAULT_FLAGS };

  restore(form);
  applyProfile(form, getProfile(), { initial: true });
  // a drag line under the salary, and ₹ | % switches for the two figures people know as a share
  { const gross = form.querySelector('[data-path="salary.gross"]'), basic = form.querySelector('[data-path="salary.basicDa"]'), empNps = form.querySelector('[data-path="employer.npsContribution"]');
    attachSlider(gross, { max: 100000000, step: 50000 });
    pctToggle({ input: basic, baseInput: gross, defaultPct: 40, name: 'tax.basic', hint: 'gross salary', defaultMode: 'pct' });
    // employer NPS: rupees by default and zero, because most people have none; % is there for those who do
    pctToggle({ input: empNps, baseInput: basic, defaultPct: 0, name: 'tax.employerNps.v3', hint: 'Basic + DA', max: 30, defaultMode: 'inr' }); }
  enhanceMoneyInputs(form);
  syncSalaryBalance(form);
  form.addEventListener('input', () => syncSalaryBalance(form));
  document.getElementById('tax-email').replaceChildren(emailWorkbookCard({
    title: 'Save this comparison',
    intro: 'A formatted Excel workbook with the line-by-line comparison, the break-even analysis, and every figure you entered, so you can go through it with your CA.',
    source: 'tax',
    fileName: (who) => `taxcompass-tax-comparison-${String(who || '').replace(/[^a-z0-9]+/gi, '-').replace(/^-|-$/g, '').toLowerCase() || 'workbook'}-${new Date().toISOString().slice(0, 10)}.xlsx`,
    buildBase64: async (who) => (await import('./tax-export.js')).buildTaxWorkbookBase64(lastInputs, compareRegimes(lastInputs, rates, flags), rates, flags, who),
  }));
  // Every edit re-renders and writes the fields the shared profile owns back to it.
  const run = debounce(() => { const inputs = readForm(form); render(inputs, rates, flags); updateProfile((p) => fromTaxInputs(p, inputs), 'tax'); }, 120);
  form.addEventListener('input', run);
  form.addEventListener('change', run);
  initTopics(form, run);
  initIncomeType(form, run);
  rememberFold(document.getElementById('tax-working-fold'), 'tax');
  // Reset starts the page over: the form, and the salary and deductions it shares with the quick answer
  // above it (one step, so the Undo it announces restores both). A "Start over" in the quick answer
  // clears the profile itself and asks only for the form to follow.
  const clearForm = () => {
    form.reset();
    try { localStorage.removeItem(STORAGE_KEY); localStorage.removeItem(TOPICS_KEY); } catch {}
    syncTopics(form); syncIncomeType(form);
    render(readForm(form), rates, flags);
  };
  document.getElementById('tax-reset').addEventListener('click', () => { clearForm(); updateProfile(clearSalary, 'reset:tax'); });
  window.addEventListener('taxcompass:startover', clearForm);
  window.addEventListener('taxcompass:salarycleared', clearForm);
  // Edits made elsewhere (the profile panel, the salary calculator, a fixture) flow into the form.
  onProfileChange((p) => { applyProfile(form, p); syncTopics(form); syncIncomeType(form); render(readForm(form), rates, flags); }, 'tax');

  renderProvisionTable(onboarding);
  syncTopics(form);
  syncIncomeType(form);
  const first = readForm(form);
  render(first, rates, flags);
  // Existing users: a form saved before the shared profile existed seeds it once, and only once; a
  // profile emptied later (Reset, Start over, an emptied CTC box) must not be refilled from here.
  const SEEDED = 'taxcompass.tax-seeded.v1';
  let seeded = false; try { seeded = !!localStorage.getItem(SEEDED); localStorage.setItem(SEEDED, '1'); } catch {}
  if (!seeded && isEmptyProfile(getProfile()) && (first.salary?.gross > 0)) updateProfile((p) => fromTaxInputs(p, first), 'tax');
  // Professional tax and home-loan interest joined the profile later: a figure already typed on this
  // form is kept (applyProfile left it alone above) and becomes the profile's, so every tool agrees.
  else if (!isEmptyProfile(getProfile())) {
    const pt = first.salary?.professionalTax, hl = first.houseProperty?.selfOccupiedInterest;
    updateProfile((p) => {
      if (pt > 0) p.tax.professionalTax = pt;
      if (hl > 0 && !p.loans.some((l) => l.type === 'home' && l.propertyUse === 'self_occupied')) p.tax.homeLoanInterest = hl;
      return p;
    }, 'tax');
  }
}

// ---- the salary / business / both toggle ----
// Step 1 has three buttons writing to a hidden incomeType input; blocks marked data-for="salary" or
// data-for="business" show only for the matching type ('both' shows everything). Switching away from a
// type clears that type's figures so a hidden salary or hidden receipts never shape the result.
const SALARY_PATHS = ['salary.gross', 'salary.basicDa', 'salary.hraReceived', 'salary.conveyance', 'salary.variablePay', 'salary.variableOnTop', 'salary.ltaExempt', 'salary.professionalTax', 'deductions.epfEmployee', 'employer.npsContribution', 'employer.totalRetirementContribution', 'perquisites.other'];
const BUSINESS_PATHS = ['business.receipts', 'business.expenses', 'business.tdsDeducted'];
function initIncomeType(form, run) {
  form.querySelectorAll('[data-income-type]').forEach((b) => b.addEventListener('click', () => {
    const hidden = form.querySelector('[data-path="incomeType"]');
    const was = hidden.value, now = b.dataset.incomeType;
    if (was === now) return;
    hidden.value = now;
    const clear = (paths) => { for (const p of paths) { const f = form.querySelector(`[data-path="${p}"]`); if (f && f.type === 'number') f.value = ''; } };
    if (now === 'business') clear(SALARY_PATHS);
    if (now === 'salary') clear(BUSINESS_PATHS);
    syncIncomeType(form);
    hidden.dispatchEvent(new Event('input', { bubbles: true }));
    run();
  }));
  form.querySelector('[data-path="business.kind"]').addEventListener('change', () => syncIncomeType(form));
  form.querySelector('[data-path="business.presumptive"]').addEventListener('change', () => syncIncomeType(form));
}
/** Reflect the hidden value in the buttons and the blocks. Called after restore, profile apply and reset. */
function syncIncomeType(form) {
  const hidden = form.querySelector('[data-path="incomeType"]');
  const t = ['salary', 'business', 'both'].includes(hidden.value) ? hidden.value : 'salary';
  hidden.value = t;
  form.querySelectorAll('[data-income-type]').forEach((b) => { const on = b.dataset.incomeType === t; b.classList.toggle('on', on); b.setAttribute('aria-pressed', String(on)); });
  form.querySelectorAll('[data-for]').forEach((n) => { n.hidden = !(t === 'both' || n.dataset.for === t); });
  const kind = form.querySelector('[data-path="business.kind"]').value;
  const presumptive = form.querySelector('[data-path="business.presumptive"]').checked;
  form.querySelectorAll('[data-for-kind]').forEach((n) => { n.hidden = !(presumptive && n.dataset.forKind === kind); });
  form.querySelectorAll('[data-for-books]').forEach((n) => { n.hidden = presumptive; });
  const rentHint = form.querySelector('[data-rent-hint]');
  if (rentHint) rentHint.textContent = t === 'business' ? '80GG: least of ₹60,000, 25% of income, or rent less 10% of income; old regime only' : 'with HRA the exemption is worked out; without HRA, 80GG gives up to ₹60,000 (old regime)';
  // the tick boxes are worded for whoever is reading them: HRA, EPF and perks mean nothing to a shop owner
  const noSalary = t === 'business';
  const TOPIC_LABELS = {
    hra: noSalary ? '🏢 I pay rent (80GG)' : '🏢 I pay rent / get HRA',
    invest: noSalary ? '💹 80C investments, own NPS' : '💹 80C investments, NPS',
    more: noSalary ? '➕ Other deductions' : '➕ Other deductions and perks',
  };
  for (const [value, label] of Object.entries(TOPIC_LABELS)) {
    const span = form.querySelector(`#tax-topics input[value="${value}"]`);
    if (span) span.closest('label').querySelector('span').textContent = label;
  }
  const help = form.querySelector('#topics-help');
  if (help) help.textContent = noSalary
    ? 'Tick what applies and only those questions appear. Your receipts alone already give a real answer; business expenses and the TDS your clients deducted are in step 1 above.'
    : t === 'both'
      ? 'Tick what applies and only those questions appear. Nothing ticked is fine: the salary and receipts above already give a real answer.'
      : 'Tick what applies and only those questions appear. Nothing ticked is fine: salary alone gives a real answer.';
}

/** Business or profession: what is left to pay after TDS, the advance-tax calendar, and GST. */
function renderBusiness(inputs, cmp, rates, flags) {
  const box = document.getElementById('tax-business');
  if (!box) return;
  if (!hasBusiness(inputs) || (cmp.old.tax.totalIncome === 0 && cmp.new.tax.totalIncome === 0)) { box.replaceChildren(); return; }
  const regime = cmp.better === 'old' ? 'old' : 'new';
  const t = cmp[regime].tax;
  const bz = businessIncome(inputs, rates);
  const at = advanceTaxSchedule(inputs, rates, flags);
  const gst = (rates.business_income || {}).gst_registration;
  const gstLimit = gst ? (inputs.business.kind === 'business' ? gst.goods : gst.services) : 0;
  const cards = [];
  cards.push(el('div', { class: 'card biz' }, [
    el('h3', { style: 'margin-top:0' }, 'Running a business or practice'),
    el('div', { class: 'stats' }, [
      el('div', { class: 'stat' }, [el('div', { class: 'k' }, `Tax for the year (${regime} regime)`), el('div', { class: 'v' }, inr(t.total))]),
      el('div', { class: 'stat' }, [el('div', { class: 'k' }, 'TDS already deducted'), el('div', { class: 'v' }, inr(t.tdsDeducted || 0))]),
      t.refundDue > 0 ? el('div', { class: 'stat hi' }, [el('div', { class: 'k' }, 'Refund due to you'), el('div', { class: 'v' }, inr(t.refundDue))]) : el('div', { class: 'stat hi' }, [el('div', { class: 'k' }, 'Still to pay'), el('div', { class: 'v' }, inr(t.netPayable))]),
    ]),
    bz.presumptive && bz.receipts > 0 ? el('p', { class: 'muted small' }, `Presumptive scheme: income taken as ${inr(bz.income)} on receipts of ${inr(bz.receipts)}. If your real expenses are higher than the deemed ones, books of account would cut the tax; if lower, the scheme is a gift. ${bz.notes.length ? bz.notes.join(' ') : ''}`) : null,
    at ? el('div', {}, [
      el('h4', {}, at.presumptive ? 'Advance tax: one payment' : 'Advance tax calendar'),
      el('div', { class: 'table-wrap' }, el('table', { class: 'compare' }, [
        el('thead', {}, el('tr', {}, [el('th', {}, 'By'), el('th', {}, 'Pay'), el('th', {}, 'Cumulative')])),
        el('tbody', {}, at.rows.map((r) => el('tr', {}, [el('td', {}, r.due), el('td', {}, inr(r.instalment)), el('td', {}, `${inr(r.cumulative)} (${Math.round(r.cumulativePct * 100)}%)`)]))),
      ])),
      el('p', { class: 'muted small' }, at.note),
    ]) : el('p', { class: 'muted small' }, 'No advance tax is due: what is left to pay after TDS is under ₹10,000, or you are a resident senior without business income.'),
    gstLimit && bz.receipts > 0 ? el('p', { class: 'muted small' }, bz.receipts >= gstLimit ? `GST: receipts of ${inr(bz.receipts)} are above the ${inr(gstLimit)} registration threshold for ${inputs.business.kind === 'business' ? 'goods' : 'services'}, so GST registration and returns apply (separate from income tax).` : `GST: registration becomes compulsory above ${inr(gstLimit)} a year for ${inputs.business.kind === 'business' ? 'goods' : 'services'} (from the first rupee for inter-state goods or e-commerce sales); you are at ${inr(bz.receipts)}.`) : null,
    !bz.presumptive && bz.receipts > 0 ? el('details', { class: 'fold' }, [el('summary', {}, 'Expenses a practice or business can usually claim'), el('ul', { class: 'levers' }, ['Office or shop rent, electricity, internet and phone (the business share)', 'Staff salaries and contractor fees', 'Materials, stock and software subscriptions', 'Travel and vehicle running for work, with a log', 'Depreciation on laptop, equipment, furniture and vehicles', 'Professional fees: CA, lawyer, GST filing', 'Insurance for the business, bank charges, interest on a business loan', 'Membership and licence fees, books and training'].map((x) => el('li', {}, x))), el('p', { class: 'muted small' }, 'Keep invoices; personal spending is never deductible, and a mixed-use item is claimed in the business share only.')]) : null,
  ]));
  setChildren(box, cards);
}

// ---- progressive disclosure: topics ----
// Step 2 is a row of tick boxes; each topic-group of fields shows only when its topic is ticked. A topic
// ticks itself when any of its fields already holds a value (a saved form, the profile, a fixture), and
// unticking one clears its fields so a hidden number can never shape the result.
const TOPICS_KEY = 'taxcompass.tax-topics.v1';
const isCheck = (f) => f.type === 'checkbox';
const hasValue = (f) => (isCheck(f) ? f.checked !== f.defaultChecked : f.tagName === 'SELECT' ? f.selectedIndex > 0 : f.value !== '' && +f.value !== 0);
function topicBoxes(form) { return [...form.querySelectorAll('#tax-topics input[type=checkbox]')]; }
function initTopics(form, run) {
  let saved = []; try { saved = JSON.parse(localStorage.getItem(TOPICS_KEY) || '[]'); } catch {}
  for (const box of topicBoxes(form)) box.checked = saved.includes(box.value);
  form.querySelector('#tax-topics').addEventListener('change', (e) => {
    const box = e.target; if (!box.value) return;
    if (!box.checked) {
      for (const f of form.querySelectorAll(`[data-topic="${box.value}"] [data-path]`)) { if (isCheck(f)) f.checked = f.defaultChecked; else if (f.tagName === 'SELECT') f.selectedIndex = 0; else f.value = ''; }
      // a field in % mode would re-derive itself from its base; zero the percentage too
      for (const pctIn of form.querySelectorAll(`[data-topic="${box.value}"] .pct-input`)) { pctIn.value = 0; pctIn.dispatchEvent(new Event('input', { bubbles: false })); }
      run();
    }
    showTopics(form);
  });
  form.querySelector('#tax-topics-all').addEventListener('click', () => { for (const box of topicBoxes(form)) box.checked = true; showTopics(form); });
}
/** Tick every topic whose fields carry a value, then show/hide. Called after restore, profile apply and reset. */
/** Special allowance = gross less the named components; shown, never typed. */
function syncSalaryBalance(form) {
  const out = form.querySelector('[data-salary-balance]');
  if (!out) return;
  const v = (p) => +(form.querySelector(`[data-path="${p}"]`) || {}).value || 0;
  const onTop = (form.querySelector('[data-path="salary.variableOnTop"]') || {}).value === 'true';
  const variable = v('salary.variablePay');
  // a bonus paid on top raises the package rather than eating into the special allowance
  const total = v('salary.gross') + (onTop ? variable : 0);
  const rest = v('salary.basicDa') + v('salary.hraReceived') + v('salary.conveyance') + variable;
  const bal = total - rest;
  out.value = total > 0 ? Math.round(bal) : '';
  out.classList.toggle('neg', bal < 0);
  const echo = out.nextElementSibling;
  if (echo && echo.classList.contains('amount-echo')) {
    echo.textContent = total <= 0 ? ''
      : bal < 0 ? `the components exceed the pay by ${inr(Math.abs(Math.round(bal)))}: raise the gross, or mark the bonus as paid on top`
      : inr(Math.round(bal)) + (onTop && variable > 0 ? ` · total pay ${inr(Math.round(total))}` : '');
  }
}

function syncTopics(form) {
  for (const box of topicBoxes(form)) {
    const fields = [...form.querySelectorAll(`[data-topic="${box.value}"] [data-path]`)];
    if (fields.some(hasValue)) box.checked = true;
  }
  showTopics(form);
}
function showTopics(form) {
  const on = topicBoxes(form).filter((b) => b.checked).map((b) => b.value);
  for (const g of form.querySelectorAll('.topic-group')) g.hidden = !on.includes(g.dataset.topic);
  const details = form.querySelector('#tax-details');
  details.hidden = on.length === 0;
  const all = form.querySelector('#tax-topics-all');
  all.textContent = on.length === topicBoxes(form).length ? 'Every field is showing' : 'Show every field';
  try { localStorage.setItem(TOPICS_KEY, JSON.stringify(on)); } catch {}
}

// Fields the shared profile owns. Everything else on the form (capital gains, donations, parents' cover...) is the form's own.
const PROFILE_PATHS = ['fy', 'ageBand', 'incomeType', 'salary.gross', 'salary.basicDa', 'salary.hraReceived', 'salary.conveyance', 'salary.variablePay', 'salary.rentPaid', 'salary.city', 'salary.professionalTax', 'houseProperty.selfOccupiedInterest', 'employer.npsContribution', 'employer.totalRetirementContribution', 'deductions.s80c', 'deductions.nps1b', 'deductions.healthSelf', 'business.receipts', 'business.kind', 'business.presumptive', 'business.digitalSharePct', 'business.expenses', 'business.tdsDeducted'];

// Shared later than the rest: on first load a figure already typed here wins over the profile's default.
const TYPED_WINS_ON_LOAD = new Set(['salary.professionalTax', 'houseProperty.selfOccupiedInterest']);

function applyProfile(form, profile, { initial = false } = {}) {
  if (isEmptyProfile(profile)) return;
  const t = toTaxInputs(profile);
  // the profile's gross already contains the bonus, so the form must not add it a second time
  const onTop = form.querySelector('[data-path="salary.variableOnTop"]');
  if (onTop) onTop.value = 'false';
  const paths = [...PROFILE_PATHS];
  const home = profile.loans.filter((l) => l.type === 'home');
  if (home.some((l) => l.propertyUse === 'let_out')) paths.push('houseProperty.letOut.interest');
  for (const path of paths) {
    const field = form.querySelector(`[data-path="${path}"]`);
    if (!field) continue;
    if (initial && TYPED_WINS_ON_LOAD.has(path) && +field.value > 0) continue;
    const v = path.split('.').reduce((o, k) => (o == null ? undefined : o[k]), t);
    if (v === undefined) continue;
    if (field.type === 'checkbox') field.checked = !!v;
    else if (field.type === 'number') field.value = v ? String(Math.round(v)) : '';
    else field.value = String(v);
  }
}

function readForm(form) {
  const inputs = {};
  form.querySelectorAll('[data-path]').forEach((field) => {
    let v;
    if (field.type === 'checkbox') v = field.checked;
    else if (field.dataset.type === 'bool') v = field.value === 'true';
    else if (field.type === 'number') v = field.value === '' ? 0 : Number(field.value);
    else v = field.value;
    setPath(inputs, field.dataset.path, v);
  });
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(inputs)); } catch {}
  return inputs;
}

function restore(form) {
  let saved;
  try { saved = JSON.parse(localStorage.getItem(STORAGE_KEY) || 'null'); } catch { saved = null; }
  if (!saved) return;
  form.querySelectorAll('[data-path]').forEach((field) => {
    const v = field.dataset.path.split('.').reduce((o, k) => (o == null ? undefined : o[k]), saved);
    if (v === undefined) return;
    if (field.type === 'checkbox') field.checked = !!v;
    else if (field.type === 'number') field.value = v ? String(v) : '';
    else field.value = String(v);
  });
}

function render(inputs, rates, flags) {
  lastInputs = inputs;
  const result = compareRegimes(inputs, rates, flags);
  // a comparison counts only when the person is on this page; re-renders from profile edits elsewhere do not
  if ((result.new.tax.totalIncome > 0 || result.old.tax.totalIncome > 0) && !document.getElementById('tax').hidden) countEvent('compare');
  renderHeadline(result, inputs, rates, flags);
  renderWarnings(result);
  renderBusiness(inputs, result, rates, flags);
  renderNext(inputs, result);
  renderInsights(inputs, result, rates, flags);
  renderCharts(inputs, result, rates, flags);
  renderTable(result);
  renderWorking(result, rates);
  renderNotes(result);
}

// ---------- slab-wise working, marginal relief status, HRA working ----------

const fmtBand = (from, to) => (to == null ? `Above ${inr(from)}` : from === 0 ? `Up to ${inr(to)}` : `${inr(from + 1)} to ${inr(to)}`);

function slabWorking(regimeKey, r, rates) {
  const t = r.tax, isNew = regimeKey === 'new';
  const rows = [];
  const row = (label, amount, cls = '', note = null) => rows.push(el('tr', { class: cls }, [el('td', {}, note ? [label, el('div', { class: 'muted small' }, note)] : label), el('td', { class: typeof amount === 'number' && amount < 0 ? 'neg' : '' }, typeof amount === 'number' ? inr(amount) : amount)]));
  const group = (label) => rows.push(el('tr', { class: 'group' }, [el('td', { colspan: 2 }, label)]));

  group('Tax at slab rates on ' + inr(t.slabIncome));
  if (t.slabRows.length === 0) row('No slab-rate income', 0);
  for (const s of t.slabRows) {
    row(`${fmtBand(s.from, s.to)} at ${Math.round(s.rate * 100)}%`, s.tax, '', s.rate > 0 ? `${inr(s.amount)} × ${Math.round(s.rate * 100)}%` : `${inr(s.amount)}, nil rate`);
  }
  row('Tax at slab rates', t.slabTax, 'subtotal');

  const sp = t.specialParts;
  if (t.specialTax > 0) {
    group('Tax at special rates (not eligible for rebate)');
    if (sp.stcgEquity) row('Short-term gains on listed equity at 20%', sp.stcgEquity);
    if (sp.ltcgEquity) row('Long-term gains on listed equity at 12.5%, above the ₹1,25,000 exemption', sp.ltcgEquity);
    if (sp.ltcgOther) row('Long-term gains on other assets at 12.5%', sp.ltcgOther);
    if (sp.lottery) row('Lottery, gaming, crypto at 30%', sp.lottery);
    if (t.exemptionAdj > 0) row('Unused basic exemption set against gains first', `${inr(t.exemptionAdj)} of gains untaxed`);
    row('Tax at special rates', t.specialTax, 'subtotal');
  }

  const rr = t.rebateRule;
  group(`Rebate under s.87A / s.156 (total income up to ${inr(rr.threshold)})`);
  if (!rr.eligibleResident) {
    row('Rebate', 0, '', 'Not available: the rebate is for resident individuals only.');
  } else if (t.rebate > 0) {
    row(`Rebate: total income ${inr(t.totalIncome)} is within ${inr(rr.threshold)}`, -t.rebate, '', `Lower of slab-rate tax ${inr(t.slabTax)} and the cap ${inr(rr.max)}. Tax on special-rate income is not rebated.`);
  } else if (t.rebateRelief > 0) {
    const excess = t.totalIncome - rr.threshold;
    row('Marginal relief on the rebate: applies', -t.rebateRelief, 'better', `Total income exceeds ${inr(rr.threshold)} by ${inr(excess)}, but slab tax would be ${inr(t.slabTax)}. Tax is limited to the excess income, so relief of ${inr(t.rebateRelief)} brings slab tax down to ${inr(excess)}.`);
  } else if (t.totalIncome > rr.threshold) {
    const excess = t.totalIncome - rr.threshold;
    if (rr.marginalReliefAvailable) row('Marginal relief on the rebate: does not apply', 0, '', `Total income exceeds ${inr(rr.threshold)} by ${inr(excess)}, which is more than the slab tax of ${inr(t.slabTax)}. Relief applies only while slab tax exceeds the excess income, roughly up to ${inr(rr.threshold + 70588)} of total income in the new regime.`);
    else row('Rebate: not available', 0, '', `Total income ${inr(t.totalIncome)} is above ${inr(rr.threshold)}. The old-regime rebate has no marginal relief; it is a hard cut-off.`);
  } else {
    row('Rebate', 0, '', 'No slab-rate tax to rebate.');
  }
  row('Tax after rebate', t.taxBeforeSurcharge, 'subtotal');

  const scTable = isNew ? rates.surcharge.new_regime : rates.surcharge.old_regime;
  const firstThreshold = scTable[0].income_above;
  group('Surcharge');
  if (t.surcharge > 0) {
    const w = t.surchargeReliefWorking;
    row(`Surcharge at ${Math.round(t.scRate * 100)}%: total income is above ${inr(t.scThreshold)}`, t.surcharge, '', (sp.stcgEquity || sp.ltcgEquity || sp.ltcgOther) ? 'Surcharge on tax from capital gains and dividends is capped at 15%; the full rate applies to the rest.' : null);
    if (w && w.relief > 0) {
      row('Marginal relief on surcharge: applies', -w.relief, 'better', `Income exceeds the ${inr(w.threshold)} threshold by ${inr(w.excessIncome)}, but tax plus surcharge rises by ${inr(w.extraTax)} (from ${inr(w.taxAtThreshold)} to ${inr(w.taxAtActual)}). The rise is capped at the extra income, so relief of ${inr(w.relief)} is given.`);
    } else if (w) {
      row('Marginal relief on surcharge: does not apply', 0, '', `Income exceeds the ${inr(w.threshold)} threshold by ${inr(w.excessIncome)}; tax plus surcharge rises by only ${inr(w.extraTax)}, which is less than the extra income, so no relief is needed.`);
    }
  } else {
    row('No surcharge', 0, '', `Surcharge starts when total income exceeds ${inr(firstThreshold)}; yours is ${inr(t.totalIncome)}.`);
  }
  row('Tax plus surcharge', t.taxPlusSurcharge, 'subtotal');

  group('Health and education cess');
  row(`Cess at 4% of ${inr(t.taxPlusSurcharge)}`, t.cess, '', 'Cess is charged on tax plus surcharge, after every rebate and relief.');
  row('Total tax payable', t.total, 'total');

  return el('div', { class: 'working-col' }, [
    el('h4', { class: `working-head ${regimeKey}` }, regimeKey === 'old' ? 'Old regime' : 'New regime'),
    el('div', { class: 'table-wrap' }, el('table', { class: 'compare working' }, [el('tbody', {}, rows)])),
  ]);
}

function hraWorking(cmp) {
  const w = cmp.old.income.hraWorking;
  if (!w) return null;
  const rows = w.limbs.map((l, i) => el('tr', { class: l.value === w.least ? 'subtotal hra-least' : '' }, [
    el('td', {}, [`${['(a)', '(b)', '(c)'][i]} ${l.label}`, l.value === w.least ? el('span', { class: 'tag' }, 'lowest') : null]),
    el('td', { class: l.value < 0 ? 'neg' : '' }, inr(l.value)),
  ]));
  let verdict;
  if (w.missing === 'rent') verdict = 'You receive HRA but have not entered rent paid, so no exemption is computed. Enter the annual rent to see it.';
  else if (w.missing === 'hra') verdict = 'You pay rent but receive no HRA. HRA exemption needs an HRA component in salary; look at section 80GG instead (rent paid without HRA, old regime only, up to ₹60,000 a year).';
  else if (w.exempt <= 0) verdict = `Rent paid minus 10% of Basic + DA is ${inr(w.least)}, which is not positive, so no HRA is exempt. Rent must exceed 10% of Basic + DA for any exemption.`;
  else verdict = `The exemption is the lowest of the three, ${inr(w.exempt)}. It reduces salary income in the old regime only; the new regime taxes the full HRA of ${inr(w.limbs[0].value)}.`;
  const taxable = Math.max(0, w.limbs[0].value - w.exempt);
  return el('div', { class: 'card working-card hra-card' }, [
    el('h3', { style: 'margin-top:0' }, 'HRA exemption, step by step'),
    el('p', { class: 'muted small' }, `Section 10(13A) of the 1961 Act, s.11 read with Schedule III of the 2025 Act. Exempt HRA is the least of three amounts. "Salary" here means Basic + DA, ${inr(w.basicDa)}. ${w.city} counts as ${w.metro ? 'a metro' : 'a non-metro'} city, so limb (b) uses ${Math.round(w.pct * 100)}%.`),
    el('div', { class: 'table-wrap' }, el('table', { class: 'compare working' }, [el('tbody', {}, [
      ...rows,
      el('tr', { class: 'total' }, [el('td', {}, 'Exempt HRA (old regime)'), el('td', {}, inr(w.exempt))]),
      w.limbs[0].value > 0 ? el('tr', {}, [el('td', {}, 'Taxable HRA in the old regime'), el('td', {}, inr(taxable))]) : null,
      w.limbs[0].value > 0 ? el('tr', {}, [el('td', {}, 'Taxable HRA in the new regime'), el('td', {}, inr(w.limbs[0].value))]) : null,
    ])])),
    el('p', { class: 'explain' }, verdict),
    el('p', { class: 'muted small' }, 'If your annual rent exceeds ₹1,00,000, your employer needs the landlord\u2019s PAN. Rent paid to family is allowed but needs a genuine payment trail. Metro list for this purpose: Delhi, Mumbai, Kolkata, Chennai; the reported expansion to eight cities from FY 2026-27 is not applied until the Rules are confirmed.'),
  ]);
}

function renderWorking(cmp, rates) {
  const box = document.getElementById('tax-working');
  if (cmp.old.tax.totalIncome === 0 && cmp.new.tax.totalIncome === 0) { box.replaceChildren(); return; }
  const hra = hraWorking(cmp);
  setChildren(box, [
    hra,
    el('details', { class: 'working-details', open: true }, [
      el('summary', {}, 'How the tax is worked out, slab by slab'),
      el('p', { class: 'muted small', style: 'margin-top:0' }, 'Each regime step by step: slab bands, special-rate income, rebate and its marginal relief, surcharge and its marginal relief, then cess.'),
      el('div', { class: 'working-grid' }, [slabWorking('old', cmp.old, rates), slabWorking('new', cmp.new, rates)]),
      el('p', { class: 'muted small' }, 'Marginal relief exists in two places: on the rebate when total income crosses the rebate limit by a small margin, and at each surcharge threshold. In both cases the extra tax cannot exceed the extra income that caused it. Both are checked above.'),
    ]),
  ]);
}

function renderCharts(inputs, cmp, rates, flags) {
  const box = document.getElementById('tax-charts');
  if (cmp.old.tax.totalIncome === 0 && cmp.new.tax.totalIncome === 0) { box.replaceChildren(); return; }
  const curve = breakEvenCurve(inputs, rates, flags);
  const parts = [];
  if (curve) {
    const markers = [{ x: curve.current.x, y: curve.current.y, label: 'You are here', color: OLD_COLOR }];
    const vlines = curve.crossing != null && curve.crossing >= 0 && curve.crossing <= curve.xMax ? [{ x: curve.crossing, label: `Break-even ${shortINR(curve.crossing)}` }] : [];
    parts.push(el('div', { class: 'card chart-card' }, [
      el('h3', { style: 'margin-top:0' }, 'Where the regimes cross'),
      el('p', { class: 'muted small' }, 'Old-regime tax falls as you claim more deductions and exemptions; new-regime tax does not move. The dot is your current position.'),
      lineChart({
        series: [
          { name: 'Old regime', color: OLD_COLOR, points: curve.points },
          { name: 'New regime', color: NEW_COLOR, points: [[0, curve.newTax], [curve.xMax, curve.newTax]], dash: true },
        ],
        xFormat: shortINR, xLabel: 'Total old-regime deductions and exemptions claimed', markers, vlines, height: 260,
        ariaLabel: 'Tax under each regime as deductions vary',
      }),
    ]));
  }
  setChildren(box, parts);
}

const fmt = (n) => inr(n);

function renderInsights(inputs, cmp, rates, flags) {
  const box = document.getElementById('tax-insights');
  if (cmp.old.tax.totalIncome === 0 && cmp.new.tax.totalIncome === 0) { box.replaceChildren(); return; }
  const be = breakEven(inputs, rates, flags);
  const hr = headroom(inputs, rates, flags);

  const sentence = breakEvenSentence(be);

  // what-if sliders for old-regime room
  const roomOf = (id) => (hr.items.find((i) => i.id === id) || { room: 0 }).room;
  const sliders = [
    ['s80c', '80C investments', roomOf('80c'), null],
    ['nps1b', 'Own NPS, 80CCD(1B)', roomOf('nps1b'), 'nps'],
    ['health', 'Health insurance, 80D', roomOf('80d'), null],
  ].filter(([, , room]) => room > 0);
  for (const [key, , room] of sliders) extras[key] = Math.min(extras[key], room);
  for (const key of Object.keys(extras)) if (!sliders.find((s) => s[0] === key)) extras[key] = 0;

  const result = el('div', { class: 'whatif-result' });
  const renderResult = () => {
    const w = whatIf(inputs, extras, rates, flags);
    const a = w.after;
    if (w.invested === 0) { result.replaceChildren(el('span', { class: 'muted' }, 'Move a slider to see the effect.')); return; }
    const verdict = a.better === 'old' ? `the old regime wins by ${fmt(a.saving)}` : a.better === 'new' ? `the new regime still wins by ${fmt(a.saving)}` : 'both regimes come out equal';
    setChildren(result, [
      el('div', {}, [el('strong', {}, `Investing ${fmt(w.invested)} more saves ${fmt(w.taxSaved)} in old-regime tax`), `, and ${verdict}.`]),
      el('div', { class: 'muted small' }, `Old regime ${fmt(a.old.tax.total)} versus new regime ${fmt(a.new.tax.total)}. You would still have to put the ${fmt(w.invested)} in; the tax saved is ${w.invested ? Math.round((w.taxSaved / w.invested) * 100) : 0}% of it.`),
    ]);
  };
  const sliderRows = sliders.map(([key, label, room, filter]) => {
    const range = el('input', { type: 'range', min: 0, max: room, step: 500, value: extras[key] });
    const val = el('span', { class: 'slider-val' }, fmt(extras[key]));
    range.addEventListener('input', () => { extras[key] = +range.value; val.textContent = fmt(extras[key]); renderResult(); });
    return el('div', { class: 'slider-row' }, [
      el('div', { class: 'slider-label' }, [label, el('small', {}, ` room left ${fmt(room)}`), filter ? el('a', { href: '/nps', class: 'slider-link' }, 'how NPS works') : null]),
      el('div', { class: 'slider-ctl' }, [range, val]),
    ]);
  });
  renderResult();

  const rows = hr.items.map((it) => el('tr', {}, [
    el('td', {}, [termify(it.label), it.schemesFilter ? el('a', { href: '/nps', class: 'tag-link' }, 'how NPS works') : null]),
    el('td', {}, fmt(it.room)),
    el('td', {}, it.regime === 'both' ? [fmt(it.saving), el('div', { class: 'muted small' }, `new regime · old: ${fmt(it.savingOld)}`)] : fmt(it.saving)),
    el('td', {}, it.regime === 'both' ? 'Both' : 'Old only'),
  ]));

  setChildren(box, [
    el('div', { class: 'card insights' }, [
      el('h3', { style: 'margin-top:0' }, 'What if you used the room you have left?'),
      el('p', { class: 'muted small' }, sentence),
      sliders.length ? el('div', {}, [
        el('p', { class: 'muted small' }, 'These deductions apply in the old regime only. Drag to see what more investing would do to the comparison.'),
        ...sliderRows,
        result,
      ]) : null,
      hr.items.length ? el('details', { class: 'headroom' }, [
        el('summary', {}, 'Where the room is, and what each would save'),
        el('div', { class: 'table-wrap' }, el('table', { class: 'compare' }, [
          el('thead', {}, el('tr', {}, [el('th', {}, 'Deduction'), el('th', {}, 'Room left'), el('th', {}, 'Tax saved if used'), el('th', {}, 'Regime')])),
          el('tbody', {}, rows),
        ])),
        el('p', { class: 'muted small' }, 'Tax saved is what the deduction would cut from your tax. You would still have to invest or spend the amount itself. Employer NPS needs your employer to restructure your salary.'),
      ]) : null,
    ]),
  ]);
}

function breakEvenSentence(be) {
  return {
    need: `You would need about ${fmt(be.extra)} more in old-regime deductions or exemptions before the old regime became cheaper.`,
    impossible: 'On these figures no amount of old-regime deductions would beat the new regime.',
    cushion: `The old regime stays cheaper until about ${fmt(be.cushion)} of the ${fmt(be.claimed)} you currently claim is lost.`,
    always: 'The old regime would stay cheaper even without any of its deductions.',
    none: '',
  }[be.kind] || '';
}

/** Your biggest tax drivers: what adds tax and what cuts it, under the regime that is lower. */
function driversCard(inputs, r, rates, flags) {
  const d = taxDrivers(inputs, rates, flags);
  const income = d.items.filter((it) => it.kind === 'income');
  const reliefs = d.items.filter((it) => it.kind === 'relief');
  // Salary alone has nothing to rank: "salary is your whole tax" tells nobody anything.
  if (!reliefs.length && income.length < 2) return null;
  const other = d.regime === 'old' ? 'new' : 'old';
  const size = (it) => Math.max(Math.abs(it.old), Math.abs(it.new));
  const scale = Math.max(...d.items.map(size), 1);
  const row = (it) => {
    // a deduction the lower regime ignores is still worth seeing, marked as the other regime's
    const onlyOther = it.effect === 0 && it[other] !== 0;
    const eff = Math.abs(onlyOther ? it[other] : it.effect);
    const share = it.kind === 'income' && !onlyOther ? ' of tax' : '';
    return el('div', { class: 'driver' + (onlyOther ? ' only-other' : '') }, [
      el('div', { class: 'driver-head' }, [
        el('span', { class: 'driver-label' }, [termify(it.label), el('small', { class: 'muted' }, ` ${fmt(it.amount)}`)]),
        el('span', { class: 'driver-eff ' + (it.kind === 'income' ? 'adds' : 'cuts') }, [`${it.kind === 'income' ? '' : 'saves '}${fmt(eff)}`, el('small', {}, onlyOther ? ` ${other} regime only` : share)]),
      ]),
      el('div', { class: 'driver-bar' }, el('span', { class: it.kind === 'income' ? 'adds' : 'cuts', style: `width:${Math.max(2, Math.round(eff / scale * 100))}%` })),
    ]);
  };
  const group = (title, items) => items.length ? el('div', { class: 'driver-group' }, [el('h4', {}, title), ...items.slice(0, 5).map(row)]) : null;
  return el('div', { class: 'card drivers' }, [
    el('h3', { style: 'margin-top:0' }, 'What moves your tax'),
    el('p', { class: 'muted small' }, `Under the ${d.regime} regime: the tax each source of income is responsible for, and what each deduction or exemption saves you. Each figure comes from taking that one item out and recomputing.`),
    group('What you pay tax on', income),
    group('What cuts it', reliefs),
  ]);
}

function renderHeadline(r, inputs, rates, flags) {
  const box = document.getElementById('tax-headline');
  box.replaceChildren();
  const card = (key, label) => {
    const t = r[key].tax;
    const amount = el('div', { class: 'amount' });
    animateNumber(amount, `tax:${key}`, inr(t.total));
    return el('div', { class: `regime-card ${key}` }, [
      r.better === key ? el('span', { class: 'winner' }, 'Lower tax') : null,
      el('div', { class: 'label' }, label),
      amount,
      el('div', { class: 'eff' }, `Total income ${inr(t.totalIncome)} · effective rate ${pct(t.effectiveRate)}`),
    ]);
  };
  const empty = r.old.tax.totalIncome === 0 && r.new.tax.totalIncome === 0;
  // 1. The answer, in large type; 2. how far it is from flipping; 3. why (the two totals); 4. what drives it.
  let verdict;
  if (empty) {
    verdict = el('div', { class: 'verdict same' }, 'Enter your income on the left to see both regimes computed side by side.');
  } else if (r.better === 'same') {
    verdict = el('div', { class: 'verdict same' }, 'Both regimes give the same tax. The new regime is the default and needs no form.');
  } else {
    const saving = el('span', { class: 'verdict-amount' });
    animateNumber(saving, 'tax:saving', inr(r.saving));
    verdict = el('div', { class: 'verdict' }, [el('div', { class: 'verdict-k' }, 'Your result'), el('div', { class: 'verdict-line' }, [`The ${r.better} regime saves you `, saving, ' this year']), el('div', { class: 'verdict-sub' }, breakEvenSentence(breakEven(inputs, rates, flags)))]);
  }
  box.append(verdict);
  if (!empty) {
    box.append(el('div', { class: 'why-title' }, 'Why?'), card('old', 'Old regime'), card('new', 'New regime (default)'));
    const drivers = driversCard(inputs, r, rates, flags);
    if (drivers) box.append(drivers);
    box.append(el('div', { class: 'headline-foot' }, [
      el('span', { class: 'trust' }, 'Checked against the 10 statutory worked examples and 190+ automated tests. Rates as compiled 13 Sep 2026.'),
      shareCard(r, FY_SHORT[lastInputs?.fy] || 'FY 2026-27'),
    ]));
  }
}

/**
 * What to do next, and the parts that only make sense once there is an answer: the what-if card sits in
 * the "What to do next" section, the working folds away, and the email form waits until there is
 * something to send.
 */
function renderNext(inputs, cmp) {
  const has = !(cmp.old.tax.totalIncome === 0 && cmp.new.tax.totalIncome === 0);
  const next = document.getElementById('tax-next');
  const details = document.getElementById('tax-working-fold');
  const email = document.getElementById('tax-email');
  if (next) next.hidden = !has;
  if (details) details.hidden = !has;
  if (email) email.hidden = !has;
  const box = document.getElementById('tax-next-actions');
  if (!box || !has) return;
  const biz = hasBusiness(inputs);
  const better = cmp.better === 'old' ? 'old' : 'new';
  const action = (label, note, href) => el('a', { class: 'r-action', href }, [el('strong', {}, label), el('span', {}, note)]);
  setChildren(box, [
    biz ? action('Plan the advance tax', 'The instalments and dates are in the card above', '#tax-business')
      : action('See your monthly take-home', `What reaches your bank each month under the ${better} regime`, '/calculators/salary'),
    action('Put the saving to work', 'PPF, FD, funds and NPS compared after tax, at your slab', '/calculators/compare'),
    (inputs.capitalGains && Object.values(inputs.capitalGains).some((v) => +v > 0))
      ? action('Work out the capital gains properly', 'From a sale, or from your broker’s Tax P&L file', '/calculators/capital-gains')
      : action('Sold shares or property this year?', 'The gain, the exemptions, and what reinvesting saves', '/calculators/capital-gains'),
  ]);
}

function renderWarnings(r) {
  const box = document.getElementById('tax-warnings');
  box.replaceChildren();
  for (const w of r.warnings) box.append(el('div', { class: 'notice warn' }, w));
}

function renderTable(r) {
  const box = document.getElementById('tax-table');
  const o = r.old, n = r.new;
  const rows = [];
  const money = (v, opts = {}) => {
    const td = el('td', {}, inr(v));
    if (v < 0) td.classList.add('neg');
    if (opts.na) { td.textContent = 'Not available'; td.className = 'na'; }
    return td;
  };
  const group = (label) => rows.push(el('tr', { class: 'group' }, [el('td', { colspan: 3 }, label)]));
  const line = (label, ov, nv, cls = '', opts = {}) => {
    const tdO = money(ov, { na: opts.naOld });
    const tdN = money(nv, { na: opts.naNew });
    rows.push(el('tr', { class: cls }, [el('td', {}, termify(label)), tdO, tdN]));
  };

  // Income lines, merged by id in the order they appear in the old regime
  const byId = (arr) => Object.fromEntries(arr.map((l) => [l.id, l]));
  const oL = byId(o.income.lines), nL = byId(n.income.lines);
  const ids = [...new Set([...o.income.lines.map((l) => l.id), ...n.income.lines.map((l) => l.id)])];
  if (ids.length) {
    group('Income');
    for (const id of ids) {
      const l = oL[id] || nL[id];
      if (l.info) { rows.push(el('tr', {}, [el('td', { colspan: 3, class: 'muted' }, l.label)])); continue; }
      const ov = oL[id] ? oL[id].amount : 0;
      const nv = nL[id] ? nL[id].amount : 0;
      if (ov === 0 && nv === 0 && !l.subtotal) continue;
      line(l.label, ov, nv, l.subtotal ? 'subtotal' : '', { naNew: l.unavailableIn === 'new' && nv === 0 && ov !== 0 });
    }
  }

  // Chapter VI-A
  const oV = byId(o.income.via), nV = byId(n.income.via);
  const vIds = [...new Set([...o.income.via.map((v) => v.id), ...n.income.via.map((v) => v.id)])];
  if (vIds.length) {
    group('Chapter VI-A deductions');
    for (const id of vIds) {
      const v = oV[id] || nV[id];
      line(v.label, -(oV[id] ? oV[id].amount : 0), -(nV[id] ? nV[id].amount : 0), '', { naNew: !nV[id] });
    }
    line('Total deductions', -o.income.viaTotal, -n.income.viaTotal, 'subtotal');
  }

  const ot = o.tax, nt = n.tax;
  group('Tax computation');
  line('Slab-rate income', ot.slabIncome, nt.slabIncome, 'subtotal');
  if (ot.specialTax || nt.specialTax) line('Special-rate income (capital gains, lottery)', ot.totalIncome - ot.slabIncome, nt.totalIncome - nt.slabIncome);
  line('Total income', ot.totalIncome, nt.totalIncome, 'subtotal');
  line('Tax at slab rates', ot.slabTax, nt.slabTax);
  if (ot.specialTax || nt.specialTax) line('Tax on special-rate income', ot.specialTax, nt.specialTax);
  if (ot.rebate || nt.rebate) line('Less: rebate u/s 87A / s.156', -ot.rebate, -nt.rebate);
  if (ot.rebateRelief || nt.rebateRelief) line('Less: marginal relief on rebate', -ot.rebateRelief, -nt.rebateRelief);
  if (ot.surcharge || nt.surcharge) {
    line(`Surcharge (${Math.round(ot.scRate * 100)}% / ${Math.round(nt.scRate * 100)}%)`, ot.surcharge, nt.surcharge);
    if (ot.surchargeRelief || nt.surchargeRelief) line('Less: marginal relief on surcharge', -ot.surchargeRelief, -nt.surchargeRelief);
  }
  line('Health and education cess (4%)', ot.cess, nt.cess);
  line('Total tax payable', ot.total, nt.total, 'total');

  const table = el('table', { class: 'compare' }, [
    el('thead', {}, el('tr', {}, [el('th', {}, 'Line'), el('th', {}, 'Old regime'), el('th', {}, 'New regime')])),
    el('tbody', {}, rows),
  ]);
  // highlight the lower total
  const totalRow = rows[rows.length - 1];
  if (r.better !== 'same') totalRow.children[r.better === 'old' ? 1 : 2].classList.add('better');
  box.replaceChildren(el('div', { class: 'table-wrap' }, table));
}

function renderNotes(r) {
  const box = document.getElementById('tax-notes');
  box.replaceChildren();
  const notes = [
    ...r.old.income.notes.map((t) => `Old regime: ${t.replace(/^Old regime: /, '')}`),
    ...r.new.income.notes.map((t) => `New regime: ${t.replace(/^New regime: /, '')}`),
  ];
  if (r.old.tax.exemptionAdj || r.new.tax.exemptionAdj) {
    notes.push('Unused basic exemption has been set against capital gains (available to resident individuals).');
  }
  if (!notes.length) return;
  box.append(el('h3', {}, 'Notes'), el('ul', { class: 'notes' }, notes.map((t) => el('li', {}, t))));
}

function renderProvisionTable(onboarding) {
  const box = document.getElementById('provision-table');
  const rows = [];
  for (const g of onboarding.comparison_screen_rows.groups) {
    rows.push(el('tr', { class: 'group' }, [el('td', { colspan: 3 }, g.group)]));
    for (const row of g.rows) {
      const tag = row.highlight === 'new_better' ? 'new regime better' : row.highlight === 'old_better' ? 'old regime better' : '';
      rows.push(el('tr', {}, [
        el('td', {}, [row.param, tag ? el('span', { class: 'tag' }, tag) : null]),
        el('td', {}, row.old),
        el('td', {}, row.new),
      ]));
    }
  }
  const table = el('table', { class: 'compare prov-table' }, [
    el('thead', {}, el('tr', {}, [el('th', {}, 'Provision'), el('th', {}, 'Old regime'), el('th', {}, 'New regime')])),
    el('tbody', {}, rows),
  ]);
  box.replaceChildren(el('div', { class: 'table-wrap' }, table));
}
