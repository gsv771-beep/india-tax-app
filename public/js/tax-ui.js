import { compareRegimes, DEFAULT_FLAGS } from './tax-engine.js';
import { inr, pct, el, setPath, debounce, setChildren, animateNumber } from './util.js';
import { breakEven, headroom, whatIf, breakEvenCurve, waterfallSteps } from './tax-insights.js';
import { buildTaxWorkbookBase64, taxFileName } from './tax-export.js';
import { emailWorkbookCard } from './email-card.js';
import { lineChart, waterfallChart, shortINR } from './charts.js';
import { shareCard } from './share-card.js';
import { termify } from './tooltips.js';
import { countEvent } from './feedback.js';

const OLD_COLOR = '#b7861c', NEW_COLOR = '#1d6b3d';
const FY_SHORT = { 'FY2026-27': 'FY 2026-27', 'FY2025-26': 'FY 2025-26' };

const STORAGE_KEY = 'taxcompass.inputs.v1';
let lastInputs = null;
const extras = { s80c: 0, nps1b: 0, health: 0 }; // what-if slider state, survives re-renders

export function initTax({ rates, onboarding }) {
  const form = document.getElementById('tax-form');
  const flags = { ...DEFAULT_FLAGS };

  restore(form);
  document.getElementById('tax-email').replaceChildren(emailWorkbookCard({
    title: 'Email me this comparison',
    intro: 'A formatted Excel workbook with the line-by-line comparison, the break-even analysis, and every figure you entered, so you can go through it with your CA.',
    source: 'tax',
    fileName: taxFileName,
    buildBase64: async (who) => buildTaxWorkbookBase64(lastInputs, compareRegimes(lastInputs, rates, flags), rates, flags, who),
  }));
  const run = debounce(() => render(readForm(form), rates, flags), 120);
  form.addEventListener('input', run);
  form.addEventListener('change', run);
  document.getElementById('tax-reset').addEventListener('click', () => {
    form.reset();
    try { localStorage.removeItem(STORAGE_KEY); } catch {}
    run();
  });

  renderProvisionTable(onboarding);
  render(readForm(form), rates, flags);
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
  if (result.new.tax.totalIncome > 0 || result.old.tax.totalIncome > 0) countEvent('compare');
  renderHeadline(result);
  renderWarnings(result);
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
  const wo = waterfallSteps(cmp.old), wn = waterfallSteps(cmp.new);
  const max = Math.max(wo.gross, wn.gross, 1);
  parts.push(el('div', { class: 'card chart-card' }, [
    el('h3', { style: 'margin-top:0' }, 'From gross income to tax, in each regime'),
    el('p', { class: 'muted small' }, 'Same starting income; the two regimes remove different amounts on the way to taxable income.'),
    el('div', { class: 'two-charts' }, [
      waterfallChart({ title: 'Old regime', steps: wo.steps, max, color: OLD_COLOR }),
      waterfallChart({ title: 'New regime', steps: wn.steps, max, color: NEW_COLOR }),
    ]),
  ]));
  setChildren(box, parts);
}

const fmt = (n) => inr(n);

function renderInsights(inputs, cmp, rates, flags) {
  const box = document.getElementById('tax-insights');
  if (cmp.old.tax.totalIncome === 0 && cmp.new.tax.totalIncome === 0) { box.replaceChildren(); return; }
  const be = breakEven(inputs, rates, flags);
  const hr = headroom(inputs, rates, flags);

  const sentence = {
    need: `The old regime would win only if you had about ${fmt(be.extra)} more in deductions or exemptions than you do now.`,
    impossible: 'On these figures no amount of old-regime deductions would beat the new regime.',
    cushion: `The old regime stays ahead until about ${fmt(be.cushion)} of the ${fmt(be.claimed)} you currently claim is lost.`,
    always: 'The old regime would stay lower even without any of its deductions.',
  }[be.kind];

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
      el('h3', { style: 'margin-top:0' }, 'How far is this from flipping?'),
      el('p', {}, sentence),
      sliders.length ? el('div', {}, [
        el('h4', {}, 'What if you used the room you have left?'),
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

function renderHeadline(r) {
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
  box.append(card('old', 'Old regime'), card('new', 'New regime (default)'));
  const empty = r.old.tax.totalIncome === 0 && r.new.tax.totalIncome === 0;
  let verdict;
  if (empty) {
    verdict = el('div', { class: 'verdict same' }, 'Enter your income on the left to see both regimes computed side by side.');
  } else if (r.better === 'same') {
    verdict = el('div', { class: 'verdict same' }, 'Both regimes give the same tax. The new regime is the default and needs no form.');
  } else {
    const saving = el('span');
    animateNumber(saving, 'tax:saving', inr(r.saving));
    verdict = el('div', { class: 'verdict' }, [`The ${r.better} regime saves you `, saving, ' this year.']);
  }
  box.append(verdict);
  if (!empty) {
    box.append(el('div', { class: 'headline-foot' }, [
      el('span', { class: 'trust' }, 'Checked against the 10 statutory worked examples and 190+ automated tests. Rates as compiled 13 Sep 2026.'),
      shareCard(r, FY_SHORT[lastInputs?.fy] || 'FY 2026-27'),
    ]));
  }
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
