/**
 * Expenses and savings calculator: monthly income, categorised expenses, SIP and recurring
 * deposit investments, a summary with charts, and an Excel export (download or email).
 *
 * Pure functions at the top (tested in tests/budget.test.mjs); DOM code below.
 */
import { inr, pct, el, setChildren, disclaimer, isBlankAfterReset, clearBlankAfterReset } from './util.js';
import { sipFV } from './calculators.js';
import { loadExcelJS, X, headerRow, dataRow, sheetTitle, toBase64, safeFileName } from './xlsx-style.js';
import { emailWorkbookCard } from './email-card.js';
import { setHandoff, takeHandoff, handoffNote } from './handoff.js';
import { getProfile, updateProfile } from './profile-store.js';
import { toSalaryStore, isEmptyProfile } from '../engine/profile.js';
import { salaryBreakdown } from './salary.js';

export const CATEGORIES = [
  'Rent / housing', 'Groceries & food', 'Education', 'Medical & health', 'Electricity & utilities',
  'Internet & phone', 'Subscriptions', 'Petrol & transport', 'Loan EMIs', 'Insurance', 'Others',
];
const STORAGE_KEY = 'taxcompass.budget.v1';

/** Recurring deposit maturity: monthly deposits, quarterly compounding (the Indian bank / post office convention). */
export function rdFV(monthly, ratePct, years) {
  const n = Math.round(years * 4);
  const i = ratePct / 400;
  if (n <= 0 || monthly <= 0) return { fv: 0, invested: 0, gain: 0 };
  const invested = monthly * years * 12;
  if (i === 0) return { fv: invested, invested, gain: 0 };
  const fv = (monthly * (Math.pow(1 + i, n) - 1)) / (1 - Math.pow(1 + i, -1 / 3));
  return { fv, invested, gain: fv - invested };
}

export function projectInvestment(inv) {
  const amt = +inv.amount || 0, rate = +inv.ratePct || 0, years = +inv.years || 0;
  return inv.type === 'rd' ? rdFV(amt, rate, years) : sipFV(amt, rate, years, 0);
}

export function summarise(state) {
  const income = +state.income || 0;
  const expenses = (state.expenses || []).filter((e) => +e.amount > 0);
  const investments = (state.investments || []).filter((e) => +e.amount > 0);
  const totalExpenses = expenses.reduce((s, e) => s + +e.amount, 0);
  const totalInvestments = investments.reduce((s, e) => s + +e.amount, 0);
  const surplus = income - totalExpenses - totalInvestments;
  const byCategory = {};
  for (const e of expenses) {
    const c = CATEGORIES.includes(e.category) ? e.category : 'Others';
    byCategory[c] = (byCategory[c] || 0) + +e.amount;
  }
  const categories = Object.entries(byCategory).map(([category, amount]) => ({ category, amount, share: income > 0 ? amount / income : 0 })).sort((a, b) => b.amount - a.amount);
  return {
    income, totalExpenses, totalInvestments, surplus,
    savings: totalInvestments + Math.max(0, surplus),
    savingsRate: income > 0 ? (totalInvestments + Math.max(0, surplus)) / income : 0,
    categories,
    investments: investments.map((inv) => ({ ...inv, ...projectInvestment(inv) })),
    deficit: surplus < 0,
  };
}

export function defaultState() {
  return {
    income: 0,
    expenses: ['Rent / housing', 'Groceries & food', 'Electricity & utilities', 'Internet & phone', 'Petrol & transport'].map((c) => ({ id: uid(), category: c, note: '', amount: '' })),
    investments: [{ id: uid(), type: 'sip', name: 'Mutual fund SIP', amount: '', ratePct: 12, years: 10 }],
    person: { name: '', email: '' },
  };
}
const uid = () => Math.random().toString(36).slice(2, 9);

// ---------- charts (inline SVG, single-hue for magnitude, three fixed hues for the allocation) ----------

