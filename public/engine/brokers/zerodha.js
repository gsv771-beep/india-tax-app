/**
 * Zerodha Console "Tax P&L" workbook -> plain trades and totals. Pure: takes sheets as arrays of
 * rows (each row an array of cell values, column A first) and never returns the client name,
 * client ID or PAN that the workbook carries on every sheet.
 *
 * Layout (as exported in 2025-26):
 *   Sheet "Tradewise Exits from YYYY-MM-DD": section titles ("Equity - Intraday", "Equity - Short Term",
 *     "Equity - Long Term", "Equity - Buyback", "Mutual Funds", "F&O", "Currency", "Commodity"), each
 *     followed by a header row (Symbol, ISIN, Entry Date, Exit Date, Quantity, Buy Value, Sell Value,
 *     Profit, Period of Holding, Fair Market Value, Taxable Profit, Turnover, Brokerage, ... STT).
 *   Sheet "Equity and Non Equity": "Equity Intraday/Speculative profit", "Equity Short Term profit",
 *     "Equity Long Term profit" totals and a charges ledger.
 *   Sheet "F&O": "Options Realized Profit", "Futures Realized Profit", turnovers.
 *   Sheet "Mutual Funds": realized profit breakdown when there are redemptions.
 */

const SECTION_KEYS = {
  'Equity - Intraday': 'equityIntraday', 'Equity - Short Term': 'equityShortTerm', 'Equity - Long Term': 'equityLongTerm', 'Equity - Buyback': 'equityBuyback',
  'Mutual Funds': 'mutualFunds', 'F&O': 'fno', 'Currency': 'currency', 'Commodity': 'commodity',
};
const num = (v) => (v == null || v === '' ? 0 : Number.isFinite(+v) ? +v : 0);
const str = (v) => (v == null ? '' : typeof v === 'object' ? (v.text ?? v.result ?? '') : String(v)).trim();
const cells = (row) => (Array.isArray(row) ? row : []).map((c) => (c && typeof c === 'object' && !(c instanceof Date) ? (c.result ?? c.text ?? c.richText?.map((t) => t.text).join('') ?? '') : c));
const firstText = (row) => { const c = cells(row).filter((v) => v != null && v !== ''); return c.length === 1 && typeof c[0] === 'string' ? c[0].trim() : null; };

/** Is this a Zerodha Tax P&L workbook? Returns the period if so. */
export function detectZerodha(sheets) {
  const name = Object.keys(sheets).find((n) => /^Tradewise Exits/i.test(n));
  if (!name) return null;
  for (const row of sheets[name].slice(0, 20)) {
    const t = firstText(row);
    const m = t && t.match(/Tradewise Exits from (\d{4}-\d{2}-\d{2}) to (\d{4}-\d{2}-\d{2})/);
    if (m) return { broker: 'zerodha', from: m[1], to: m[2], sheet: name };
  }
  return { broker: 'zerodha', from: null, to: null, sheet: name };
}

function toDate(v) {
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  const s = str(v);
  return /^\d{4}-\d{2}-\d{2}/.test(s) ? s.slice(0, 10) : s;
}

/** Every exit in the tradewise sheet, grouped by section. */
export function parseTradewise(rows) {
  const out = {};
  let section = null, header = null;
  for (const raw of rows) {
    const row = cells(raw);
    const title = firstText(row);
    if (title && SECTION_KEYS[title]) { section = SECTION_KEYS[title]; header = null; out[section] = out[section] || []; continue; }
    if (!section) continue;
    const idx = row.findIndex((v) => str(v) === 'Symbol');
    if (idx >= 0) { header = { start: idx, cols: row.slice(idx).map((v) => str(v)) }; continue; }
    if (!header) continue;
    const vals = row.slice(header.start);
    if (!str(vals[0])) continue;
    const get = (name) => vals[header.cols.indexOf(name)];
    const chargeCols = ['Brokerage', 'Exchange Transaction Charges', 'IPFT', 'SEBI Charges', 'CGST', 'SGST', 'IGST', 'Stamp Duty', 'Clearing Charges'];
    out[section].push({
      symbol: str(get('Symbol')), isin: str(get('ISIN')), entryDate: toDate(get('Entry Date')), exitDate: toDate(get('Exit Date')),
      quantity: num(get('Quantity')), buyValue: num(get('Buy Value')), sellValue: num(get('Sell Value')), profit: num(get('Profit')),
      holdingDays: num(get('Period of Holding')), fmv: num(get('Fair Market Value')), taxableProfit: num(get('Taxable Profit')), turnover: num(get('Turnover')),
      stt: num(get('STT')), otherCharges: chargeCols.reduce((s, c) => s + num(get(c)), 0),
    });
  }
  return out;
}

