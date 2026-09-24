/**
 * Home buying, in two steps. First the true cost of the property (stamp duty, registration, GST,
 * builder extras). Then, only if asked, how to fund it: the loan you want, the down payment, the
 * stage-by-stage payment plan with pre-EMI interest, and the EMI. No lender eligibility model:
 * you say how much you are borrowing.
 * Engine: engine/property.js and engine/payment-plan.js. Data: data/property_charges.json.
 */
import { inr, pct, el, setChildren, disclaimer, animateNumber, debounce, isBlankAfterReset, clearBlankAfterReset } from './util.js';
import { propertyCost, PROPERTY_CITIES, STATUSES, BUYERS } from '../engine/property.js';
import { paymentPlan, PLAN_PRESETS, presetFor } from '../engine/payment-plan.js';
import { emiFor } from '../engine/loan-eligibility.js';
import { getProfile, updateProfile } from './profile-store.js';
import { isEmptyProfile } from '../engine/profile.js';
import { setHandoff } from './handoff.js';
import { calcExportCard } from './calc-export-card.js';
import { resultLayout } from './result-layout.js';
import { attachSlider } from './amount-input.js';

const STORE = 'taxcompass.home.v1';
const SOURCE = 'calc:home';
const STATUS_LABELS = { under_construction: 'Under construction, from a builder', ready: 'Ready to move, from a builder (has OC)', resale: 'Resale, from an owner' };
const BUYER_LABELS = { man: 'A man', woman: 'A woman (sole name)', joint: 'Joint, man and woman' };
const KIND_LABELS = { price: 'Price', statutory: 'Paid to the state', customary: 'Fees', builder: 'Builder charges', loan: 'Loan costs', optional: 'Optional' };
const KIND_COLORS = { price: 'var(--accent)', statutory: '#c9a227', customary: '#8a948e', builder: '#2a78d6', loan: '#eb6834', optional: '#b083d6' };
const DEFAULT_RATE = 8.5;