const C = { expenses: '#2a78d6', investments: '#eb6834', surplus: '#1baf7a', ink: 'var(--text)', muted: 'var(--muted)', grid: 'var(--line)', surface: 'var(--surface)', critical: '#d03b3b', track: 'var(--surface-2)' };
const svgEl = (tag, attrs = {}, children = []) => {
  const n = document.createElementNS('http://www.w3.org/2000/svg', tag);
  for (const [k, v] of Object.entries(attrs)) n.setAttribute(k, v);
  for (const c of [].concat(children)) if (c != null) n.append(typeof c === 'string' ? document.createTextNode(c) : c);
  return n;
};

/** Horizontal stacked bar: how income splits into expenses, investments and what is left. */
export function allocationChart(s) {
  const W = 640, H = 92, pad = 4, barY = 30, barH = 26;
  const total = Math.max(s.income, s.totalExpenses + s.totalInvestments) || 1;
  const segs = [
    { key: 'expenses', label: 'Expenses', value: s.totalExpenses, color: C.expenses },
    { key: 'investments', label: 'Investments', value: s.totalInvestments, color: C.investments },
    { key: 'surplus', label: 'Left over', value: Math.max(0, s.surplus), color: C.surplus },
  ].filter((x) => x.value > 0);
  const svg = svgEl('svg', { viewBox: `0 0 ${W} ${H}`, width: '100%', role: 'img', 'aria-label': 'How monthly income is allocated' });
  svg.append(svgEl('title', {}, 'How monthly income is allocated'));
  svg.append(svgEl('rect', { x: pad, y: barY, width: W - 2 * pad, height: barH, rx: 4, style: `fill:${C.track}` }));
  let x = pad;
  segs.forEach((seg, i) => {
    const w = Math.max(0, ((W - 2 * pad) * seg.value) / total - (i < segs.length - 1 ? 2 : 0));
    const g = svgEl('g');
    g.append(svgEl('title', {}, `${seg.label}: ${inr(seg.value)} (${pct(seg.value / (s.income || total), 0)} of income)`));
    g.append(svgEl('rect', { x, y: barY, width: w, height: barH, rx: 4, fill: seg.color }));
    svg.append(g);
    x += w + 2;
  });
  if (s.deficit && s.income > 0) {
    const ix = pad + ((W - 2 * pad) * s.income) / total;
    svg.append(svgEl('line', { x1: ix, x2: ix, y1: barY - 8, y2: barY + barH + 8, stroke: C.critical, 'stroke-width': 2 }));
    svg.append(svgEl('text', { x: Math.min(ix, W - 130), y: barY - 12, 'font-size': 12, fill: C.critical, 'font-weight': 600 }, 'Income ends here'));
  }
  // legend row
  let lx = pad;
  for (const seg of segs) {
    svg.append(svgEl('rect', { x: lx, y: barY + barH + 16, width: 10, height: 10, rx: 2, fill: seg.color }));
    const t = svgEl('text', { x: lx + 15, y: barY + barH + 25, 'font-size': 12, style: `fill:${C.ink}` }, `${seg.label} ${inr(seg.value)} (${pct(seg.value / (s.income || total), 0)})`);
    svg.append(t);
    lx += 15 + 6.6 * t.textContent.length + 18;
  }
  return svg;
}

