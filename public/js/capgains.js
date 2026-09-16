/**
 * Capital gains calculator: pure computation (tested) and the UI.
 * Rules and the Cost Inflation Index come from data/capital_gains.json.
 */
import { inr, pct, el, setChildren, disclaimer } from './util.js';
import { calcExportCard } from './calc-export-card.js';

// ---------- dates ----------
const parse = (s) => { const [y, m, d] = String(s).split('-').map(Number); return y && m && d ? Date.UTC(y, m - 1, d) : null; };
export function monthsBetween(a, b) {
  const A = new Date(a), B = new Date(b);
  let m = (B.getUTCFullYear() - A.getUTCFullYear()) * 12 + (B.getUTCMonth() - A.getUTCMonth());
  if (B.getUTCDate() < A.getUTCDate()) m -= 1;
  return m;
}
export function fyOf(t) {
  const d = new Date(t);
  const y = d.getUTCMonth() >= 3 ? d.getUTCFullYear() : d.getUTCFullYear() - 1;
  return `${y}-${String((y + 1) % 100).padStart(2, '0')}`;
}
function ciiFor(fy, data) {
  if (data.cii[fy] != null) return { value: data.cii[fy], fy, fallback: false };
  const keys = Object.keys(data.cii).sort();
  const last = keys[keys.length - 1];
  return fy > last ? { value: data.cii[last], fy: last, fallback: true } : { value: data.cii[keys[0]], fy: keys[0], fallback: false };
}

/**
 * inputs: { asset: 'equity'|'debt_mf'|'property'|'other', buyDate, sellDate, cost, fmv2001 (property bought before 1 Apr 2001),
 *           improvements: [{amount, fy}] (property), sale, expenses, fmv2018 (equity bought before 1 Feb 2018),
 *           resident: bool, slabRate: number (0..0.30), otherEquityLtcgThisYear: number }
 */
