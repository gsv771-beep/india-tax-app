/**
 * The NPS page: what it is, a corpus and pension projector, tax treatment, choices, exit rules, returns.
 * Data: nps section of data/schemes.json.
 */
import { inr, pct, el, setChildren, disclaimer, animateNumber } from './util.js';
import { sipFV } from './calculators.js';
import { lineChart } from './charts.js';

/**
 * Project an NPS corpus at retirement and what it turns into.
 * p: { age, retireAge, monthly, employerMonthly, stepUpPct, returnPct, annuityPct (share of corpus used to buy the pension), annuityRatePct }
 */
export function npsProjection(p) {
  const years = Math.max(0, Math.round((+p.retireAge || 60) - (+p.age || 0)));
  const monthly = (+p.monthly || 0) + (+p.employerMonthly || 0);
  const g = sipFV(monthly, +p.returnPct || 0, years, +p.stepUpPct || 0);
  const annuityShare = Math.min(1, Math.max(0.2, (+p.annuityPct || 40) / 100));
  const corpus = g.fv;
  const annuityCorpus = corpus * annuityShare;
  const lump = corpus - annuityCorpus;
  const lumpTaxFree = Math.min(lump, 0.6 * corpus);
  const lumpTaxable = lump - lumpTaxFree;
  const pension = (annuityCorpus * ((+p.annuityRatePct || 0) / 100)) / 12;
  return { years, monthly, corpus, invested: g.invested, gain: g.gain, annuityShare, annuityCorpus, lump, lumpTaxFree, lumpTaxable, pension };
}

const STORE = 'taxcompass.nps.v1';

export function initNps({ schemes }) {
  const nps = schemes.nps;
  const body = document.getElementById('nps-body');
  setChildren(body, [
    overview(nps),
    projector(nps),
    taxSection(nps),
    choicesSection(nps),
    exitSection(nps),
    returnsSection(nps),
    disclaimer(['invest', 'tax']),
  ]);
}

function overview(nps) {
  return el('div', { class: 'card' }, [
    el('h2', { style: 'margin-top:0' }, 'What NPS is, in one minute'),
    el('p', {}, 'The National Pension System is a market-linked retirement account regulated by PFRDA. You put money in during your working life, it is invested in equity, corporate bonds and government securities in a mix you choose or an age-based auto mix, and at retirement part of it must buy an annuity that pays you a monthly pension for life.'),
    el('div', { class: 'facts' }, [
      el('span', {}, 'Open to Indian citizens, NRIs and OCIs aged 18 to 70'),
      el('span', {}, `Tier I minimum ₹${nps.tiers.tier_1.min_per_year.toLocaleString('en-IN')} a year`),
      el('span', {}, 'The only big deduction that survives in the new regime: employer contribution'),
      el('span', {}, 'Lump sum tax-free up to 60% of the corpus'),
    ]),
    el('dl', { class: 'kv', style: 'margin-top:12px' }, [
      el('dt', {}, 'Tier I'), el('dd', {}, `${nps.tiers.tier_1.nature}. Lock-in: ${nps.tiers.tier_1.lock_in}.`),
      el('dt', {}, 'Tier II'), el('dd', {}, 'Optional, fully liquid add-on account that needs an active Tier I. No tax benefit for most subscribers; think of it as a low-cost mutual fund.'),
      el('dt', {}, 'Costs'), el('dd', {}, 'Among the lowest of any retirement product: fund management charges are a small fraction of a percent, which compounds in your favour over decades.'),
      el('dt', {}, 'The catch'), el('dd', {}, 'Money is locked until 60 (or 15 years for late joiners), at least 20% must buy an annuity whose income is fully taxable, and returns are not guaranteed.'),
    ]),
    el('div', { class: 'notice warn' }, [el('strong', {}, 'Lump sum at exit: '), nps.CRITICAL_MISMATCH.issue]),
  ]);
}

