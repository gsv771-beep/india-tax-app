/**
 * The quick answer: type a CTC, see the monthly in-hand pay and which regime costs less, at once.
 * "Could the old regime win for you?" adds the deductions a person actually has (rent, home loan, 80C,
 * health cover, own NPS) one tick at a time and shows how close they are to the point where it flips.
 * Before anything is typed, a table of common CTCs fills the space and a tap on a row fills the box.
 *
 * Mounted on the home page, the tax page and the in-hand salary page (each with its own profile source,
 * so one copy hears what another saved). The arithmetic is quick-engine.js.
 */
import { el, inr, inrShort, setChildren, debounce } from './util.js';
import { getProfile, updateProfile, onProfileChange } from './profile-store.js';
import { fromSalaryStore, toTaxInputs, ctcOf, isEmptyProfile, CITIES, METRO_CITIES } from '../engine/profile.js';
import { quickAnswer, ladder, QUICK_DEFAULTS, LIMIT_80C } from './quick-engine.js';

const DETAIL = 'taxcompass.detail-open.v1';
const live = new Map();   // one listener per mount point, replaced when a page re-renders its copy

/** The quick form's figures, from the shared profile. */
function fromProfile(p) {
  const i = p.income, ctc = Math.round(ctcOf(i));
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
  };
}

const DEDUCTIONS = [
  { key: 'rentMonthly', label: 'I pay rent', unit: 'a month', dflt: 25000, step: 1000, hint: () => 'the old regime exempts part of your HRA' },
  { key: 'homeLoanInterest', label: 'Home loan on a house I live in', unit: 'interest a year', dflt: 200000, step: 10000, hint: () => 'up to ₹2 lakh of interest counts (section 24b)' },
  { key: 'other80c', label: 'PPF, ELSS, life insurance, tuition fees', unit: 'a year', dflt: null, step: 5000, hint: (a) => a ? `80C: your PF already uses ${inr(a.claimed.epf)} of the ${inrShort(LIMIT_80C)}, so ${inr(a.room80c)} is left` : '80C, on top of your PF' },
  { key: 'healthSelf', label: 'Health insurance for my family', unit: 'premium a year', dflt: 25000, step: 1000, hint: () => '80D: up to ₹25,000, ₹50,000 if you are over 60' },
  { key: 'nps1b', label: 'NPS I pay into myself', unit: 'a year', dflt: 50000, step: 5000, hint: () => '80CCD(1B): up to ₹50,000 over the 80C limit' },
];

/**
 * mountQuick(slot, { rates, source, taxLink, salaryLink })
 *   source      the profile source this copy writes as ('quick:home', 'quick:tax', 'quick:salary')
 *   taxLink, salaryLink   { href, text, onclick? } under each result tile; onclick opens the detailed
 *               tool on a page that has it below instead of navigating away
 */