export function renderHomeBuying({ propertyCharges: charges, loanPolicy: policy }) {
  const p = getProfile();
  let saved = {}; try { saved = JSON.parse(localStorage.getItem(STORE) || '{}'); } catch {}
  const blank = isBlankAfterReset('home');
  const fromProfile = {};
  if (!isEmptyProfile(p) && !blank) {
    if (PROPERTY_CITIES.includes(p.location.city)) fromProfile.city = p.location.city;
    const homeGoal = p.horizon.goals.find((g) => /home|house|flat|property/i.test(g.name) && g.target > 0);
    if (homeGoal) fromProfile.price = homeGoal.target;
  }

  const st = {
    city: 'Mumbai', price: '', status: 'under_construction', buyer: 'man', affordable: false, brokerageRate: 1, brokerageOnNew: false, interiors: 0, legalAndValuation: charges.customary.legal_and_valuation.default_amount,
    builderCharges: [],
    funding: false, loan: '', downPayment: '', lastEdited: 'loan', ratePct: DEFAULT_RATE, tenureYears: 20,
    processingFeeRate: charges.customary.loan_processing_fee.default_rate * 100, processingFeeCap: charges.customary.loan_processing_fee.cap,
    plan: { preset: '', tranches: null },
    ...saved, ...fromProfile,
  };
  const save = () => { clearBlankAfterReset('home'); try { localStorage.setItem(STORE, JSON.stringify(st)); } catch {} };

  // --- helpers ---
  const fold = (title, children) => el('details', { class: 'opts fold' }, [el('summary', {}, title), ...children]);
  const openFolds = new Set(['cost']);
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
      if (key === 'loan' || key === 'downPayment') { st.lastEdited = key; syncLoanAndDown(); }
      save(); if (immediate) { syncVisibility(); render(); } else rerender();
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

    loan: field('loan', 'Loan you want (₹)', { step: 100000, placeholder: 'e.g. 6000000' }, 'the two below add up to the price; edit either'),
    downPayment: field('downPayment', 'Down payment (₹)', { step: 100000, placeholder: 'price less loan' }, 'your own money towards the price; charges come on top and are never financed'),
    ratePct: field('ratePct', 'Interest rate (% p.a.)', { step: 0.05, max: 20 }, policy.rate.range_note),
    tenureYears: field('tenureYears', 'Tenure (years)', { step: 1, min: 1, max: 30 }),
    processingFeeRate: field('processingFeeRate', 'Loan processing fee (%)', { step: 0.05, max: 3 }),
    processingFeeCap: field('processingFeeCap', 'Processing fee cap (₹)', { step: 1000 }, '0 = no cap'),
  };
  // Loan and down payment always add up to the price; whichever was typed last wins.
  const syncLoanAndDown = () => {
    const price = +st.price || 0;
    if (!(price > 0)) return;
    if (st.lastEdited === 'downPayment' && st.downPayment !== '') { st.loan = Math.max(0, price - (+st.downPayment || 0)); F.loan.input.value = st.loan; }
    else if (st.loan !== '') { st.downPayment = Math.max(0, price - (+st.loan || 0)); F.downPayment.input.value = st.downPayment; }
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

  // Step 2 inputs, shown only once the user asks to plan the funding.
  const fundingBlock = el('div', { class: 'opts funding' }, [
    el('div', { class: 'opt-title' }, 'Funding it'),
    el('div', { class: 'two' }, [F.loan.node, F.downPayment.node]),
    el('div', { class: 'two' }, [F.ratePct.node, F.tenureYears.node]),
    fold('How the price is paid', [
      el('label', {}, ['Payment plan', presetSelect]), planNote, planList,
      el('button', { type: 'button', class: 'btn secondary small-btn', onclick: () => { const tr = currentTranches(); tr.push({ label: 'Stage', pct: 0, month: (tr.at(-1)?.month || 0) + 3 }); st.plan.tranches = tr; save(); buildPlanRows(); render(); } }, '+ Add a stage'),
    ]),
    fold('Loan charges', [el('div', { class: 'two' }, [F.processingFeeRate.node, F.processingFeeCap.node])]),
  ]);
  const syncVisibility = () => {
    F.affordable.node.hidden = st.status !== 'under_construction';
    F.brokerageOnNew.node.hidden = st.status === 'resale';
    F.brokerageRate.node.hidden = !(st.status === 'resale' || st.brokerageOnNew);
    fundingBlock.hidden = !st.funding;
  };
  attachSlider(F.price.input, { max: 50000000, step: 100000 }); attachSlider(F.loan.input, { max: 50000000, step: 100000 });
  const inputs = el('div', { class: 'card inputs' }, [
    el('div', { class: 'opts', style: 'border-top:0;padding-top:0' }, [
      el('div', { class: 'opt-title' }, 'The property'),
      el('div', { class: 'two' }, [F.city.node, F.price.node]),
      F.status.node,
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
    fundingBlock,
  ]);
  syncVisibility();

  const startFunding = () => {
    st.funding = true;
    if (st.loan === '' && +st.price > 0) { st.loan = Math.round(+st.price * 0.8); st.lastEdited = 'loan'; F.loan.input.value = st.loan; syncLoanAndDown(); }
    save(); syncVisibility(); render();
    F.loan.input.focus();
  };

  // --- output ---
  function compute() {
    const price = +st.price || 0;
    const loan = st.funding ? Math.max(0, Math.min(price, +st.loan || 0)) : 0;
    const downPayment = st.funding ? Math.max(0, price - loan) : 0;
    const cost = propertyCost({
      city: st.city, price, status: st.status, buyer: st.buyer, affordable: !!st.affordable, brokerageRate: (+st.brokerageRate || 0) / 100, brokerageOnNew: !!st.brokerageOnNew,
      builderCharges: st.builderCharges, interiors: +st.interiors, legalAndValuation: +st.legalAndValuation, loanAmount: loan,
      processingFeeRate: (+st.processingFeeRate || 0) / 100, processingFeeCap: +st.processingFeeCap || 0,
    }, charges);
    if (!st.funding) return { cost, loan: 0, downPayment: 0, plan: null, emi: 0, tenureMonths: 0, cashNeeded: cost.total };
    const gstLine = cost.lines.find((l) => l.id === 'gst');
    const gstRate = gstLine ? gstLine.amount / cost.price : 0;
    const tenureMonths = Math.max(12, Math.round((+st.tenureYears || 20) * 12));
    const plan = paymentPlan({ price, tranches: currentTranches(), downPayment, loan, ratePct: +st.ratePct || 0, tenureMonths, gstRate, upfrontCharges: cost.hiddenTotal - (gstLine ? gstLine.amount : 0) });
    const emi = emiFor(loan, +st.ratePct || 0, tenureMonths);
    return { cost, loan, downPayment, plan, emi, tenureMonths, cashNeeded: Math.max(0, cost.total - loan) };
  }

  function paint() {
    if (!(+st.price > 0)) {
      setChildren(out, [el('div', { class: 'notice' }, [el('strong', {}, 'Enter the agreed price to begin. '), 'Everything that follows is worked out from it.'])]);
      last = null;
      return;
    }
    const { cost: c, loan, downPayment, plan, emi, tenureMonths, cashNeeded } = compute();
    last = { st: { ...st }, c, loan, downPayment, plan, emi, tenureMonths, cashNeeded };
    const stat = (k, v, cls = '') => { const val = el('div', { class: 'v' }); animateNumber(val, 'home:' + k, v); return el('div', { class: 'stat ' + cls }, [el('div', { class: 'k' }, k), val]); };
    const cityData = charges.cities[c.city];
    const liquid = p.investments.fd + p.investments.debt;
    const ltvHigh = st.funding && loan > 0.9 * c.price;
    const years = Math.round(tenureMonths / 12);

    const costRows = c.lines.map((l) => el('tr', { class: l.kind === 'price' ? 'subtotal' : '' }, [
      el('td', {}, [el('span', { class: 'kind-dot', style: `background:${KIND_COLORS[l.kind]}` }), l.label, l.confidence && l.confidence !== 'verified' ? el('span', { class: 'conf-flag', title: l.detail || '' }, l.confidence) : null]),
      el('td', {}, inr(l.amount)),
      el('td', {}, l.kind === 'price' ? '' : pct(c.price ? l.amount / c.price : 0, 1)),
    ]));
    const segments = ['statutory', 'customary', 'builder', 'loan', 'optional'].map((k) => ({ k, v: c[k] || 0 })).filter((s) => s.v > 0);
    const hiddenBar = el('div', {}, [
      el('div', { class: 'legend' }, segments.map((s) => el('span', {}, [el('i', { style: `background:${KIND_COLORS[s.k]}` }), `${KIND_LABELS[s.k]} ${inr(s.v)}`]))),
      el('div', { class: 'bar', role: 'img', 'aria-label': `Charges beyond the price, ${inr(c.hiddenTotal)}, split by type` }, segments.map((s) => el('span', { style: `width:${(100 * s.v) / (c.hiddenTotal || 1)}%;background:${KIND_COLORS[s.k]}` }))),
    ]);
    const link = (u) => el('a', { href: u, target: '_blank', rel: 'noopener' }, new URL(u).hostname);
    const links = (arr) => arr.flatMap((u, k) => [k ? ', ' : '', link(u)]);

    setChildren(out, resultLayout({
      key: 'home',
      answer: [
        // ---- Step 1: what it costs ----
      el('div', { class: 'stats' }, [
        stat('All-in cost', inr(c.total), 'hi'),
        stat('Not on the sticker', inr(c.hiddenTotal) + ` (${pct(c.hiddenPct, 1)})`),
        stat('Paid to the state', inr(c.statutory)),
        st.funding ? stat('Your money in total', inr(cashNeeded), cashNeeded > liquid && liquid > 0 ? 'bad' : '') : stat('Fees and builder charges', inr(c.customary + c.builder + c.optional)),
      ]),
        el('p', { class: 'explain' }, `A ${inr(c.price)} ${STATUS_LABELS[st.status].split(',')[0].toLowerCase()} home in ${c.city} costs ${inr(c.total)} to actually own: ${inr(c.hiddenTotal)}, or ${pct(c.hiddenPct, 1)}, on top of the price. ${inr(c.statutory)} of that goes to the state${st.status === 'under_construction' ? ', on registration and as GST with each builder demand' : ' on registration'}.${st.funding ? ` With a ${inr(loan)} loan you bring ${inr(cashNeeded)} yourself: the ${inr(downPayment)} down payment plus every charge, none of which a bank finances.${liquid > 0 ? ` Your profile shows ${inr(liquid)} in fixed deposits and debt funds${cashNeeded > liquid ? `, ${inr(cashNeeded - liquid)} short of that` : ', which covers it'}.` : ''}` : ''}`),
        // ---- Step 2: funding ----
      st.funding ? el('div', { class: 'stats' }, [
        stat('Monthly EMI', inr(emi), 'hi'),
        stat('Loan', inr(loan) + ` (${pct(c.price ? loan / c.price : 0, 0)} of price)`),
        stat('Cash at booking', inr(plan.cashAtBooking)),
        stat(plan.constructionMonths > 0 ? `Pre-EMI interest, ${plan.constructionMonths} months` : 'Interest before the first EMI', inr(plan.preEmiTotal)),
      ]) : null,
        st.funding ? el('p', { class: 'explain' }, plan.constructionMonths > 0
        ? `Your ${inr(plan.downPaymentUsed)} goes into the first stages, then the bank releases ${inr(plan.loan)} stage by stage over ${plan.constructionMonths} months. Until the last release you pay only interest on what has been released, ${inr(plan.preEmiTotal)} in all, on top of the ${inr(plan.gstTotal)} of GST that comes with each demand. The full EMI of ${inr(emi)} at ${(+st.ratePct).toFixed(2)}% for ${years} years starts in month ${plan.emiStartMonth}.`
        : `The whole price changes hands at registration: ${inr(plan.downPaymentUsed)} from you and ${inr(plan.loan)} from the bank, and the EMI of ${inr(emi)} at ${(+st.ratePct).toFixed(2)}% for ${years} years starts the following month.`) : null,
      ],
      why: [
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
        st.funding && ltvHigh ? el('div', { class: 'notice warn' }, `Lenders can finance at most 90% of the price for loans up to ₹30 lakh, 80% up to ₹75 lakh and 75% above that (RBI), and never the charges. A ${inr(loan)} loan on a ${inr(c.price)} price is above that; expect to bring a bigger down payment.`) : null,
        st.funding && plan.warnings.length ? el('div', { class: 'notice warn' }, plan.warnings.map((w) => el('div', {}, w))) : null,
        st.funding ? resultFold('plan', 'When the money goes out', `${inr(plan.cashAtBooking)} at ${plan.constructionMonths > 0 ? 'booking' : 'registration'} · ${inr(plan.youByPossession)} from you by possession`, [
        el('div', { class: 'table-wrap' }, el('table', { class: 'compare' }, [
          el('thead', {}, el('tr', {}, [el('th', {}, 'Month'), el('th', {}, 'Stage'), el('th', {}, 'Builder demands'), el('th', {}, 'From you'), el('th', {}, 'Bank releases'), el('th', {}, 'Loan released so far'), el('th', {}, 'Pre-EMI until next stage')])),
          el('tbody', {}, plan.rows.map((r) => el('tr', {}, [
            el('td', {}, String(r.month)), el('td', {}, [r.label, el('div', { class: 'muted small' }, `${+r.pct.toFixed(1)}% of price${r.gst ? ` + GST ${inr(r.gst)}` : ''}${r.upfront ? ` · charges ${inr(r.upfront)}` : ''}`)]),
            el('td', {}, inr(r.due + r.gst)), el('td', {}, inr(r.fromYou)), el('td', {}, inr(r.fromBank)), el('td', {}, inr(r.cumulativeLoan)), el('td', {}, r.preEmiUntilNext > 0 ? inr(r.preEmiUntilNext) : '—'),
          ]))),
        ])),
        el('p', { class: 'muted small' }, 'Your own money is used before any loan is released, which is how lenders disburse. Pre-EMI interest is charged monthly on the released amount at the loan rate. Interest paid before possession is deductible in five equal yearly instalments starting the year you get possession, within the ₹2,00,000 self-occupied cap and only in the old regime. Some lenders let you start a full EMI on the released amount instead of pre-EMI; that pays down principal sooner.'),
      ]) : null,
      ],
      next: [
        // ---- The invitation to step 2 ----
      !st.funding ? el('div', { class: 'card next-steps' }, [
        el('h3', { style: 'margin-top:0' }, 'Want to work out how you would fund it?'),
        el('p', { class: 'muted small' }, 'Say how much you would borrow and put down, and see the EMI, what you pay at each stage of construction, the interest before possession, and the cash you need in all.'),
        el('div', { class: 'btn-row' }, [el('button', { type: 'button', class: 'btn', onclick: startFunding }, 'Plan the funding')]),
      ]) : null,
        el('div', { class: 'btn-row' }, [
        st.funding && loan > 0 ? el('a', { class: 'btn', href: '/calculators/emi', onclick: () => setHandoff('emi', { principal: Math.round(loan), ratePct: +st.ratePct, years, price: Math.round(c.price), downPayment: Math.round(downPayment), constructionMonths: plan.constructionMonths, note: `the ${inr(loan)} loan from the home-buying tool` }, 'home') }, 'Plan this loan’s EMI and prepayments') : null,
        cashNeeded > 0 ? el('button', { type: 'button', class: 'btn secondary', onclick: () => { updateProfile((d) => { const g = d.horizon.goals.find((x) => x.name === 'Home down payment') || (d.horizon.goals.push({ name: 'Home down payment', years: 3, target: 0 }), d.horizon.goals.at(-1)); g.target = Math.round(cashNeeded); return d; }, SOURCE); } }, `Save ${inr(cashNeeded)} as a goal in my profile`) : null,
        st.funding ? el('button', { type: 'button', class: 'btn secondary', onclick: () => { st.funding = false; save(); syncVisibility(); render(); } }, 'Hide the funding plan') : null,
      ]),
      ],
      details: [
        el('details', { class: 'sources' }, [
        el('summary', {}, 'Sources and dates for these rates'),
        el('ul', {}, [
          el('li', {}, [`${c.city} stamp duty and registration (as of ${cityData.stamp_duty.as_of}, ${cityData.stamp_duty.confidence}): `, ...links(cityData.stamp_duty.sources)]),
          el('li', {}, ['GST on under-construction property: ', ...links(charges.gst.sources)]),
          el('li', {}, ['RBI loan-to-value bands: ', ...links(policy._meta.sources.ltv)]),
        ]),
      ]),
      ],
      foot: [
        disclaimer('loan'),
      ],
      detailsLabel: 'Show the sources and dates for these rates',
    }));
  }

  paint();
  return el('div', { class: 'calc' }, [inputs, el('div', {}, [out, exportCard])]);
}
