import { compareRegimes, DEFAULT_FLAGS } from './tax-engine.js';
import { inr, pct, el, setPath, debounce } from './util.js';

const STORAGE_KEY = 'taxcompass.inputs.v1';

export function initTax({ rates, onboarding }) {
  const form = document.getElementById('tax-form');
  const flags = { ...DEFAULT_FLAGS };

  restore(form);
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
  const result = compareRegimes(inputs, rates, flags);
  renderHeadline(result);
  renderWarnings(result);
  renderTable(result);
  renderNotes(result);
}

function renderHeadline(r) {
  const box = document.getElementById('tax-headline');
  box.replaceChildren();
  const card = (key, label) => {
    const t = r[key].tax;
    return el('div', { class: `regime-card ${key}` }, [
      r.better === key ? el('span', { class: 'winner' }, 'Lower tax') : null,
      el('div', { class: 'label' }, label),
      el('div', { class: 'amount' }, inr(t.total)),
      el('div', { class: 'eff' }, `Total income ${inr(t.totalIncome)} · effective rate ${pct(t.effectiveRate)}`),
    ]);
  };
  box.append(card('old', 'Old regime'), card('new', 'New regime (default)'));
  let verdict;
  if (r.old.tax.totalIncome === 0 && r.new.tax.totalIncome === 0) {
    verdict = el('div', { class: 'verdict same' }, 'Enter your income on the left to see both regimes computed side by side.');
  } else if (r.better === 'same') {
    verdict = el('div', { class: 'verdict same' }, 'Both regimes give the same tax. The new regime is the default and needs no form.');
  } else {
    verdict = el('div', { class: 'verdict' }, `The ${r.better} regime saves you ${inr(r.saving)} this year.`);
  }
  box.append(verdict);
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
    rows.push(el('tr', { class: cls }, [el('td', {}, label), tdO, tdN]));
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
