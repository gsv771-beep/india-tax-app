import { el, setChildren, disclaimer } from './util.js';

/**
 * Classification the raw pack does not carry as fields: instrument type, issuer, 80C status and
 * how interest is taxed. Keyed by scheme id in data/schemes.json.
 */
const META = {
  ppf: { type: 'Savings account', issuer: 'Government of India', s80c: 'Yes', interestTax: 'Tax-free (EEE)', taxFree: true, seniors: false },
  epf: { type: 'Provident fund', issuer: 'EPFO, Government of India', s80c: 'Yes, employee share', interestTax: 'Tax-free on contributions up to ₹2.5L a year', taxFree: true },
  vpf: { type: 'Provident fund', issuer: 'EPFO, Government of India', s80c: 'Yes', interestTax: 'Tax-free on contributions up to ₹2.5L a year (with EPF)', taxFree: true },
  ssy: { type: 'Savings account', issuer: 'Government of India', s80c: 'Yes', interestTax: 'Tax-free (EEE)', taxFree: true },
  scss: { type: 'Deposit', issuer: 'Government of India', s80c: 'Yes', interestTax: 'Taxable; ₹50,000 deduction under 80TTB', seniors: true },
  nsc: { type: 'Certificate', issuer: 'Government of India, via India Post', s80c: 'Yes; accrued interest re-qualifies', interestTax: 'Taxable at maturity' },
  kvp: { type: 'Certificate', issuer: 'Government of India, via India Post', s80c: 'No', interestTax: 'Taxable' },
  pomis: { type: 'Deposit', issuer: 'India Post', s80c: 'No', interestTax: 'Taxable' },
  po_td: { type: 'Deposit', issuer: 'India Post', s80c: '5-year deposit only', interestTax: 'Taxable' },
  po_rd: { type: 'Deposit', issuer: 'India Post', s80c: 'No', interestTax: 'Taxable' },
  po_savings: { type: 'Savings account', issuer: 'India Post', s80c: 'No', interestTax: 'Exempt up to ₹3,500 a year' },
  rbi_frsb: { type: 'Bond', issuer: 'Government of India, via RBI', s80c: 'No', interestTax: 'Taxable' },
};
const TYPES = ['Savings account', 'Deposit', 'Certificate', 'Bond', 'Provident fund', 'Pension'];

export function initSchemes({ schemes }) {
  const body = document.getElementById('schemes-body');
  const rows = buildRows(schemes);
  body.replaceChildren(
    el('p', { class: 'muted' }, `Small-savings rates for ${schemes._meta.rate_quarter_in_force}. ${schemes._meta.next_rate_notification}`),
    comparisonSection(rows),
    postTaxSection(schemes),
    npsSection(schemes.nps),
    apySection(schemes.apy),
    closedSection(schemes.closed_to_new_money),
    disclaimer(['invest', 'tax']),
  );
}

function buildRows(schemes) {
  const rows = schemes.schemes.map((x) => {
    const m = META[x.id] || { type: 'Other', issuer: '', s80c: '', interestTax: '' };
    const rateNum = typeof x.rate === 'number' ? x.rate : x.current_coupon || (x.rates ? Math.max(...Object.values(x.rates)) : null);
    const rateText = typeof x.rate === 'number' ? `${x.rate.toFixed(2)}%` : x.rates ? Object.entries(x.rates).map(([k, v]) => `${k}: ${v}%`).join(', ') : x.current_coupon ? `${x.current_coupon.toFixed(2)}% (floating)` : '';
    return {
      id: x.id, name: x.name, ...m, rateNum, rateText,
      rateNote: x.rate_applies_to ? `for ${x.rate_applies_to}` : x.coupon_period ? x.coupon_period : '',
      tenure: x.tenure || x.maturity || (x.maturity_months ? `${x.maturity_months} months` : '') || x.lock_in || '',
      who: x.eligibility || '',
      raw: x,
    };
  });
  rows.push({
    id: 'nps', name: 'National Pension System (NPS)', type: 'Pension', issuer: 'PFRDA (regulator); pension funds manage the money', rateNum: null,
    rateText: 'Market-linked', rateNote: 'depends on your equity/debt mix', tenure: 'Till age 60 or 15 years (All-Citizen)', s80c: 'Yes, plus extra ₹50,000 (old regime); employer share in both regimes',
    interestTax: '60% of corpus tax-free at exit; annuity income taxable', who: 'Indian citizens 18-70, including NRIs and OCIs', raw: null,
  });
  rows.push({
    id: 'apy', name: 'Atal Pension Yojana (APY)', type: 'Pension', issuer: 'PFRDA; guaranteed by Government of India', rateNum: null,
    rateText: 'Guaranteed pension of ₹1,000 to ₹5,000 a month', rateNote: 'from age 60', tenure: 'At least 20 years of contributions', s80c: 'Yes (old regime)',
    interestTax: 'Pension taxable at slab rates', who: 'Ages 18-40; not open to anyone who is or has been an income-tax payer', raw: null,
  });
  return rows;
}

