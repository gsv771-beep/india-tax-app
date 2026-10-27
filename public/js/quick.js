/**
 * The salary question, one step at a time: the CTC alone; then whether there is a bonus, and whether it
 * sits inside the CTC or on top; then the monthly salary in hand under both regimes (Basic taken as 50%
 * of the CTC, PF 12% of that). Only if the person asks to go deeper come rent, 80C, NPS, home loan and
 * health cover, and the EMIs and other items that change what is left each month. The working (CTC down
 * to take-home, line by line) is folded until asked for.
 *
 * Mounted on the home page, the tax page and the salary pages (each with its own profile source,
 * so one copy hears what another saved). The arithmetic is quick-engine.js.
 */
import { el, inr, inrShort, setChildren, debounce } from './util.js';
import { getProfile, updateProfile, onProfileChange } from './profile-store.js';
import { setHandoff } from './handoff.js';
import { countEvent } from './feedback.js';
import { fromSalaryStore, toTaxInputs, ctcOf, ctcHeadline, payoutOf, isEmptyProfile, clearSalary, CITIES, METRO_CITIES } from '../engine/profile.js';
import { quickAnswer, ctcForInHand, QUICK_DEFAULTS, LIMIT_80C } from './quick-engine.js';

const DETAIL = 'taxcompass.detail-open.v1';
const live = new Map();   // one listener per mount point, replaced when a page re-renders its copy

/** The quick form's figures, from the shared profile. */
function fromProfile(p) {
  const i = p.income, ctc = Math.round(ctcHeadline(p));
  const listedLoan = p.loans.some((l) => l.type === 'home' && l.propertyUse === 'self_occupied');
  return {
    ctc: ctc > 0 && p.person.employment !== 'self_employed' ? ctc : 0,
    basicPct: ctc > 0 && i.basic > 0 ? Math.round(1000 * i.basic / ctc) / 10 : QUICK_DEFAULTS.basicPct,
    city: p.location.city || 'Other',
    rentMonthly: p.location.housing === 'rent' ? Math.round((p.location.rentPaid || 0) / 12) : 0,
    homeLoanInterest: Math.round(toTaxInputs(p).houseProperty.selfOccupiedInterest),
    listedLoan,   // interest then comes from the loan's schedule, so a figure typed here is not stored over it
    professionalTax: p.tax.professionalTax,
    other80c: p.tax.s80cUsed || 0, healthSelf: p.tax.s80dUsed || 0, nps1b: p.tax.nps1bUsed || 0,
    // a bonus set in the payslip or the tax form: kept through a new CTC here, and out of the monthly figure
    variable: ctc > 0 ? Math.round(i.variablePay || 0) : 0, payoutPct: payoutOf(p), onTop: !!p.tax.bonusOnTop,
    employerNpsPct: i.basic > 0 && i.employerNps > 0 ? Math.round(1000 * i.employerNps / i.basic) / 10 : 0,
    pfInCtc: i.employerPf > 0 || i.gratuity > 0,
    inhand: { ...p.inhand },
    loanEmi: (type) => Math.round(p.loans.filter((l) => l.type === type).reduce((s, l) => s + (l.emi || 0), 0)),
  };
}

// Money that leaves or joins the take-home each month without changing the tax. Monthly amounts.
const ADJUST = [
  { key: 'homeLoanEmi', label: 'Home loan EMI', sign: -1, loan: 'home', hint: 'the whole EMI; the interest for tax is asked above' },
  { key: 'personalLoanEmi', label: 'Personal loan EMI', sign: -1, loan: 'personal' },
  { key: 'carLoanEmi', label: 'Car loan EMI', sign: -1, loan: 'car' },
  { key: 'otherDeductions', label: 'Other deductions', sign: -1, note: 'otherDeductionsNote', notePh: 'what it is, e.g. VPF, insurance, salary advance' },
  { key: 'additions', label: 'Money added each month', sign: 1, note: 'additionsNote', notePh: 'what it is, e.g. reimbursement, rent received' },
];
const adjTotal = (inhand) => ADJUST.reduce((s, d) => s + d.sign * (+inhand?.[d.key] || 0), 0);

const DEDUCTIONS = [
  { key: 'rentMonthly', label: 'Rent you pay', unit: 'a month', step: 1000, hint: () => 'the old regime exempts part of your HRA; pick your city' },
  { key: 'other80c', label: '80C investments: PPF, ELSS, life insurance, tuition fees', unit: 'a year', step: 5000, hint: (a) => !a ? 'on top of your PF' : a.room80c > 0 ? `your PF already counts ${inr(a.claimed.epf)} of the ${inrShort(LIMIT_80C)} limit, so ${inr(a.room80c)} is left` : `your PF (${inr(a.claimed.epf)} a year) already fills the ${inrShort(LIMIT_80C)} limit, so more here does not lower the tax` },
  { key: 'nps1b', label: 'NPS you pay into yourself (not through your employer)', unit: 'a year', step: 5000, hint: () => 'up to ₹50,000 counts, over the 80C limit (80CCD(1B))' },
  { key: 'homeLoanInterest', label: 'Home loan interest, house you live in', unit: 'a year', step: 10000, hint: () => 'interest only, not the EMI; up to ₹2 lakh counts' },
  { key: 'healthSelf', label: 'Health insurance premium', unit: 'a year', step: 1000, hint: () => 'for you and your family; up to ₹25,000 counts (80D)' },
];
/**
 * mountQuick(slot, { rates, source, taxLink, salaryLink })
 *   source      the profile source this copy writes as ('quick:home', 'quick:tax', 'quick:salary')
 *   taxLink, salaryLink   { href, text, onclick? } under each result tile; onclick opens the detailed
 *               tool on a page that has it below instead of navigating away
 */