/** Horizontal bars of expense categories, largest first, one hue, direct-labelled. */
export function categoryChart(s) {
  const rows = s.categories;
  const W = 640, rowH = 26, labelW = 170, pad = 4, valueW = 90;
  const H = rows.length * rowH + 8;
  const max = Math.max(...rows.map((r) => r.amount), 1);
  const svg = svgEl('svg', { viewBox: `0 0 ${W} ${H}`, width: '100%', role: 'img', 'aria-label': 'Monthly expenses by category' });
  svg.append(svgEl('title', {}, 'Monthly expenses by category'));
  rows.forEach((r, i) => {
    const y = i * rowH + 4;
    const w = ((W - labelW - valueW - pad) * r.amount) / max;
    const g = svgEl('g');
    g.append(svgEl('title', {}, `${r.category}: ${inr(r.amount)} a month, ${pct(r.share, 1)} of income`));
    g.append(svgEl('text', { x: labelW - 8, y: y + 15, 'text-anchor': 'end', 'font-size': 12, style: `fill:${C.ink}` }, r.category));
    g.append(svgEl('rect', { x: labelW, y: y + 3, width: Math.max(w, 2), height: rowH - 10, rx: 4, fill: C.expenses }));
    g.append(svgEl('text', { x: labelW + Math.max(w, 2) + 8, y: y + 15, 'font-size': 12, style: `fill:${C.muted}` }, `${inr(r.amount)} · ${pct(r.share, 0)}`));
    svg.append(g);
  });
  return svg;
}

// ---------- Excel workbook ----------

export function workbookRows(state, s) {
  const today = new Date().toISOString().slice(0, 10);
  const summary = [
    ['TaxCompass India: monthly budget summary'],
    ['Prepared for', state.person.name || ''],
    ['Date', today],
    [],
    ['Item', 'Monthly (₹)', 'Yearly (₹)', '% of income'],
    ['Income', s.income, s.income * 12, 1],
    ['Expenses', s.totalExpenses, s.totalExpenses * 12, s.income ? s.totalExpenses / s.income : 0],
    ['Investments (SIP + RD)', s.totalInvestments, s.totalInvestments * 12, s.income ? s.totalInvestments / s.income : 0],
    [s.deficit ? 'Shortfall' : 'Left over after expenses and investments', s.surplus, s.surplus * 12, s.income ? s.surplus / s.income : 0],
    ['Savings rate (investments + left over)', '', '', s.savingsRate],
    [],
    ['Expenses by category', 'Monthly (₹)', 'Yearly (₹)', '% of income'],
    ...s.categories.map((c) => [c.category, c.amount, c.amount * 12, c.share]),
  ];
  const expenses = [
    ['Category', 'Note', 'Monthly (₹)', 'Yearly (₹)'],
    ...(state.expenses || []).filter((e) => +e.amount > 0).map((e) => [e.category, e.note || '', +e.amount, +e.amount * 12]),
  ];
  const investments = [
    ['Type', 'Name', 'Monthly (₹)', 'Expected return / rate (% p.a.)', 'Years', 'Total invested (₹)', 'Projected value (₹)', 'Projected gain (₹)'],
    ...s.investments.map((i) => [i.type === 'rd' ? 'Recurring deposit' : 'Mutual fund SIP', i.name || '', +i.amount, +i.ratePct, +i.years, Math.round(i.invested), Math.round(i.fv), Math.round(i.gain)]),
  ];
  const notes = [
    ['Notes'],
    ['SIP projections assume instalments at the start of each month (annuity-due) and a constant annual return. Returns are illustrative, not guaranteed. Mutual fund investments are subject to market risk.'],
    ['Recurring deposit maturity uses monthly deposits with quarterly compounding, the convention used by Indian banks and post offices, before tax on interest.'],
    ['This workbook is for personal budgeting only and is not tax, legal or investment advice. Please consult your tax consultant or chartered accountant before taking any tax decision, and a SEBI-registered investment adviser before investing.'],
    ['Generated by TaxCompass India on ' + today + '.'],
  ];
  return { summary, expenses, investments, notes };
}

/**
 * Build the styled workbook and return it as a base64 string.
 * `charts` = { alloc: <svg>, cat: <svg> } from the page (optional; skipped in Node).
 * `ExcelJSLib` lets tests inject the Node build of ExcelJS.
 */