export function mountQuick(slot, { rates, source, taxLink, salaryLink }) {
  if (!slot || !rates) return;
  if (live.has(source)) live.get(source)();
  let q = fromProfile(getProfile());
  const ladderRows = ladder(rates);
  const ticked = new Set(DEDUCTIONS.filter((d) => q[d.key] > 0).map((d) => d.key));

  // ---- the input ----
  const ctcInput = el('input', { type: 'number', min: 0, step: 50000, inputmode: 'numeric', placeholder: 'e.g. 1800000', class: 'quick-ctc', 'data-echo': 'own', 'aria-label': 'Your annual CTC in rupees', value: q.ctc || '' });
  const echo = el('span', { class: 'quick-echo', 'aria-live': 'polite' });
  const results = el('div', { class: 'quick-results' });
  const flip = el('div', { class: 'quick-flip' });
  const table = el('div', { class: 'quick-ladder' });
  const assumePt = el('span');
  const basicInput = el('input', { type: 'number', min: 10, max: 80, step: 1, class: 'quick-basic', value: q.basicPct, 'aria-label': 'Basic pay as a percentage of CTC' });

  const save = debounce(() => {
    const a = quickAnswer(q, rates);
    if (!a || a.error) return;
    updateProfile((d) => {
      const prev = fromProfile(d);
      // a new CTC or Basic % rewrites the salary split; a tick on a deduction leaves any detailed split alone
      let out = prev.ctc !== q.ctc || Math.abs(prev.basicPct - q.basicPct) > 0.05 || isEmptyProfile(d) ? fromSalaryStore(d, { ...a.store, regime: a.better }, a.pay) : d;
      out.tax.s80cUsed = q.other80c || 0; out.tax.s80dUsed = q.healthSelf || 0; out.tax.nps1bUsed = q.nps1b || 0;
      if (!q.listedLoan) out.tax.homeLoanInterest = q.homeLoanInterest || 0;
      out.location.city = q.city; out.location.metro = METRO_CITIES.includes(q.city);
      out.location.rentPaid = 12 * (q.rentMonthly || 0);
      if (q.rentMonthly > 0) out.location.housing = 'rent';
      out.tax.regime = a.better;
      out.person.employment = out.person.employment === 'self_employed' || out.person.employment === 'both' ? 'both' : 'salaried';
      return out;
    }, source);
  }, 700);

  const set = (patch, { persist = true } = {}) => { q = { ...q, ...patch }; paint(); if (persist) save(); };
  ctcInput.addEventListener('input', () => set({ ctc: +ctcInput.value || 0 }));
  basicInput.addEventListener('change', () => set({ basicPct: Math.min(80, Math.max(10, +basicInput.value || QUICK_DEFAULTS.basicPct)) }));

  // ---- the deduction ticks: built once so typing in them keeps focus ----
  const rows = DEDUCTIONS.map((d) => {
    const box = el('input', { type: 'checkbox', checked: ticked.has(d.key) });
    const amount = el('input', { type: 'number', min: 0, step: d.step, inputmode: 'numeric', 'data-echo': 'own', value: q[d.key] || '', 'aria-label': `${d.label}, ₹ ${d.unit}` });
    const hint = el('small', { class: 'quick-hint' });
    const extra = d.key === 'rentMonthly'
      ? el('select', { class: 'quick-city', 'aria-label': 'City you live in' }, CITIES.map((c) => el('option', { value: c, selected: c === q.city }, c === 'Other' ? 'Other city' : c)))
      : null;
    if (extra) extra.addEventListener('change', () => set({ city: extra.value }));
    const amountWrap = el('span', { class: 'quick-amount' }, ['₹', amount, el('span', { class: 'unit' }, d.unit), extra]);
    const sync = () => { amountWrap.hidden = !box.checked; row.classList.toggle('on', box.checked); };
    box.addEventListener('change', () => {
      if (box.checked) {
        ticked.add(d.key);
        if (!(+amount.value > 0)) amount.value = d.dflt != null ? d.dflt : (quickAnswer(q, rates)?.room80c || 50000);
        set({ [d.key]: +amount.value || 0 });
        amount.focus({ preventScroll: true });
      } else { ticked.delete(d.key); set({ [d.key]: 0 }); }
      sync();
    });
    amount.addEventListener('input', () => set({ [d.key]: +amount.value || 0 }));
    const row = el('div', { class: 'quick-row' }, [el('label', { class: 'quick-tick' }, [box, el('span', {}, d.label)]), amountWrap, hint]);
    sync();
    return { d, row, box, amount, hint, extra };
  });
  const refreshRows = (a) => { for (const r of rows) { r.hint.textContent = r.d.hint(a); if (document.activeElement !== r.amount) r.amount.value = q[r.d.key] || ''; if (r.extra) r.extra.value = q.city; } };

  function paint() {
    const a = quickAnswer(q, rates);
    echo.textContent = q.ctc > 0 ? `${inrShort(q.ctc)} a year` : '';
    assumePt.textContent = inr(q.professionalTax ?? QUICK_DEFAULTS.professionalTax);
    slot.classList.toggle('has-answer', !!(a && !a.error));
    if (!a) { setChildren(results, []); flip.hidden = true; paintLadder(null); return; }
    if (a.error) { setChildren(results, el('p', { class: 'notice warn' }, a.error)); flip.hidden = true; return; }
    const other = a.better === 'new' ? 'old' : 'new';
    const taxMonthly = a.tax[a.better] / 12;
    const max = Math.max(a.tax.new, a.tax.old, 1);
    const bar = (r) => el('div', { class: 'quick-bar' + (r === a.better ? ' win' : '') }, [
      el('span', { class: 'quick-bar-k' }, r === 'new' ? 'New regime' : 'Old regime'),
      el('span', { class: 'quick-bar-track' }, el('span', { class: 'quick-bar-fill', style: `width:${Math.max(2, 100 * a.tax[r] / max).toFixed(1)}%` })),
      el('span', { class: 'quick-bar-v' }, inr(a.tax[r])),
    ]);
    setChildren(results, [
      el('div', { class: 'quick-tile' }, [
        el('div', { class: 'quick-k' }, 'In hand each month'),
        el('div', { class: 'quick-v' }, inr(a.monthly.best)),
        el('div', { class: 'quick-sub' }, `${inrShort(a.inHand.best)} a year, after ${inr(a.pay.employeePf / 12)} PF, ${inr(a.pay.professionalTax / 12)} professional tax and ${inr(taxMonthly)} income tax a month (${a.better} regime).`),
        salaryLink ? el('a', { class: 'quick-link', href: salaryLink.href, onclick: salaryLink.onclick }, salaryLink.text) : null,
      ]),
      el('div', { class: 'quick-tile' + (a.same ? '' : ' quick-win') }, [
        el('div', { class: 'quick-k' }, a.same ? 'Tax is the same in both regimes' : `The ${a.better} regime saves you`),
        el('div', { class: 'quick-v' }, a.same ? inr(a.tax.new) : [inr(a.saves), el('span', { class: 'quick-per' }, ' a year')]),
        el('div', { class: 'quick-sub' }, a.same ? (a.tax.new === 0 ? 'No income tax either way after the rebate.' : 'Either regime costs the same on these figures.') : `${inr(a.saves / 12)} a month more in hand than the ${other} regime.`),
        el('div', { class: 'quick-bars' }, [bar('new'), bar('old')]),
        taxLink ? el('a', { class: 'quick-link', href: taxLink.href, onclick: taxLink.onclick }, taxLink.text) : null,
      ]),
    ]);

    // ---- could the old regime win? ----
    flip.hidden = false;
    const need = a.needed, have = a.claimed.total;
    const pct = need ? Math.min(100, 100 * have / need) : 100;
    const verdict = a.tax.new === 0 && a.tax.old === 0 ? 'No tax in either regime at this income, so the choice does not matter.'
      : a.better === 'old' ? `With these, the old regime wins by ${inr(a.saves)} a year. Tell your employer you want the old regime so the tax taken from your salary matches, or choose it when you file your return.`
      : a.be.kind === 'impossible' ? 'The new regime wins even if every rupee of your pay were deducted in the old one.'
      : need ? `You would need ${inr(Math.max(0, need - have))} more in old-regime deductions for it to win. Until then, stay on the new regime.` : '';
    setChildren(flip.querySelector('.quick-meter'), need ? [
      el('div', { class: 'quick-meter-text' }, [el('span', {}, ['Your old-regime deductions: ', el('b', {}, inr(have))]), el('span', {}, ['It wins above ', el('b', {}, inr(need))])]),
      el('div', { class: 'quick-meter-track', role: 'meter', 'aria-valuemin': 0, 'aria-valuemax': Math.round(need), 'aria-valuenow': Math.round(have), 'aria-label': 'Old-regime deductions against the point where the old regime wins' }, el('span', { class: 'quick-meter-fill' + (a.better === 'old' ? ' past' : ''), style: `width:${pct.toFixed(1)}%` })),
      el('div', { class: 'quick-meter-parts muted small' }, [`Counted: your PF ${inr(a.claimed.epf)}`, a.claimed.hra ? `, HRA exemption ${inr(a.claimed.hra)}` : '', a.claimed.s80c > a.claimed.epf ? `, other 80C ${inr(a.claimed.s80c - a.claimed.epf)}` : '', a.claimed.homeLoan ? `, home-loan interest ${inr(a.claimed.homeLoan)}` : '', a.claimed.health ? `, health cover ${inr(a.claimed.health)}` : '', a.claimed.nps ? `, NPS ${inr(a.claimed.nps)}` : '', '.']),
    ] : []);
    const v = flip.querySelector('.quick-verdict'); if (v) v.textContent = verdict;
    refreshRows(a);
    paintLadder(a);
  }

  function paintLadder(a) {
    const rowsData = ladderRows;
    const near = a ? rowsData.reduce((b, r) => (Math.abs(r.ctc - a.ctc) < Math.abs(b.ctc - a.ctc) ? r : b), rowsData[0]) : null;
    setChildren(table, [
      el('div', { class: 'quick-ladder-head' }, [
        el('h2', {}, a ? 'Salaries around yours' : 'In-hand pay and tax at common salaries'),
        el('p', { class: 'muted small' }, 'FY 2026-27, the default split below, no deductions beyond PF. Tap a row to use that CTC.'),
      ]),
      el('div', { class: 'table-wrap' }, el('table', { class: 'compare quick-table' }, [
        el('thead', {}, el('tr', {}, [el('th', {}, 'CTC'), el('th', {}, 'In hand a month'), el('th', {}, 'Tax, new regime'), el('th', {}, 'Tax, old regime'), el('th', {}, 'Old wins only above')]),),
        el('tbody', {}, rowsData.map((r) => {
          const tr = el('tr', { class: r === near ? 'near' : '', tabindex: 0, role: 'button', 'aria-label': `Use a CTC of ${inrShort(r.ctc)}` }, [
            el('td', {}, inrShort(r.ctc)), el('td', {}, inr(r.monthly)), el('td', {}, inr(r.newTax)), el('td', {}, inr(r.oldTax)),
            el('td', {}, r.oldNeeds ? `${inr(r.oldNeeds)} of deductions` : 'no tax either way'),
          ]);
          const use = () => { ctcInput.value = r.ctc; set({ ctc: r.ctc }); slot.scrollIntoView({ block: 'start', behavior: 'smooth' }); };
          tr.addEventListener('click', use);
          tr.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); use(); } });
          return tr;
        })),
      ])),
    ]);
  }

  flip.append(
    el('h3', { class: 'quick-flip-title' }, 'Could the old regime still win for you?'),
    el('p', { class: 'muted small' }, 'Only if your deductions are big enough. Tick what you have; the answer above follows.'),
    el('div', { class: 'quick-meter' }),
    el('div', { class: 'quick-rows' }, rows.map((r) => r.row)),
    el('p', { class: 'quick-verdict' }),
  );

  setChildren(slot, [
    el('div', { class: 'card quick' }, [
      el('label', { class: 'quick-in' }, [el('span', { class: 'quick-in-label' }, 'Your annual CTC (₹)'), el('span', { class: 'quick-in-row' }, [ctcInput, echo]), el('small', { class: 'muted' }, ['Cost to company, as on your offer letter. Self-employed or a business? ', el('a', { href: '/tax#detail' }, 'The full tax calculator takes business income'), '.'])]),
      results,
      flip,
      el('p', { class: 'quick-assume muted small' }, [
        'Assumes Basic ', basicInput, '% of CTC, HRA half of Basic, employer PF and gratuity inside the CTC, ', assumePt, ' professional tax, age under 60, FY 2026-27. An estimate, not tax advice.',
      ]),
    ]),
    table,
  ]);
  paint();

  const off = onProfileChange((p) => {
    if (slot.contains(document.activeElement)) return;
    q = fromProfile(p);
    ctcInput.value = q.ctc || '';
    basicInput.value = q.basicPct;
    for (const r of rows) { r.box.checked = q[r.d.key] > 0; r.row.classList.toggle('on', r.box.checked); r.row.querySelector('.quick-amount').hidden = !r.box.checked; }
    paint();
  }, source);
  live.set(source, off);
}