/** A CTC passed in the address (/tax?ctc=2500000, from a salary page or a shared link): shown, not saved until edited. */
export function ctcFromUrl() {
  if (typeof location === 'undefined') return null;
  const v = Math.round(+new URLSearchParams(location.search).get('ctc'));
  return v >= 100000 && v <= 1e9 ? v : null;
}
/** A take-home asked for in the address (/?want=200000, or /?want= to open the reverse question empty). */
export function wantFromUrl() {
  if (typeof location === 'undefined') return null;
  const s = new URLSearchParams(location.search);
  if (!s.has('want')) return null;
  const v = Math.round(+s.get('want'));
  return v > 0 && v < 1e8 ? v : 0;
}
// money boxes show Indian grouping as you type (25,00,000) and are read back as plain numbers
const rupees = (n) => (+n > 0 ? Math.round(+n).toLocaleString('en-IN') : '');
const readRupees = (s) => +String(s || '').replace(/[^\d]/g, '') || 0;
function groupAsTyped(input) {
  input.addEventListener('input', () => {
    const before = input.value, caret = input.selectionStart ?? before.length;
    const digitsLeft = before.slice(0, caret).replace(/\D/g, '').length;
    const after = rupees(readRupees(before));
    if (after === before) return;
    input.value = after;
    // keep the caret after the same number of digits
    let pos = 0, seen = 0;
    while (pos < after.length && seen < digitsLeft) { if (/\d/.test(after[pos])) seen++; pos++; }
    try { input.setSelectionRange(pos, pos); } catch {}
  });
}
const WANT = 'taxcompass.want.v1';   // localStorage: { mode, want } for the reverse question
const mounts = new Map();   // source -> the slot and options, so a ?ctc= link can refill a card already on the page
if (typeof window !== 'undefined') window.addEventListener('routechange', () => {
  const c = ctcFromUrl(), w = wantFromUrl();
  if (!c && w == null) return;
  for (const { slot, opts } of mounts.values()) if (slot.isConnected && slot.offsetParent !== null && (w != null || opts.ctc !== c)) mountQuick(slot, { ...opts, ctc: c });
});