export async function buildWorkbookBase64(state, s, charts = null, ExcelJSLib = null) {
  const ExcelJS = ExcelJSLib || (await loadExcelJS());
  const wb = new ExcelJS.Workbook();
  wb.creator = 'TaxCompass India';
  wb.created = new Date();
  const today = new Date().toISOString().slice(0, 10);
  const who = state.person.name ? `for ${state.person.name}` : '';

  // ----- Summary -----
  const ws = wb.addWorksheet('Summary', { views: [{ showGridLines: false }] });
  ws.columns = [{ width: 42 }, { width: 16 }, { width: 16 }, { width: 13 }, { width: 3 }, { width: 3 }, { width: 3 }];
  sheetTitle(ws, 'TaxCompass India: monthly budget summary', `Prepared ${who} on ${today}. Amounts in rupees.`);
  headerRow(ws, 4, ['Item', 'Monthly', 'Yearly', '% of income']);
  const pctOf = (v) => (s.income ? v / s.income : 0);
  dataRow(ws, 5, ['Take-home income', s.income, s.income * 12, 1], [null, X.inr, X.inr, X.pct], { bold: true });
  dataRow(ws, 6, ['Expenses', s.totalExpenses, s.totalExpenses * 12, pctOf(s.totalExpenses)], [null, X.inr, X.inr, X.pct], { zebra: true });
  dataRow(ws, 7, ['Investments (SIP and RD)', s.totalInvestments, s.totalInvestments * 12, pctOf(s.totalInvestments)], [null, X.inr, X.inr, X.pct]);
  dataRow(ws, 8, [s.deficit ? 'Shortfall' : 'Left over after expenses and investments', s.surplus, s.surplus * 12, pctOf(s.surplus)], [null, X.inr, X.inr, X.pct], { bold: true, fillArgb: s.deficit ? X.redSoft : X.greenSoft, color: s.deficit ? X.red : X.green });
  dataRow(ws, 9, ['Savings rate (investments + left over)', null, null, s.savingsRate], [null, null, null, X.pct], { bold: true });

  headerRow(ws, 11, ['Expenses by category', 'Monthly', 'Yearly', '% of income']);
  s.categories.forEach((c, i) => dataRow(ws, 12 + i, [c.category, c.amount, c.amount * 12, c.share], [null, X.inr, X.inr, X.pct], { zebra: i % 2 === 1 }));
  const totalRow = 12 + s.categories.length;
  dataRow(ws, totalRow, ['Total expenses', s.totalExpenses, s.totalExpenses * 12, pctOf(s.totalExpenses)], [null, X.inr, X.inr, X.pct], { bold: true, fillArgb: X.greenSoft });

  // charts as images, to the right of the tables
  if (charts && typeof document !== 'undefined') {
    try {
      if (charts.alloc) {
        const png = await svgToPng(charts.alloc, 560);
        const id = wb.addImage({ base64: png.base64, extension: 'png' });
        ws.getCell('H3').value = 'Where your income goes'; ws.getCell('H3').font = { bold: true, color: { argb: X.green } };
        ws.addImage(id, { tl: { col: 7, row: 3 }, ext: { width: png.width, height: png.height } });
      }
      if (charts.cat) {
        const png = await svgToPng(charts.cat, 560);
        const id = wb.addImage({ base64: png.base64, extension: 'png' });
        ws.getCell('H10').value = 'Expenses by category'; ws.getCell('H10').font = { bold: true, color: { argb: X.green } };
        ws.addImage(id, { tl: { col: 7, row: 10 }, ext: { width: png.width, height: png.height } });
      }
    } catch { /* charts are a nice-to-have; the tables are the record */ }
  }

  // ----- Expenses -----
  const we = wb.addWorksheet('Expenses', { views: [{ state: 'frozen', ySplit: 1 }] });
  we.columns = [{ width: 28 }, { width: 34 }, { width: 16 }, { width: 16 }];
  headerRow(we, 1, ['Category', 'Note', 'Monthly', 'Yearly']);
  const exp = (state.expenses || []).filter((e) => +e.amount > 0);
  exp.forEach((e, i) => dataRow(we, 2 + i, [e.category, e.note || '', +e.amount, +e.amount * 12], [null, null, X.inr, X.inr], { zebra: i % 2 === 1 }));
  dataRow(we, 2 + exp.length, ['Total', '', s.totalExpenses, s.totalExpenses * 12], [null, null, X.inr, X.inr], { bold: true, fillArgb: X.greenSoft });
  if (exp.length) we.autoFilter = { from: 'A1', to: `D${1 + exp.length}` };

  // ----- Investments -----
  const wi = wb.addWorksheet('Investments', { views: [{ state: 'frozen', ySplit: 1 }] });
  wi.columns = [{ width: 20 }, { width: 30 }, { width: 14 }, { width: 22 }, { width: 8 }, { width: 18 }, { width: 18 }, { width: 18 }];
  headerRow(wi, 1, ['Type', 'Name', 'Monthly', 'Expected return / rate (% p.a.)', 'Years', 'Total invested', 'Projected value', 'Projected gain']);
  s.investments.forEach((inv, i) => dataRow(wi, 2 + i, [inv.type === 'rd' ? 'Recurring deposit' : 'Mutual fund SIP', inv.name || '', +inv.amount, +inv.ratePct / 100, +inv.years, Math.round(inv.invested), Math.round(inv.fv), Math.round(inv.gain)], [null, null, X.inr, X.pct, '0', X.inr, X.inr, X.inr], { zebra: i % 2 === 1 }));
  if (s.investments.length) {
    const sum = (k) => s.investments.reduce((a, b) => a + (+b[k] || 0), 0);
    dataRow(wi, 2 + s.investments.length, ['Total', '', sum('amount'), null, null, Math.round(sum('invested')), Math.round(sum('fv')), Math.round(sum('gain'))], [null, null, X.inr, null, null, X.inr, X.inr, X.inr], { bold: true, fillArgb: X.greenSoft });
  }

  // ----- Notes -----
  const wn = wb.addWorksheet('Notes');
  wn.columns = [{ width: 110 }];
  const notes = workbookRows(state, s).notes;
  notes.forEach((r, i) => { const c = wn.getCell(`A${i + 1}`); c.value = r[0]; c.alignment = { wrapText: true, vertical: 'top' }; if (i === 0) c.font = { bold: true, size: 14, color: { argb: X.green } }; });

  const buf = await wb.xlsx.writeBuffer();
  return toBase64(buf);
}

