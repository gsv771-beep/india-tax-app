/**
 * Home buying: the true cost of a property (stamp duty, registration, GST, builder extras, loan
 * costs) and how much a lender will let you borrow against it, on one page. Reads the shared
 * profile for income, existing EMIs, age, credit score and city; writes back the facts about you.
 * Engine: engine/property.js and engine/loan-eligibility.js. Data: data/property_charges.json,
 * data/loan_policy.json.
 */
import { inr, pct, el, setChildren, disclaimer, animateNumber, debounce, isBlankAfterReset, clearBlankAfterReset } from './util.js';
import { propertyCost, PROPERTY_CITIES, STATUSES, BUYERS } from '../engine/property.js';
import { loanEligibility } from '../engine/loan-eligibility.js';
import { paymentPlan, PLAN_PRESETS, presetFor } from '../engine/payment-plan.js';
import { getProfile, updateProfile } from './profile-store.js';
import { toSalaryStore, grossSalaryOf, isEmptyProfile } from '../engine/profile.js';
import { salaryBreakdown } from './salary.js';
import { setHandoff } from './handoff.js';
import { calcExportCard } from './calc-export-card.js';

const STORE = 'taxcompass.home.v1';
const SOURCE = 'calc:home';
const STATUS_LABELS = { under_construction: 'Under construction, from a builder', ready: 'Ready to move, from a builder (has OC)', resale: 'Resale, from an owner' };
const BUYER_LABELS = { man: 'A man', woman: 'A woman (sole name)', joint: 'Joint, man and woman' };
const KIND_LABELS = { price: 'Price', statutory: 'Paid to the state', customary: 'Fees', builder: 'Builder charges', loan: 'Loan costs', optional: 'Optional' };
const KIND_COLORS = { price: 'var(--accent)', statutory: '#c9a227', customary: '#8a948e', builder: '#2a78d6', loan: '#eb6834', optional: '#b083d6' };
const BINDING_TEXT = {
  foir: 'your repayment capacity: total EMIs must stay within the lender’s share of income',
  ltv: 'the RBI loan-to-value cap on this property, not your income',
  tenure: 'your age: the lender wants the loan closed by its cutoff, which shortens the tenure',
  credit: 'your credit score',
};