export function mountQuick(slot, opts) {
  const { rates, source, taxLink, salaryLink } = opts;
  const ctc = opts.ctc ?? ctcFromUrl();
  if (!slot || !rates) return;
  if (live.has(source)) live.get(source)();
  mounts.set(source, { slot, opts: { ...opts, ctc } });
  // a salary page starts from its own CTC with the person's deductions; nothing is saved until they change something
  let q = { ...fromProfile(getProfile()), ...(ctc ? { ctc } : {}) };
  // the bonus question: asked once a CTC is typed, unless the answer is already known (a saved salary, a
  // CTC from a link or a salary page, or a bonus set in the payslip or tax form)
  const knownBonus = (x) => (x.variable > 0 ? (x.onTop ? 'top' : 'ctc') : x.ctc > 0 ? 'none' : null);
  let bonusKind = knownBonus(q);
  let asking = !bonusKind;   // the bonus question is on screen: until answered, or while its amount is being typed
  let deeper = DEDUCTIONS.some((d) => q[d.key] > 0) || ADJUST.some((d) => +q.inhand?.[d.key] > 0) || q.employerNpsPct > 0;
  // the reverse question (the CTC to ask for, for a take-home), on the landing page only
  const allowWant = source === 'quick:tax';
  let mode = 'ctc', want = 0, hike = 0, example = false;   // example: the ₹15 lakh sample is on screen, not the person's own salary
  if (allowWant && !ctc) {
    const w = wantFromUrl();
    if (w != null) { mode = 'want'; want = w; }
    else { try { const s = JSON.parse(localStorage.getItem(WANT) || 'null'); if (s && s.mode === 'want') { mode = 'want'; want = +s.want || 0; } } catch {} }
  }
  const keepWant = () => { try { localStorage.setItem(WANT, JSON.stringify({ mode, want })); } catch {} };

  // ---- 1. the CTC, and nothing else ----
  const ctcInput = el('input', { type: 'text', inputmode: 'numeric', autocomplete: 'off', placeholder: 'e.g. 15,00,000', class: 'quick-ctc', 'data-echo': 'own', 'aria-label': 'Your annual CTC in rupees', value: rupees(q.ctc) });
  groupAsTyped(ctcInput);
  const echo = el('span', { class: 'quick-echo', 'aria-live': 'polite' });
  const startOver = el('button', { type: 'button', class: 'quick-reset' }, 'Start over');
  const wantInput = el('input', { type: 'text', inputmode: 'numeric', autocomplete: 'off', placeholder: 'e.g. 2,00,000', class: 'quick-ctc', 'data-echo': 'own', 'aria-label': 'The take-home you want each month, in rupees', value: rupees(want) });
  groupAsTyped(wantInput);
  const wantEcho = el('span', { class: 'quick-echo', 'aria-live': 'polite' });
  const ctcLabel = el('label', { class: 'quick-in' }, [el('span', { class: 'quick-in-label' }, 'Your annual CTC (₹)'), el('span', { class: 'quick-in-row' }, [ctcInput, echo])]);
  const wantLabel = el('label', { class: 'quick-in' }, [el('span', { class: 'quick-in-label' }, 'Take-home you want (₹ a month)'), el('span', { class: 'quick-in-row' }, [wantInput, wantEcho])]);
  const modeBtns = [['ctc', 'I know my CTC'], ['want', 'I know the in-hand I want']].map(([m, t]) => el('button', { type: 'button', class: 'quick-mode', 'data-mode': m, 'aria-pressed': 'false' }, t));
  const modeSwitch = allowWant ? el('div', { class: 'quick-modes', role: 'group', 'aria-label': 'What you know' }, modeBtns) : null;
  for (const b of modeBtns) b.addEventListener('click', () => { mode = b.dataset.mode; keepWant(); paint(); (mode === 'want' ? wantInput : ctcInput).focus(); });
  wantInput.addEventListener('input', () => { want = readRupees(wantInput.value); keepWant(); paint(); });
  // what the CTC holds: most of the difference between a CTC and the salary paid is employer PF and
  // gratuity, so the assumption is shown as a choice under the answer, not buried in the working
  const pfInput = el('input', { type: 'checkbox' });
  const pfNote = el('span', { class: 'quick-basis-note muted small' });
  const pfBox = el('label', { class: 'quick-basis', hidden: true }, [pfInput, el('span', {}, [el('span', {}, 'My CTC includes employer PF and gratuity'), pfNote])]);
  pfInput.addEventListener('change', () => { if (pfInput.checked) countEvent('pfin'); set({ pfInCtc: pfInput.checked }); });
  // a hike on the CTC: what it adds to the take-home, after the tax on it
  const hikeInput = el('input', { type: 'number', min: 0, max: 200, step: 1, inputmode: 'decimal', placeholder: 'e.g. 10', class: 'quick-pct', 'aria-label': 'Hike you expect, percent' });
  const hikeOut = el('span', { class: 'quick-hike-out', 'aria-live': 'polite' });
  const hikeBox = el('label', { class: 'quick-hike', hidden: true }, [el('span', {}, 'Expecting a hike?'), el('span', { class: 'quick-amount' }, [hikeInput, el('span', { class: 'unit' }, '%')]), hikeOut]);
  hikeInput.addEventListener('input', () => { hike = Math.max(0, +hikeInput.value || 0); if (hike > 0) countEvent('hike'); paint(); });

  // ---- 2. the bonus ----
  const kindBtn = (kind, text) => el('button', { type: 'button', class: 'quick-choice', 'data-kind': kind, 'aria-pressed': 'false' }, text);
  const kindBtns = [kindBtn('none', 'No'), kindBtn('ctc', 'Yes, part of my CTC'), kindBtn('top', 'Yes, on top of my CTC')];
  const bonusInput = el('input', { type: 'text', inputmode: 'numeric', autocomplete: 'off', 'data-echo': 'own', placeholder: 'e.g. 2,00,000', class: 'quick-bonus-amount', value: rupees(q.variable), 'aria-label': 'Bonus or variable pay a year, in rupees' });
  groupAsTyped(bonusInput);
  const bonusAmount = el('label', { class: 'quick-q-field', hidden: true }, [el('span', {}, 'How much, a year, if paid in full?'), el('span', { class: 'quick-amount' }, ['₹', bonusInput])]);
  const bonusStep = el('div', { class: 'quick-step', hidden: true }, [
    el('p', { class: 'quick-q' }, 'Do you get a bonus or variable pay?'),
    el('div', { class: 'quick-choices', role: 'group', 'aria-label': 'Bonus or variable pay' }, kindBtns),
    bonusAmount,
  ]);

  // ---- 3. the answer, and 4. going deeper ----
  const answer = el('div', { class: 'quick-answer', 'aria-live': 'polite', hidden: true });
  const deeperBtn = el('button', { type: 'button', class: 'btn quick-deeper-btn' }, 'Get a more exact answer');
  const deeperIntro = el('p', { class: 'quick-q' }, 'A few more questions. Answer what applies to you and leave the rest blank.');
  const verdict = el('div', { class: 'quick-verdict-box' });
  const breakdown = el('details', { class: 'quick-breakdown', hidden: true });
  const breakdownBody = el('div', { class: 'quick-breakdown-body' });
  const assumePt = el('span');
  const basicInput = el('input', { type: 'number', min: 10, max: 80, step: 1, class: 'quick-basic', value: q.basicPct, 'aria-label': 'Basic pay as a percentage of CTC' });
  const assume = el('p', { class: 'quick-assume muted small' }, [
    'Assumes Basic ', basicInput, '% of CTC, HRA half of Basic, ', assumePt, ' professional tax, age under 60, FY 2026-27. Self-employed? ', el('a', { href: '/#detail' }, 'The full calculator takes business income'), '. An estimate, not tax advice.',
  ]);

  const save = debounce(() => {
    if (mode === 'want' || example) return;   // a take-home being tried out, or the sample, is not a salary: nothing is saved
    if (!q.ctc) {
      // an emptied CTC box empties the salary it had saved, and the detailed calculators' own copies of
      // it, so the old figure does not come back on this page or the next visit
      if (ctcOf(getProfile().income) > 0) {
        try { localStorage.removeItem('taxcompass.salary.v1'); } catch {}
        updateProfile((d) => { for (const k of Object.keys(d.income)) d.income[k] = 0; return d; }, source);
        window.dispatchEvent(new CustomEvent('taxcompass:salarycleared', { detail: { source } }));
      }
      return;
    }
    if (!bonusKind) return;   // nothing is saved until the bonus question is answered
    const a = quickAnswer(q, rates);
    if (!a || a.error) return;
    // a ?ctc= link was only the starting figure: once a CTC of their own is saved, the address drops it so
    // the payslip and tax form below (which also read it) follow the profile instead
    if (ctcFromUrl() && ctcFromUrl() !== q.ctc) {
      const u = new URL(location.href); u.searchParams.delete('ctc');
      history.replaceState(history.state, '', u.pathname + u.search + u.hash);
    }
    updateProfile((d) => {
      const prev = fromProfile(d);
      // a new CTC, Basic % or bonus rewrites the salary split; a deduction leaves any detailed split alone
      const resplit = prev.ctc !== q.ctc || Math.abs(prev.basicPct - q.basicPct) > 0.05 || prev.variable !== q.variable || prev.onTop !== q.onTop || Math.abs(prev.employerNpsPct - (q.employerNpsPct || 0)) > 0.05 || prev.pfInCtc !== !!q.pfInCtc || isEmptyProfile(d);
      let out = resplit ? fromSalaryStore(d, { ...a.store, regime: a.better }, a.pay) : d;
      out.tax.s80cUsed = q.other80c || 0; out.tax.s80dUsed = q.healthSelf || 0; out.tax.nps1bUsed = q.nps1b || 0;
      if (!q.listedLoan) out.tax.homeLoanInterest = q.homeLoanInterest || 0;
      out.location.city = q.city; out.location.metro = METRO_CITIES.includes(q.city);
      out.location.rentPaid = 12 * (q.rentMonthly || 0);
      if (q.rentMonthly > 0) out.location.housing = 'rent';
      out.tax.regime = a.better;
      out.person.employment = out.person.employment === 'self_employed' || out.person.employment === 'both' ? 'both' : 'salaried';
      out.inhand = { ...out.inhand, ...q.inhand };
      return out;
    }, source);
  }, 700);

  const set = (patch, { persist = true } = {}) => { q = { ...q, ...patch }; paint(); if (persist) save(); };
  ctcInput.addEventListener('input', () => { example = false; set({ ctc: readRupees(ctcInput.value) }); });
  // one tap to a worked answer, before typing anything: a ₹15 lakh CTC, no bonus, nothing saved
  const exampleBtn = el('button', { type: 'button', class: 'quick-link-btn quick-example' }, 'Or see an example: ₹15 lakh CTC');
  exampleBtn.addEventListener('click', () => { countEvent('example'); example = true; bonusKind = 'none'; asking = false; ctcInput.value = rupees(1500000); set({ ctc: 1500000, variable: 0, onTop: false }); });
  ctcInput.addEventListener('keydown', (e) => { if (e.key === 'Enter' && !bonusStep.hidden) { e.preventDefault(); kindBtns[0].focus(); } });
  basicInput.addEventListener('change', () => set({ basicPct: Math.min(80, Math.max(10, +basicInput.value || QUICK_DEFAULTS.basicPct)) }));
  for (const b of kindBtns) b.addEventListener('click', () => {
    bonusKind = b.dataset.kind;
    if (bonusKind === 'none') { asking = false; set({ variable: 0, onTop: false }); }
    else { set({ variable: readRupees(bonusInput.value), onTop: bonusKind === 'top' }); bonusInput.focus({ preventScroll: true }); }
  });
  bonusInput.addEventListener('input', () => set({ variable: readRupees(bonusInput.value) }));
  // the amount is done when the box is left or Enter is pressed: the question folds into one line
  const doneBonus = () => { if (bonusKind && bonusKind !== 'none' && q.variable > 0) { asking = false; paint(); } };
  bonusInput.addEventListener('change', doneBonus);
  bonusInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); doneBonus(); } });

  // ---- the deeper questions: one plain field each, blank means none ----
  const qField = (d) => {
    const input = el('input', { type: 'number', min: 0, step: d.step, inputmode: 'numeric', 'data-echo': 'own', placeholder: '0', value: q[d.key] || '', 'aria-label': `${d.label}, ₹ ${d.unit}` });
    const hint = el('small', { class: 'quick-hint' });
    const city = d.key === 'rentMonthly' ? el('select', { class: 'quick-city', 'aria-label': 'City you live in' }, CITIES.map((c) => el('option', { value: c, selected: c === q.city }, c === 'Other' ? 'Other city' : c))) : null;
    if (city) city.addEventListener('change', () => set({ city: city.value }));
    input.addEventListener('input', () => set({ [d.key]: Math.max(0, +input.value || 0) }));
    const node = el('label', { class: 'quick-q-field' }, [el('span', {}, d.label), el('span', { class: 'quick-amount' }, ['₹', input, el('span', { class: 'unit' }, d.unit), city]), hint]);
    return { d, node, input, hint, city };
  };
  const fields = DEDUCTIONS.map(qField);
  // corporate NPS: a % of Basic the employer pays into NPS out of the CTC (80CCD(2), both regimes)
  const npsPctInput = el('input', { type: 'number', min: 0, max: 30, step: 1, inputmode: 'decimal', placeholder: '0', class: 'quick-pct', value: q.employerNpsPct || '', 'aria-label': 'Employer NPS, % of Basic' });
  const npsHint = el('small', { class: 'quick-hint' });
  npsPctInput.addEventListener('input', () => set({ employerNpsPct: Math.min(30, Math.max(0, +npsPctInput.value || 0)) }));
  const npsField = el('label', { class: 'quick-q-field' }, [el('span', {}, 'Employer NPS through your salary (corporate NPS)'), el('span', { class: 'quick-amount' }, [npsPctInput, el('span', { class: 'unit' }, '% of Basic')]), npsHint]);
  const adjFields = ADJUST.map((d) => {
    const input = el('input', { type: 'number', min: 0, step: 500, inputmode: 'numeric', 'data-echo': 'own', placeholder: '0', value: q.inhand?.[d.key] || '', 'aria-label': `${d.label}, ₹ a month` });
    const note = d.note ? el('input', { type: 'text', maxlength: 60, class: 'quick-note', placeholder: d.notePh, value: q.inhand?.[d.note] || '', 'aria-label': `${d.label}: what it is` }) : null;
    input.addEventListener('input', () => set({ inhand: { ...q.inhand, [d.key]: Math.max(0, +input.value || 0) } }));
    if (note) note.addEventListener('input', () => set({ inhand: { ...q.inhand, [d.note]: note.value } }));
    // a loan already in the profile offers its EMI the first time the box is reached
    if (d.loan) input.addEventListener('focus', () => { const e = q.loanEmi(d.loan); if (!(+input.value > 0) && e > 0) { input.value = e; set({ inhand: { ...q.inhand, [d.key]: e } }); } });
    return { d, input, note, node: el('label', { class: 'quick-q-field' }, [el('span', {}, d.label), el('span', { class: 'quick-amount' }, [d.sign > 0 ? '+ ₹' : '− ₹', input, el('span', { class: 'unit' }, 'a month')]), note, d.hint ? el('small', { class: 'quick-hint' }, d.hint) : null]) };
  });
  const adjFold = el('details', { class: 'quick-fold', open: ADJUST.some((d) => +q.inhand?.[d.key] > 0) }, [
    el('summary', {}, el('span', { class: 'quick-fold-title' }, 'Loan EMIs, other deductions or extra income')),
    el('p', { class: 'muted small' }, 'Monthly amounts that come out of your pay or come in on top. They change what is left each month, not your tax.'),
    el('div', { class: 'quick-q-grid' }, adjFields.map((f) => f.node)),
  ]);
  const deeperBody = el('div', { class: 'quick-deeper-body', hidden: true }, [
    deeperIntro,
    el('div', { class: 'quick-q-grid' }, [...fields.map((f) => f.node), npsField]),
    verdict,
    adjFold,
  ]);
  const deeperBox = el('div', { class: 'quick-step quick-deeper', hidden: true }, [deeperBtn, deeperBody]);
  deeperBtn.addEventListener('click', () => { countEvent('deeper'); deeper = true; paint(); fields[0].input.focus({ preventScroll: false }); });

  const refreshFields = (a) => {
    if (document.activeElement !== npsPctInput) npsPctInput.value = q.employerNpsPct || '';
    npsHint.textContent = a.pay.employerNps > 0 ? `${inr(a.pay.employerNps)} a year, out of your CTC. Up to 14% of Basic counts in the new regime, 10% in the old${(q.employerNpsPct || 0) > 14 ? '; the part above that is still taxed' : ''}.` : 'if your employer offers it: usually 10% or 14% of Basic, taken out of your CTC; it lowers the tax in both regimes';
    for (const f of fields) { f.hint.textContent = f.d.hint(a); if (document.activeElement !== f.input) f.input.value = q[f.d.key] || ''; if (f.city) f.city.value = q.city; }
    for (const f of adjFields) { if (document.activeElement !== f.input) f.input.value = q.inhand?.[f.d.key] || ''; if (f.note && document.activeElement !== f.note) f.note.value = q.inhand?.[f.d.note] || ''; }
  };

  const regimeName = (r) => (r === 'new' ? 'New regime' : 'Old regime');
  function paintAnswer(a, need) {
    if (a.error) { setChildren(answer, el('p', { class: 'notice warn' }, a.error)); return; }
    const bonus = a.bonus.paid > 0;
    if (need) { paintWant(a, need, bonus); return; }
    const row = (r) => el('div', { class: 'quick-side' + (r === a.better && !a.same ? ' win' : '') }, [
      el('div', { class: 'quick-side-k' }, regimeName(r)),
      el('div', { class: 'quick-side-v' }, [inr(a.monthly[r]), el('span', { class: 'quick-per' }, ' a month')]),
      el('div', { class: 'quick-side-tax' }, a.tax[r] > 0 ? ['Tax ', el('b', {}, inr(a.tax[r])), ' a year'] : 'No income tax'),
      a.same ? (r === 'new' ? el('div', { class: 'quick-side-sub' }, 'Same either way') : null) : r === a.better ? el('div', { class: 'quick-side-sub' }, `Better by ${inr(a.saves)} a year`) : null,
    ]);
    const kindText = bonusKind === 'top' ? 'on top of your CTC' : bonusKind === 'ctc' ? 'part of your CTC' : 'none';
    const change = el('button', { type: 'button', class: 'quick-link-btn', onclick: () => { asking = true; paint(); (kindBtns.find((b) => b.dataset.kind === bonusKind) || kindBtns[0]).focus(); } }, 'change');
    setChildren(answer, [
      el('div', { class: 'quick-k' }, bonus ? 'Your monthly salary in hand, before bonus' : 'Your monthly salary in hand'),
      el('div', { class: 'quick-v' }, inr(a.monthly.best)),
      el('p', { class: 'quick-sub' }, `In the ${a.better} regime, after ${inr(a.pay.employeePf / 12)} PF (12% of Basic, taken as ${+q.basicPct.toFixed(1)}% of your CTC), ${inr(a.pay.professionalTax / 12)} professional tax and income tax.`),
      a.pay.employerNps > 0 ? el('p', { class: 'quick-sub' }, `Another ${inr(a.pay.employerNps / 12)} a month goes to your NPS account (employer NPS, ${+(+q.employerNpsPct).toFixed(1)}% of Basic), and lowers your tax in both regimes.`) : null,
      bonus ? el('p', { class: 'quick-sub quick-bonus' }, `Plus your bonus, ${kindText}: ${inr(a.bonus.paid)} a year, about ${inr(a.bonus.net.best)} after tax.`) : null,
      adjTotal(q.inhand) !== 0 ? leftLine(a) : null,
      el('div', { class: 'quick-sides' }, [row('new'), row('old')]),
      el('p', { class: 'quick-sub quick-bonus-kind' }, ['Bonus: ', bonus ? `${inr(a.bonus.target)}, ${kindText}` : 'none', ' · ', change]),
    ]);
  }
  // the reverse answer: the CTC to ask for, both regimes, and a way to carry on with it
  function paintWant(a, need, bonus) {
    const b = need.best, other = b === 'new' ? 'old' : 'new';
    const kindText = bonusKind === 'top' ? 'on top of your CTC' : bonusKind === 'ctc' ? 'part of your CTC' : 'none';
    const change = el('button', { type: 'button', class: 'quick-link-btn', onclick: () => { asking = true; paint(); (kindBtns.find((x) => x.dataset.kind === bonusKind) || kindBtns[0]).focus(); } }, 'change');
    const row = (r) => need[r] ? el('div', { class: 'quick-side' + (r === b && need.new && need.old && need.new.ctc !== need.old.ctc ? ' win' : '') }, [
      el('div', { class: 'quick-side-k' }, regimeName(r)),
      el('div', { class: 'quick-side-v' }, [inr(need[r].ctc), el('span', { class: 'quick-per' }, ' CTC')]),
      el('div', { class: 'quick-side-tax' }, need[r].a.tax[r] > 0 ? ['Tax ', el('b', {}, inr(need[r].a.tax[r])), ' a year'] : 'No income tax'),
      r === b && need[other] && need[other].ctc > need[r].ctc ? el('div', { class: 'quick-side-sub' }, `Asks for ${inr(need[other].ctc - need[r].ctc)} less`) : null,
    ]) : null;
    const use = el('button', { type: 'button', class: 'btn secondary small-btn quick-use' }, `Carry on with ${inrShort(need[b].ctc)} as my CTC`);
    use.addEventListener('click', () => { mode = 'ctc'; keepWant(); ctcInput.value = rupees(need[b].ctc); set({ ctc: need[b].ctc }); ctcInput.focus({ preventScroll: true }); });
    setChildren(answer, [
      el('div', { class: 'quick-k' }, 'Ask for a CTC of'),
      el('div', { class: 'quick-v' }, inr(need[b].ctc)),
      el('p', { class: 'quick-sub' }, `That puts ${inr(a.monthly[b])} a month in your bank${bonus ? ', before the bonus,' : ''} in the ${b} regime, after ${inr(a.pay.employeePf / 12)} PF (12% of Basic, taken as ${+q.basicPct.toFixed(1)}% of the CTC), ${inr(a.pay.professionalTax / 12)} professional tax and ${inr(a.tax[b] / 12)} a month of income tax.`),
      need[other] && need[other].ctc !== need[b].ctc ? el('p', { class: 'quick-sub' }, `In the ${other} regime you would need ${inr(need[other].ctc)}.`) : null,
      bonus ? el('p', { class: 'quick-sub quick-bonus' }, `Plus your bonus, ${kindText}: ${inr(a.bonus.paid)} a year, about ${inr(a.bonus.net[b])} after tax.`) : null,
      el('div', { class: 'quick-sides' }, [row('new'), row('old')]),
      el('p', { class: 'quick-sub quick-bonus-kind' }, ['Bonus: ', bonus ? `${inr(a.bonus.target)}, ${kindText}` : 'none', ' · ', change]),
      use,
    ]);
  }
  function leftLine(a) {
    const left = a.monthly.best + adjTotal(q.inhand);
    const off = ADJUST.filter((d) => d.sign < 0).reduce((s, d) => s + (+q.inhand?.[d.key] || 0), 0), on = +q.inhand?.additions || 0;
    return el('div', { class: 'quick-left' + (left < 0 ? ' neg' : '') }, [
      el('span', { class: 'quick-left-k' }, `Left each month${off ? ` after ${inr(off)} of EMIs and deductions` : ''}${on ? `${off ? ',' : ''} with ${inr(on)} added` : ''}`),
      el('span', { class: 'quick-left-v' }, (left < 0 ? '−' : '') + inr(Math.abs(left))),
    ]);
  }

  // could the old regime win? shown once deeper questions are open
  function paintVerdict(a) {
    const need = a.needed, have = a.claimed.total;
    if (!need || (a.tax.new === 0 && a.tax.old === 0)) { setChildren(verdict, []); return; }
    const pct = Math.min(100, 100 * have / need);
    const line = a.better === 'old' ? `With these, the old regime wins by ${inr(a.saves)} a year. Tell your employer you want the old regime, or choose it when you file your return.`
      : a.be.kind === 'impossible' ? 'The new regime wins at this salary whatever you claim.'
      : `The old regime needs ${inr(Math.max(0, need - have))} more in deductions to win. Until then, the new regime.`;
    setChildren(verdict, [
      el('div', { class: 'quick-meter-text' }, [el('span', {}, ['Your old-regime deductions: ', el('b', {}, inr(have))]), el('span', {}, ['It wins above ', el('b', {}, inr(need))])]),
      el('div', { class: 'quick-meter-track', role: 'meter', 'aria-valuemin': 0, 'aria-valuemax': Math.round(need), 'aria-valuenow': Math.round(have), 'aria-label': 'Old-regime deductions against the point where the old regime wins' }, el('span', { class: 'quick-meter-fill' + (a.better === 'old' ? ' past' : ''), style: `width:${pct.toFixed(1)}%` })),
      el('p', { class: 'quick-verdict' }, line),
    ]);
  }

  // the working: CTC down to take-home, line by line, both regimes; it adds up
  function paintBreakdown(a) {
    const row = (k, n, o, cls = '') => el('tr', { class: cls }, [el('th', { scope: 'row' }, k), el('td', {}, n), el('td', {}, o)]);
    const minus = (v) => (v > 0 ? `− ${inr(v)}` : inr(0));
    const both = (v) => [v, v];
    const pf = a.pay.employeePf, pt = a.pay.professionalTax, gross = a.pay.grossSalary;
    const parts = [`your PF ${inr(a.claimed.epf)}`, a.claimed.hra ? `HRA exemption ${inr(a.claimed.hra)}` : '', a.claimed.s80c > a.claimed.epf ? `other 80C ${inr(a.claimed.s80c - a.claimed.epf)}` : '', a.claimed.homeLoan ? `home-loan interest ${inr(a.claimed.homeLoan)}` : '', a.claimed.health ? `health cover ${inr(a.claimed.health)}` : '', a.claimed.nps ? `NPS ${inr(a.claimed.nps)}` : ''].filter(Boolean);
    setChildren(breakdownBody, [
      el('div', { class: 'table-wrap' }, el('table', { class: 'compare quick-breakdown-table' }, [
        el('thead', {}, el('tr', {}, [el('th', {}, 'A year'), el('th', { class: a.better === 'new' ? 'win' : '' }, 'New'), el('th', { class: a.better === 'old' ? 'win' : '' }, 'Old')])),
        el('tbody', {}, [
          row('Your CTC', ...both(inr(a.ctc))),
          a.store.variableInCtc === 'top' && a.bonus.paid > 0 ? row('Bonus on top of the CTC', ...both(`+ ${inr(a.bonus.paid)}`))
            : a.bonus.paid !== a.bonus.target ? row(`Bonus paid at ${+a.bonus.payoutPct.toFixed(1)}% of target`, ...both(`${a.bonus.paid > a.bonus.target ? '+' : '−'} ${inr(Math.abs(a.bonus.paid - a.bonus.target))}`)) : null,
          a.pay.employerNps > 0 ? row('Employer NPS, to your NPS account', ...both(minus(a.pay.employerNps))) : null,
          a.pay.employerPf > 0 ? row('Employer PF, inside the CTC', ...both(minus(a.pay.employerPf))) : null,
          a.pay.gratuity > 0 ? row('Gratuity, inside the CTC', ...both(minus(a.pay.gratuity))) : null,
          row('Your PF', ...both(minus(pf))),
          row('Professional tax', ...both(minus(pt))),
          row('Income tax', minus(a.tax.new), minus(a.tax.old)),
          row('In hand a year', inr(a.inHand.new), inr(a.inHand.old), 'total'),
          a.bonus.paid > 0 ? row('Of which bonus, paid once', inr(a.bonus.net.new), inr(a.bonus.net.old)) : null,
          row(a.bonus.paid > 0 ? 'In hand a month, before bonus' : 'In hand a month', inr(a.monthly.new), inr(a.monthly.old), 'total'),
        ]),
      ])),
      adjTotal(q.inhand) !== 0 ? el('div', { class: 'table-wrap' }, el('table', { class: 'compare quick-breakdown-table' }, [
        el('thead', {}, el('tr', {}, [el('th', {}, 'Each month'), el('th', { class: 'win' }, `${a.better === 'new' ? 'New' : 'Old'} regime`)])),
        el('tbody', {}, [
          el('tr', {}, [el('th', { scope: 'row' }, a.bonus.paid > 0 ? 'Take-home, before bonus' : 'Take-home'), el('td', {}, inr(a.monthly.best))]),
          ...ADJUST.filter((d) => +q.inhand?.[d.key] > 0).map((d) => el('tr', {}, [el('th', { scope: 'row' }, d.note && q.inhand[d.note] ? `${d.label} (${q.inhand[d.note]})` : d.label), el('td', {}, `${d.sign < 0 ? '−' : '+'} ${inr(q.inhand[d.key])}`)])),
          el('tr', { class: 'total' }, [el('th', { scope: 'row' }, 'Left each month'), el('td', {}, (a.monthly.best + adjTotal(q.inhand) < 0 ? '−' : '') + inr(Math.abs(a.monthly.best + adjTotal(q.inhand))))]),
        ]),
      ])) : null,
      el('p', { class: 'muted small' }, [`Your PF is 12% of Basic. ${a.pay.employerPf > 0 ? 'Employer PF and gratuity are inside this CTC, so they come off it above.' : `Employer PF (${inr(0.12 * a.pay.basic)}) and gratuity are paid on top of the CTC, so they are not taken off here.`} Old-regime deductions counted: ${parts.join(', ')}.`]),
      el('div', { class: 'quick-links' }, [
        // the payslip and the full form work from a saved salary, which a take-home being tried out is not
        taxLink && mode !== 'want' ? el('a', { class: 'quick-link', href: taxLink.href, onclick: taxLink.onclick }, taxLink.text) : null,
        salaryLink && mode !== 'want' ? el('a', { class: 'quick-link', href: salaryLink.href, onclick: salaryLink.onclick }, salaryLink.text) : null,
        el('a', { class: 'quick-link', href: '/calculators/budget', onclick: () => setHandoff('budget', { income: Math.round(a.monthly.best) }, 'salary') }, 'Plan your savings with this →'),
      ]),
      assume,
    ]);
  }

  function paint() {
    const wanting = mode === 'want';
    exampleBtn.hidden = wanting || q.ctc > 0;
    slot.classList.toggle('wanting', wanting);
    for (const b of modeBtns) b.setAttribute('aria-pressed', String(b.dataset.mode === mode));
    ctcLabel.hidden = wanting; wantLabel.hidden = !wanting;
    if (document.activeElement !== wantInput) wantInput.value = rupees(want);
    wantEcho.textContent = want > 0 ? `${inr(want)} a month` : '';
    const hasCtc = wanting ? want >= 10000 : q.ctc >= 100000;
    let a = null, need = null;
    if (wanting) { if (hasCtc) { need = ctcForInHand(want, { ...q, ctc: 0 }, rates); a = need ? need[need.best].a : { error: 'No CTC up to ₹100 crore reaches that take-home.' }; } }
    else a = q.ctc > 0 ? quickAnswer(q, rates) : null;
    echo.textContent = q.ctc > 0 ? `${inrShort(q.ctc)} a year` : '';
    assumePt.textContent = inr(q.professionalTax ?? QUICK_DEFAULTS.professionalTax);
    // step 2 waits for a CTC; the answer waits for step 2
    bonusStep.hidden = !hasCtc || !asking;
    for (const b of kindBtns) b.setAttribute('aria-pressed', String(b.dataset.kind === bonusKind));
    bonusAmount.hidden = !(bonusKind === 'ctc' || bonusKind === 'top');
    if (document.activeElement !== bonusInput) bonusInput.value = rupees(q.variable);
    const ok = !!(a && !a.error) && hasCtc && !!bonusKind;
    slot.classList.toggle('has-answer', ok);
    slot.classList.toggle('asking', hasCtc && !bonusKind);
    answer.hidden = !(ok || (a && a.error && hasCtc));
    deeperBox.hidden = !ok;
    breakdown.hidden = !ok;
    deeperBtn.hidden = deeper;
    deeperBody.hidden = !deeper;
    hikeBox.hidden = !ok || wanting;
    pfBox.hidden = !ok;
    pfInput.checked = !!q.pfInCtc;
    if (a && !a.error) pfNote.textContent = q.pfInCtc
      ? `Ticked: ${inr(a.pay.employerPf + a.pay.gratuity)} of the CTC is employer PF and gratuity, saved for you rather than paid, so the salary paid is ${inr(a.pay.grossSalary)}.`
      : `Unticked: they are paid on top of the CTC, as many offer letters show. Tick if yours lists them inside it.`;
    if (a && a.error) { paintAnswer(a); return; }
    if (!ok) return;
    // the funnel: an answer was shown (once a tab), and whether it came from the reverse question
    if (source === 'quick:tax') { countEvent('answer'); if (wanting) countEvent('want'); }
    paintAnswer(a, need);
    if (!wanting) {
      const h = hike > 0 ? quickAnswer({ ...q, ctc: Math.round(q.ctc * (1 + hike / 100)) }, rates) : null;
      const gain = h && !h.error ? h.inHand.best - a.inHand.best : 0;
      hikeOut.textContent = gain > 0 ? `→ ${inr(gain)} more a year in hand (${inr(gain / 12)} a month): ${+(100 * gain / a.inHand.best).toFixed(1)}% after tax.` : '';
    }
    paintVerdict(a);
    paintBreakdown(a);
    refreshFields(a);
  }

  breakdown.append(el('summary', {}, 'See how this adds up'), breakdownBody);

  setChildren(slot, [
    el('div', { class: 'card quick quick-flow' }, [
      modeSwitch,
      el('div', { class: 'quick-top' }, [
        el('div', { class: 'quick-in-wrap' }, [ctcLabel, wantLabel]),
        startOver,
      ]),
      el('p', { class: 'quick-privacy muted small' }, ['As on your offer letter. No sign-up; what you type stays on this device. ', exampleBtn]),
      bonusStep,
      answer,
      pfBox,
      hikeBox,
      deeperBox,
      breakdown,
    ]),
  ]);
  paint();

  const fromSaved = (p) => {
    q = { ...fromProfile(p), ...(ctc && !p.income.ctc ? { ctc } : {}) };
    ctcInput.value = rupees(q.ctc);
    basicInput.value = q.basicPct;
    // a salary saved elsewhere answers the bonus question; an emptied one asks it again
    if (!asking) bonusKind = q.ctc > 0 ? knownBonus(q) : null;
    if (!bonusKind) asking = true;
    if (DEDUCTIONS.some((d) => q[d.key] > 0) || ADJUST.some((d) => +q.inhand?.[d.key] > 0) || q.employerNpsPct > 0) deeper = true;
    adjFold.open = adjFold.open || ADJUST.some((d) => +q.inhand?.[d.key] > 0);
    paint();
  };
  // Start over: the salary and deductions go from the profile in one undoable step, and the detailed
  // calculator on the same page (tax form, in-hand calculator) is told to clear itself too.
  startOver.addEventListener('click', () => {
    updateProfile(clearSalary, `reset:${source}`);
    deeper = false; bonusKind = null; asking = true; want = 0; hike = 0; hikeInput.value = ''; keepWant();
    fromSaved(getProfile());
    bonusKind = null; asking = true; paint();
    window.dispatchEvent(new CustomEvent('taxcompass:startover', { detail: { source } }));
    if (!ctc) (mode === 'want' ? wantInput : ctcInput).focus();
  });
  const offChange = onProfileChange((p) => { if (!slot.contains(document.activeElement)) fromSaved(p); }, source);
  // a figure typed just before the tab is closed or reloaded is saved, not lost to the debounce
  const flush = () => { if (document.visibilityState === 'hidden') save.flush(); };
  window.addEventListener('pagehide', save.flush);
  document.addEventListener('visibilitychange', flush);
  live.set(source, () => { offChange(); window.removeEventListener('pagehide', save.flush); document.removeEventListener('visibilitychange', flush); });
}