function comparisonSection(rows) {
  const state = { type: 'All', only80c: false, onlyTaxFree: false, sort: 'rate' };
  const table = el('div', { class: 'table-wrap' });
  const chips = el('div', { class: 'chips' });
  const c80 = el('input', { type: 'checkbox' });
  const cTax = el('input', { type: 'checkbox' });
  const sort = el('select', {}, [el('option', { value: 'rate' }, 'Highest rate first'), el('option', { value: 'name' }, 'Name A to Z'), el('option', { value: 'type' }, 'By type')]);
  c80.addEventListener('change', () => { state.only80c = c80.checked; render(); });
  cTax.addEventListener('change', () => { state.onlyTaxFree = cTax.checked; render(); });
  sort.addEventListener('change', () => { state.sort = sort.value; render(); });

  function renderChips() {
    setChildren(chips, ['All', ...TYPES].map((t) => el('button', { type: 'button', class: t === state.type ? 'active' : '', onclick: () => { state.type = t; renderChips(); render(); } }, t)));
  }
  function render() {
    let list = rows.filter((r) => (state.type === 'All' || r.type === state.type) && (!state.only80c || /^yes|only/i.test(r.s80c)) && (!state.onlyTaxFree || r.taxFree));
    list.sort((a, b) => state.sort === 'rate' ? (b.rateNum ?? -1) - (a.rateNum ?? -1) || a.name.localeCompare(b.name) : state.sort === 'type' ? a.type.localeCompare(b.type) || a.name.localeCompare(b.name) : a.name.localeCompare(b.name));
    const trs = [];
    for (const r of list) {
      const detail = el('tr', { class: 'detail', hidden: true }, [el('td', { colspan: 7 }, detailBlock(r))]);
      const btn = el('button', { type: 'button', class: 'link-btn' }, 'Details');
      btn.addEventListener('click', () => { detail.hidden = !detail.hidden; btn.textContent = detail.hidden ? 'Details' : 'Hide'; });
      trs.push(el('tr', {}, [
        el('td', {}, [el('strong', {}, r.name), el('div', { class: 'muted small' }, r.type)]),
        el('td', { class: 'left' }, r.issuer),
        el('td', {}, [r.rateText, r.rateNote ? el('div', { class: 'muted small' }, r.rateNote) : null]),
        el('td', { class: 'left' }, r.tenure),
        el('td', { class: 'left' }, r.s80c),
        el('td', { class: 'left' }, r.interestTax),
        el('td', {}, btn),
      ]), detail);
    }
    setChildren(table, [el('table', { class: 'compare schemes-table' }, [
      el('thead', {}, el('tr', {}, [el('th', {}, 'Scheme'), el('th', { class: 'left' }, 'Issuer'), el('th', {}, 'Rate'), el('th', { class: 'left' }, 'Tenure / lock-in'), el('th', { class: 'left' }, '80C deduction'), el('th', { class: 'left' }, 'Tax on interest'), el('th', {}, '')])),
      el('tbody', {}, trs.length ? trs : [el('tr', {}, el('td', { colspan: 7, class: 'muted' }, 'No scheme matches these filters.'))]),
    ])]);
  }
  // deep links from the tax page: #schemes?f=80c (80C-eligible) or #schemes?f=pension
  const applyHash = () => {
    const q = new URLSearchParams((location.hash.split('?')[1] || ''));
    const f = q.get('f');
    if (!f) return;
    if (f === '80c') { state.only80c = true; c80.checked = true; state.type = 'All'; }
    if (f === 'pension') { state.type = 'Pension'; state.only80c = false; c80.checked = false; }
    renderChips(); render();
  };
  window.addEventListener('hashchange', applyHash);
  renderChips(); render(); applyHash();
  return el('div', {}, [
    el('h2', {}, 'Compare schemes at a glance'),
    el('div', { class: 'filters' }, [
      chips,
      el('label', { class: 'check' }, [c80, '80C deduction available']),
      el('label', { class: 'check' }, [cTax, 'Interest tax-free']),
      el('label', { class: 'inline' }, ['Sort', sort]),
    ]),
    table,
  ]);
}

