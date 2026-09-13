/**
 * Advance tax: instalment schedule and interest under 234B / 234C (s.424 / s.425 of the 2025 Act).
 * Pure function `advanceTaxPlan` (tested) plus the calculator UI.
 */
import { inr, pct, el, setChildren, disclaimer } from './util.js';
import { compareRegimes } from './tax-engine.js';

const MONTHS = ['April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December', 'January', 'February', 'March'];

/** Financial year that a date falls in, as its starting calendar year. */
export function fyStartYear(d = new Date()) {
  return d.getMonth() >= 3 ? d.getFullYear() : d.getFullYear() - 1;
}

/**
 * params: { totalTax, tds, seniorNoBusiness, presumptive, paid: [cumulative paid by 15 Jun, 15 Sep, 15 Dec, 15 Mar],
 *           balanceMonth: months after 31 March until the balance is paid (1 = April ... 12 = March next year), fy: start year, today: Date }
 */
export function advanceTaxPlan(params, rates) {
  const at = rates.advance_tax;
  const monthlyRate = rates.interest.short_advance_tax.rate_per_month;
  const net = Math.max(0, Math.round((+params.totalTax || 0) - (+params.tds || 0)));
  const fy = params.fy || fyStartYear(params.today || new Date());
  const today = params.today || new Date();
  const paid = (params.paid || []).map((x) => Math.max(0, +x || 0));

  let required = true, reason = null;
  if (params.seniorNoBusiness) { required = false; reason = 'Resident individuals aged 60 or above with no business or professional income are exempt from advance tax; the whole amount is payable as self-assessment tax before filing.'; }
  else if (net < at.liability_threshold) { required = false; reason = `Advance tax applies only when the net liability after TDS is ${inr(at.liability_threshold)} or more. Yours is ${inr(net)}, so pay it as self-assessment tax before filing.`; }

  const plan = params.presumptive
    ? [{ due: new Date(Date.UTC(fy + 1, 2, 15)), cumPct: 1, tol: null, months: 1, label: '15 March' }]
    : at.instalments.map((inst, i) => ({ due: new Date(Date.UTC(fy + (i === 3 ? 1 : 0), [5, 8, 11, 2][i], 15)), cumPct: inst.cumulative_pct, tol: inst.s425_tolerance_pct, months: i === 3 ? 1 : 3, label: inst.due }));

  let running = 0;
  const rows = plan.map((p, i) => {
    const cumDue = Math.round(net * p.cumPct);
    const paidCum = Math.max(running, paid[params.presumptive ? 3 : i] || 0);
    running = paidCum;
    const shortfall = Math.max(0, cumDue - paidCum);
    const thisInstalment = cumDue - Math.round(net * (i ? plan[i - 1].cumPct : 0));
    // 234C: no interest on the first two instalments if at least 12% / 36% has been paid; interest is 1% a month on the shortfall, rounded down to Rs 100
    const tolerated = p.tol != null && paidCum >= Math.round(net * p.tol);
    const base = Math.floor(shortfall / 100) * 100;
    const interest = required && !tolerated && shortfall > 0 ? base * monthlyRate * p.months : 0;
    const past = today.getTime() > p.due.getTime();
    return { label: p.label, due: p.due, cumPct: p.cumPct, cumDue, thisInstalment, paidCum, shortfall, tolerated, interest, months: p.months, past };
  });

  const paidTotal = rows.length ? rows[rows.length - 1].paidCum : 0;
  const interest234C = rows.reduce((s, r) => s + r.interest, 0);
  const balanceMonth = Math.min(12, Math.max(0, Math.round(+params.balanceMonth || 0)));
  const shortfall234B = required && paidTotal < 0.9 * net ? net - paidTotal : 0;
  const interest234B = Math.floor(shortfall234B / 100) * 100 * monthlyRate * balanceMonth;
  const nextDue = rows.find((r) => !r.past && r.shortfall > 0) || null;

  return {
    net, required, reason, fy, rows, paidTotal, interest234C, interest234B, shortfall234B, balanceMonth,
    total: interest234C + interest234B, nextDue,
    sections: { instalments: rates.advance_tax.section, s234B: rates.interest.short_advance_tax, s234C: rates.interest.deferment_of_instalments },
  };
}