export function renderHomeBuying({ rates, propertyCharges: charges, loanPolicy: policy }) {
  const p = getProfile();
  let saved = {}; try { saved = JSON.parse(localStorage.getItem(STORE) || '{}'); } catch {}

  // --- what the profile already knows ---
  const fromProfile = {};
  const blank = isBlankAfterReset('home');
  if (!isEmptyProfile(p) && !blank) {
    if (p.income.ctc > 0) {
      const r = salaryBreakdown({ ...toSalaryStore(p), professionalTax: 2400 }, rates);
      if (!r.error) fromProfile.netMonthly = Math.round(r.monthly);
      fromProfile.grossMonthly = Math.round(grossSalaryOf(p) / 12);
    }
    fromProfile.existingEmi = Math.round(p.loans.reduce((s, l) => s + (l.emi || 0), 0));
    if (PROPERTY_CITIES.includes(p.location.city)) fromProfile.city = p.location.city;
    const homeGoal = p.horizon.goals.find((g) => /home|house|flat|property/i.test(g.name) && g.target > 0);
    if (homeGoal) fromProfile.price = homeGoal.target;
  }
  if (!blank) { fromProfile.age = p.person.age || 0; fromProfile.creditScore = p.person.creditScore || 0; fromProfile.employment = p.person.employment; }

  const st = {
    city: 'Mumbai', price: '', status: 'under_construction', buyer: 'man', affordable: false, brokerageRate: 1, brokerageOnNew: false, interiors: 0, legalAndValuation: charges.customary.legal_and_valuation.default_amount,
    builderCharges: [],
    netMonthly: 0, grossMonthly: 0, variablePayMonthly: 0, rentalMonthly: 0, coApplicantMonthly: 0, existingEmi: 0, creditCardOutstanding: 0, creditScore: 0, age: 0, employment: 'salaried',
    ratePct: policy.rate.default_pct, tenureYears: 20, downPayment: '',
    plan: { preset: '', tranches: null },
    incomeBasis: policy.foir.income_basis, foirOverride: '', loanEndAge: '', maxTenureYears: policy.age.max_tenure_years, processingFeeRate: charges.customary.loan_processing_fee.default_rate * 100, processingFeeCap: charges.customary.loan_processing_fee.cap,
    ...saved, ...fromProfile,
  };
  const save = () => {
    clearBlankAfterReset('home');
    try { localStorage.setItem(STORE, JSON.stringify(st)); } catch {}
    if (!(+st.age > 0) && !(+st.creditScore > 0)) return;
    updateProfile((d) => { d.person.age = Math.round(+st.age || 0); d.person.creditScore = Math.round(+st.creditScore || 0); d.person.employment = st.employment; return d; }, SOURCE);
  };

  // --- inputs ---
  const fold = (title, children) => el('details', { class: 'opts fold' }, [el('summary', {}, title), ...children]);
  // Result sections are collapsed; which ones the user opened survives the re-render on every keystroke.
  const openFolds = new Set();
  const resultFold = (id, title, summary, children) => el('details', { class: 'result-fold', open: openFolds.has(id), ontoggle: (ev) => { if (ev.target.open) openFolds.add(id); else openFolds.delete(id); } }, [
    el('summary', {}, [el('span', { class: 'rf-title' }, title), el('span', { class: 'rf-sum' }, summary)]), ...children,
  ]);
  const out = el('div');
  let last = null;
  const exportCard = calcExportCard('home', () => last);
  const render = () => paint();
  const rerender = debounce(render, 80);
  const field = (key, label, attrs = {}, hint) => {
    let input;
    if (attrs.options) input = el('select', {}, attrs.options.map(([v, t]) => el('option', { value: v, selected: String(v) === String(st[key]) }, t)));
    else if (attrs.type === 'checkbox') { input = el('input', { type: 'checkbox' }); input.checked = !!st[key]; }
    else input = el('input', { type: 'number', min: attrs.min ?? 0, max: attrs.max, step: attrs.step || 1, value: st[key] === '' ? '' : st[key], placeholder: attrs.placeholder });
    const immediate = !!attrs.options || attrs.type === 'checkbox';
    input.addEventListener(immediate ? 'change' : 'input', () => {
      st[key] = attrs.type === 'checkbox' ? input.checked : attrs.options ? input.value : input.value === '' ? '' : +input.value;
      if (key === 'status') { st.plan = { preset: presetFor(st.status), tranches: null }; buildPlanRows(); }
      save(); if (immediate || attrs.rebuild) { syncVisibility(); render(); } else rerender();
    });
    const node = attrs.type === 'checkbox' ? el('label', { class: 'check' }, [input, label]) : el('label', {}, [label, hint ? el('small', {}, hint) : null, input]);
    return { node, input };
  };

  // builder charges: free-form rows
  const builderList = el('div', { class: 'rows' });
  const suggestions = el('datalist', { id: 'builder-charge-suggestions' }, charges.customary.builder_charge_suggestions.map((s) => el('option', { value: s })));
  const addBuilderRow = (row) => {
    const label = el('input', { type: 'text', value: row.label || '', placeholder: 'e.g. Covered car parking', list: 'builder-charge-suggestions', maxlength: 50 });
    const amount = el('input', { type: 'number', min: 0, step: 10000, value: row.amount || '', placeholder: '₹' });
    const node = el('div', { class: 'lump-row' }, [el('label', {}, ['Charge', label]), el('label', {}, ['Amount (₹)', amount]), el('button', { type: 'button', class: 'btn secondary small-btn', 'aria-label': 'Remove this charge', onclick: () => { st.builderCharges = st.builderCharges.filter((b) => b !== row); node.remove(); save(); render(); } }, 'Remove')]);
    label.addEventListener('input', () => { row.label = label.value; save(); rerender(); });
    amount.addEventListener('input', () => { row.amount = +amount.value || 0; save(); rerender(); });
    builderList.append(node);
  };
  st.builderCharges.forEach(addBuilderRow);

  const F = {
    city: field('city', 'City', { options: PROPERTY_CITIES.map((c) => [c, c]) }),
    price: field('price', 'Agreed price (₹)', { step: 100000, placeholder: 'e.g. 8000000' }, 'the figure on the agreement; the state may charge duty on its own guideline value if higher'),
    status: field('status', 'What you are buying', { options: STATUSES.map((s) => [s, STATUS_LABELS[s]]) }),
    buyer: field('buyer', 'Registered in the name of', { options: BUYERS.map((b) => [b, BUYER_LABELS[b]]) }, 'some states charge women less'),
    affordable: field('affordable', 'Qualifies as affordable housing (GST 1%): value up to ₹45 lakh and carpet area within limits', { type: 'checkbox' }),
    brokerageRate: field('brokerageRate', 'Brokerage (%)', { step: 0.5, max: 5 }),
    brokerageOnNew: field('brokerageOnNew', 'I am paying a broker on this builder purchase', { type: 'checkbox' }),
    interiors: field('interiors', 'Interiors and furnishing (₹)', { step: 50000 }, 'optional; not financed by the home loan'),
    legalAndValuation: field('legalAndValuation', 'Legal, title search and valuation (₹)', { step: 1000 }),

    netMonthly: field('netMonthly', 'Net monthly take-home (₹)', { step: 1000 }, fromProfile.netMonthly ? 'from your profile: CTC after PF, professional tax and income tax' : 'as on your salary slip'),
    grossMonthly: field('grossMonthly', 'Gross monthly salary (₹)', { step: 1000 }, 'used only if the assumptions switch to a gross basis'),
    variablePayMonthly: field('variablePayMonthly', 'Variable pay, monthly average (₹)', { step: 1000 }, `lenders count about ${Math.round(policy.income_haircuts.variable_pay * 100)}% of it`),
    rentalMonthly: field('rentalMonthly', 'Rental income received (₹/month)', { step: 1000 }, `counted at ${Math.round(policy.income_haircuts.rental_income * 100)}%`),
    coApplicantMonthly: field('coApplicantMonthly', 'Co-applicant’s net monthly income (₹)', { step: 1000 }, 'spouse or parent joining the loan; 0 if none'),
    existingEmi: field('existingEmi', 'Existing EMIs (₹/month)', { step: 500 }, fromProfile.existingEmi ? 'from the loans in your profile' : 'car, personal, education loans'),
    creditCardOutstanding: field('creditCardOutstanding', 'Credit card balances carried (₹)', { step: 5000 }, `lenders count ${Math.round(policy.obligations.credit_card_pct_of_outstanding * 100)}% of it as a monthly obligation`),
    creditScore: field('creditScore', 'Credit score', { step: 1, max: 900, placeholder: 'e.g. 760' }, '0 if you do not know it; saved to your profile'),
    age: field('age', 'Your age', { step: 1, max: 100 }, 'saved to your profile'),
    employment: field('employment', 'Employment', { options: [['salaried', 'Salaried'], ['self_employed', 'Self-employed / business']] }),

    ratePct: field('ratePct', 'Interest rate offered (% p.a.)', { step: 0.05, max: 20 }, policy.rate.range_note),
    tenureYears: field('tenureYears', 'Tenure you want (years)', { step: 1, min: 1, max: 30 }),
    downPayment: field('downPayment', 'Down payment you will put in (₹)', { step: 100000, placeholder: 'blank = the least the lender lets you' }, 'your own money towards the price; charges come on top and are never financed'),

    incomeBasis: field('incomeBasis', 'Income the lender measures FOIR against', { options: [['net', 'Net take-home (most sanctioning teams)'], ['gross', 'Gross salary (some lender calculators)']] }),
    foirOverride: field('foirOverride', 'FOIR cap override (%)', { step: 1, max: 90, placeholder: 'blank = by income band' }, 'total EMIs as a share of counted income'),
    loanEndAge: field('loanEndAge', 'Loan must end by age', { step: 1, max: 80, placeholder: `blank = ${policy.age.loan_must_end_by.salaried} salaried / ${policy.age.loan_must_end_by.self_employed} self-employed` }, policy.age.lender_variants),
    maxTenureYears: field('maxTenureYears', 'Maximum tenure (years)', { step: 1, min: 5, max: 40 }),
    processingFeeRate: field('processingFeeRate', 'Loan processing fee (%)', { step: 0.05, max: 3 }),
    processingFeeCap: field('processingFeeCap', 'Processing fee cap (₹)', { step: 1000 }, '0 = no cap'),
  };

  // Phase-wise payment plan: a preset chosen by what you are buying, then editable stage by stage.
  if (!st.plan || typeof st.plan !== 'object') st.plan = { preset: '', tranches: null };
  const planList = el('div', { class: 'rows' });
  const presetSelect = el('select', {}, Object.entries(PLAN_PRESETS).map(([k, v]) => el('option', { value: k }, v.label)));
  const planNote = el('p', { class: 'opt-help' });
  const currentTranches = () => (Array.isArray(st.plan.tranches) ? st.plan.tranches : PLAN_PRESETS[st.plan.preset || presetFor(st.status)].tranches.map((t) => ({ ...t })));
  const applyPreset = (key) => { st.plan = { preset: key, tranches: PLAN_PRESETS[key].tranches.map((t) => ({ ...t })) }; save(); buildPlanRows(); render(); };
  presetSelect.addEventListener('change', () => applyPreset(presetSelect.value));
  const buildPlanRows = () => {
    const key = st.plan.preset || presetFor(st.status);
    presetSelect.value = key;
    planNote.textContent = PLAN_PRESETS[key].note;
    const tr = currentTranches();
    st.plan.tranches = tr;
    planList.replaceChildren(...tr.map((t, idx) => {
      const label = el('input', { type: 'text', value: t.label, maxlength: 40 });
      const pctIn = el('input', { type: 'number', min: 0, max: 100, step: 1, value: t.pct });
      const monthIn = el('input', { type: 'number', min: 0, max: 120, step: 1, value: t.month });
      label.addEventListener('input', () => { t.label = label.value; save(); rerender(); });
      pctIn.addEventListener('input', () => { t.pct = +pctIn.value || 0; save(); rerender(); });
      monthIn.addEventListener('input', () => { t.month = +monthIn.value || 0; save(); rerender(); });
      return el('div', { class: 'plan-row' }, [
        el('label', {}, ['Stage', label]), el('label', {}, ['% of price', pctIn]), el('label', {}, ['Month', monthIn]),
        el('button', { type: 'button', class: 'btn secondary small-btn', 'aria-label': 'Remove this stage', onclick: () => { tr.splice(idx, 1); save(); buildPlanRows(); render(); } }, '×'),
      ]);
    }));
  };
  buildPlanRows();
  const planBlock = fold('How the price is paid', [
    el('label', {}, ['Payment plan', presetSelect]), planNote, planList,
    el('button', { type: 'button', class: 'btn secondary small-btn', onclick: () => { const tr = currentTranches(); tr.push({ label: 'Stage', pct: 0, month: (tr.at(-1)?.month || 0) + 3 }); st.plan.tranches = tr; save(); buildPlanRows(); render(); } }, '+ Add a stage'),
  ]);

  const syncVisibility = () => {
    F.affordable.node.hidden = st.status !== 'under_construction';
    F.brokerageOnNew.node.hidden = st.status === 'resale';
    F.brokerageRate.node.hidden = !(st.status === 'resale' || st.brokerageOnNew);
    F.grossMonthly.node.hidden = st.incomeBasis !== 'gross';
  };
  syncVisibility();

  const foirTable = el('table', { class: 'compare small-table' }, [
    el('thead', {}, el('tr', {}, [el('th', {}, 'Counted income / month'), el('th', {}, 'Salaried'), el('th', {}, 'Self-employed')])),
    el('tbody', {}, policy.foir.bands.map((b, k) => el('tr', {}, [el('td', {}, b.income_upto == null ? `above ${inr(policy.foir.bands[k - 1].income_upto)}` : `up to ${inr(b.income_upto)}`), el('td', {}, pct(b.salaried, 0)), el('td', {}, pct(b.self_employed, 0))]))),
  ]);

  // Five fields answer the question; everything else is folded away with sensible defaults
  // (8% for 20 years, score 750+, a payment plan matching the purchase type, age and EMIs from the profile).
  const inputs = el('div', { class: 'card inputs' }, [
    el('div', { class: 'opts', style: 'border-top:0;padding-top:0' }, [
      el('div', { class: 'opt-title' }, 'The essentials'),
      el('div', { class: 'two' }, [F.city.node, F.price.node]),
      F.status.node,
      F.netMonthly.node,
      F.downPayment.node,
    ]),
    fold('More about the property', [
      F.buyer.node, F.affordable.node, F.brokerageOnNew.node, F.brokerageRate.node,
      el('div', { class: 'sub' }, [
        el('div', { class: 'sub-title' }, 'Builder or society charges'),
        el('p', { class: 'opt-help' }, 'Everything on the cost sheet that is not the price: parking, clubhouse, floor rise, maintenance advance. Type what you were quoted.'),
        suggestions, builderList,
        el('button', { type: 'button', class: 'btn secondary small-btn', onclick: () => { const row = { label: '', amount: 0 }; st.builderCharges.push(row); addBuilderRow(row); save(); } }, '+ Add a charge'),
      ]),
      el('div', { class: 'two' }, [F.legalAndValuation.node, F.interiors.node]),
    ]),
    fold('More about you', [
      F.grossMonthly.node,
      el('div', { class: 'two' }, [F.variablePayMonthly.node, F.rentalMonthly.node]),
      F.coApplicantMonthly.node,
      el('div', { class: 'two' }, [F.existingEmi.node, F.creditCardOutstanding.node]),
      el('div', { class: 'two' }, [F.creditScore.node, F.age.node]),
      F.employment.node,
    ]),
    fold('Loan terms', [el('div', { class: 'two' }, [F.ratePct.node, F.tenureYears.node])]),
    planBlock,
    fold('Lender assumptions', [
      el('p', { class: 'opt-help' }, 'Only the RBI loan-to-value cap is law. The rest is how a typical lender behaves; each bank has its own policy.'),
      F.incomeBasis.node, F.foirOverride.node,
      el('div', { class: 'table-wrap' }, foirTable),
      el('div', { class: 'two' }, [F.loanEndAge.node, F.maxTenureYears.node]),
      el('div', { class: 'two' }, [F.processingFeeRate.node, F.processingFeeCap.node]),
    ]),
  ]);

  // --- output ---
  function compute() {
    const eligibility = loanEligibility({
      netMonthly: +st.netMonthly, grossMonthly: +st.grossMonthly, variablePayMonthly: +st.variablePayMonthly, rentalMonthly: +st.rentalMonthly, coApplicantMonthly: +st.coApplicantMonthly,
      existingEmi: +st.existingEmi, creditCardOutstanding: +st.creditCardOutstanding, creditScore: +st.creditScore, age: +st.age, employment: st.employment,
      ratePct: +st.ratePct, tenureYears: +st.tenureYears, propertyPrice: +st.price, loanWanted: st.downPayment === '' ? 0 : Math.max(1, +st.price - (+st.downPayment || 0)),
      overrides: { incomeBasis: st.incomeBasis, foir: st.foirOverride === '' ? undefined : +st.foirOverride / 100, loanEndAge: st.loanEndAge === '' ? undefined : +st.loanEndAge, maxTenureYears: +st.maxTenureYears || undefined },
    }, policy);
    const cost = propertyCost({
      city: st.city, price: +st.price, status: st.status, buyer: st.buyer, affordable: !!st.affordable, brokerageRate: (+st.brokerageRate || 0) / 100, brokerageOnNew: !!st.brokerageOnNew,
      builderCharges: st.builderCharges, interiors: +st.interiors, legalAndValuation: +st.legalAndValuation, loanAmount: eligibility.loan,
      processingFeeRate: (+st.processingFeeRate || 0) / 100, processingFeeCap: +st.processingFeeCap || 0,
    }, charges);
    // Down payment towards the price: what you typed, or the least the lender's ceiling allows.
    const downPayment = st.downPayment === '' ? Math.max(0, +st.price - eligibility.loan) : Math.max(0, +st.downPayment || 0);
    if (st.downPayment !== '' && downPayment >= +st.price) { eligibility.loan = 0; eligibility.emi = 0; eligibility.foir.after = eligibility.foir.before; }
    const gstRate = cost.lines.find((l) => l.id === 'gst') ? cost.lines.find((l) => l.id === 'gst').amount / cost.price : 0;
    const plan = paymentPlan({
      price: +st.price, tranches: currentTranches(), downPayment, loan: eligibility.loan, ratePct: eligibility.rate.effective, tenureMonths: eligibility.tenure.used * 12,
      gstRate, upfrontCharges: cost.hiddenTotal - (cost.lines.find((l) => l.id === 'gst')?.amount || 0),
    });
    return { eligibility, cost, plan, downPayment, cashNeeded: Math.max(0, cost.total - eligibility.loan) };
  }

  function paint() {
    if (!(+st.price > 0)) {
      setChildren(out, [el('div', { class: 'notice' }, [el('strong', {}, 'Enter the agreed price to begin. '), 'The cost of buying and how much a lender would sanction both depend on it; nothing is worked out until it is in.'])]);
      return;
    }
    const { eligibility: e, cost: c, plan, downPayment, cashNeeded } = compute();
    last = { st: { ...st }, c, e, plan, downPayment, cashNeeded };
    const needMore = Math.max(0, +st.price - downPayment - e.maxLoan);
    const stat = (k, v, cls = '') => { const val = el('div', { class: 'v' }); animateNumber(val, 'home:' + k, v); return el('div', { class: 'stat ' + cls }, [el('div', { class: 'k' }, k), val]); };
    const liquid = p.investments.fd + p.investments.debt;
    const cityData = charges.cities[c.city];

    const costRows = c.lines.map((l) => el('tr', { class: l.kind === 'price' ? 'subtotal' : '' }, [
      el('td', {}, [el('span', { class: 'kind-dot', style: `background:${KIND_COLORS[l.kind]}` }), l.label, l.confidence && l.confidence !== 'verified' ? el('span', { class: 'conf-flag', title: l.detail || '' }, l.confidence) : null]),
      el('td', {}, inr(l.amount)),
      el('td', {}, l.kind === 'price' ? '' : pct(c.price ? l.amount / c.price : 0, 1)),
    ]));

    const segments = ['statutory', 'customary', 'builder', 'loan', 'optional'].map((k) => ({ k, v: c[k === 'customary' ? 'customary' : k] || 0 })).filter((s) => s.v > 0);
    const hiddenBar = el('div', {}, [
      el('div', { class: 'legend' }, segments.map((s) => el('span', {}, [el('i', { style: `background:${KIND_COLORS[s.k]}` }), `${KIND_LABELS[s.k]} ${inr(s.v)}`]))),
      el('div', { class: 'bar', role: 'img', 'aria-label': `Hidden charges ${inr(c.hiddenTotal)} split by type` }, segments.map((s) => el('span', { style: `width:${(100 * s.v) / (c.hiddenTotal || 1)}%;background:${KIND_COLORS[s.k]}` }))),
    ]);

    const bindingLine = e.rejected
      ? `No lender will sanction this at a credit score of ${st.creditScore}. Bring the score above ${policy.credit_score.reject_below} first; income does not help.`
      : `The ceiling is set by ${BINDING_TEXT[e.binding]}. ${e.binding === 'foir' ? `With ${inr(e.income.counted)} of counted income and a ${pct(e.foir.rate, 0)} cap, ${inr(e.maxEmi)} a month is left for a new EMI after ${inr(e.existingEmi)} of existing obligations, which services ${inr(e.maxByFoir)} over ${e.tenure.used} years at ${e.rate.effective.toFixed(2)}%.` : ''}${e.binding === 'ltv' ? `RBI caps a loan of this size at ${pct(e.maxByLtv / c.price, 0)} of the value, so ${inr(e.maxByLtv)} is the most against a ${inr(c.price)} price; your income would carry ${inr(e.maxByFoir)}.` : ''}${e.binding === 'tenure' ? `At ${st.age} the loan must close by ${e.tenure.endBy}, so ${e.tenure.used} years instead of ${e.tenure.wanted}; the same EMI then services ${inr(e.maxByFoir)}.` : ''}`;

    setChildren(out, [
      el('div', { class: 'stats' }, [
        stat('All-in cost', inr(c.total), 'hi'),
        stat('Not on the sticker', inr(c.hiddenTotal) + ` (${pct(c.hiddenPct, 1)})`),
        stat(st.downPayment === '' ? 'You can borrow up to' : 'Loan you get', inr(e.loan), e.rejected || needMore > 0 ? 'bad' : ''),
        stat('Your money in total', inr(cashNeeded), cashNeeded > liquid && liquid > 0 ? 'bad' : ''),
      ]),
      el('p', { class: 'explain' }, `A ${inr(c.price)} ${STATUS_LABELS[st.status].split(',')[0].toLowerCase()} home in ${c.city} costs ${inr(c.total)} to actually own, ${inr(c.hiddenTotal)} more than the price. ${e.rejected ? 'The loan is the problem, not the price.' : `A lender would finance up to ${inr(e.maxLoan)}. With a ${inr(downPayment)} down payment${needMore > 0 ? ` the loan needed is ${inr(needMore)} above that ceiling, so the down payment has to rise to ${inr(downPayment + needMore)}` : ` the loan is ${inr(e.loan)}`}, and you bring ${inr(cashNeeded)} in all: the down payment plus every charge, none of which a bank finances.`}${liquid > 0 ? ` Your profile shows ${inr(liquid)} in fixed deposits and debt funds${cashNeeded > liquid ? `, ${inr(cashNeeded - liquid)} short of that` : ', which covers it'}.` : ''}`),

      resultFold('cost', 'Where the money goes', `${inr(c.hiddenTotal)} beyond the price`, [
      hiddenBar,
      el('div', { class: 'table-wrap' }, el('table', { class: 'compare' }, [
        el('thead', {}, el('tr', {}, [el('th', {}, 'Item'), el('th', {}, 'Amount'), el('th', {}, '% of price')])),
        el('tbody', {}, [...costRows, el('tr', { class: 'total' }, [el('td', {}, 'All-in cost'), el('td', {}, inr(c.total)), el('td', {}, pct(c.price ? c.total / c.price : 0, 1))])]),
      ])),
      el('p', { class: 'muted small' }, `${cityData.stamp_duty.composition} ${cityData.registration.note}${st.status === 'under_construction' ? ' ' + charges.gst.note : ''}`),
      c.warnings.length ? el('div', { class: 'notice warn' }, c.warnings.map((w) => el('div', {}, w))) : null,
      c.notes.length ? el('p', { class: 'muted small' }, c.notes.join(' ')) : null,
      ]),

      resultFold('plan', 'When the money goes out', plan.constructionMonths > 0 ? `${inr(plan.cashAtBooking)} at booking · pre-EMI ${inr(plan.preEmiTotal)} · EMI from month ${plan.emiStartMonth}` : `${inr(plan.cashAtBooking)} at registration · EMI from month 1`, [
      el('div', { class: 'stats' }, [
        stat('Cash at booking', inr(plan.cashAtBooking)),
        stat(plan.constructionMonths > 0 ? `Pre-EMI interest, ${plan.constructionMonths} months` : 'Pre-EMI interest', inr(plan.preEmiTotal)),
        stat(`EMI from month ${plan.emiStartMonth}`, inr(plan.emi)),
        stat('Paid by you by possession', inr(plan.youByPossession)),
      ]),
      el('p', { class: 'explain' }, plan.constructionMonths > 0
        ? `Your ${inr(plan.downPaymentUsed)} goes into the first stages, then the bank releases ${inr(plan.loan)} stage by stage over ${plan.constructionMonths} months. Until the last release you pay only interest on what has been released, ${inr(plan.preEmiTotal)} in all, on top of the ${inr(plan.gstTotal)} of GST that comes with each demand. The full EMI of ${inr(plan.emi)} starts in month ${plan.emiStartMonth}.`
        : `The whole price changes hands at registration: ${inr(plan.downPaymentUsed)} from you and ${inr(plan.loan)} from the bank, and the EMI of ${inr(plan.emi)} starts the following month.`),
      plan.warnings.length ? el('div', { class: 'notice warn' }, plan.warnings.map((w) => el('div', {}, w))) : null,
      el('div', { class: 'table-wrap' }, el('table', { class: 'compare' }, [
        el('thead', {}, el('tr', {}, [el('th', {}, 'Month'), el('th', {}, 'Stage'), el('th', {}, 'Builder demands'), el('th', {}, 'From you'), el('th', {}, 'Bank releases'), el('th', {}, 'Loan released so far'), el('th', {}, 'Pre-EMI until next stage')])),
        el('tbody', {}, plan.rows.map((r) => el('tr', {}, [
          el('td', {}, String(r.month)), el('td', {}, [r.label, el('div', { class: 'muted small' }, `${+r.pct.toFixed(1)}% of price${r.gst ? ` + GST ${inr(r.gst)}` : ''}${r.upfront ? ` · charges ${inr(r.upfront)}` : ''}`)]),
          el('td', {}, inr(r.due + r.gst)), el('td', {}, inr(r.fromYou)), el('td', {}, inr(r.fromBank)), el('td', {}, inr(r.cumulativeLoan)), el('td', {}, r.preEmiUntilNext > 0 ? inr(r.preEmiUntilNext) : '—'),
        ]))),
      ])),
      el('p', { class: 'muted small' }, 'Your own money is used before any loan is released, which is how lenders disburse. Pre-EMI interest is charged monthly on the released amount at the loan rate. Interest paid before possession is deductible in five equal yearly instalments starting the year you get possession, within the ₹2,00,000 self-occupied cap and only in the old regime. Some lenders let you start a full EMI on the released amount instead of pre-EMI; that pays down principal sooner.'),
      ]),

      resultFold('loan', 'Why this loan ceiling', e.rejected ? 'refused on credit score' : `set by ${e.binding === 'ltv' ? 'the RBI loan-to-value cap' : e.binding === 'tenure' ? 'your age' : 'your repayment capacity'} · EMI ${inr(e.emi)}`, [
      el('div', { class: 'stats' }, [
        stat('Monthly EMI', inr(e.emi)),
        stat('Rate after score', `${e.rate.effective.toFixed(2)}%`),
        stat('Tenure', `${e.tenure.used} yrs`),
        stat(`EMIs as % of income (cap ${pct(e.foir.rate, 0)})`, pct(e.foir.after, 0)),
      ]),
      el('p', { class: 'explain' }, bindingLine),
      el('div', { class: 'table-wrap' }, el('table', { class: 'compare' }, [
        el('thead', {}, el('tr', {}, [el('th', {}, 'Test'), el('th', {}, 'Ceiling'), el('th', {}, '')])),
        el('tbody', {}, [
          el('tr', { class: e.binding === 'foir' || e.binding === 'tenure' ? 'better' : '' }, [el('td', {}, `Repayment capacity (${pct(e.foir.rate, 0)} of ${inr(e.income.counted)}, less ${inr(e.existingEmi)} existing)`), el('td', {}, inr(e.maxByFoir)), el('td', {}, e.binding === 'foir' || e.binding === 'tenure' ? 'binds' : '')]),
          el('tr', { class: e.binding === 'ltv' ? 'better' : '' }, [el('td', {}, e.maxByLtv != null ? `RBI loan-to-value cap (${pct(e.maxByLtv / c.price, 0)} of ${inr(c.price)})` : 'RBI loan-to-value cap (enter a price)'), el('td', {}, e.maxByLtv != null ? inr(e.maxByLtv) : '—'), el('td', {}, e.binding === 'ltv' ? 'binds' : '')]),
          el('tr', {}, [el('td', {}, `Tenure allowed by age (${e.tenure.ageKnown ? `${st.age}, loan to end by ${e.tenure.endBy}` : 'age not entered'})`), el('td', {}, `${e.tenure.allowedByAge} yrs`), el('td', {}, e.binding === 'tenure' ? 'binds' : '')]),
          el('tr', {}, [el('td', {}, 'Credit score gate'), el('td', {}, st.creditScore ? String(st.creditScore) : 'not entered'), el('td', {}, e.rejected ? 'refused' : e.rate.premiumBps ? `+${e.rate.premiumBps / 100}% on the rate` : 'best rate')]),
        ]),
      ])),
      e.warnings.length ? el('div', { class: 'notice warn' }, e.warnings.map((w) => el('div', {}, w))) : null,
      ]),

      e.levers.length ? el('div', { class: 'card next-steps' }, [
        el('h3', { style: 'margin-top:0' }, 'What would raise the ceiling'),
        el('ul', { class: 'levers' }, e.levers.map((l) => el('li', {}, l.info ? l.label : [el('strong', {}, '+' + inr(l.gain)), ' ', l.label]))),
      ]) : null,

      el('div', { class: 'btn-row' }, [
        e.loan > 0 ? el('a', { class: 'btn', href: '/calculators/emi', onclick: () => setHandoff('emi', { principal: Math.round(e.loan), ratePct: e.rate.effective, years: e.tenure.used, price: Math.round(+st.price), downPayment: Math.round(downPayment), constructionMonths: plan.constructionMonths, note: `the ${inr(e.loan)} loan from the home-buying tool` }, 'home') }, 'Plan this loan’s EMI and prepayments') : null,
        cashNeeded > 0 ? el('button', { type: 'button', class: 'btn secondary', onclick: () => { updateProfile((d) => { const g = d.horizon.goals.find((x) => x.name === 'Home down payment') || (d.horizon.goals.push({ name: 'Home down payment', years: 3, target: 0 }), d.horizon.goals.at(-1)); g.target = Math.round(cashNeeded); return d; }, SOURCE); } }, `Save ${inr(cashNeeded)} as a goal in my profile`) : null,
      ]),
      el('details', { class: 'sources' }, [
        el('summary', {}, 'Sources and dates for these rates'),
        el('ul', {}, [
          el('li', {}, [`${c.city} stamp duty and registration (as of ${cityData.stamp_duty.as_of}, ${cityData.stamp_duty.confidence}): `, ...cityData.stamp_duty.sources.map((u, k) => [k ? ', ' : '', el('a', { href: u, target: '_blank', rel: 'noopener' }, new URL(u).hostname)]).flat()]),
          el('li', {}, ['RBI loan-to-value bands: ', ...policy._meta.sources.ltv.map((u, k) => [k ? ', ' : '', el('a', { href: u, target: '_blank', rel: 'noopener' }, new URL(u).hostname)]).flat()]),
          el('li', {}, ['FOIR bands and income treatment (lender conventions, not law): ', ...policy._meta.sources.foir.map((u, k) => [k ? ', ' : '', el('a', { href: u, target: '_blank', rel: 'noopener' }, new URL(u).hostname)]).flat()]),
          el('li', {}, ['Age cutoffs and credit-score pricing: ', ...policy._meta.sources.age_and_score.map((u, k) => [k ? ', ' : '', el('a', { href: u, target: '_blank', rel: 'noopener' }, new URL(u).hostname)]).flat()]),
        ]),
      ]),
      disclaimer('loan'),
    ]);
  }

  paint();
  return el('div', { class: 'calc' }, [inputs, el('div', {}, [out, exportCard])]);
}