function detailBlock(r) {
  const x = r.raw;
  if (!x) return el('p', { class: 'muted' }, r.id === 'nps' ? 'See the NPS section below for tiers, tax treatment and exit rules.' : 'See the APY section below.');
  const items = [
    ['Who can invest', x.eligibility],
    ['Minimum / maximum', [x.min != null ? `₹${Number(x.min).toLocaleString('en-IN')}${x.min_basis ? ' ' + x.min_basis : ''}` : '', x.max != null ? (typeof x.max === 'number' ? `₹${x.max.toLocaleString('en-IN')}${x.max_basis ? ' ' + x.max_basis : ''}` : x.max) : x.max_single ? `₹${x.max_single.toLocaleString('en-IN')} single / ₹${x.max_joint.toLocaleString('en-IN')} joint` : ''].filter(Boolean).join(' / ')],
    ['Interest', x.compounding || x.payout || x.interest_payment],
    ['Tax', x.tax || x.tax_contribution],
    ['Early exit', x.premature_closure || x.premature || x.premature_exit],
    ['Partial withdrawal', x.partial_withdrawal],
    ['Loan against it', x.loan],
    ['Where to open', x.where],
    ['Worth knowing', x.app_note || x.interest_calc_quirk || x.tax_interest],
    ['Current-year rate', x.rate_fy2026_27 ? 'The FY 2026-27 rate has not been declared yet. It is usually announced around February or March of the following year; the FY 2025-26 rate is shown until then.' : ''],
  ].filter(([, v]) => v);
  return el('dl', { class: 'kv' }, items.flatMap(([k, v]) => [el('dt', {}, k), el('dd', {}, v)]));
}

const TAX_FREE_IDS = new Set(['ppf', 'ssy']);
function postTaxSection(s) {
  const sel = el('select', {}, [0, 5, 10, 15, 20, 25, 30].map((p) => el('option', { value: p, selected: p === 30 }, p === 0 ? 'No tax (income below exemption)' : `${p}% slab`)));
  const out = el('div', { class: 'table-wrap' });
  const items = s.schemes.filter((x) => typeof x.rate === 'number' || x.current_coupon).map((x) => ({ id: x.id, name: x.name, rate: typeof x.rate === 'number' ? x.rate : x.current_coupon }));
  const render = () => {
    const eff = (+sel.value / 100) * 1.04;
    const rows = items.map((x) => {
      const taxFree = TAX_FREE_IDS.has(x.id);
      const post = taxFree ? x.rate : x.rate * (1 - eff);
      return { ...x, taxFree, post };
    }).sort((a, b) => b.post - a.post);
    setChildren(out, [el('table', { class: 'compare' }, [
      el('thead', {}, el('tr', {}, [el('th', {}, 'Scheme'), el('th', {}, 'Headline rate'), el('th', {}, 'Interest'), el('th', {}, 'What you keep')])),
      el('tbody', {}, rows.map((x) => el('tr', {}, [el('td', {}, x.name), el('td', {}, x.rate.toFixed(2) + '%'), el('td', {}, x.taxFree ? 'Tax-free' : 'Taxable at your slab'), el('td', { class: x.taxFree ? 'better' : '' }, x.post.toFixed(2) + '%')]))),
    ])]);
  };
  sel.addEventListener('change', render);
  render();
  return el('details', { class: 'section' }, [
    el('summary', {}, 'What you actually keep after tax, by your slab'),
    el('p', { class: 'muted' }, 'A taxable 8.2% is worth less than a tax-free 7.1% for anyone in the 30% bracket. Cess is included; the 80C deduction on the deposit is not.'),
    el('label', { style: 'max-width:320px;margin-bottom:10px' }, ['Your marginal tax slab', sel]),
    out,
  ]);
}