// ---------- UI ----------
const STORE = 'taxcompass.advtax.v1';
const fmtDate = (d) => d.toLocaleDateString('en-IN', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' });

export function renderAdvanceTax(data) {
  const rates = data.rates;
  let saved = {}; try { saved = JSON.parse(localStorage.getItem(STORE) || '{}'); } catch {}
  const st = { source: 'auto', totalTax: '', tds: '', senior: false, presumptive: false, paid: ['', '', '', ''], balanceMonth: 4, ...saved };
  const save = () => { try { localStorage.setItem(STORE, JSON.stringify(st)); } catch {} };

  // figures from the tax comparison, if the user has one
  let cmp = null;
  try { const inputs = JSON.parse(localStorage.getItem('taxcompass.inputs.v1') || 'null'); if (inputs) cmp = compareRegimes(inputs, rates); } catch { cmp = null; }
  const hasCmp = cmp && (cmp.old.tax.totalIncome > 0 || cmp.new.tax.totalIncome > 0);

  const sourceOpts = [];
  if (hasCmp) {
    sourceOpts.push(['new', `New regime, from my tax comparison: ${inr(cmp.new.tax.total)}`], ['old', `Old regime, from my tax comparison: ${inr(cmp.old.tax.total)}`]);
  }
  sourceOpts.push(['manual', 'I will type the tax liability']);
  if (st.source === 'auto') st.source = hasCmp ? (cmp.better === 'old' ? 'old' : 'new') : 'manual';
  if (!sourceOpts.find(([v]) => v === st.source)) st.source = 'manual';

  const source = el('select', {}, sourceOpts.map(([v, t]) => el('option', { value: v, selected: v === st.source }, t)));
  const totalTax = el('input', { type: 'number', min: 0, step: 1000, value: st.totalTax, placeholder: 'total tax for the year incl. cess' });
  const tds = el('input', { type: 'number', min: 0, step: 1000, value: st.tds, placeholder: '0' });
  const senior = el('input', { type: 'checkbox' }); senior.checked = !!st.senior;
  const presumptive = el('input', { type: 'checkbox' }); presumptive.checked = !!st.presumptive;
  const paidInputs = ['15 June', '15 September', '15 December', '15 March'].map((d, i) => ({ label: d, input: el('input', { type: 'number', min: 0, step: 1000, value: st.paid[i] ?? '', placeholder: '0' }) }));
  const balance = el('select', {}, MONTHS.map((m, i) => el('option', { value: i + 1, selected: i + 1 === +st.balanceMonth }, `${m}${i >= 9 ? ' (next year)' : ''}`)));

  const wire = (elm, key, ev = 'input', get = () => elm.value) => elm.addEventListener(ev, () => { st[key] = get(); save(); render(); });
  wire(source, 'source', 'change'); wire(totalTax, 'totalTax'); wire(tds, 'tds');
  wire(senior, 'senior', 'change', () => senior.checked); wire(presumptive, 'presumptive', 'change', () => presumptive.checked);
  paidInputs.forEach((p, i) => p.input.addEventListener('input', () => { st.paid[i] = p.input.value; save(); render(); }));
  wire(balance, 'balanceMonth', 'change');

  const manualRow = el('label', {}, ['Total tax for the year (₹)', el('small', {}, 'after rebate and cess; the Tax comparison tab gives this'), totalTax]);
  const inputs = el('div', { class: 'card inputs' }, [
    el('label', {}, ['Tax liability to plan for', source]),
    manualRow,
    el('label', {}, ['TDS and TCS expected for the year (₹)', el('small', {}, 'from salary, bank interest, and anything else deducted at source'), tds]),
    el('label', { class: 'check' }, [senior, 'I am a resident aged 60 or above with no business or professional income']),
    el('label', { class: 'check' }, [presumptive, 'I pay tax under the presumptive scheme (44AD / 44ADA)']),
    el('div', { class: 'opts' }, [
      el('div', { class: 'opt-title' }, 'Already paid'),
      el('p', { class: 'opt-help' }, 'Cumulative advance tax paid by each date, to work out interest. Leave blank if nothing yet.'),
      el('div', { class: 'two' }, paidInputs.map((p) => el('label', {}, [`By ${p.label} (₹)`, p.input]))),
      el('label', {}, ['I will pay any balance in', el('small', {}, 'used for interest under 234B, which runs from April of the next financial year'), balance]),
    ]),
  ]);
  const out = el('div');

  function render() {
    manualRow.hidden = st.source !== 'manual';
    const tax = st.source === 'new' && hasCmp ? cmp.new.tax.total : st.source === 'old' && hasCmp ? cmp.old.tax.total : +st.totalTax || 0;
    const plan = advanceTaxPlan({ totalTax: tax, tds: +st.tds || 0, seniorNoBusiness: st.senior, presumptive: st.presumptive, paid: st.paid, balanceMonth: +st.balanceMonth }, rates);
    const stat = (k, v, cls = '') => el('div', { class: 'stat ' + cls }, [el('div', { class: 'k' }, k), el('div', { class: 'v' }, v)]);

    if (!tax) { setChildren(out, [el('div', { class: 'notice' }, 'Enter your tax for the year, or fill in the Tax comparison first and pick it from the list.')]); return; }
    const fyLabel = `FY ${plan.fy}-${String((plan.fy + 1) % 100).padStart(2, '0')}`;
    setChildren(out, [
      el('div', { class: 'stats' }, [
        stat('Tax for the year', inr(tax)),
        stat('Less TDS / TCS', inr(+st.tds || 0)),
        stat('Advance tax payable', inr(plan.required ? plan.net : 0), 'hi'),
        plan.required && plan.nextDue ? stat('Next instalment', `${inr(plan.nextDue.shortfall)} by ${plan.nextDue.label}`) : stat('Status', plan.required ? (plan.rows.every((r) => r.shortfall === 0) ? 'Fully paid' : 'All dates passed') : 'Not required'),
        plan.required && plan.total > 0 ? stat('Interest on this path', inr(plan.total), 'bad') : null,
      ]),
      !plan.required ? el('div', { class: 'notice' }, plan.reason) : el('p', { class: 'explain' }, plan.nextDue
        ? `For ${fyLabel} you need to pay ${inr(plan.net)} in advance tax. Pay ${inr(plan.nextDue.shortfall)} by ${plan.nextDue.label} to be on schedule${plan.nextDue.tolerated ? '' : ''}. Interest at 1% a month applies to any instalment paid short or late.`
        : `For ${fyLabel} you need ${inr(plan.net)} in advance tax. ${plan.rows.every((r) => r.shortfall === 0) ? 'You are fully paid up.' : 'All instalment dates have passed; pay the balance as self-assessment tax as soon as possible to stop interest.'}`),
      plan.required ? el('div', { class: 'table-wrap' }, el('table', { class: 'compare' }, [
        el('thead', {}, el('tr', {}, [el('th', {}, 'Due date'), el('th', {}, 'Cumulative'), el('th', {}, 'Cumulative due'), el('th', {}, 'This instalment'), el('th', {}, 'Paid by then'), el('th', {}, 'Shortfall'), el('th', {}, 'Interest 234C')])),
        el('tbody', {}, plan.rows.map((r) => el('tr', { class: r.past ? '' : (r === plan.nextDue ? 'subtotal' : '') }, [
          el('td', {}, [fmtDate(r.due), r.past ? el('span', { class: 'tag' }, 'passed') : r === plan.nextDue ? el('span', { class: 'tag' }, 'next') : null]),
          el('td', {}, pct(r.cumPct, 0)), el('td', {}, inr(r.cumDue)), el('td', {}, inr(r.thisInstalment)), el('td', {}, inr(r.paidCum)),
          el('td', { class: r.shortfall ? 'neg' : '' }, inr(r.shortfall)),
          el('td', {}, [inr(r.interest), r.tolerated && r.shortfall ? el('div', { class: 'muted small' }, 'within tolerance') : null]),
        ]))),
        el('tfoot', {}, [
          el('tr', { class: 'total' }, [el('td', { colspan: 6 }, 'Interest for deferring instalments (234C / s.425)'), el('td', {}, inr(plan.interest234C))]),
          el('tr', {}, [el('td', { colspan: 6 }, `Interest for short payment (234B / s.424): ${plan.shortfall234B ? `${inr(plan.shortfall234B)} unpaid, 1% a month for ${plan.balanceMonth} month${plan.balanceMonth === 1 ? '' : 's'} from April` : 'not applicable, at least 90% paid'}`), el('td', {}, inr(plan.interest234B))]),
          el('tr', { class: 'total' }, [el('td', { colspan: 6 }, 'Total interest'), el('td', {}, inr(plan.total))]),
        ]),
      ])) : null,
      el('ul', { class: 'notes' }, [
        'Instalments are 15%, 45%, 75% and 100% of the year\'s advance tax, cumulatively, by 15 June, 15 September, 15 December and 15 March. Under the presumptive scheme the whole amount is due by 15 March.',
        'No 234C interest on the June and September instalments if at least 12% and 36% respectively has been paid by then. Interest is 1% a month for three months on each of the first three shortfalls and one month on the March shortfall, on the amount rounded down to the nearest hundred.',
        'Tax on capital gains, lottery winnings or dividends that arose after an instalment date is not charged 234C interest if it is paid by the next instalment date. This calculator does not model the timing of such income; treat those instalments as approximate.',
        'Advance tax paid until 31 March counts. If less than 90% of the assessed tax has been paid by then, 234B interest runs at 1% a month from 1 April until payment.',
        'Section numbers under the Income-tax Act 2025 (s.408 for instalments, s.424 and s.425 for interest) are as mapped in the data pack and marked unverified there.',
      ].map((t) => el('li', {}, t))),
      disclaimer('tax'),
    ]);
  }
  render();
  return el('div', { class: 'calc' }, [inputs, out]);
}
