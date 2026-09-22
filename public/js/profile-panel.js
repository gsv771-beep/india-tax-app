/**
 * "Your profile": the collapsible panel on every page that shows and edits the shared profile.
 * Every field writes straight to the store; every tool on the site reads from it.
 * Also carries the privacy indicator, export / import, one-click reset and one-click wipe.
 */
import { el, setChildren, inr } from './util.js';
import { attachSlider } from './amount-input.js';
import { emailWorkbookCard } from './email-card.js';
import { getProfile, updateProfile, resetProfile, wipeEverything, exportSnapshotJSON, importProfileJSON, onProfileChange } from './profile-store.js';
import { profileSummary, isEmptyProfile, ctcOf, emiFor, CITIES, METRO_CITIES, LOAN_TYPES, PROPERTY_USE, INVESTMENT_BUCKETS } from '../engine/profile.js';

const SOURCE = 'panel';
const BUCKET_LABELS = { equity: 'Equity (stocks, equity funds)', debt: 'Debt funds', epf: 'EPF', ppf: 'PPF', nps: 'NPS', fd: 'Fixed deposits', gold: 'Gold' };
const LOAN_LABELS = { home: 'Home loan', car: 'Car loan', personal: 'Personal loan', education: 'Education loan', other: 'Other loan' };
const USE_LABELS = { self_occupied: 'Self-occupied home', let_out: 'Let-out property', none: 'Not a property loan' };