function projector(nps) {
  let saved = {}; try { saved = JSON.parse(localStorage.getItem(STORE) || '{}'); } catch {}
  const st = { age: 30, retireAge: 60, monthly: 5000, employerMonthly: 0, stepUpPct: 5, returnPct: 10, annuityPct: 40, annuityRatePct: 6, ...saved };
  const save = () => { try { localStorage.setItem(STORE, JSON.stringify(st)); } catch {} };
  const f = (key, label, attrs, hint) => {
    const input = el('input', { type: 'number', ...attrs, value: st[key] });
    input.addEventListener('input', () => { st[key] = input.value; save(); render(); });
    return el('label', {}, [label, hint ? el('small', {}, hint) : null, input]);
  };
  const out = el('div');
  const inputs = el('div', { class: 'card inputs' }, [
    el('div', { class: 'two' }, [f('age', 'Your age', { min: 18, max: 70, step: 1 }), f('retireAge', 'Retire at', { min: 40, max: 75, step: 1 }, 'normal exit is 60')]),
    f('monthly', 'Your monthly contribution (₹)', { min: 0, step: 500 }),
    f('employerMonthly', 'Employer monthly contribution (₹)', { min: 0, step: 500 }, 'deductible in both regimes up to 14% of Basic + DA'),
    f('stepUpPct', 'Increase contributions every year (%)', { min: 0, max: 30, step: 1 }),
    f('returnPct', 'Expected return (% p.a.)', { min: 0, max: 20, step: 0.5 }, 'NPS equity has returned about 13% and debt about 7% over ten years; a 50:50 mix sits near 10%'),
    el('div', { class: 'two' }, [f('annuityPct', 'Share used to buy the pension (%)', { min: 20, max: 100, step: 5 }, 'at least 20% (40% for corporate subscribers)'), f('annuityRatePct', 'Annuity rate (% p.a.)', { min: 0, max: 12, step: 0.25 }, 'what insurers pay on a lifetime annuity, roughly 6 to 7%')]),
  ]);
  function render() {
    const r = npsProjection(st);
    const stat = (k, v, cls = '') => { const val = el('div', { class: 'v' }); animateNumber(val, 'nps:' + k, v); return el('div', { class: 'stat ' + cls }, [el('div', { class: 'k' }, k), val]); };
    const ages = Array.from({ length: r.years + 1 }, (_, k) => k);
    const growth = ages.map((k) => sipFV(r.monthly, +st.returnPct || 0, k, +st.stepUpPct || 0));
    setChildren(out, [
      el('div', { class: 'stats' }, [
        stat('Corpus at ' + st.retireAge, inr(r.corpus), 'hi'),
        stat('You will have put in', inr(r.invested)),
        stat('Lump sum in hand', inr(r.lump)),
        stat('Monthly pension', inr(r.pension)),
      ]),
      r.years > 0 ? el('div', { class: 'card', style: 'padding:12px 14px;margin-bottom:12px' }, [
        el('div', { class: 'viz-title' }, 'Corpus by age'),
        lineChart({ series: [{ name: 'Contributed', color: '#8a948e', dash: true, points: ages.map((k, i) => [+st.age + k, growth[i].invested]) }, { name: 'Corpus', color: '#1d6b3d', area: true, points: ages.map((k, i) => [+st.age + k, growth[i].fv]) }], xFormat: (x) => `Age ${Math.round(x)}`, xTipFormat: (x) => `At age ${Math.round(x)}`, height: 230, ariaLabel: 'NPS corpus by age' }),
      ]) : null,
      el('p', { class: 'explain' }, `Contributing ${inr(r.monthly)} a month for ${r.years} years, rising ${st.stepUpPct}% a year and earning ${st.returnPct}%, builds about ${inr(r.corpus)}. Using ${pct(r.annuityShare, 0)} of it to buy an annuity at ${st.annuityRatePct}% gives roughly ${inr(r.pension)} a month for life, and you take ${inr(r.lump)} as a lump sum${r.lumpTaxable > 0 ? `, of which ${inr(r.lumpTaxable)} is taxable at your slab because only 60% of the corpus is exempt` : ', all of it tax-free'}.`),
      el('div', { class: 'table-wrap' }, el('table', { class: 'compare' }, [
        el('thead', {}, el('tr', {}, [el('th', {}, 'At retirement'), el('th', {}, 'Amount'), el('th', {}, 'Tax')])),
        el('tbody', {}, [
          el('tr', {}, [el('td', {}, 'Total corpus'), el('td', {}, inr(r.corpus)), el('td', {}, '')]),
          el('tr', {}, [el('td', {}, 'Lump sum, tax-free part (up to 60% of corpus)'), el('td', {}, inr(r.lumpTaxFree)), el('td', {}, 'Exempt')]),
          r.lumpTaxable > 0 ? el('tr', {}, [el('td', {}, 'Lump sum above 60% of corpus'), el('td', {}, inr(r.lumpTaxable)), el('td', {}, 'Taxable at slab')]) : null,
          el('tr', {}, [el('td', {}, `Used to buy the annuity (${pct(r.annuityShare, 0)})`), el('td', {}, inr(r.annuityCorpus)), el('td', {}, 'Exempt at purchase')]),
          el('tr', { class: 'total' }, [el('td', {}, 'Monthly pension from the annuity'), el('td', {}, inr(r.pension)), el('td', {}, 'Taxable as income')]),
        ]),
      ])),
      el('p', { class: 'muted small' }, 'Returns are assumed constant and are illustrative only; NPS is market-linked. Annuity rates depend on the insurer, the option chosen (with or without return of purchase price, joint life) and interest rates at the time. The pension is not inflation-linked unless you buy an increasing annuity, which starts lower.'),
    ]);
  }
  render();
  return el('div', {}, [el('h2', {}, 'What could your NPS grow into?'), el('div', { class: 'calc' }, [inputs, out])]);
}

