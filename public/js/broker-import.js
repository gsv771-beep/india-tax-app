/**
 * "A year of trades": read a broker's tax P&L workbook in the browser, work out the capital gains
 * and business income heads, the tax, the set-offs and carry-forwards, and what to do before
 * 31 March. The file never leaves the device; the client name, ID and PAN in it are read past and
 * never kept. Only the aggregated figures are saved in this browser, so the page survives a reload.
 * Parsers: engine/brokers/*.js. Tax: engine/trading-tax.js.
 */
import { inr, pct, el, setChildren, disclaimer } from './util.js';
import { loadExcelJS } from './xlsx-style.js';
import { parseZerodhaTaxPnl, detectZerodha } from '../engine/brokers/zerodha.js';
import { tradingTax, quarterlyTax } from '../engine/trading-tax.js';

const STORE = 'taxcompass.broker.v1';
const BROKERS = [
  { id: 'zerodha', label: 'Zerodha (Console → Reports → Tax P&L, Excel)', how: 'In Console open Reports → Tax P&L, pick the financial year and all quarters, and download the Excel. Upload that file here.' },
];

export function renderBrokerImport({ rates }) {
  let saved = null; try { saved = JSON.parse(localStorage.getItem(STORE) || 'null'); } catch {}
  const st = { slabRate: 0.3, deductCharges: false, otherEquityLtcgThisYear: '', ...(saved?.opts || {}) };
  let parsed = saved?.parsed || null;
  const persist = () => { try { localStorage.setItem(STORE, JSON.stringify({ parsed, opts: st })); } catch {} };

  const status = el('p', { class: 'muted', role: 'status', style: 'margin:8px 0 0' });
  const out = el('div');
  const file = el('input', { type: 'file', accept: '.xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
  file.addEventListener('change', async () => {
    const f = file.files && file.files[0];
    if (!f) return;
    status.textContent = 'Reading the workbook in your browser…';
    try {
      const ExcelJS = await loadExcelJS();
      const wb = new ExcelJS.Workbook();
      await wb.xlsx.load(await f.arrayBuffer());
      const sheets = {};
      for (const ws of wb.worksheets) { const rows = []; ws.eachRow({ includeEmpty: false }, (row) => { rows.push(row.values.slice(1)); }); sheets[ws.name] = rows; }
      if (!detectZerodha(sheets)) throw new Error('This is not a Zerodha Tax P&L workbook. Other brokers are not supported yet; send a sample through Feedback and it will be.');
      parsed = parseZerodhaTaxPnl(sheets);
      persist();
      status.textContent = `Read ${Object.values(parsed.counts).reduce((s, n) => s + n, 0)} exits for ${parsed.period.from} to ${parsed.period.to}. Your name, client ID and PAN were skipped; nothing was uploaded.`;
      render();
    } catch (e) {
      status.textContent = e.message;
    } finally { file.value = ''; }
  });

  const opt = (key, label, attrs, hint) => {
    let input;
    if (attrs.options) input = el('select', {}, attrs.options.map(([v, t]) => el('option', { value: v, selected: String(v) === String(st[key]) }, t)));
    else if (attrs.type === 'checkbox') { input = el('input', { type: 'checkbox' }); input.checked = !!st[key]; }
    else input = el('input', { type: 'number', min: 0, step: attrs.step || 1, value: st[key], placeholder: attrs.placeholder });
    input.addEventListener(attrs.options || attrs.type === 'checkbox' ? 'change' : 'input', () => { st[key] = attrs.type === 'checkbox' ? input.checked : input.value; persist(); render(); });
    return attrs.type === 'checkbox' ? el('label', { class: 'check' }, [input, label]) : el('label', {}, [label, hint ? el('small', {}, hint) : null, input]);
  };

  const inputs = el('div', { class: 'card inputs' }, [
    el('div', { class: 'opts', style: 'border-top:0;padding-top:0' }, [
      el('div', { class: 'opt-title' }, 'Your broker statement'),
      el('p', { class: 'privacy-note', style: 'margin:0 0 10px' }, [el('strong', {}, 'Read on this device only. '), 'The file is opened in your browser and never uploaded. Your name, client ID and PAN in it are skipped; only the totals are kept, here in this browser.']),
      el('label', {}, ['Broker', el('select', {}, BROKERS.map((b) => el('option', { value: b.id }, b.label)))]),
      el('p', { class: 'opt-help' }, BROKERS[0].how),
      el('label', {}, ['Tax P&L workbook (.xlsx)', file]),
      status,
    ]),
    el('div', { class: 'opts' }, [
      el('div', { class: 'opt-title' }, 'About you'),
      opt('slabRate', 'Your income tax slab', { options: [[0, 'Nil'], [0.05, '5%'], [0.1, '10%'], [0.15, '15%'], [0.2, '20%'], [0.25, '25%'], [0.3, '30%']] }, 'used for intraday, F&O and debt-fund income'),
      opt('otherEquityLtcgThisYear', 'Long-term equity gains booked elsewhere this year (₹)', { step: 1000, placeholder: '0' }, 'another broker or fund house; the ₹1,25,000 exemption is shared'),
      opt('deductCharges', 'Deduct brokerage and other non-STT charges from the gains', { type: 'checkbox' }),
    ]),
  ]);

  function render() {
    if (!parsed) {
      setChildren(out, [el('div', { class: 'notice' }, [el('strong', {}, 'Upload your Tax P&L workbook to begin. '), 'You get every head of income the year produced, the tax on it, losses to set off or carry forward, and what is worth doing before 31 March.'])]);
      return;
    }
    const r = tradingTax(parsed, rates, { slabRate: +st.slabRate, deductCharges: !!st.deductCharges, otherEquityLtcgThisYear: +st.otherEquityLtcgThisYear || 0 });
    const h = r.heads;
    const stat = (k, v, cls = '') => el('div', { class: 'stat ' + cls }, [el('div', { class: 'k' }, k), el('div', { class: 'v' }, v)]);
    const signed = (n) => (n < 0 ? '−' : '') + inr(Math.abs(n));
    const business = h.intraday + h.fno + h.debtSlab + h.currency + h.commodity;
    const rows = [
      ['Short-term capital gain on equity (shares and equity funds, 12 months or less)', h.stcgEquity, `${pct(r.rates.stcg, 0)} after set-off`],
      ['Long-term capital gain on equity (over 12 months)', h.ltcgEquity, `${pct(r.rates.ltcg, 1)} above ${inr(r.rates.exemption)} a year`],
      h.intraday !== 0 ? ['Intraday (speculative business income)', h.intraday, 'slab rate; loss only against speculative gains'] : null,
      h.fno !== 0 ? ['F&O (non-speculative business income)', h.fno, 'slab rate; loss against any income but salary'] : null,
      h.debtSlab !== 0 ? ['Debt fund gains', h.debtSlab, 'slab rate'] : null,
      h.currency !== 0 ? ['Currency derivatives', h.currency, 'business income, slab rate'] : null,
      h.commodity !== 0 ? ['Commodity derivatives', h.commodity, 'business income, slab rate'] : null,
    ].filter(Boolean);
    const taxRows = [
      ['Short-term gains taxable after set-off', r.stcgTaxable, r.tax.stcg],
      [`Long-term gains taxable after set-off and ${inr(r.ltcgExemptUsed)} exemption`, r.ltcgTaxable, r.tax.ltcg],
      business > 0 ? [`Business income at ${pct(r.rates.slab, 0)}`, Math.max(0, h.intraday) + Math.max(0, h.fno) + Math.max(0, h.debtSlab) + Math.max(0, h.currency) + Math.max(0, h.commodity), r.tax.business] : null,
      ['Health and education cess (4%)', '', r.tax.cess],
    ].filter(Boolean);
    const qt = quarterlyTax(parsed, rates, { slabRate: +st.slabRate, deductCharges: !!st.deductCharges, otherEquityLtcgThisYear: +st.otherEquityLtcgThisYear || 0 });
    const quarterSection = el('div', {}, [
      el('h3', {}, 'Quarter by quarter, and the advance tax each one triggers'),
      el('div', { class: 'table-wrap' }, el('table', { class: 'compare' }, [
        el('thead', {}, el('tr', {}, [el('th', {}, 'Quarter'), el('th', {}, 'Short-term'), el('th', {}, 'Long-term'), el('th', {}, 'Intraday'), el('th', {}, 'F&O'), el('th', {}, 'Tax on the year so far'), el('th', {}, 'Advance tax to pay')])),
        el('tbody', {}, [
          ...qt.rows.map((row) => el('tr', {}, [
            el('td', {}, [row.label, el('div', { class: 'muted small' }, `${row.exits} exit${row.exits === 1 ? '' : 's'} · due ${new Date(row.dueDate + 'T00:00:00').toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })}`)]),
            el('td', { class: row.quarter.stcg < 0 ? 'neg' : '' }, signed(row.quarter.stcg)), el('td', { class: row.quarter.ltcg < 0 ? 'neg' : '' }, signed(row.quarter.ltcg)),
            el('td', { class: row.quarter.intraday < 0 ? 'neg' : '' }, signed(row.quarter.intraday)), el('td', { class: row.quarter.fno < 0 ? 'neg' : '' }, signed(row.quarter.fno)),
            el('td', {}, inr(row.cumulative.taxSoFar)),
            el('td', { class: row.instalment > 0 ? 'better' : '' }, row.instalment > 0 ? inr(row.instalment) : row.refundable > 0 ? `nil (${inr(row.refundable)} refundable)` : 'nil'),
          ])),
          el('tr', { class: 'total' }, [el('td', {}, 'Year'), el('td', {}, signed(h.stcgEquity)), el('td', {}, signed(h.ltcgEquity)), el('td', {}, signed(h.intraday)), el('td', {}, signed(h.fno)), el('td', {}, inr(r.tax.total)), el('td', {}, inr(qt.totalPaid))]),
        ]),
      ])),
      el('ul', { class: 'small muted' }, qt.notes.map((n) => el('li', {}, n))),
    ]);
    const symbolTable = (title, list) => list.length ? el('details', { class: 'result-fold' }, [
      el('summary', {}, [el('span', { class: 'rf-title' }, title), el('span', { class: 'rf-sum' }, `${list.length} scrips · worst first`)]),
      el('div', { class: 'table-wrap' }, el('table', { class: 'compare' }, [
        el('thead', {}, el('tr', {}, [el('th', {}, 'Scrip'), el('th', {}, 'Exits'), el('th', {}, 'Bought for'), el('th', {}, 'Sold for'), el('th', {}, 'Gain')])),
        el('tbody', {}, list.map((s) => el('tr', {}, [el('td', {}, s.symbol), el('td', {}, String(s.trades)), el('td', {}, inr(s.buyValue)), el('td', {}, inr(s.sellValue)), el('td', { class: s.profit < 0 ? 'neg' : '' }, signed(s.profit))]))),
      ])),
    ]) : null;

    setChildren(out, [
      el('div', { class: 'stats' }, [
        stat('Short-term equity', signed(h.stcgEquity), h.stcgEquity < 0 ? 'bad' : ''),
        stat('Long-term equity', signed(h.ltcgEquity), h.ltcgEquity < 0 ? 'bad' : ''),
        stat('Intraday + F&O', signed(h.intraday + h.fno), h.intraday + h.fno < 0 ? 'bad' : ''),
        stat('Tax on the year', inr(r.tax.total), 'hi'),
      ]),
      el('p', { class: 'explain' }, `Between ${parsed.period.from} and ${parsed.period.to} this account produced ${signed(h.stcgEquity)} of short-term and ${signed(h.ltcgEquity)} of long-term equity gains${business !== 0 ? `, and ${signed(business)} of business income from intraday, F&O or other segments` : ''}. After set-offs and the ${inr(r.rates.exemption)} long-term exemption, the tax comes to ${inr(r.tax.total)}${r.stclCarried + r.ltclCarried > 0 ? `, with ${inr(r.stclCarried + r.ltclCarried)} of loss to carry forward` : ''}.`),
      r.insights.length ? el('div', { class: 'card next-steps' }, [
        el('h3', { style: 'margin-top:0' }, 'What this means, and what to do'),
        el('ul', { class: 'levers' }, r.insights.map((i) => el('li', { class: 'insight-' + i.kind }, i.text))),
      ]) : null,
      quarterSection,
      el('h3', {}, 'Heads of income'),
      el('div', { class: 'table-wrap' }, el('table', { class: 'compare' }, [
        el('thead', {}, el('tr', {}, [el('th', {}, 'Head'), el('th', {}, 'Amount'), el('th', {}, 'Treatment')])),
        el('tbody', {}, rows.map(([l, v, t]) => el('tr', {}, [el('td', {}, l), el('td', { class: v < 0 ? 'neg' : '' }, signed(v)), el('td', { class: 'muted small' }, t)]))),
      ])),
      el('h3', {}, 'Tax'),
      el('div', { class: 'table-wrap' }, el('table', { class: 'compare' }, [
        el('thead', {}, el('tr', {}, [el('th', {}, 'Item'), el('th', {}, 'Taxable'), el('th', {}, 'Tax')])),
        el('tbody', {}, [...taxRows.map(([l, v, t]) => el('tr', {}, [el('td', {}, l), el('td', {}, v === '' ? '' : inr(v)), el('td', {}, inr(t))])), el('tr', { class: 'total' }, [el('td', {}, 'Tax on this year’s trading'), el('td', {}, ''), el('td', {}, inr(r.tax.total))])]),
      ])),
      symbolTable('Short-term exits by scrip', parsed.symbols.shortTerm),
      symbolTable('Long-term exits by scrip', parsed.symbols.longTerm),
      symbolTable('Intraday by scrip', parsed.symbols.intraday),
      el('div', { class: 'btn-row' }, [
        el('button', { type: 'button', class: 'btn', onclick: () => addToTaxComparison(r) }, 'Add these figures to my tax comparison'),
        el('button', { type: 'button', class: 'btn secondary', onclick: () => { parsed = null; try { localStorage.removeItem(STORE); } catch {} status.textContent = 'Removed from this browser.'; render(); } }, 'Remove this statement'),
      ]),
      el('p', { class: 'muted small' }, 'Totals are the broker’s own (Zerodha’s "taxable profit", which applies the 31 January 2018 fair market value where relevant). Dividends, interest and gains at other brokers or fund houses are not in this file. Surcharge, if your total income is above ₹50 lakh, is applied on the Tax comparison tab, not here.'),
      disclaimer('tax'),
    ]);
  }

  function addToTaxComparison(r) {
    const KEY = 'taxcompass.inputs.v1';
    let s; try { s = JSON.parse(localStorage.getItem(KEY) || 'null') || {}; } catch { s = {}; }
    const h = r.heads;
    // the comparison engine applies the exemption and rates itself: hand it the gains after set-off, floored at nil
    s.capitalGains = { ...(s.capitalGains || {}), stcgEquity: Math.round(r.stcgTaxable), ltcgEquity: Math.round(Math.max(0, h.ltcgEquity + Math.min(0, h.stcgEquity))) };
    const business = Math.max(0, h.intraday) + Math.max(0, h.fno) + Math.max(0, h.currency) + Math.max(0, h.commodity);
    if (business > 0) { s.business = { ...(s.business || {}), income: Math.round((+s.business?.income || 0) + business) }; s.hasBusinessIncome = true; }
    if (h.debtSlab > 0) s.otherIncome = { ...(s.otherIncome || {}), other: Math.round((+s.otherIncome?.other || 0) + h.debtSlab) };
    try { localStorage.setItem(KEY, JSON.stringify(s)); } catch {}
    location.href = '/tax';
  }

  render();
  return el('div', { class: 'calc' }, [inputs, out]);
}