export function computeCapitalGains(inputs, data) {
  const buy = parse(inputs.buyDate), sell = parse(inputs.sellDate);
  const notes = [];
  if (!buy || !sell) return { error: 'Enter both dates.' };
  if (sell < buy) return { error: 'The sale date is before the purchase date.' };
  const asset = data.assets[inputs.asset] || data.assets.other;
  const months = monthsBetween(buy, sell);
  const afterCutover = sell >= parse(data.cutover_date);
  const sale = Math.max(0, +inputs.sale || 0);
  const expenses = Math.max(0, +inputs.expenses || 0);
  let cost = Math.max(0, +inputs.cost || 0);
  const improvements = (inputs.improvements || []).filter((i) => +i.amount > 0);
  const impTotal = improvements.reduce((s, i) => s + +i.amount, 0);
  const slab = Math.min(0.30, Math.max(0, +inputs.slabRate || 0));

  // classification: "held for more than N months" is decided on exact dates, not whole months
  const threshold = new Date(buy); threshold.setUTCMonth(threshold.getUTCMonth() + asset.long_term_after_months);
  let longTerm = sell > threshold.getTime();
  let slabAlways = false;
  if (inputs.asset === 'debt_mf' && buy >= parse(asset.slab_if_purchased_on_or_after)) {
    slabAlways = true; longTerm = false;
    notes.push('Debt fund units bought on or after 1 April 2023 are taxed at your slab rate whatever the holding period.');
  }

  // equity grandfathering (31 Jan 2018)
  if (inputs.asset === 'equity' && buy <= parse(asset.grandfather_date) && +inputs.fmv2018 > 0) {
    const gf = Math.max(cost, Math.min(+inputs.fmv2018, sale));
    if (gf !== cost) notes.push(`Cost stepped up to ${inr(gf)} using the 31 January 2018 fair market value (grandfathering).`);
    cost = gf;
  }
  // property bought before the base year: FMV on 1 April 2001 replaces cost
  const baseStart = parse('2001-04-01');
  if (inputs.asset === 'property' && buy < baseStart && +inputs.fmv2001 > 0) {
    cost = +inputs.fmv2001;
    notes.push('For property acquired before 1 April 2001, the fair market value on that date is taken as the cost.');
  }

  const netSale = sale - expenses;
  const gain = netSale - cost - impTotal;
  const lines = [
    { label: 'Sale consideration', amount: sale },
    { label: 'Less: expenses on transfer (brokerage, stamp duty, legal)', amount: -expenses },
    { label: 'Less: cost of acquisition', amount: -cost },
  ];
  if (impTotal) lines.push({ label: 'Less: cost of improvement', amount: -impTotal });
  lines.push({ label: longTerm ? 'Long-term capital gain' : 'Short-term capital gain', amount: gain, subtotal: true });

  const result = {
    asset: inputs.asset, assetLabel: asset.label, months, longTerm, slabAlways, gain, lines, notes,
    classification: slabAlways ? 'Taxed at slab rate' : longTerm ? 'Long-term' : 'Short-term',
    holdingRule: `${asset.long_term_after_months} months`,
    section: afterCutover ? asset.section_2025 : asset.section_1961,
    section1961: asset.section_1961, section2025: asset.section_2025,
  };

  if (gain <= 0) {
    result.taxableGain = 0; result.tax = 0; result.cess = 0; result.total = 0; result.rate = 0; result.rateLabel = '—';
    result.loss = -gain;
    notes.push(longTerm
      ? 'A long-term capital loss can be set off only against long-term capital gains, in this year or carried forward for 8 years if the return is filed on time.'
      : 'A short-term capital loss can be set off against any capital gain, in this year or carried forward for 8 years if the return is filed on time.');
    return result;
  }

  let rate, rateLabel, taxableGain = gain, exemptionUsed = 0, options = null;
  if (slabAlways || !longTerm && inputs.asset !== 'equity') {
    rate = slab; rateLabel = `your slab rate ${pct(slab, 0)}`;
    if (!slab) notes.push('Pick your tax slab on the left; short-term gains on this asset are added to your income.');
  } else if (inputs.asset === 'equity') {
    if (longTerm) {
      const exemption = afterCutover ? asset.ltcg_exemption : asset.ltcg_exemption_before_cutover;
      const remaining = Math.max(0, exemption - Math.max(0, +inputs.otherEquityLtcgThisYear || 0));
      exemptionUsed = Math.min(gain, remaining);
      taxableGain = gain - exemptionUsed;
      rate = afterCutover ? asset.ltcg_rate : asset.ltcg_rate_before_cutover;
      rateLabel = pct(rate, 1);
      lines.push({ label: `Less: exemption for listed equity LTCG (${inr(exemption)} a year${remaining < exemption ? ', partly used' : ''})`, amount: -exemptionUsed });
    } else {
      rate = afterCutover ? asset.stcg_rate : asset.stcg_rate_before_cutover;
      rateLabel = pct(rate, 0);
    }
  } else if (inputs.asset === 'property' && longTerm) {
    const eligible = buy < parse(asset.indexed_option_if_acquired_before) && inputs.resident !== false;
    if (eligible) {
      const cSell = ciiFor(fyOf(sell), data);
      const cBuy = ciiFor(buy < baseStart ? data.base_year : fyOf(buy), data);
      const indexedCost = cost * cSell.value / cBuy.value;
      const indexedImp = improvements.reduce((s, i) => s + (+i.amount) * cSell.value / ciiFor(i.fy || fyOf(buy), data).value, 0);
      const indexedGain = netSale - indexedCost - indexedImp;
      const taxA = gain * asset.ltcg_rate;
      const taxB = Math.max(0, indexedGain) * asset.indexed_option_rate;
      options = {
        plain: { label: '12.5% without indexation', gain, rate: asset.ltcg_rate, tax: taxA },
        indexed: { label: '20% with indexation', gain: indexedGain, rate: asset.indexed_option_rate, tax: taxB, indexedCost: indexedCost + indexedImp, ciiBuy: cBuy, ciiSell: cSell },
        chosen: taxB < taxA ? 'indexed' : 'plain',
      };
      if (cSell.fallback) notes.push(`The Cost Inflation Index for FY ${fyOf(sell)} is not in the data yet; FY ${cSell.fy} (${cSell.value}) has been used. Update data/capital_gains.json when CBDT notifies it.`);
      if (indexedGain < 0 && taxB === 0) notes.push('Indexation produces a loss here, which cannot be set off or carried forward; the tax is simply nil.');
      notes.push('Property acquired before 23 July 2024 by a resident individual or HUF is taxed at the lower of 12.5% without indexation and 20% with indexation. Both are shown; the lower is applied.');
      if (options.chosen === 'indexed') { rate = asset.indexed_option_rate; rateLabel = '20% with indexation'; taxableGain = Math.max(0, indexedGain); }
      else { rate = asset.ltcg_rate; rateLabel = '12.5% without indexation'; }
    } else {
      rate = asset.ltcg_rate; rateLabel = pct(rate, 1);
      if (buy >= parse(asset.indexed_option_if_acquired_before)) notes.push('Property acquired on or after 23 July 2024: 12.5% without indexation, no indexed option.');
      else notes.push('The 20%-with-indexation option is available only to resident individuals and HUFs.');
    }
  } else {
    rate = asset.ltcg_rate; rateLabel = pct(rate, 1);
  }

  const tax = taxableGain * rate;
  const cess = tax * data.cess;
  Object.assign(result, { rate, rateLabel, taxableGain, exemptionUsed, tax, cess, total: Math.round(tax + cess), options, effective: gain > 0 ? (tax + cess) / gain : 0 });
  notes.push('Surcharge, if your total income is above ₹50 lakh, is not included here; the Tax comparison tab applies it.');
  return result;
}

