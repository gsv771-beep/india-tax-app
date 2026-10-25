/**
 * The quick answer, in the order a person needs it: one input (the CTC), the answer at once (monthly
 * take-home, both regimes side by side), then optional refinements (a chip each for rent, home loan,
 * 80C, health cover and own NPS; an added chip becomes one figure and the answer follows), then the
 * working (CTC down to take-home, line by line, folded until asked for).
 *
 * Mounted on the home page, the tax page and the salary pages (each with its own profile source,
 * so one copy hears what another saved). The arithmetic is quick-engine.js.
 */
import { el, inr, inrShort, setChildren, debounce } from './util.js';
import { getProfile, updateProfile, onProfileChange } from './profile-store.js';
import { setHandoff } from './handoff.js';
import { fromSalaryStore, toTaxInputs, ctcOf, ctcHeadline, payoutOf, isEmptyProfile, clearSalary, CITIES, METRO_CITIES } from '../engine/profile.js';
import { quickAnswer, QUICK_DEFAULTS, LIMIT_80C } from './quick-engine.js';

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
    inhand: { ...p.inhand },
    loanEmi: (type) => Math.round(p.loans.filter((l) => l.type === type).reduce((s, l) => s + (l.emi || 0), 0)),
  };
}

// Money that leaves or joins the take-home each month without changing the tax. Monthly amounts.
const ADJUST = [
  { key: 'homeLoanEmi', chip: 'Home loan EMI', label: 'Home loan EMI', sign: -1, loan: 'home', hint: 'the whole EMI, principal and interest; the interest for tax goes under Home loan above' },
  { key: 'personalLoanEmi', chip: 'Personal loan EMI', label: 'Personal loan EMI', sign: -1, loan: 'personal' },
  { key: 'carLoanEmi', chip: 'Car loan EMI', label: 'Car loan EMI', sign: -1, loan: 'car' },
  { key: 'otherDeductions', chip: 'Other deductions', label: 'Other deductions', sign: -1, note: 'otherDeductionsNote', notePh: 'what it is, e.g. VPF, insurance, salary advance' },
  { key: 'additions', chip: 'Add an amount', label: 'Money added each month', sign: 1, note: 'additionsNote', notePh: 'what it is, e.g. reimbursement, rent received' },
];
const adjTotal = (inhand) => ADJUST.reduce((s, d) => s + d.sign * (+inhand?.[d.key] || 0), 0);

const DEDUCTIONS = [
  { key: 'rentMonthly', chip: 'Pay rent', label: 'Rent', unit: 'a month', dflt: 25000, step: 1000, hint: () => 'the old regime exempts part of your HRA' },
  { key: 'homeLoanInterest', chip: 'Home loan', label: 'Home loan on a house you live in', unit: 'interest a year', dflt: 200000, step: 10000, hint: () => 'up to ₹2 lakh of interest counts (section 24b)' },
  { key: 'other80c', chip: '80C investments', label: 'PPF, ELSS, life insurance, tuition fees', unit: 'a year', dflt: null, step: 5000, hint: (a) => a ? `80C: your PF already uses ${inr(a.claimed.epf)} of the ${inrShort(LIMIT_80C)}, so ${inr(a.room80c)} is left` : '80C, on top of your PF' },
  { key: 'healthSelf', chip: 'Health insurance', label: 'Health insurance for your family', unit: 'premium a year', dflt: 25000, step: 1000, hint: () => '80D: up to ₹25,000, ₹50,000 if you are over 60' },
  { key: 'nps1b', chip: 'Own NPS', label: 'NPS you pay into yourself', unit: 'a year', dflt: 50000, step: 5000, hint: () => '80CCD(1B): up to ₹50,000 over the 80C limit' },
];

/**
 * mountQuick(slot, { rates, source, taxLink, salaryLink })
 *   source      the profile source this copy writes as ('quick:home', 'quick:tax', 'quick:salary')
 *   taxLink, salaryLink   { href, text, onclick? } under each result tile; onclick opens the detailed
 *               tool on a page that has it below instead of navigating away
 */
/** A CTC passed in the address (/tax?ctc=2500000, from Ask TaxCompass): shown, not saved until edited. */
export function ctcFromUrl() {
  if (typeof location === 'undefined') return null;
  const v = Math.round(+new URLSearchParams(location.search).get('ctc'));
  return v >= 100000 && v <= 1e9 ? v : null;
}
const mounts = new Map();   // source -> the slot and options, so a ?ctc= link can refill a card already on the page
if (typeof window !== 'undefined') window.addEventListener('routechange', () => {
  const c = ctcFromUrl();
  if (!c) return;
  for (const { slot, opts } of mounts.values()) if (slot.isConnected && slot.offsetParent !== null && opts.ctc !== c) mountQuick(slot, { ...opts, ctc: c });
});

