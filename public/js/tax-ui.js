import { compareRegimes, DEFAULT_FLAGS } from './tax-engine.js';
import { inr, pct, el, setPath, debounce, setChildren, animateNumber } from './util.js';
import { breakEven, headroom, whatIf, breakEvenCurve, waterfallSteps } from './tax-insights.js';
import { buildTaxWorkbookBase64, taxFileName } from './tax-export.js';
import { emailWorkbookCard } from './email-card.js';
import { lineChart, waterfallChart, shortINR } from './charts.js';
import { shareCard } from './share-card.js';
import { termify } from './tooltips.js';

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
  renderHeadline(result);
  renderWarnings(result);
  renderInsights(inputs, result, rates, flags);
  renderCharts(inputs, result, rates, flags);
  renderTable(result);
  renderNotes(result);
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