// ---------- UI ----------
const STORE = 'taxcompass.capgains.v1';

export function renderCapitalGains(data) {
  const saved = (() => { try { return JSON.parse(localStorage.getItem(STORE) || 'null') || {}; } catch { return {}; } })();
  const st = {
    asset: 'equity', buyDate: '2020-04-01', sellDate: new Date().toISOString().slice(0, 10), cost: '', sale: '', expenses: '', fmv2018: '', fmv2001: '',
    impAmount: '', impFy: '', resident: true, slabRate: 0.30, otherEquityLtcgThisYear: '', ...saved,
  };
  const save = () => { try { localStorage.setItem(STORE, JSON.stringify(st)); } catch {} };

  const mk = (key, attrs, label, hint) => {
    const input = attrs.tag === 'select'
      ? el('select', {}, attrs.options.map(([v, t]) => el('option', { value: v, selected: String(v) === String(st[key]) }, t)))
      : el('input', {
        type: attrs.type || 'number',
        ...(attrs.type && attrs.type !== 'number' ? {} : { min: 0, step: attrs.step || 1000 }),
        ...(attrs.type === 'date' ? {} : { placeholder: attrs.placeholder || '' }),
        value: st[key] ?? '',
      });
    if (attrs.type === 'checkbox') { input.type = 'checkbox'; input.checked = !!st[key]; input.removeAttribute('value'); }
    input.addEventListener(attrs.tag === 'select' || attrs.type === 'checkbox' || attrs.type === 'date' ? 'change' : 'input', () => {
      st[key] = attrs.type === 'checkbox' ? input.checked : input.value; save(); render();
    });
    const node = attrs.type === 'checkbox' ? el('label', { class: 'check' }, [input, label]) : el('label', {}, [label, hint ? el('small', {}, hint) : null, input]);
    return { node, input };
  };

  const asset = mk('asset', { tag: 'select', options: Object.entries(data.assets).map(([k, v]) => [k, v.label]) }, 'What did you sell?');
  const buyDate = mk('buyDate', { type: 'date' }, 'Purchase date');
  const sellDate = mk('sellDate', { type: 'date' }, 'Sale date');
  const cost = mk('cost', { step: 1000 }, 'Purchase price (₹)', 'total cost including brokerage, stamp duty and registration at purchase');
  const fmv2001 = mk('fmv2001', { step: 1000 }, 'Fair market value on 1 April 2001 (₹)', 'used instead of the purchase price for property bought before April 2001');
  const impAmount = mk('impAmount', { step: 1000 }, 'Cost of improvement (₹)', 'renovation or construction after purchase, optional');
  const impFy = mk('impFy', { type: 'text', step: undefined, placeholder: 'e.g. 2018-19' }, 'Financial year of the improvement');
  const sale = mk('sale', { step: 1000 }, 'Sale price (₹)');
  const expenses = mk('expenses', { step: 100 }, 'Expenses on sale (₹)', 'brokerage, legal fees, transfer charges');
  const fmv2018 = mk('fmv2018', { step: 1000 }, 'Fair market value on 31 January 2018 (₹)', 'for shares or equity funds bought before 1 February 2018 (grandfathering)');
  const resident = mk('resident', { type: 'checkbox' }, 'I am a resident individual or HUF');
  const slab = mk('slabRate', { tag: 'select', options: [[0, 'Not sure / nil'], [0.05, '5%'], [0.10, '10%'], [0.15, '15%'], [0.20, '20%'], [0.25, '25%'], [0.30, '30%']] }, 'Your income tax slab', 'used only where the gain is taxed at slab rate');
  const otherLtcg = mk('otherEquityLtcgThisYear', { step: 1000 }, 'Other listed-equity LTCG already booked this year (₹)', 'the ₹1,25,000 exemption is shared across the year');

  let last = null;
  const exportCard = calcExportCard('capgains', () => last);
  const out = el('div');
  // Build the input panel once; render() only shows or hides the conditional fields, so typing never loses focus.
  const impRow = el('div', { class: 'two' }, [impAmount.node, impFy.node]);
  const inputsCard = el('div', { class: 'card inputs' }, [
    asset.node, el('div', { class: 'two' }, [buyDate.node, sellDate.node]),
    cost.node, fmv2001.node, impRow, sale.node, expenses.node, fmv2018.node, otherLtcg.node, resident.node, slab.node,
  ]);

  function render() {
    const a = st.asset;
    const buyT = parse(st.buyDate);
    const useFmv2001 = a === 'property' && buyT && buyT < parse('2001-04-01');
    cost.node.hidden = useFmv2001;
    fmv2001.node.hidden = !useFmv2001;
    impRow.hidden = a !== 'property';
    fmv2018.node.hidden = !(a === 'equity' && buyT && buyT <= parse(data.assets.equity.grandfather_date));
    otherLtcg.node.hidden = a !== 'equity';
    resident.node.hidden = a !== 'property';
    slab.node.hidden = a === 'equity';

    const r = computeCapitalGains({
      asset: a, buyDate: st.buyDate, sellDate: st.sellDate, cost: st.cost, fmv2001: st.fmv2001, sale: st.sale, expenses: st.expenses,
      fmv2018: st.fmv2018, resident: st.resident, slabRate: +st.slabRate, otherEquityLtcgThisYear: st.otherEquityLtcgThisYear,
      improvements: a === 'property' && +st.impAmount > 0 ? [{ amount: +st.impAmount, fy: st.impFy && /^\d{4}-\d{2}$/.test(st.impFy) ? st.impFy : null }] : [],
    }, data);

    if (r.error) { setChildren(out, [el('div', { class: 'notice' }, r.error)]); return; }
    last = { st: { ...st }, r };
    const stat = (k, v, cls = '') => el('div', { class: 'stat ' + cls }, [el('div', { class: 'k' }, k), el('div', { class: 'v' }, v)]);
    const rows = r.lines.map((l) => el('tr', { class: l.subtotal ? 'subtotal' : '' }, [el('td', {}, l.label), el('td', { class: l.amount < 0 ? 'neg' : '' }, inr(l.amount))]));
    if (r.gain > 0) {
      if (r.exemptionUsed) rows.push(el('tr', {}, [el('td', {}, 'Taxable gain'), el('td', {}, inr(r.taxableGain))]));
      rows.push(el('tr', {}, [el('td', {}, `Tax at ${r.rateLabel}`), el('td', {}, inr(r.tax))]));
      rows.push(el('tr', {}, [el('td', {}, 'Health and education cess (4%)'), el('td', {}, inr(r.cess))]));
      rows.push(el('tr', { class: 'total' }, [el('td', {}, 'Tax on this sale'), el('td', {}, inr(r.total))]));
    }
    setChildren(out, [
      el('div', { class: 'stats' }, [
        stat('Holding period', `${Math.floor(r.months / 12)} yr ${r.months % 12} mo`),
        stat('Treatment', r.classification),
        stat(r.gain >= 0 ? 'Gain' : 'Loss', inr(Math.abs(r.gain)), r.gain < 0 ? 'bad' : ''),
        stat('Tax payable', inr(r.total), 'hi'),
      ]),
      el('p', { class: 'explain' }, r.gain <= 0
        ? `This is a ${r.longTerm ? 'long-term' : 'short-term'} capital loss of ${inr(-r.gain)}; no tax is due on it.`
        : `Held ${r.months} months against a ${r.holdingRule} threshold, so this is a ${r.classification.toLowerCase()} gain taxed at ${r.rateLabel}. Effective tax ${pct(r.effective, 1)} of the gain. Section ${r.section1961} of the 1961 Act, ${r.section2025} of the 2025 Act.`),
      el('div', { class: 'table-wrap' }, el('table', { class: 'compare' }, [el('thead', {}, el('tr', {}, [el('th', {}, 'Computation'), el('th', {}, 'Amount')])), el('tbody', {}, rows)])),
      r.options ? el('div', {}, [
        el('h3', {}, 'Your two options, and which one applies'),
        el('div', { class: 'table-wrap' }, el('table', { class: 'compare compare-scen' }, [
          el('thead', {}, el('tr', {}, [el('th', {}, ''), el('th', { class: r.options.chosen === 'plain' ? 'on' : '' }, r.options.plain.label), el('th', { class: r.options.chosen === 'indexed' ? 'on' : '' }, r.options.indexed.label)])),
          el('tbody', {}, [
            el('tr', {}, [el('td', {}, 'Cost considered'), el('td', { class: r.options.chosen === 'plain' ? 'on' : '' }, inr(r.lines.find((l) => l.label.startsWith('Less: cost of acq')).amount * -1 + (r.lines.find((l) => l.label.startsWith('Less: cost of imp'))?.amount || 0) * -1)), el('td', { class: r.options.chosen === 'indexed' ? 'on' : '' }, inr(r.options.indexed.indexedCost))]),
            el('tr', {}, [el('td', {}, 'Gain'), el('td', { class: r.options.chosen === 'plain' ? 'on' : '' }, inr(r.options.plain.gain)), el('td', { class: r.options.chosen === 'indexed' ? 'on' : '' }, inr(r.options.indexed.gain))]),
            el('tr', { class: 'total' }, [el('td', {}, 'Tax before cess'), el('td', { class: r.options.chosen === 'plain' ? 'on' : '' }, inr(r.options.plain.tax)), el('td', { class: r.options.chosen === 'indexed' ? 'on' : '' }, inr(r.options.indexed.tax))]),
          ]),
        ])),
        el('p', { class: 'muted small' }, `Indexation: cost × CII of FY ${r.options.indexed.ciiSell.fy} (${r.options.indexed.ciiSell.value}) ÷ CII of FY ${r.options.indexed.ciiBuy.fy} (${r.options.indexed.ciiBuy.value}).`),
      ]) : null,
      r.notes.length ? el('ul', { class: 'notes' }, r.notes.map((n) => el('li', {}, n))) : null,
      r.gain > 0 ? el('div', { class: 'btn-row' }, [el('button', { type: 'button', class: 'btn secondary', onclick: () => addToTaxComparison(r) }, 'Add this gain to my tax comparison')]) : null,
      disclaimer('tax'),
    ]);
  }
  render();
  return el('div', { class: 'calc' }, [inputsCard, el('div', {}, [out, exportCard])]);
}

/** Push the gain into the saved tax-comparison inputs and open that page. */
function addToTaxComparison(r) {
  const KEY = 'taxcompass.inputs.v1';
  let s; try { s = JSON.parse(localStorage.getItem(KEY) || 'null') || {}; } catch { s = {}; }
  s.capitalGains = s.capitalGains || {}; s.otherIncome = s.otherIncome || {};
  const add = (obj, k, v) => { obj[k] = (+obj[k] || 0) + Math.round(v); };
  if (r.asset === 'equity' && r.longTerm) add(s.capitalGains, 'ltcgEquity', r.gain);
  else if (r.asset === 'equity') add(s.capitalGains, 'stcgEquity', r.gain);
  else if (r.longTerm && !r.slabAlways) add(s.capitalGains, 'ltcgOther', r.taxableGain);
  else add(s.otherIncome, 'other', r.gain); // slab-rate gains are taxed like other income
  try { localStorage.setItem(KEY, JSON.stringify(s)); } catch {}
  location.href = '/tax';
}