function npsSection(nps) {
  const tax = nps.tax_treatment;
  const yesNo = (v) => (v === undefined ? '' : v ? 'Yes' : 'No');
  const taxRows = Object.entries(tax).filter(([k, v]) => !k.startsWith('_') && typeof v === 'object').map(([k, v]) => {
    const limit = v.limit || (v.limit_old_regime ? `Old: ${v.limit_old_regime}; New: ${v.limit_new_regime}` : '') || v.exempt_share || v.exempt || (v.cap ? `₹${v.cap.toLocaleString('en-IN')} ${v.scope}` : '') || v.purchase || '';
    const both = v.applies_both_regimes;
    return el('tr', {}, [el('td', { class: 'left' }, k.replace(/_/g, ' ')), el('td', { class: 'left' }, limit), el('td', {}, both !== undefined ? yesNo(both) : yesNo(v.old_regime)), el('td', {}, both !== undefined ? yesNo(both) : yesNo(v.new_regime))]);
  });
  const table = (head, rows) => el('div', { class: 'table-wrap' }, el('table', { class: 'compare' }, [el('thead', {}, el('tr', {}, head.map((h) => el('th', { class: 'left' }, h)))), el('tbody', {}, rows)]));
  return el('div', {}, [
    el('h2', {}, 'National Pension System (NPS)'),
    el('div', { class: 'card' }, [
      el('dl', { class: 'kv' }, [
        el('dt', {}, 'What it is'), el('dd', {}, 'A market-linked retirement account regulated by PFRDA. You choose how much goes to equity (E), corporate debt (C), government bonds (G) and alternatives (A), or let an age-based auto choice do it.'),
        el('dt', {}, 'Tier I'), el('dd', {}, `Locked pension account. Minimum ₹${nps.tiers.tier_1.min_per_year.toLocaleString('en-IN')} a year. Lock-in: ${nps.tiers.tier_1.lock_in}.`),
        el('dt', {}, 'Tier II'), el('dd', {}, 'Optional, fully liquid add-on account. Needs an active Tier I. No tax benefit for most subscribers.'),
        el('dt', {}, 'At exit'), el('dd', {}, `${nps.exit_rules_non_government.normal_exit_split}. The lump sum is tax-free only up to 60% of the corpus; the annuity pension is taxable.`),
      ]),
      el('div', { class: 'notice warn' }, [el('strong', {}, 'Lump sum at exit: '), nps.CRITICAL_MISMATCH.issue]),
    ]),
    el('details', { class: 'section' }, [el('summary', {}, 'Tax treatment, old regime versus new'), table(['Item', 'Limit', 'Old regime', 'New regime'], taxRows)]),
    el('details', { class: 'section' }, [el('summary', {}, 'Investment choices'), table(['Asset class', 'Active choice cap', 'Auto choice cap'], Object.entries(nps.asset_classes).map(([k, v]) => el('tr', {}, [el('td', { class: 'left' }, `${k}: ${v.name}`), el('td', { class: 'left' }, v.cap_active_choice), el('td', { class: 'left' }, v.cap_auto_choice)]))),
      el('p', { class: 'muted' }, 'Auto choice life-cycle funds: ' + nps.auto_choice_lifecycle_funds.map((f) => `${f.code} ${f.name}${f.is_default ? ' (default)' : ''}`).join(', ') + '.')]),
    el('details', { class: 'section' }, [el('summary', {}, 'Partial withdrawal and early exit'), el('dl', { class: 'kv' }, [
      el('dt', {}, 'Partial withdrawal'), el('dd', {}, `After ${nps.partial_withdrawal.min_membership_years} years, up to ${nps.partial_withdrawal.max_amount}. ${nps.partial_withdrawal.frequency_before_60}.`),
      el('dt', {}, 'Allowed for'), el('dd', {}, nps.partial_withdrawal.permitted_reasons.join('; ')),
      el('dt', {}, 'Premature exit'), el('dd', {}, `${nps.exit_rules_non_government.premature_exit_split}. Minimum lock-in for premature exit: ${nps.exit_rules_non_government.minimum_lock_in_for_premature_exit}.`),
      el('dt', {}, 'On death'), el('dd', {}, nps.exit_rules_non_government.on_death),
    ])]),
    el('details', { class: 'section' }, [el('summary', {}, 'Historical returns by asset class'), table(['Class', '1 yr', '3 yr', '5 yr', '10 yr'], Object.entries(nps.historical_returns_by_asset_class).filter(([k]) => !k.startsWith('_')).map(([k, v]) => el('tr', {}, [el('td', { class: 'left' }, k.replace(/_/g, ' ')), el('td', {}, v['1yr'] + '%'), el('td', {}, v['3yr'] + '%'), el('td', {}, v['5yr'] + '%'), el('td', {}, v['10yr'] + '%')]))),
      el('p', { class: 'muted' }, nps.historical_returns_by_asset_class._caveat)]),
  ]);
}

function apySection(apy) {
  return el('details', { class: 'section' }, [
    el('summary', {}, 'Atal Pension Yojana (APY)'),
    el('p', {}, `${apy.eligibility}. Pension slabs of ₹${apy.pension_slabs_monthly.join(', ₹')} a month, guaranteed by the Government.`),
    el('div', { class: 'notice warn' }, apy.income_tax_payer_bar),
    el('p', { class: 'muted' }, `${apy.on_death} ${apy.exit_before_60}`),
  ]);
}

function closedSection(items) {
  return el('details', { class: 'section' }, [
    el('summary', {}, 'Schemes closed to new money'),
    el('div', { class: 'scheme-grid' }, items.map((x) => el('div', { class: 'scheme' }, [el('h3', {}, x.name), el('small', {}, x.status), el('p', { style: 'font-size:.88rem' }, x.detail)]))),
  ]);
}