/**
 * The detailed tool under the quick answer, folded until asked for. Opens by itself on #detail links
 * and remembers being opened, per page.
 */
export function detailFold(key, container, { label, openLabel }) {
  const read = () => { try { return JSON.parse(localStorage.getItem(DETAIL) || '{}'); } catch { return {}; } };
  const btn = el('button', { type: 'button', class: 'detail-toggle', 'aria-expanded': 'false' });
  const setOpen = (v, { remember = true, scroll = false } = {}) => {
    container.classList.toggle('detail-closed', !v);
    btn.setAttribute('aria-expanded', String(v));
    btn.textContent = v ? openLabel : label;
    if (remember) { try { localStorage.setItem(DETAIL, JSON.stringify({ ...read(), [key]: v })); } catch {} }
    if (v) window.dispatchEvent(new Event('resize'));   // charts drawn while hidden re-measure
    // after the router's own scroll to the top, which runs once the route has been handled
    if (v && scroll) setTimeout(() => btn.scrollIntoView({ block: 'start', behavior: 'smooth' }), 60);
  };
  btn.addEventListener('click', () => setOpen(container.classList.contains('detail-closed')));
  setOpen(location.hash === '#detail' || !!read()[key], { remember: false, scroll: location.hash === '#detail' });
  return { button: btn, open: (scroll = true) => setOpen(true, { scroll }) };
}