async function svgToPng(svg, width) {
  const NS = 'http://www.w3.org/2000/svg';
  const vb = svg.viewBox.baseVal;
  const height = Math.round((width * vb.height) / vb.width);
  const clone = svg.cloneNode(true);
  clone.setAttribute('xmlns', NS);
  clone.setAttribute('width', width); clone.setAttribute('height', height);
  clone.setAttribute('font-family', 'Arial, Helvetica, sans-serif');
  // CSS variables do not resolve inside a serialised image: bake the computed colours in, and force light-mode ink
  const src = svg.querySelectorAll('*'), dst = clone.querySelectorAll('*');
  src.forEach((s, i) => {
    const cs = getComputedStyle(s);
    if (s.tagName === 'text') dst[i].setAttribute('fill', /var\(/.test(s.getAttribute('style') || '') ? (cs.fill.includes('rgb(255') || cs.fill.includes('rgb(232') ? '#1c2321' : cs.fill) : cs.fill);
    if (s.tagName === 'rect' && /var\(/.test(s.getAttribute('style') || '')) dst[i].setAttribute('fill', '#eef2ec');
    dst[i].removeAttribute('style');
  });
  const bg = document.createElementNS(NS, 'rect');
  bg.setAttribute('width', '100%'); bg.setAttribute('height', '100%'); bg.setAttribute('fill', '#ffffff');
  clone.insertBefore(bg, clone.firstChild);
  const data = new XMLSerializer().serializeToString(clone);
  const img = new Image();
  await new Promise((res, rej) => { img.onload = res; img.onerror = rej; img.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(data); });
  const scale = 2;
  const canvas = document.createElement('canvas');
  canvas.width = width * scale; canvas.height = height * scale;
  const ctx = canvas.getContext('2d');
  ctx.scale(scale, scale); ctx.drawImage(img, 0, 0, width, height);
  return { base64: canvas.toDataURL('image/png').split(',')[1], width, height };
}


// ---------- UI ----------

export function renderBudget(appData) {
  let state = load();
  const handoff = takeHandoff('budget');
  if (handoff && handoff.values.income > 0) { state.income = handoff.values.income; try { localStorage.setItem(STORAGE_KEY, JSON.stringify(state)); } catch {} }
  // First visit with a profile but no budget yet: start from the monthly in-hand the profile implies.
  if (!state.income && appData?.rates && !isBlankAfterReset('budget')) {
    const p = getProfile();
    if (!isEmptyProfile(p) && p.income.ctc > 0) { const r = salaryBreakdown(toSalaryStore(p), appData.rates); if (!r.error && r.monthly > 0) state.income = Math.round(r.monthly); }
  }
  const root = el('div', { class: 'calc budget' });
  const left = el('div', { class: 'card inputs' });
  const right = el('div');
  root.append(left, right);

  const incomeInput = el('input', { 'aria-label': 'Monthly take-home income in rupees', type: 'number', min: 0, step: 1000, value: state.income || '', placeholder: 'e.g. 120000' });
  incomeInput.addEventListener('input', () => { state.income = +incomeInput.value || 0; refresh(); });

  const expenseList = el('div', { class: 'rows' });
  const investList = el('div', { class: 'rows' });

  function expenseRow(e) {
    const cat = el('select', { 'aria-label': 'Expense category' }, CATEGORIES.map((c) => el('option', { value: c, selected: c === e.category }, c)));
    const note = el('input', { type: 'text', placeholder: 'note (optional)', value: e.note || '', maxlength: 60, 'aria-label': 'Note about this expense' });
    const amt = el('input', { type: 'number', min: 0, step: 100, placeholder: '₹ / month', value: e.amount || '', 'aria-label': 'Amount per month in rupees' });
    const del = el('button', { type: 'button', class: 'icon-btn', title: 'Remove', 'aria-label': 'Remove expense' }, '×');
    cat.addEventListener('change', () => { e.category = cat.value; refresh(); });
    note.addEventListener('input', () => { e.note = note.value; save(); });
    amt.addEventListener('input', () => { e.amount = amt.value; refresh(); });
    del.addEventListener('click', () => { state.expenses = state.expenses.filter((x) => x !== e); row.remove(); refresh(); });
    const row = el('div', { class: 'row expense-row' }, [cat, note, amt, del]);
    return row;
  }
  function investRow(inv) {
    const type = el('select', { 'aria-label': 'Investment type' }, [el('option', { value: 'sip', selected: inv.type === 'sip' }, 'Mutual fund SIP'), el('option', { value: 'rd', selected: inv.type === 'rd' }, 'Recurring deposit')]);
    const name = el('input', { type: 'text', placeholder: 'name (optional)', value: inv.name || '', maxlength: 60, 'aria-label': 'Name of this investment' });
    const amt = el('input', { type: 'number', min: 0, step: 500, placeholder: '₹ / month', value: inv.amount || '', 'aria-label': 'Amount invested per month in rupees' });
    const rate = el('input', { type: 'number', min: 0, step: 0.1, value: inv.ratePct, title: inv.type === 'rd' ? 'RD interest rate % p.a.' : 'Expected return % p.a.', 'aria-label': 'Return per year, percent' });
    const yrs = el('input', { type: 'number', min: 1, max: 40, step: 1, value: inv.years, title: 'Years', 'aria-label': 'Term in years' });
    const del = el('button', { type: 'button', class: 'icon-btn', title: 'Remove', 'aria-label': 'Remove investment' }, '×');
    type.addEventListener('change', () => { inv.type = type.value; if (inv.type === 'rd' && +rate.value > 9) { rate.value = 6.7; inv.ratePct = 6.7; } refresh(); });
    name.addEventListener('input', () => { inv.name = name.value; save(); });
    amt.addEventListener('input', () => { inv.amount = amt.value; refresh(); });
    rate.addEventListener('input', () => { inv.ratePct = rate.value; refresh(); });
    yrs.addEventListener('input', () => { inv.years = yrs.value; refresh(); });
    del.addEventListener('click', () => { state.investments = state.investments.filter((x) => x !== inv); row.remove(); refresh(); });
    const row = el('div', { class: 'row invest-row' }, [type, name, amt, el('span', { class: 'unit' }, [rate, '%']), el('span', { class: 'unit' }, [yrs, 'yrs']), del]);
    return row;
  }
  const addExpense = (category = 'Others') => { const e = { id: uid(), category, note: '', amount: '' }; state.expenses.push(e); expenseList.append(expenseRow(e)); expenseList.lastChild.querySelector('input[type=number]').focus(); };
  const addInvest = (type) => { const inv = { id: uid(), type, name: type === 'rd' ? 'Recurring deposit' : 'Mutual fund SIP', amount: '', ratePct: type === 'rd' ? 6.7 : 12, years: type === 'rd' ? 5 : 10 }; state.investments.push(inv); investList.append(investRow(inv)); refresh(); };

  for (const e of state.expenses) expenseList.append(expenseRow(e));
  for (const inv of state.investments) investList.append(investRow(inv));

  // append() turns a null into the text "null"; setChildren drops it
  setChildren(left, [
    handoff ? handoffNote(handoff.from, `Income set to ${inr(state.income)} a month from `) : null,
    el('label', {}, ['Monthly take-home income (₹)', el('small', {}, ['after tax and deductions, as credited to your bank. ', el('a', { href: '/calculators/salary' }, 'Work it out from your CTC')]), incomeInput]),
    el('div', { class: 'opts' }, [el('div', { class: 'opt-title' }, 'Monthly expenses'), el('div', { class: 'row-head' }, ['Category', 'Note', 'Amount', ''].map((t) => el('span', {}, t))), expenseList,
      el('div', { class: 'chips' }, CATEGORIES.map((c) => el('button', { type: 'button', onclick: () => addExpense(c) }, '+ ' + c)))]),
    el('div', { class: 'opts' }, [el('div', { class: 'opt-title' }, 'Monthly investments'), el('div', { class: 'row-head invest-head' }, ['Type', 'Name', 'Amount', 'Return', 'Term', ''].map((t) => el('span', {}, t))), investList,
      el('div', { class: 'chips' }, [el('button', { type: 'button', onclick: () => addInvest('sip') }, '+ SIP'), el('button', { type: 'button', onclick: () => addInvest('rd') }, '+ Recurring deposit')])]),
    el('div', { class: 'form-actions' }, el('button', { type: 'button', class: 'btn secondary', onclick: () => { state = defaultState(); save(); root.replaceWith(renderBudget()); } }, 'Start over')),
  ]);

  // right side
  const stats = el('div', { class: 'stats' });
  const allocBox = el('div', { class: 'chart' });
  const catBox = el('div', { class: 'chart' });
  const tables = el('div');
  const exportBox = exportCard(() => state, () => summarise(state), () => ({ alloc: allocBox.querySelector('svg'), cat: catBox.querySelector('svg') }));
  right.append(stats, el('h3', {}, 'Where your income goes'), allocBox, el('h3', {}, 'Expenses by category'), catBox, tables, exportBox, disclaimer('invest'));

  function refresh() {
    save();
    const s = summarise(state);
    setChildren(stats, [
      statTile('Income', inr(s.income), true),
      statTile('Expenses', inr(s.totalExpenses)),
      statTile('Investments', inr(s.totalInvestments)),
      statTile(s.deficit ? 'Shortfall' : 'Left over', inr(s.surplus), false, s.deficit ? 'bad' : ''),
      statTile('Savings rate', pct(s.savingsRate, 0)),
    ]);
    setChildren(allocBox, s.income > 0 || s.totalExpenses > 0 ? [allocationChart(s)] : [el('p', { class: 'muted' }, 'Enter your income and expenses to see the split.')]);
    setChildren(catBox, s.categories.length ? [categoryChart(s)] : [el('p', { class: 'muted' }, 'No expenses yet.')]);
    setChildren(tables, [
      s.deficit ? el('div', { class: 'notice warn' }, `Expenses and investments exceed income by ${inr(-s.surplus)} a month. Something on the left needs to give, or the investments will be funded by debt.`) : null,
      !s.deficit && s.surplus >= 500 ? el('div', { class: 'btn-row' }, [
        el('a', { class: 'btn', href: '/calculators/sip', onclick: () => setHandoff('sip', { monthly: Math.floor(s.surplus / 500) * 500 }, 'budget') }, `See what a ${inr(Math.floor(s.surplus / 500) * 500)} monthly SIP could grow into`),
      ]) : null,
      !s.deficit && s.income > 0 && s.savingsRate < 0.2 ? el('p', { class: 'muted' }, 'A common rule of thumb is to save or invest at least 20% of take-home pay. This is a guideline, not advice.') : null,
      s.investments.length ? el('div', {}, [
        el('h3', {}, 'What your investments could grow to'),
        el('div', { class: 'table-wrap' }, el('table', { class: 'compare' }, [
          el('thead', {}, el('tr', {}, [el('th', {}, 'Investment'), el('th', {}, 'Monthly'), el('th', {}, 'Rate'), el('th', {}, 'Years'), el('th', {}, 'Invested'), el('th', {}, 'Projected value')])),
          el('tbody', {}, s.investments.map((i) => el('tr', {}, [
            el('td', {}, `${i.name || (i.type === 'rd' ? 'Recurring deposit' : 'SIP')} (${i.type === 'rd' ? 'RD' : 'SIP'})`), el('td', {}, inr(i.amount)), el('td', {}, `${(+i.ratePct).toFixed(1)}%`), el('td', {}, i.years), el('td', {}, inr(i.invested)), el('td', { class: 'better' }, inr(i.fv)),
          ]))),
        ])),
        el('p', { class: 'muted', style: 'font-size:.8rem' }, 'SIP values assume a constant return and are illustrative, not guaranteed. RD maturity uses quarterly compounding, before tax on interest.'),
      ]) : null,
    ]);
  }
  function save() {
    clearBlankAfterReset('budget');
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(state)); } catch {}
    // What is free each month after expenses feeds the shared profile (the Decide tool allocates it).
    const s = summarise(state);
    if (s.income > 0) updateProfile((p) => { p.cashflow.monthlySurplus = Math.max(0, Math.round(s.income - s.totalExpenses)); return p; }, 'calc:budget');
  }
  refresh();
  return root;
}

function statTile(k, v, hi = false, extra = '') {
  return el('div', { class: `stat ${hi ? 'hi' : ''} ${extra}` }, [el('div', { class: 'k' }, k), el('div', { class: 'v' }, v)]);
}

function load() {
  try {
    const s = JSON.parse(localStorage.getItem(STORAGE_KEY) || 'null');
    if (s && Array.isArray(s.expenses) && Array.isArray(s.investments)) return { ...defaultState(), ...s, person: { name: '', email: '', ...(s.person || {}) } };
  } catch {}
  return defaultState();
}

function exportCard(getState, getSummary, getCharts) {
  return emailWorkbookCard({
    title: 'Get this as an Excel workbook',
    intro: 'We will email you the summary, your expenses by category, the investment projections and the charts as a formatted spreadsheet.',
    source: 'budget',
    fileName: (who) => safeFileName('taxcompass-budget', who),
    buildBase64: async (who) => { const state = getState(); state.person.name = who; return buildWorkbookBase64(state, getSummary(), getCharts()); },
  });
}