function taxSection(nps) {
  const tax = nps.tax_treatment;
  const yesNo = (v) => (v === undefined ? '' : v ? 'Yes' : 'No');
  const rows = Object.entries(tax).filter(([k, v]) => !k.startsWith('_') && typeof v === 'object').map(([k, v]) => {
    const limit = v.limit || (v.limit_old_regime ? `Old: ${v.limit_old_regime}; New: ${v.limit_new_regime}` : '') || v.exempt_share || v.exempt || (v.cap ? `₹${v.cap.toLocaleString('en-IN')} ${v.scope}` : '') || v.purchase || '';
    const both = v.applies_both_regimes;
    return el('tr', {}, [el('td', {}, k.replace(/_/g, ' ')), el('td', { class: 'left' }, limit), el('td', {}, both !== undefined ? yesNo(both) : yesNo(v.old_regime)), el('td', {}, both !== undefined ? yesNo(both) : yesNo(v.new_regime))]);
  });
  return el('div', {}, [
    el('h2', {}, 'Tax treatment, old regime versus new'),
    el('div', { class: 'card' }, [
      el('p', {}, 'Three separate benefits, often confused. Your own contribution counts within the ₹1.5 lakh 80C limit and gets an extra ₹50,000 under 80CCD(1B), both old regime only. Your employer\'s contribution is deductible in both regimes, up to 14% of Basic + DA in the new regime, and this is the single most valuable deduction left in the new regime for a private-sector employee.'),
      el('div', { class: 'table-wrap' }, el('table', { class: 'compare schemes-table' }, [el('thead', {}, el('tr', {}, [el('th', {}, 'Item'), el('th', { class: 'left' }, 'Limit'), el('th', {}, 'Old regime'), el('th', {}, 'New regime')])), el('tbody', {}, rows)])),
      el('p', { class: 'muted small' }, tax.anti_double_deduction),
      el('p', {}, [el('a', { href: '/tax' }, 'See what employer NPS would save you'), ' in the tax comparison, under "Where the room is".']),
    ]),
  ]);
}