/** "Label", value pairs from a summary sheet (Equity and Non Equity, F&O, Mutual Funds). */
export function parseSummary(rows) {
  const out = {};
  for (const raw of rows) {
    const row = cells(raw).filter((v) => v !== null && v !== undefined && v !== '');
    if (row.length === 2 && typeof row[0] === 'string' && typeof row[1] === 'number') out[row[0].trim()] = row[1];
  }
  return out;
}

/**
 * The whole workbook -> { broker, period, trades, totals, charges, symbols }.
 * `sheets` is { sheetName: rows[] }. Nothing identifying is returned.
 */
export function parseZerodhaTaxPnl(sheets) {
  const det = detectZerodha(sheets);
  if (!det) throw new Error('This does not look like a Zerodha Tax P&L workbook (no "Tradewise Exits" sheet).');
  const trades = parseTradewise(sheets[det.sheet]);
  const eq = parseSummary(sheets['Equity and Non Equity'] || []);
  const fno = parseSummary(sheets['F&O'] || []);
  const mf = parseSummary(sheets['Mutual Funds'] || []);
  const sum = (arr, f) => (arr || []).reduce((s, t) => s + f(t), 0);

  const totals = {
    equityIntraday: eq['Equity Intraday/Speculative profit'] ?? sum(trades.equityIntraday, (t) => t.taxableProfit),
    equityShortTerm: eq['Equity Short Term profit'] ?? sum(trades.equityShortTerm, (t) => t.taxableProfit),
    equityLongTerm: eq['Equity Long Term profit'] ?? sum(trades.equityLongTerm, (t) => t.taxableProfit),
    equityBuyback: sum(trades.equityBuyback, (t) => t.sellValue),
    fnoOptions: fno['Options Realized Profit'] ?? 0,
    fnoFutures: fno['Futures Realized Profit'] ?? 0,
    fnoTurnover: (fno['Options Turnover'] ?? 0) + (fno['Futures Turnover'] ?? 0),
    intradayTurnover: eq['Intraday/Speculative turnover'] ?? sum(trades.equityIntraday, (t) => t.turnover),
    mfEquityShortTerm: mf['Equity Short Term profit'] ?? 0, mfEquityLongTerm: mf['Equity Long Term profit'] ?? 0,
    mfDebtShortTerm: mf['Debt Short Term profit'] ?? 0, mfDebtLongTerm: mf['Debt Long Term profit'] ?? 0,
    currency: (trades.currency || []).reduce((s, t) => s + t.profit, 0),
    commodity: (trades.commodity || []).reduce((s, t) => s + t.profit, 0),
  };
  // Mutual fund redemptions listed tradewise but not summarised: classify by holding period, treat as equity funds and say so.
  const mfTrades = trades.mutualFunds || [];
  const mfSummarised = ['Equity Short Term profit', 'Equity Long Term profit', 'Debt Short Term profit', 'Debt Long Term profit'].some((k) => k in mf);
  if (!mfSummarised && mfTrades.length) {
    totals.mfEquityShortTerm = sum(mfTrades.filter((t) => t.holdingDays <= 365), (t) => t.taxableProfit);
    totals.mfEquityLongTerm = sum(mfTrades.filter((t) => t.holdingDays > 365), (t) => t.taxableProfit);
    totals.mfAssumedEquity = true;
  }
  const charges = {
    stt: sum([].concat(...Object.values(trades)), (t) => t.stt),
    other: sum([].concat(...Object.values(trades)), (t) => t.otherCharges),
    equityStcgOther: sum(trades.equityShortTerm, (t) => t.otherCharges),
    equityLtcgOther: sum(trades.equityLongTerm, (t) => t.otherCharges),
  };
  const bySymbol = (arr) => {
    const m = new Map();
    for (const t of arr || []) { const cur = m.get(t.symbol) || { symbol: t.symbol, quantity: 0, buyValue: 0, sellValue: 0, profit: 0, trades: 0 }; cur.quantity += t.quantity; cur.buyValue += t.buyValue; cur.sellValue += t.sellValue; cur.profit += t.taxableProfit; cur.trades++; m.set(t.symbol, cur); }
    return [...m.values()].sort((a, b) => a.profit - b.profit);
  };
  return {
    broker: 'zerodha', period: { from: det.from, to: det.to },
    counts: Object.fromEntries(Object.entries(trades).map(([k, v]) => [k, v.length])),
    totals, charges,
    symbols: { shortTerm: bySymbol(trades.equityShortTerm), longTerm: bySymbol(trades.equityLongTerm), intraday: bySymbol(trades.equityIntraday) },
    grandfathered: (trades.equityLongTerm || []).filter((t) => t.fmv > 0).length,
  };
}