/**
 * A detailed tool under the quick answer, folded until asked for. Opens by itself on its own hash link
 * (#detail, #payslip); otherwise every visit starts with it closed. onOpen runs each time it opens.
 */
export function detailFold(key, container, { label, openLabel, hash = '#detail', onOpen }) {
  // an open state remembered by an older version is dropped: the page always starts clean
  try { localStorage.removeItem(DETAIL); } catch {}
  const btn = el('button', { type: 'button', class: 'detail-toggle', 'aria-expanded': 'false' });
  const setOpen = (v, { scroll = false } = {}) => {
    container.classList.toggle('detail-closed', !v);
    btn.setAttribute('aria-expanded', String(v));
    btn.textContent = v ? openLabel : label;
    if (v && onOpen) onOpen();
    if (v) window.dispatchEvent(new Event('resize'));   // charts drawn while hidden re-measure
    // after the router's own scroll to the top, which runs once the route has been handled
    if (v && scroll) setTimeout(() => btn.scrollIntoView({ block: 'start', behavior: 'smooth' }), 60);
  };
  btn.addEventListener('click', () => setOpen(container.classList.contains('detail-closed')));
  setOpen(location.hash === hash, { scroll: location.hash === hash });
  return { button: btn, open: (scroll = true) => setOpen(true, { scroll }) };
}