export function mountQuick(slot, opts) {
  const { rates, source, taxLink, salaryLink } = opts;
  const ctc = opts.ctc ?? ctcFromUrl();
  if (!slot || !rates) return;
  if (live.has(source)) live.get(source)();
  mounts.set(source, { slot, opts: { ...opts, ctc } });
  // a salary page starts from its own CTC with the person's deductions; nothing is saved until they change something
  let q = { ...fromProfile(getProfile()), ...(ctc ? { ctc } : {}) };
  const added = new Set(DEDUCTIONS.filter((d) => q[d.key] > 0).map((d) => d.key));

  // ---- one input ----
  const ctcInput = el('input', { type: 'number', min: 0, step: 50000, inputmode: 'numeric', placeholder: 'e.g. 1500000', class: 'quick-ctc', 'data-echo': 'own', 'aria-label': 'Your annual CTC in rupees', value: q.ctc || '' });
  const echo = el('span', { class: 'quick-echo', 'aria-live': 'polite' });
  const startOver = el('button', { type: 'button', class: 'quick-reset' }, 'Start over');
  // ---- the answer, then what refines it, then the working ----
  const answer = el('div', { class: 'quick-answer', 'aria-live': 'polite' });
  const refine = el('div', { class: 'quick-refine' });
  const refineNote = el('p', { class: 'muted small quick-refine-note' });
  const chipRow = el('div', { class: 'quick-chips', role: 'group', 'aria-label': 'Add what applies to you' });
  const verdict = el('div', { class: 'quick-verdict-box' });
  const breakdown = el('details', { class: 'quick-breakdown' });
  const breakdownBody = el('div', { class: 'quick-breakdown-body' });
  const assumePt = el('span');
  const basicInput = el('input', { type: 'number', min: 10, max: 80, step: 1, class: 'quick-basic', value: q.basicPct, 'aria-label': 'Basic pay as a percentage of CTC' });

  const save = debounce(() => {
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
      // a new CTC or Basic % rewrites the salary split; adding a deduction leaves any detailed split alone
      let out = prev.ctc !== q.ctc || Math.abs(prev.basicPct - q.basicPct) > 0.05 || isEmptyProfile(d) ? fromSalaryStore(d, { ...a.store, regime: a.better }, a.pay) : d;
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
  ctcInput.addEventListener('input', () => set({ ctc: +ctcInput.value || 0 }));
  basicInput.addEventListener('change', () => set({ basicPct: Math.min(80, Math.max(10, +basicInput.value || QUICK_DEFAULTS.basicPct)) }));

  // ---- the refinements: a chip each; a chip once added becomes a row with its one figure ----
  const rows = DEDUCTIONS.map((d) => {
    const chip = el('button', { type: 'button', class: 'quick-chip', 'aria-pressed': 'false' }, [el('span', { class: 'quick-chip-plus', 'aria-hidden': 'true' }, '+'), d.chip]);
    const amount = el('input', { type: 'number', min: 0, step: d.step, inputmode: 'numeric', 'data-echo': 'own', value: q[d.key] || '', 'aria-label': `${d.label}, ₹ ${d.unit}` });
    const hint = el('small', { class: 'quick-hint' });
    const extra = d.key === 'rentMonthly'
      ? el('select', { class: 'quick-city', 'aria-label': 'City you live in' }, CITIES.map((c) => el('option', { value: c, selected: c === q.city }, c === 'Other' ? 'Other city' : c)))
      : null;
    if (extra) extra.addEventListener('change', () => set({ city: extra.value }));
    const remove = el('button', { type: 'button', class: 'quick-row-remove', 'aria-label': `Remove ${d.label.toLowerCase()}` }, 'Remove');
    const row = el('div', { class: 'quick-row', hidden: true }, [
      el('div', { class: 'quick-row-head' }, [el('span', { class: 'quick-row-label' }, d.label), remove]),
      el('span', { class: 'quick-amount' }, ['₹', amount, el('span', { class: 'unit' }, d.unit), extra]),
      hint,
    ]);
    const sync = () => {
      const on = added.has(d.key);
      row.hidden = !on; chip.hidden = on;
      chip.setAttribute('aria-pressed', String(on));
    };
    chip.addEventListener('click', () => {
      added.add(d.key);
      if (!(+amount.value > 0)) amount.value = d.dflt != null ? d.dflt : (quickAnswer(q, rates)?.room80c || 50000);
      sync();
      set({ [d.key]: +amount.value || 0 });
      amount.focus({ preventScroll: true });
      amount.select();
    });
    remove.addEventListener('click', () => { added.delete(d.key); sync(); set({ [d.key]: 0 }); chipRow.querySelector('.quick-chip:not([hidden])')?.focus(); });
    amount.addEventListener('input', () => set({ [d.key]: +amount.value || 0 }));
    sync();
    return { d, row, chip, amount, hint, extra, sync };
  });
  setChildren(chipRow, rows.map((r) => r.chip));
  const refreshRows = (a) => { for (const r of rows) { r.hint.textContent = r.d.hint(a); if (document.activeElement !== r.amount) r.amount.value = q[r.d.key] || ''; if (r.extra) r.extra.value = q.city; } };

  // ---- what is left each month: EMIs and other deductions off, extra money on; the tax does not change ----
  const adjAdded = new Set(ADJUST.filter((d) => +q.inhand?.[d.key] > 0).map((d) => d.key));
  const setIn = (patch) => set({ inhand: { ...q.inhand, ...patch } });
  const adjChips = el('div', { class: 'quick-chips', role: 'group', 'aria-label': 'Add EMIs, other deductions or extra money' });
  const adjRows = ADJUST.map((d) => {
    const chip = el('button', { type: 'button', class: 'quick-chip' + (d.sign > 0 ? ' quick-chip-add' : ''), 'aria-pressed': 'false' }, [el('span', { class: 'quick-chip-plus', 'aria-hidden': 'true' }, d.sign > 0 ? '+' : '−'), d.chip]);
    const amount = el('input', { type: 'number', min: 0, step: 500, inputmode: 'numeric', 'data-echo': 'own', placeholder: 'e.g. 25000', value: q.inhand?.[d.key] || '', 'aria-label': `${d.label}, ₹ a month` });
    const note = d.note ? el('input', { type: 'text', maxlength: 60, class: 'quick-note', placeholder: d.notePh, value: q.inhand?.[d.note] || '', 'aria-label': `${d.label}: what it is` }) : null;
    const remove = el('button', { type: 'button', class: 'quick-row-remove', 'aria-label': `Remove ${d.label.toLowerCase()}` }, 'Remove');
    const row = el('div', { class: 'quick-row' + (d.sign > 0 ? ' quick-row-add' : ''), hidden: true }, [
      el('div', { class: 'quick-row-head' }, [el('span', { class: 'quick-row-label' }, d.label), remove]),
      el('span', { class: 'quick-amount' }, ['₹', amount, el('span', { class: 'unit' }, 'a month')]),
      note,
      d.hint ? el('small', { class: 'quick-hint' }, d.hint) : null,
    ]);
    const sync = () => { const on = adjAdded.has(d.key); row.hidden = !on; chip.hidden = on; chip.setAttribute('aria-pressed', String(on)); };
    chip.addEventListener('click', () => {
      adjAdded.add(d.key);
      // a loan already in the profile brings its EMI; otherwise the box waits for a figure
      const fromLoans = d.loan ? q.loanEmi(d.loan) : 0;
      if (!(+amount.value > 0) && fromLoans > 0) { amount.value = fromLoans; setIn({ [d.key]: fromLoans }); }
      sync();
      amount.focus({ preventScroll: true });
    });
    remove.addEventListener('click', () => { adjAdded.delete(d.key); sync(); setIn({ [d.key]: 0, ...(d.note ? { [d.note]: '' } : {}) }); if (note) note.value = ''; amount.value = ''; });
    amount.addEventListener('input', () => setIn({ [d.key]: Math.max(0, +amount.value || 0) }));
    if (note) note.addEventListener('input', () => setIn({ [d.note]: note.value }));
    sync();
    return { d, row, chip, amount, note, sync };
  });
  setChildren(adjChips, adjRows.map((r) => r.chip));
  const adjust = el('div', { class: 'quick-refine quick-adjust' }, [
    el('h3', { class: 'quick-refine-title' }, 'What is left each month?'),
    el('p', { class: 'muted small quick-refine-note' }, 'Take off EMIs and anything else that comes out of your pay, or add money that comes in on top. These do not change your tax.'),
    adjChips,
    el('div', { class: 'quick-rows' }, adjRows.map((r) => r.row)),
  ]);
  const refreshAdj = () => { for (const r of adjRows) { if (document.activeElement !== r.amount) r.amount.value = q.inhand?.[r.d.key] || ''; if (r.note && document.activeElement !== r.note) r.note.value = q.inhand?.[r.d.note] || ''; } };

  const regimeName = (r) => (r === 'new' ? 'New regime' : 'Old regime');
  function paintAnswer(a) {
    if (!a) {
      setChildren(answer, [
        el('div', { class: 'quick-k' }, 'Your monthly take-home'),
        el('div', { class: 'quick-v quick-v-empty' }, '₹ —'),
        el('p', { class: 'quick-sub' }, ['Type your CTC above. The answer appears as you type. ', el('a', { href: '/salary' }, 'Or pick a salary from ₹3 lakh to ₹2 crore →')]),
      ]);
      return;
    }
    if (a.error) { setChildren(answer, el('p', { class: 'notice warn' }, a.error)); return; }
    const side = (r) => el('div', { class: 'quick-side' + (r === a.better && !a.same ? ' win' : '') }, [
      el('div', { class: 'quick-side-k' }, regimeName(r)),
      el('div', { class: 'quick-side-v' }, [inr(a.monthly[r]), el('span', { class: 'quick-per' }, ' a month')]),
      el('div', { class: 'quick-side-tax' }, a.tax[r] > 0 ? ['Tax ', el('b', {}, inr(a.tax[r])), ' a year'] : 'No income tax'),
      a.same ? (r === 'new' ? el('div', { class: 'quick-side-sub' }, 'Same either way') : null) : r === a.better ? el('div', { class: 'quick-side-sub' }, `Better by ${inr(a.saves)} a year`) : null,
    ]);
    const bonus = a.bonus.paid > 0;
    setChildren(answer, [
      el('div', { class: 'quick-k' }, bonus ? 'Your monthly take-home, before bonus' : 'Your monthly take-home'),
      el('div', { class: 'quick-v' }, inr(a.monthly.best)),
      el('p', { class: 'quick-sub' }, a.tax.new === 0 && a.tax.old === 0
        ? `${inrShort(a.inHand.best)} a year. No income tax in either regime at this salary.`
        : `${inrShort(a.inHand.best)} a year in the ${a.better} regime, after PF, professional tax and income tax.`),
      bonus ? el('p', { class: 'quick-sub quick-bonus' }, [`Plus your bonus${a.store.variableInCtc === 'top' ? ', on top of your CTC' : ''}: ${inr(a.bonus.paid)}${a.bonus.payoutPct !== 100 ? ` (${+a.bonus.payoutPct.toFixed(1)}% of the ${inr(a.bonus.target)} target)` : ''}, about ${inr(a.bonus.net.best)} after tax, paid once a year. `, salaryLink ? el('a', { href: salaryLink.href, onclick: salaryLink.onclick }, 'Change the bonus or its payout in your payslip →') : null]) : null,
      adjTotal(q.inhand) !== 0 ? leftLine(a) : null,
      el('div', { class: 'quick-sides' }, [side('new'), side('old')]),
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

  // could the old regime win? one sentence while nothing is added; the meter once something is
  function paintVerdict(a) {
    const need = a.needed, have = a.claimed.total;
    refineNote.textContent = a.tax.new === 0 && a.tax.old === 0 ? 'Add what applies to you. At this salary neither regime charges tax, so it will not change the choice.'
      : a.better === 'old' ? 'Add or change what applies to you. With these, the old regime is ahead.'
      : a.be.kind === 'impossible' ? 'Add only what applies to you. At this salary the new regime wins whatever you claim.'
      : need ? `Add only what applies to you. The old regime wins only with more than ${inrShort(need)} of deductions; you have ${inrShort(have)} so far.` : 'Add only what applies to you.';
    if (!added.size || !need) { setChildren(verdict, []); return; }
    const pct = Math.min(100, 100 * have / need);
    const line = a.better === 'old' ? `The old regime wins by ${inr(a.saves)} a year. Tell your employer you want the old regime, or choose it when you file your return.`
      : `You need ${inr(Math.max(0, need - have))} more in old-regime deductions for it to win. Until then, the new regime.`;
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
          gross !== a.ctc ? row(a.store.variableInCtc === 'top' ? 'Salary paid, with the bonus on top' : `Salary paid (bonus at ${+a.bonus.payoutPct.toFixed(1)}%)`, ...both(inr(gross))) : null,
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
      el('p', { class: 'muted small' }, [`Your PF is 12% of Basic. Employer PF (${inr(0.12 * a.pay.basic)}) and gratuity are paid on top of the CTC, so they are not taken off here. Old-regime deductions counted: ${parts.join(', ')}.`]),
      el('div', { class: 'quick-links' }, [
        taxLink ? el('a', { class: 'quick-link', href: taxLink.href, onclick: taxLink.onclick }, taxLink.text) : null,
        salaryLink ? el('a', { class: 'quick-link', href: salaryLink.href, onclick: salaryLink.onclick }, salaryLink.text) : null,
        el('a', { class: 'quick-link', href: '/calculators/budget', onclick: () => setHandoff('budget', { income: Math.round(a.monthly.best) }, 'salary') }, 'Plan your savings with this →'),
      ]),
    ]);
  }

  function paint() {
    const a = quickAnswer(q, rates);
    echo.textContent = q.ctc > 0 ? `${inrShort(q.ctc)} a year` : '';
    assumePt.textContent = inr(q.professionalTax ?? QUICK_DEFAULTS.professionalTax);
    const ok = !!(a && !a.error);
    slot.classList.toggle('has-answer', ok);
    paintAnswer(a);
    refine.hidden = !ok;
    adjust.hidden = !ok;
    breakdown.hidden = !ok;
    if (!ok) return;
    paintVerdict(a);
    paintBreakdown(a);
    refreshRows(a);
    refreshAdj();
  }

  refine.append(
    el('h3', { class: 'quick-refine-title' }, 'Want a more accurate answer?'),
    refineNote,
    chipRow,
    el('div', { class: 'quick-rows' }, rows.map((r) => r.row)),
    verdict,
  );
  breakdown.append(el('summary', {}, 'See how this adds up'), breakdownBody);

  setChildren(slot, [
    el('div', { class: 'card quick' }, [
      el('div', { class: 'quick-top' }, [
        el('label', { class: 'quick-in' }, [el('span', { class: 'quick-in-label' }, 'Your annual CTC (₹)'), el('span', { class: 'quick-in-row' }, [ctcInput, echo])]),
        startOver,
      ]),
      answer,
      refine,
      adjust,
      breakdown,
      el('p', { class: 'quick-assume muted small' }, [
        'Assumes Basic ', basicInput, '% of CTC, HRA half of Basic, employer PF and gratuity on top of the CTC, ', assumePt, ' professional tax, age under 60, FY 2026-27. Self-employed? ', el('a', { href: '/tax#detail' }, 'The full calculator takes business income'), '. An estimate, not tax advice.',
      ]),
    ]),
  ]);
  paint();

  const fromSaved = (p) => {
    q = { ...fromProfile(p), ...(ctc && !p.income.ctc ? { ctc } : {}) };
    ctcInput.value = q.ctc || '';
    basicInput.value = q.basicPct;
    added.clear();
    for (const r of rows) { if (q[r.d.key] > 0) added.add(r.d.key); r.sync(); }
    adjAdded.clear();
    for (const r of adjRows) { if (+q.inhand?.[r.d.key] > 0) adjAdded.add(r.d.key); r.sync(); }
    paint();
  };
  // Start over: the salary and deductions go from the profile in one undoable step, and the detailed
  // calculator on the same page (tax form, in-hand calculator) is told to clear itself too.
  startOver.addEventListener('click', () => {
    updateProfile(clearSalary, `reset:${source}`);
    fromSaved(getProfile());
    window.dispatchEvent(new CustomEvent('taxcompass:startover', { detail: { source } }));
    if (!ctc) ctcInput.focus();
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
 * (#detail, #payslip) and remembers being opened, per tool. onOpen runs each time it opens.
 */
export function detailFold(key, container, { label, openLabel, hash = '#detail', onOpen }) {
  const read = () => { try { return JSON.parse(localStorage.getItem(DETAIL) || '{}'); } catch { return {}; } };
  const btn = el('button', { type: 'button', class: 'detail-toggle', 'aria-expanded': 'false' });
  const setOpen = (v, { remember = true, scroll = false } = {}) => {
    container.classList.toggle('detail-closed', !v);
    btn.setAttribute('aria-expanded', String(v));
    btn.textContent = v ? openLabel : label;
    if (remember) { try { localStorage.setItem(DETAIL, JSON.stringify({ ...read(), [key]: v })); } catch {} }
    if (v && onOpen) onOpen();
    if (v) window.dispatchEvent(new Event('resize'));   // charts drawn while hidden re-measure
    // after the router's own scroll to the top, which runs once the route has been handled
    if (v && scroll) setTimeout(() => btn.scrollIntoView({ block: 'start', behavior: 'smooth' }), 60);
  };
  btn.addEventListener('click', () => setOpen(container.classList.contains('detail-closed')));
  setOpen(location.hash === hash || !!read()[key], { remember: false, scroll: location.hash === hash });
  return { button: btn, open: (scroll = true) => setOpen(true, { scroll }) };
}