export function initProfilePanel() {
  const root = document.getElementById('profile-panel');
  if (!root) return;

  const summary = el('span', { class: 'profile-summary' });
  const chev = el('span', { class: 'chev', 'aria-hidden': 'true' }, '▾');
  const toggle = el('button', { type: 'button', class: 'profile-toggle', 'aria-expanded': 'false', 'aria-controls': 'profile-body' }, [
    el('span', { class: 'profile-title' }, 'Your profile'), summary, chev,
  ]);
  const badge = el('span', { class: 'privacy-badge', title: 'Saved only in this browser. TaxCompass has no account system and no database of users; nothing you type here is ever transmitted.' }, [
    el('span', { class: 'lock', 'aria-hidden': 'true' }, '🔒'), 'Stays on this device. Never sent anywhere.',
  ]);
  const body = el('div', { id: 'profile-body', class: 'profile-body', hidden: true });
  root.append(el('div', { class: 'profile-bar' }, [toggle, badge]), body);

  // Starts closed on every page load and closes when you move to another page: the panel is a place to
  // check or fix a figure, not something to read past on the way to a calculator.
  let open = false;
  const setOpen = (v) => {
    open = v; body.hidden = !v; toggle.setAttribute('aria-expanded', String(v)); root.classList.toggle('open', v);
    if (v) renderBody();
  };
  toggle.addEventListener('click', () => setOpen(!open));
  window.addEventListener('taxcompass:navigate', () => { if (open) setOpen(false); });

  const refreshSummary = (p) => { summary.textContent = profileSummary(p, inr); };
  refreshSummary(getProfile());

  onProfileChange((p) => { refreshSummary(p); if (open) renderBody(); }, SOURCE);
  window.addEventListener('profilechange', (e) => { if (e.detail.source === SOURCE) refreshSummary(e.detail.profile); });

  function renderBody() {
    const p = getProfile();
    const status = el('div', { class: 'profile-status', role: 'status' });
    // Inputs whose value is worked out from others (CTC, EMI) refresh after every edit, unless focused.
    const derived = [];
    const refreshDerived = () => { const q = getProfile(); for (const { input, get } of derived) if (document.activeElement !== input) input.value = get(q) || ''; };
    const set = (fn, rebuild = false) => { updateProfile((d) => { fn(d); return d; }, SOURCE); if (rebuild) renderBody(); else refreshDerived(); };

    // ---- generic field helpers: every edit goes straight to the store ----
    const numField = (label, get, put, attrs = {}, hint) => {
      const input = el('input', { type: 'number', min: 0, step: attrs.step || 1, value: get(p) || '', placeholder: attrs.placeholder || '0', ...(attrs.max ? { max: attrs.max } : {}) });
      input.addEventListener('input', () => set((d) => put(d, +input.value || 0)));
      if (attrs.derived) derived.push({ input, get: attrs.derived });
      const node = el('label', {}, [label, hint ? el('small', {}, hint) : null, input]);
      if (attrs.slider) attachSlider(input, { max: attrs.slider, step: attrs.step || 1 });   // drag for the big amounts; typing still wins
      return node;
    };
    const selectField = (label, options, get, put, hint, rebuild = false) => {
      const input = el('select', {}, options.map(([v, t]) => el('option', { value: v, selected: String(v) === String(get(p)) }, t)));
      input.addEventListener('change', () => set((d) => put(d, input.value), rebuild));
      return el('label', {}, [label, hint ? el('small', {}, hint) : null, input]);
    };
    const checkField = (label, get, put) => {
      const input = el('input', { type: 'checkbox' }); input.checked = !!get(p);
      input.addEventListener('change', () => set((d) => put(d, input.checked)));
      return el('label', { class: 'check' }, [input, label]);
    };
    const group = (title, children, note) => el('fieldset', { class: 'profile-group' }, [el('legend', {}, title), note ? el('p', { class: 'small muted' }, note) : null, el('div', { class: 'grid' }, children)]);

    // Income: components add up to the CTC. Editing the CTC balances "other allowances"; editing a component moves the CTC.
    const comp = (key, label, hint) => numField(label, (d) => d.income[key], (d, v) => { d.income[key] = v; d.income.ctc = ctcOf(d.income); }, { step: 1000, slider: key === 'basic' || key === 'variablePay' ? 20000000 : 0 }, hint);
    const income = group('Income (per year)', [
      numField('Cost to company (₹)', (d) => d.income.ctc, (d, v) => { const i = d.income; i.ctc = v; i.otherAllowances = Math.max(0, v - i.basic - i.hra - i.conveyance - i.variablePay - i.employerNps - i.employerPf - i.gratuity - i.esop); }, { step: 50000, slider: 100000000, derived: (d) => d.income.ctc }, 'drag or type, up to ₹10 crore; special allowance absorbs the difference'),
      comp('basic', 'Basic + DA (₹)', 'drives HRA, PF, NPS caps'),
      comp('hra', 'HRA received (₹)'),
      comp('conveyance', 'Conveyance allowance (₹)', 'taxable since 2018'),
      comp('variablePay', 'Variable pay / bonus (₹)', 'target amount for the year'),
      comp('otherAllowances', 'Special allowance (₹)', 'the balancing figure: LTA, meal card, anything else'),
      comp('employerPf', 'Employer PF (₹)', 'usually 12% of basic'),
      comp('employerNps', 'Employer NPS, 80CCD(2) (₹)', 'employer contribution, not your own'),
      comp('gratuity', 'Gratuity provision (₹)', '4.81% of basic if in your CTC'),
      comp('esop', 'ESOP / RSU vesting (₹)', 'perquisite value taxed as salary'),
    ]);

    const person = group('About you', [
      numField('Age', (d) => d.person.age, (d, v) => { d.person.age = Math.round(v); }, { step: 1, max: 100 }, 'sets how long a lender lets a loan run'),
      numField('Credit score', (d) => d.person.creditScore, (d, v) => { d.person.creditScore = Math.round(v); }, { step: 1, max: 900, placeholder: 'e.g. 760' }, 'CIBIL / Experian, 300 to 900; leave 0 if unknown'),
      selectField('Income comes from', [['salaried', 'Salary'], ['self_employed', 'Business or profession'], ['both', 'Both']], (d) => d.person.employment, (d, v) => { d.person.employment = v; }, 'switches the tax page between salary and business questions', true),
    ], 'Stays on this device like everything else.');

    const business = p.person.employment === 'salaried' ? null : group('Business or profession (per year)', [
      numField('Gross receipts or turnover (₹)', (d) => d.business.receipts, (d, v) => { d.business.receipts = v; }, { step: 50000, slider: 100000000, placeholder: 'e.g. 3000000' }, 'before expenses; drag or type, up to ₹10 crore'),
      selectField('This is a', [['profession', 'Profession (44ADA)'], ['business', 'Business or trade (44AD)']], (d) => d.business.kind, (d, v) => { d.business.kind = v; }),
      selectField('Presumptive scheme', [['yes', 'Yes: deemed profit, no books'], ['no', 'No: receipts less expenses']], (d) => (d.business.presumptive ? 'yes' : 'no'), (d, v) => { d.business.presumptive = v === 'yes'; }),
      numField('Business expenses, if not presumptive (₹)', (d) => d.business.expenses, (d, v) => { d.business.expenses = v; }, { step: 10000 }),
      numField('TDS clients already deducted (₹)', (d) => d.business.tds, (d, v) => { d.business.tds = v; }, { step: 1000 }, 'from Form 26AS / AIS'),
    ]);

    const tax = group('Tax', [
      selectField('Regime you are on', [['new', 'New regime'], ['old', 'Old regime']], (d) => d.tax.regime, (d, v) => { d.tax.regime = v; }),
      selectField('Financial year', [['FY2026-27', 'FY 2026-27'], ['FY2025-26', 'FY 2025-26']], (d) => d.tax.fy, (d, v) => { d.tax.fy = v; }),
      selectField('Age', [['below_60', 'Below 60'], ['senior_60_to_79', '60 to 79'], ['super_senior_80_plus', '80 and above']], (d) => d.tax.ageBand, (d, v) => { d.tax.ageBand = v; }),
      numField('80C already used, excluding EPF (₹)', (d) => d.tax.s80cUsed, (d, v) => { d.tax.s80cUsed = v; }, { step: 1000 }, 'PPF, ELSS, LIC, tuition, home loan principal'),
      numField('80D health insurance (₹)', (d) => d.tax.s80dUsed, (d, v) => { d.tax.s80dUsed = v; }, { step: 500 }),
      numField('Own NPS, 80CCD(1B) (₹)', (d) => d.tax.nps1bUsed, (d, v) => { d.tax.nps1bUsed = v; }, { step: 1000 }, 'your contribution, cap ₹50,000'),
      numField('Other deductions (₹)', (d) => d.tax.otherDeductions, (d, v) => { d.tax.otherDeductions = v; }, { step: 1000 }, '80E, 80G, 80U and the like'),
    ]);

    const location = group('Home and city', [
      selectField('City', CITIES.map((c) => [c, c]), (d) => d.location.city, (d, v) => { d.location.city = v; d.location.metro = METRO_CITIES.includes(v); }, null, true),
      checkField('Metro city for HRA (50% of basic)', (d) => d.location.metro, (d, v) => { d.location.metro = v; }),
      selectField('Housing', [['rent', 'I rent'], ['own', 'I own my home']], (d) => d.location.housing, (d, v) => { d.location.housing = v; }),
      numField('Rent paid per year (₹)', (d) => d.location.rentPaid, (d, v) => { d.location.rentPaid = v; }, { step: 1000 }),
    ]);

    // Loans: a list. EMI is recomputed from the other three unless typed in directly.
    const loanRows = p.loans.map((l, idx) => el('div', { class: 'profile-row' }, [
      selectField('Type', LOAN_TYPES.map((t) => [t, LOAN_LABELS[t]]), () => l.type, (d, v) => { d.loans[idx].type = v; }, null, true),
      numField('Outstanding (₹)', () => l.outstanding, (d, v) => { const x = d.loans[idx]; x.outstanding = v; x.emi = emiFor(x.outstanding, x.rate, x.remainingMonths); }, { step: 50000, slider: 50000000 }),
      numField('Rate (% p.a.)', () => l.rate, (d, v) => { const x = d.loans[idx]; x.rate = v; x.emi = emiFor(x.outstanding, x.rate, x.remainingMonths); }, { step: 0.05 }),
      numField('Months left', () => l.remainingMonths, (d, v) => { const x = d.loans[idx]; x.remainingMonths = Math.round(v); x.emi = emiFor(x.outstanding, x.rate, x.remainingMonths); }, { step: 1 }),
      numField('EMI (₹/month)', () => Math.round(l.emi), (d, v) => { d.loans[idx].emi = v; }, { step: 100, derived: (d) => Math.round(d.loans[idx]?.emi || 0) }, 'worked out from the rest; overwrite if yours differs'),
      l.type === 'home' ? selectField('Property', PROPERTY_USE.map((u) => [u, USE_LABELS[u]]), () => l.propertyUse, (d, v) => { d.loans[idx].propertyUse = v; }, 'decides how Section 24(b) applies') : null,
      el('button', { type: 'button', class: 'btn secondary small-btn', onclick: () => set((d) => { d.loans.splice(idx, 1); }, true) }, 'Remove'),
    ]));
    const loans = el('fieldset', { class: 'profile-group wide' }, [
      el('legend', {}, 'Loans'),
      p.loans.length ? loanRows : el('p', { class: 'small muted' }, 'No loans. Add one to see prepayment against investment in the Decide tool.'),
      el('button', { type: 'button', class: 'btn secondary small-btn', onclick: () => set((d) => { d.loans.push({ type: 'home', outstanding: 0, rate: 8.5, remainingMonths: 240, emi: 0, propertyUse: d.location.housing === 'own' ? 'self_occupied' : 'none' }); }, true) }, '+ Add a loan'),
    ]);

    const investments = group('What you hold today', INVESTMENT_BUCKETS.map((b) => numField(`${BUCKET_LABELS[b]} (₹)`, (d) => d.investments[b], (d, v) => { d.investments[b] = v; }, { step: 25000, slider: 50000000 })), 'Current value of each bucket. Used for allocation and post-tax projections.');

    const cashflow = group('Cash flow (per month)', [
      numField('Free to invest or prepay (₹/month)', (d) => d.cashflow.monthlySurplus, (d, v) => { d.cashflow.monthlySurplus = v; }, { step: 2500, slider: 1000000 }, 'income less expenses'),
      numField('Emergency fund held (₹)', (d) => d.cashflow.emergencyFund, (d, v) => { d.cashflow.emergencyFund = v; }, { step: 25000, slider: 10000000 }),
    ]);

    const agesInput = el('input', { type: 'text', value: p.household.childrenAges.join(', '), placeholder: 'e.g. 4, 9', inputmode: 'numeric' });
    agesInput.addEventListener('change', () => set((d) => { d.household.childrenAges = agesInput.value.split(/[,\s]+/).map(Number).filter((n) => Number.isFinite(n) && n >= 0 && n < 60); }));
    const goalRows = p.horizon.goals.map((g, idx) => el('div', { class: 'profile-row' }, [
      (() => { const i = el('input', { type: 'text', value: g.name, maxlength: 40 }); i.addEventListener('change', () => set((d) => { d.horizon.goals[idx].name = i.value || 'Goal'; })); return el('label', {}, ['Goal', i]); })(),
      numField('Years away', () => g.years, (d, v) => { d.horizon.goals[idx].years = v; }, { step: 1, max: 60 }),
      numField('Amount needed then (₹)', () => g.target, (d, v) => { d.horizon.goals[idx].target = v; }, { step: 100000 }, 'optional'),
      el('button', { type: 'button', class: 'btn secondary small-btn', onclick: () => set((d) => { d.horizon.goals.splice(idx, 1); }, true) }, 'Remove'),
    ]));
    const household = el('fieldset', { class: 'profile-group wide' }, [
      el('legend', {}, 'Household and goals'),
      el('div', { class: 'grid' }, [
        numField('Dependants', (d) => d.household.dependents, (d, v) => { d.household.dependents = Math.round(v); }, { step: 1, max: 20 }),
        el('label', {}, ['Children’s ages', el('small', {}, 'comma separated'), agesInput]),
      ]),
      goalRows,
      el('button', { type: 'button', class: 'btn secondary small-btn', onclick: () => set((d) => { d.horizon.goals.push({ name: 'Goal', years: 10, target: 0 }); }, true) }, '+ Add a goal'),
    ]);

    // ---- export / import / reset / wipe ----
    const fileInput = el('input', { type: 'file', accept: 'application/json,.json', hidden: true });
    fileInput.addEventListener('change', async () => {
      const f = fileInput.files && fileInput.files[0];
      if (!f) return;
      try { const r = importProfileJSON(await f.text()); if (r && r.snapshot) { status.textContent = `Restored ${f.name}. Reloading…`; setTimeout(() => location.reload(), 300); } else status.textContent = `Imported ${f.name}. Every tool now uses it.`; }
      catch (e) { status.textContent = e.message; }
      fileInput.value = '';
    });
    // Email is the way to keep a copy or move devices: the file that arrives is the one Restore takes back.
    const emailBox = el('div', { hidden: true });
    const emailCard = emailWorkbookCard({
      title: 'Email me my profile', source: 'profile', buttonLabel: 'Email me my profile',
      intro: 'A small file with your profile and every calculator’s inputs, sent to you only; TaxCompass keeps no copy. On another device, open Your profile and choose Restore from file.',
      buildBase64: async () => btoa(unescape(encodeURIComponent(exportSnapshotJSON()))), fileName: () => 'taxcompass-profile.json',
    });
    emailBox.append(emailCard);
    const actions = el('div', { class: 'profile-actions' }, [
      el('button', { type: 'button', class: 'btn', onclick: () => { emailBox.hidden = !emailBox.hidden; if (!emailBox.hidden) emailBox.scrollIntoView({ block: 'nearest', behavior: 'smooth' }); } }, 'Email me my profile'),
      el('button', { type: 'button', class: 'btn secondary', onclick: () => fileInput.click(), title: 'The file from an earlier email' }, 'Restore from file'),
      fileInput,
      el('button', { type: 'button', class: 'btn secondary', onclick: () => { resetProfile(SOURCE); status.textContent = 'Profile reset. Other calculators keep their own inputs until you change them.'; renderBody(); } }, 'Reset profile'),
      el('button', { type: 'button', class: 'btn-link danger-link', onclick: () => { if (confirm('Remove your profile and every calculator’s inputs from this browser?')) { wipeEverything(); location.reload(); } } }, 'Wipe everything from this browser'),
    ]);

    setChildren(body, [
      el('p', { class: 'privacy-note' }, [
        el('strong', {}, 'Private by design. '),
        'Everything below is stored only in this browser’s local storage and read by every tool on this site. It is never uploaded, there is no account, and TaxCompass keeps no copy. Email it to yourself to keep a copy or move to another device; clear it any time with the wipe link. ',
        el('a', { href: '/about' }, 'How the site handles data'),
      ]),
      isEmptyProfile(p) ? el('p', { class: 'small muted' }, 'Tip: fill in the tax comparison or the in-hand salary calculator and this fills itself in.') : null,
      el('div', { class: 'profile-grid' }, [income, business, tax, person, location, loans, investments, cashflow, household]),
      actions, status, emailBox,
    ]);
  }

}
