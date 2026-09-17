/**
 * "Which is better after tax?": the same rupee in PPF, FD, debt fund, arbitrage, NPS, equity and
 * more, over your horizon, at your slab. Answers the questions behind half of every finance forum:
 * is PPF worth it under the new regime, FD or debt fund, where to park money for six months.
 * Rates: small savings from data/schemes.json (quarterly notification), fund categories from the
 * AMFI-derived history (median rolling return, not a forecast), EPF from its declared rate, NPS from
 * a 50:50 blend of published asset-class figures. Every rate is editable on the page and labelled.
 * Engine: engine/post-tax.js.
 */
import { inr, pct, el, setChildren, disclaimer, debounce, isBlankAfterReset, clearBlankAfterReset } from './util.js';
import { INSTRUMENTS, RISK_PROFILES, compareAll, postTax, poTdRate } from '../engine/post-tax.js';
import { loadFunds, summariseCategories } from './funds.js';
import { getProfile } from './profile-store.js';
import { isEmptyProfile, toTaxInputs } from '../engine/profile.js';
import { computeRegime } from './tax-engine.js';
import { calcExportCard } from './calc-export-card.js';

const STORE = 'taxcompass.compare.v1';
const HORIZONS = [[0.5, '6 months'], [1, '1 year'], [2, '2 years'], [3, '3 years'], [5, '5 years'], [7, '7 years'], [10, '10 years'], [15, '15 years'], [20, '20 years']];
const SLABS = [[0, 'Nil'], [0.05, '5%'], [0.1, '10%'], [0.15, '15%'], [0.2, '20%'], [0.25, '25%'], [0.3, '30%']];

/** Your marginal slab from the profile: tax on 10,000 more of income, under the regime you are on. */
function marginalSlab(p, rates) {
  if (isEmptyProfile(p) || !(p.income.ctc > 0)) return null;
  const t = toTaxInputs(p);
  const at = (extra) => computeRegime({ ...t, otherIncome: { ...(t.otherIncome || {}), other: (t.otherIncome?.other || 0) + extra } }, p.tax.regime, rates).tax.total;
  const m = (at(10000) - at(0)) / 10000 / 1.04;
  return SLABS.map(([v]) => v).reduce((best, v) => (Math.abs(v - m) < Math.abs(best - m) ? v : best), 0);
}