function choicesSection(nps) {
  return el('details', { class: 'section' }, [
    el('summary', {}, 'Investment choices: active, auto, and the four asset classes'),
    el('div', { class: 'table-wrap' }, el('table', { class: 'compare' }, [
      el('thead', {}, el('tr', {}, [el('th', {}, 'Asset class'), el('th', {}, 'Active choice cap'), el('th', {}, 'Auto choice cap')])),
      el('tbody', {}, Object.entries(nps.asset_classes).map(([k, v]) => el('tr', {}, [el('td', {}, `${k}: ${v.name}`), el('td', {}, v.cap_active_choice), el('td', {}, v.cap_auto_choice)]))),
    ])),
    el('h3', {}, 'Auto choice life-cycle funds'),
    el('div', { class: 'table-wrap' }, el('table', { class: 'compare' }, [
      el('thead', {}, el('tr', {}, [el('th', {}, 'Fund'), el('th', {}, 'Equity when young'), el('th', {}, 'Taper starts'), el('th', {}, 'Equity at 55')])),
      el('tbody', {}, nps.auto_choice_lifecycle_funds.map((f) => el('tr', {}, [el('td', {}, `${f.code} ${f.name}${f.is_default ? ' (default)' : ''}`), el('td', {}, f.equity_upto_age_35 || f.equity_upto_age_45), el('td', {}, f.taper_starts), el('td', {}, f.equity_at_55)]))),
    ])),
    el('p', { class: 'muted small' }, `Pension fund managers to choose from: ${nps.pension_fund_managers_count}. You can change fund manager and asset mix a few times a year at no cost.`),
  ]);
}

function exitSection(nps) {
  const ex = nps.exit_rules_non_government, pw = nps.partial_withdrawal;
  return el('details', { class: 'section' }, [
    el('summary', {}, 'Exit, partial withdrawal and what happens on death'),
    el('dl', { class: 'kv' }, [
      el('dt', {}, 'Normal exit'), el('dd', {}, `${ex.normal_exit_definition} Split: ${ex.normal_exit_split}.`),
      el('dt', {}, 'Premature exit'), el('dd', {}, `${ex.premature_exit_split}. Minimum lock-in: ${ex.minimum_lock_in_for_premature_exit}.`),
      el('dt', {}, 'Small corpus'), el('dd', {}, `Up to ₹${ex.nps_lite_small_corpus_threshold.toLocaleString('en-IN')} can be withdrawn in full without buying an annuity.`),
      el('dt', {}, 'Partial withdrawal'), el('dd', {}, `After ${pw.min_membership_years} years, up to ${pw.max_amount}. ${pw.frequency_before_60}; ${pw.frequency_after_60}.`),
      el('dt', {}, 'Allowed for'), el('dd', {}, pw.permitted_reasons.join('; ') + '.'),
      el('dt', {}, 'On death'), el('dd', {}, ex.on_death),
      el('dt', {}, 'Stay invested'), el('dd', {}, `You may defer exit and keep contributing until age ${ex.max_continuation_age}.`),
    ]),
  ]);
}

function returnsSection(nps) {
  const h = nps.historical_returns_by_asset_class;
  return el('details', { class: 'section' }, [
    el('summary', {}, 'Historical returns by asset class'),
    el('div', { class: 'table-wrap' }, el('table', { class: 'compare' }, [
      el('thead', {}, el('tr', {}, [el('th', {}, 'Class'), el('th', {}, '1 yr'), el('th', {}, '3 yr'), el('th', {}, '5 yr'), el('th', {}, '10 yr')])),
      el('tbody', {}, Object.entries(h).filter(([k]) => !k.startsWith('_')).map(([k, v]) => el('tr', {}, [el('td', {}, k.replace(/_/g, ' ')), el('td', {}, v['1yr'] + '%'), el('td', {}, v['3yr'] + '%'), el('td', {}, v['5yr'] + '%'), el('td', {}, v['10yr'] + '%')]))),
    ])),
    el('p', { class: 'muted small' }, h._caveat),
  ]);
}