export function renderCompare({ rates, schemes }) {
  const p = getProfile();
  const blank = isBlankAfterReset('compare');
  let saved = {}; try { saved = JSON.parse(localStorage.getItem(STORE) || '{}'); } catch {}
  const fromProfile = {};
  if (!blank && !isEmptyProfile(p)) {
    const m = marginalSlab(p, rates);
    if (m != null) fromProfile.slabRate = m;
    fromProfile.regime = p.tax.regime;
    fromProfile.has80CRoom = p.tax.regime === 'old' && p.tax.s80cUsed < 150000;
    if (p.cashflow.monthlySurplus > 0) fromProfile.amount = Math.round(p.cashflow.monthlySurplus * 12);
  }
  const st = { amount: '', years: 5, slabRate: 0.3, regime: 'new', riskProfile: 'balanced', has80CRoom: false, ltcgExemptionAvailable: true, rateOverrides: {}, ...saved, ...fromProfile };
  const save = () => { clearBlankAfterReset('compare'); try { localStorage.setItem(STORE, JSON.stringify(st)); } catch {} };

  // ---- default rates, each with a source label ----
  const ss = schemes.small_savings_rates_q2_fy2026_27;
  const epf = (schemes.schemes || []).find((x) => x.id === 'epf');
  const npsHist = schemes.nps.historical_returns_by_asset_class;
  const npsMix = +((npsHist.E_equity['10yr'] * 0.5 + (npsHist.C_corporate_debt['10yr'] + npsHist.G_gsec['10yr']) / 2 * 0.5)).toFixed(2);
  let categories = null;   // filled once the fund data arrives
  const defaultRates = (years) => {
    const r = { savings: ss.post_office_savings_account.rate, fd: poTdRate(ss, years), nsc: ss.nsc_viii.rate, ppf: ss.ppf.rate, ssy: ss.ssy.rate, epf: epf ? epf.rate : null, nps: npsMix };
    const src = { savings: `post office savings, ${ss._effective}`, fd: `post office time deposit, ${ss._effective}`, nsc: `NSC, ${ss._effective}`, ppf: `PPF, ${ss._effective}`, ssy: `SSY, ${ss._effective}`, epf: epf ? `EPF ${epf.rate_applies_to}` : '', nps: '50:50 blend of NPS 10-year asset-class returns' };
    for (const inst of INSTRUMENTS) {
      if (!inst.category || inst.category === 'nps_mix') continue;
      const c = categories && categories.find((x) => x.category === inst.category);
      if (c) { r[inst.id] = +c.typical.toFixed(2); src[inst.id] = `${inst.category} funds: median ${years >= 5 ? '5' : '3'}-year rolling return (${c.count} funds); worst ${c.low.toFixed(1)}%, best ${c.high.toFixed(1)}%`; }
    }
    return { rates: r, sources: src };
  };

  // ---- inputs ----
  const out = el('div');
  let last = null;
  const exportCard = calcExportCard('compare', () => last);
  const render = () => paint();
  const rerender = debounce(render, 80);
  const field = (key, label, attrs = {}, hint) => {
    let input;
    if (attrs.options) input = el('select', {}, attrs.options.map(([v, t]) => el('option', { value: v, selected: String(v) === String(st[key]) }, t)));
    else if (attrs.type === 'checkbox') { input = el('input', { type: 'checkbox' }); input.checked = !!st[key]; }
    else input = el('input', { type: 'number', min: 0, step: attrs.step || 1, value: st[key] === '' ? '' : st[key], placeholder: attrs.placeholder });
    const immediate = !!attrs.options || attrs.type === 'checkbox';
    input.addEventListener(immediate ? 'change' : 'input', () => { st[key] = attrs.type === 'checkbox' ? input.checked : attrs.options ? (isNaN(+input.value) ? input.value : +input.value) : input.value === '' ? '' : +input.value; save(); if (immediate) { syncVisibility(); render(); } else rerender(); });
    const node = attrs.type === 'checkbox' ? el('label', { class: 'check' }, [input, label]) : el('label', {}, [label, hint ? el('small', {}, hint) : null, input]);
    return { node, input };
  };
  const F = {
    amount: field('amount', 'Amount (₹)', { step: 10000, placeholder: 'e.g. 100000' }, 'a lump sum today'),
    years: field('years', 'For how long', { options: HORIZONS }),
    riskProfile: field('riskProfile', 'How much risk you will take', { options: RISK_PROFILES.map((r) => [r.id, r.label]) }, 'decides which instruments are in the running; the rest are still shown below the line'),
    slabRate: field('slabRate', 'Your income tax slab', { options: SLABS }, fromProfile.slabRate != null ? 'your marginal rate, from your profile' : 'the rate on your last rupee of income'),
    regime: field('regime', 'Regime', { options: [['new', 'New regime'], ['old', 'Old regime']] }),
    has80CRoom: field('has80CRoom', 'I still have room under 80C / 80CCD(1B) this year', { type: 'checkbox' }),
    ltcgExemptionAvailable: field('ltcgExemptionAvailable', 'My ₹1,25,000 long-term equity exemption is unused this year', { type: 'checkbox' }),
  };
  const ratesFold = el('details', { class: 'opts fold' }, [el('summary', {}, 'Assumed returns (edit any)')]);
  const rateInputs = {};
  const buildRateInputs = () => {
    const { rates: r, sources } = defaultRates(+st.years);
    const rows = INSTRUMENTS.filter((inst) => r[inst.id] != null).map((inst) => {
      const input = el('input', { type: 'number', min: 0, max: 40, step: 0.1, value: st.rateOverrides[inst.id] ?? r[inst.id] });
      input.addEventListener('input', () => { if (input.value === '' || +input.value === r[inst.id]) delete st.rateOverrides[inst.id]; else st.rateOverrides[inst.id] = +input.value; save(); rerender(); });
      rateInputs[inst.id] = input;
      return el('label', {}, [`${inst.label} (% p.a.)`, el('small', {}, st.rateOverrides[inst.id] != null ? `your figure; default ${r[inst.id]}% from ${sources[inst.id]}` : sources[inst.id]), input]);
    });
    ratesFold.replaceChildren(el('summary', {}, 'Assumed returns (edit any)'), el('p', { class: 'opt-help' }, 'Guaranteed rates are the notified ones. Fund figures are what the category has typically returned over rolling windows of about your horizon: history, not a forecast. Change anything you disagree with.'), ...rows,
      el('button', { type: 'button', class: 'btn secondary small-btn', onclick: () => { st.rateOverrides = {}; save(); buildRateInputs(); render(); } }, 'Back to defaults'));
  };
  const syncVisibility = () => { F.has80CRoom.node.hidden = st.regime !== 'old'; };
  const inputs = el('div', { class: 'card inputs' }, [
    el('div', { class: 'opts', style: 'border-top:0;padding-top:0' }, [
      el('div', { class: 'opt-title' }, 'The question'),
      F.amount.node, F.years.node, F.riskProfile.node,
      el('div', { class: 'two' }, [F.slabRate.node, F.regime.node]),
      F.has80CRoom.node, F.ltcgExemptionAvailable.node,
    ]),
    ratesFold,
  ]);
  syncVisibility();
  buildRateInputs();
  loadFunds().then((data) => { categories = summariseCategories(data, Math.max(1, +st.years)); buildRateInputs(); render(); }).catch(() => {});
  F.years.input.addEventListener('change', () => { if (categories) buildRateInputs(); });

  // ---- output ----
  function paint() {
    if (!(+st.amount > 0)) { setChildren(out, [el('div', { class: 'notice' }, [el('strong', {}, 'Enter an amount to begin. '), 'You get the same money in every instrument, after tax, side by side.'])]); last = null; return; }
    const years = +st.years;
    const { rates: r, sources } = defaultRates(years);
    const ratesById = {}; for (const inst of INSTRUMENTS) if (r[inst.id] != null) ratesById[inst.id] = st.rateOverrides[inst.id] ?? r[inst.id];
    const o = { amount: +st.amount, years, slabRate: +st.slabRate, cess: rates.cess.rate, regime: st.regime, riskProfile: st.riskProfile, has80CRoom: st.regime === 'old' && !!st.has80CRoom, ltcgExemptionAvailable: !!st.ltcgExemptionAvailable, ltcgExemption: rates.special_rate_income.capital_gains.ltcg_listed_equity_stt.annual_exemption };
    const rows = compareAll(o, ratesById);
    const avail = rows.filter((x) => x.available && x.inProfile);
    const best = avail[0];
    const outside = rows.filter((x) => x.available && !x.inProfile);
    const profileLabel = (RISK_PROFILES.find((r) => r.id === st.riskProfile) || RISK_PROFILES[2]).label.split(':')[0].toLowerCase();
    const horizonLabel = HORIZONS.find(([y]) => y === years)[1];
    const parking = years <= 1;
    const fd = rows.find((x) => x.inst.id === 'fd');
    const ppf = rows.find((x) => x.inst.id === 'ppf');
    const showSaved = o.regime === 'old' && o.has80CRoom;
    last = { st: { ...st }, o, rows, sources, ratesById };
    const t = +st.slabRate * (1 + rates.cess.rate);

    const answers = [];
    if (ppf && fd) answers.push(`PPF at ${ratesById.ppf}% tax-free is worth ${pct(ppf.preTaxEquivalent, 1)} before tax to you at this slab; a fixed deposit at ${ratesById.fd}% keeps ${pct(fd.effPost, 1)} a year. ${ppf.available ? `Over ${HORIZONS.find(([y]) => y === years)[1]} PPF ends ${inr(ppf.post - fd.post)} ahead on ${inr(o.amount)}.` : 'PPF is locked for 15 years, so it is not an answer for this horizon.'}`);
    const liq = rows.find((x) => x.inst.id === 'liquid'), arb = rows.find((x) => x.inst.id === 'arbitrage');
    if (liq && arb && years <= 2) answers.push(`Parking money: an arbitrage fund keeps ${inr(arb.post)} against ${inr(liq.post)} in a liquid fund and ${inr(fd.post)} in a deposit, because it is taxed as equity (${years <= 1 ? '20% on the gain' : '12.5% above the yearly exemption'}) instead of at your ${pct(t, 1)} slab. It is not guaranteed, but its return comes from hedged spreads, not the market’s direction.`);
    const debt = rows.find((x) => x.inst.id === 'debt');
    if (debt && fd && years >= 1) { const sameRate = postTax(debt.inst, { ...o, ratePct: ratesById.fd }); answers.push(`A debt fund earning the same ${ratesById.fd}% as the deposit would still keep ${inr(sameRate.post - fd.post)} more over the period, because its tax is paid once on redemption instead of every year.`); }
    if (showSaved) answers.push(`Because you are in the old regime with 80C room, ${inr(o.amount)} into PPF, ELSS or NSC also takes ${inr(Math.min(o.amount, 150000) * t)} off this year’s tax bill; that is counted in the last column.`);

    setChildren(out, [
      el('div', { class: 'stats' }, [
        el('div', { class: 'stat hi' }, [el('div', { class: 'k' }, 'Keeps the most'), el('div', { class: 'v' }, best ? best.inst.label : '—')]),
        el('div', { class: 'stat' }, [el('div', { class: 'k' }, 'You keep'), el('div', { class: 'v' }, best ? inr(best.post) : '—')]),
        el('div', { class: 'stat' }, [el('div', { class: 'k' }, 'After tax, per year'), el('div', { class: 'v' }, best ? pct(best.effPost, 1) : '—')]),
        el('div', { class: 'stat' }, [el('div', { class: 'k' }, 'Your slab incl. cess'), el('div', { class: 'v' }, pct(t, 1))]),
      ]),
      el('h3', {}, parking ? `Parking ${inr(o.amount)} for ${horizonLabel}` : `${inr(o.amount)} for ${horizonLabel}, ${profileLabel} risk`),
      el('p', { class: 'explain' }, best ? `At a ${pct(t, 1)} slab and a ${profileLabel} risk profile, ${best.inst.label.toLowerCase()} keeps the most: ${inr(best.post)}, ${best.how}. ${avail[1] ? `Next is ${avail[1].inst.label.toLowerCase()} at ${inr(avail[1].post)}.` : ''} The order changes with the horizon and the slab; the "pre-tax equivalent" column is what a fully taxed deposit would have to pay to match each one.${best.inst.category && categories ? (() => { const c = categories.find((x) => x.category === best.inst.category); return c && c.low < best.ratePct - 2 ? ` ${best.inst.label} is a historical median, not a promise: the same category’s worst ${years >= 5 ? '5' : '3'}-year window returned ${c.low.toFixed(1)}% a year${c.low < 0 ? ', a loss' : ''}.` : ''; })() : ''}` : 'Nothing is available for this horizon.'),
      el('div', { class: 'table-wrap' }, el('table', { class: 'compare' }, [
        el('thead', {}, el('tr', {}, [el('th', {}, 'Instrument'), el('th', {}, 'Return assumed'), el('th', {}, 'Taxed how'), el('th', {}, 'You keep'), el('th', {}, 'After tax p.a.'), el('th', {}, 'Pre-tax equivalent'), showSaved ? el('th', {}, 'Tax saved now') : null, showSaved ? el('th', {}, 'All-in p.a.') : null])),
        el('tbody', {}, rows.flatMap((x, i) => [x.available && !x.inProfile && (i === 0 || rows[i - 1].inProfile || !rows[i - 1].available) ? el('tr', { class: 'group' }, [el('td', { colspan: showSaved ? 8 : 6 }, `Outside a ${profileLabel} profile (${outside.length}): riskier than you said you would take`)]) : null, !x.available && (i === 0 || rows[i - 1].available) ? el('tr', { class: 'group' }, [el('td', { colspan: showSaved ? 8 : 6 }, 'Not for this horizon')]) : null, el('tr', { class: !x.available ? 'muted' : !x.inProfile ? 'outside' : i === 0 ? 'better' : '' }, [
          el('td', {}, [x.inst.label, el('div', { class: 'muted small' }, x.available ? `lock-in: ${x.inst.lock}` : x.reason), x.inst.note && x.available ? el('div', { class: 'muted small' }, x.inst.note) : null]),
          el('td', {}, [`${x.ratePct}%`, st.rateOverrides[x.inst.id] != null ? el('span', { class: 'conf-flag', title: 'your figure' }, 'yours') : x.inst.category && x.inst.category !== 'nps_mix' ? el('span', { class: 'conf-flag', title: sources[x.inst.id] || '' }, 'history') : null]),
          el('td', { class: 'small' }, x.available ? x.how : '—'),
          el('td', {}, x.available ? inr(x.post) : '—'),
          el('td', {}, x.available ? pct(x.effPost, 1) : '—'),
          el('td', {}, x.available ? pct(x.preTaxEquivalent, 1) : '—'),
          showSaved ? el('td', {}, x.available && x.taxSavedNow ? inr(x.taxSavedNow) : '—') : null,
          showSaved ? el('td', {}, x.available ? pct(x.effAllIn, 1) : '—') : null,
        ])].filter(Boolean))),
      ])),
      answers.length ? el('div', { class: 'card next-steps' }, [el('h3', { style: 'margin-top:0' }, 'The questions people ask'), el('ul', { class: 'levers' }, answers.map((a) => el('li', {}, a)))]) : null,
      el('p', { class: 'muted small' }, 'Guaranteed instruments pay what is notified; small-savings rates change quarterly. Fund figures are the median of what each category returned over rolling windows near your horizon, from AMFI NAV history; the actual return will differ, and the equity ones can be negative over short periods. Equity tax assumes the yearly exemption is available once; a long holding realised in one go gets the exemption only in that year. NPS assumes 60% taken tax-free and 40% annuitised with the annuity taxed at your slab. EPF interest above ₹2.5 lakh of own contributions a year is taxable and not modelled.'),
      disclaimer('invest'),
    ]);
  }

  paint();
  return el('div', { class: 'calc' }, [inputs, el('div', {}, [out, exportCard])]);
}
