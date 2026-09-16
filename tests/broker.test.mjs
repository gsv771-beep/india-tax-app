// Zerodha Tax P&L parsing and the trading-tax layer, against a synthetic workbook in Zerodha's layout.
// Run: node tests/broker.test.mjs
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { parseZerodhaTaxPnl, detectZerodha, parseTradewise, fyQuarter } from '../public/engine/brokers/zerodha.js';
import { tradingTax, quarterlyTax } from '../public/engine/trading-tax.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const rates = JSON.parse(readFileSync(path.join(here, '../public/data/tax_rates.json'), 'utf8'));
let failures = 0;
const ok = (name, cond, detail = '') => { console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${detail ? ' (' + detail + ')' : ''}`); if (!cond) failures++; };
const near = (name, a, e, tol = 1) => ok(name, Math.abs(a - e) <= tol, `got ${a}, expected ${e}`);

// ---- a workbook in Zerodha's shape (column A empty, data from column B), invented figures ----
const HEADER = [null, 'Symbol', 'ISIN', 'Entry Date', 'Exit Date', 'Quantity', 'Buy Value', 'Sell Value', 'Profit', 'Period of Holding', 'Fair Market Value', 'Taxable Profit', 'Turnover', 'Brokerage', 'Exchange Transaction Charges', 'IPFT', 'SEBI Charges', 'CGST', 'SGST', 'IGST', 'Stamp Duty', 'STT'];
const trade = (sym, entry, exit, qty, buy, sell, days, fmv = 0, taxable = null) => [null, sym, 'INE000000000', entry, exit, qty, buy, sell, sell - buy, days, fmv, taxable ?? sell - buy, Math.abs(sell - buy), 20, 3, 0.1, 0.1, 0, 0, 5, 1, 10];
const tradewise = [
  [null, 'Client ID', 'ZZ0000'], [null, 'Client Name', 'TEST PERSON'], [null, 'PAN', 'ABCDE1234F'],
  [null, 'Tradewise Exits from 2025-04-01 to 2026-03-15'],
  [null, 'Equity - Intraday'], HEADER,
  trade('AAA', '2025-06-05', '2025-06-05', 10, 1000, 900, 0),
  trade('BBB', '2025-06-06', '2025-06-06', 10, 1000, 1200, 0),
  [null, 'Equity - Short Term'], HEADER,
  trade('CCC', '2025-01-10', '2025-08-10', 100, 100000, 80000, 212),
  trade('DDD', '2025-02-10', '2025-09-10', 50, 50000, 60000, 212),
  [null, 'Equity - Long Term'], HEADER,
  trade('EEE', '2017-01-01', '2025-10-01', 100, 100000, 400000, 3195, 250000, 150000),  // grandfathered: taxable uses FMV
  trade('FFF', '2022-01-01', '2025-11-01', 100, 100000, 130000, 1400),
  [null, 'Equity - Buyback'], HEADER,
  [null, 'Mutual Funds'], HEADER,
  trade('GGG-FUND', '2023-01-01', '2025-12-01', 1000, 50000, 65000, 1065),
  [null, 'F&O'], HEADER,
  trade('NIFTY26FEB25550PE', '2026-02-01', '2026-02-05', 65, 5000, 8000, 4),
  [null, 'Currency'], HEADER,
  [null, 'Commodity'], HEADER,
];
const equitySheet = [
  [null, 'Client ID', 'ZZ0000'], [null, 'PAN', 'ABCDE1234F'],
  [null, 'Realized Profit Breakdown'],
  [null, 'Equity Intraday/Speculative profit', 100],
  [null, 'Equity Short Term profit', -10000],
  [null, 'Equity Long Term profit', 180000],
  [null, 'Turnover Breakdown'], [null, 'Intraday/Speculative turnover', 300],
  [null, 'Charges'], [null, 'Account Head', 'Amount'], [null, 'Securities Transaction Tax - Z', 70], [null, 'Brokerage - Z', 140],
];
const fnoSheet = [[null, 'Options Realized Profit', 3000], [null, 'Futures Realized Profit', 0], [null, 'Options Turnover', 3000], [null, 'Futures Turnover', 0]];
const sheets = { 'Tradewise Exits from 2025-04-01': tradewise, 'Equity and Non Equity': equitySheet, 'F&O': fnoSheet, 'Mutual Funds': [[null, 'Realized Profit Breakdown']] };

// ---- parsing ----
{
  const d = detectZerodha(sheets);
  ok('detects the workbook and its period', d && d.broker === 'zerodha' && d.from === '2025-04-01' && d.to === '2026-03-15');
  ok('rejects a workbook without the tradewise sheet', detectZerodha({ Other: [] }) === null);
  const tw = parseTradewise(tradewise);
  ok('reads every section', Object.keys(tw).length === 8 && tw.equityShortTerm.length === 2 && tw.equityLongTerm.length === 2 && tw.fno.length === 1);
  ok('maps columns by header name', tw.equityShortTerm[0].symbol === 'CCC' && tw.equityShortTerm[0].buyValue === 100000 && tw.equityShortTerm[0].holdingDays === 212 && tw.equityShortTerm[0].stt === 10);
  near('sums non-STT charges per trade', tw.equityShortTerm[0].otherCharges, 20 + 3 + 0.1 + 0.1 + 5 + 1, 0.01);
  const p = parseZerodhaTaxPnl(sheets);
  ok('nothing identifying survives parsing', !JSON.stringify(p).match(/ZZ0000|TEST PERSON|ABCDE1234F/));
  near('short-term total from the summary sheet', p.totals.equityShortTerm, -10000);
  near('long-term total from the summary sheet', p.totals.equityLongTerm, 180000);
  near('intraday total from the summary sheet', p.totals.equityIntraday, 100);
  near('F&O total', p.totals.fnoOptions + p.totals.fnoFutures, 3000);
  ok('grandfathered exits counted', p.grandfathered === 1);
  ok('mutual fund redemption classified by holding period and flagged', p.totals.mfEquityLongTerm === 15000 && p.totals.mfAssumedEquity === true);
  ok('per-symbol short-term list sorted worst first', p.symbols.shortTerm[0].symbol === 'CCC' && p.symbols.shortTerm[0].profit === -20000);
  // summary sheet missing: totals fall back to the tradewise sums
  const p2 = parseZerodhaTaxPnl({ 'Tradewise Exits from 2025-04-01': tradewise });
  near('fallback: short-term from trades', p2.totals.equityShortTerm, -10000);
  near('fallback: long-term from trades uses taxable profit (grandfathered)', p2.totals.equityLongTerm, 150000 + 30000);
}

// ---- tax ----
{
  const p = parseZerodhaTaxPnl(sheets);
  const r = tradingTax(p, rates, { slabRate: 0.3 });
  // STCG -10,000 (shares) ; LTCG 180,000 (shares) + 15,000 (fund) = 195,000 ; STCL absorbed by LTCG -> 185,000 ; exemption 125,000 -> taxable 60,000
  near('STCG head', r.heads.stcgEquity, -10000);
  near('LTCG head', r.heads.ltcgEquity, 195000);
  near('short-term loss set off against long-term gain', r.setOff.stclAgainstLtcg, 10000);
  near('LTCG taxable after exemption', r.ltcgTaxable, 60000);
  near('LTCG tax at 12.5%', r.tax.ltcg, 7500);
  near('no STCG tax after set-off', r.tax.stcg, 0);
  near('business income at slab: intraday 100 + F&O 3000', r.tax.business, 3100 * 0.3, 0.01);
  near('total with cess', r.tax.total, Math.round((7500 + 930) * 1.04));
  ok('insight: set-off explained', r.insights.some((i) => /set against long-term/.test(i.text)));
  ok('insight: business income warning', r.insights.some((i) => /ITR-3/.test(i.text)));
  ok('insight: mutual fund assumption flagged', r.insights.some((i) => i.kind === 'warn'));
  const rd = tradingTax(p, rates, { slabRate: 0.3, deductCharges: true });
  ok('deducting charges lowers the gains', rd.heads.ltcgEquity < r.heads.ltcgEquity && rd.heads.stcgEquity < r.heads.stcgEquity);
  const lossYear = tradingTax({ ...p, totals: { ...p.totals, equityLongTerm: -50000, equityShortTerm: -30000, mfEquityLongTerm: 0 } }, rates, { slabRate: 0.3 });
  ok('a loss year carries both losses forward with the right rules', lossYear.stclCarried === 30000 && lossYear.ltclCarried === 50000 && lossYear.insights.some((i) => /eight years/.test(i.text)));
  const exUsed = tradingTax(p, rates, { slabRate: 0.3, otherEquityLtcgThisYear: 125000 });
  near('exemption already used elsewhere: full LTCG taxed', exUsed.ltcgTaxable, 185000);
}

// ---- quarters and advance tax ----
{
  ok('fyQuarter: April is Q1, June Q1, July Q2, December Q3, January Q4, March Q4', [fyQuarter('2025-04-01'), fyQuarter('2025-06-30'), fyQuarter('2025-07-01'), fyQuarter('2025-12-31'), fyQuarter('2026-01-01'), fyQuarter('2026-03-31')].join() === '1,1,2,3,4,4');
  const p = parseZerodhaTaxPnl(sheets);
  ok('four quarters with labels and due dates', p.quarters.length === 4 && p.quarters[0].label === 'Apr–Jun 2025' && p.quarters[3].dueDate === '2026-03-15');
  // fixture: intraday exits in June (Q1: -100 + 200 = 100); short-term exits Aug and Sep (Q2: -20000 + 10000); long-term Oct and Nov (Q3: 150000 + 30000); fund Dec (Q3: 15000); F&O Feb (Q4: 3000)
  near('Q1 intraday', p.quarters[0].totals.equityIntraday, 100);
  near('Q2 short-term', p.quarters[1].totals.equityShortTerm, -10000);
  near('Q3 long-term incl. the grandfathered exit', p.quarters[2].totals.equityLongTerm, 180000);
  near('Q3 fund redemption, long-term', p.quarters[2].totals.mfEquityLongTerm, 15000);
  near('Q4 F&O', p.quarters[3].totals.fno, 3000);
  ok('quarters add up to the year', Math.abs(p.quarters.reduce((s, q) => s + q.totals.equityShortTerm, 0) - (-10000)) < 0.01);
  const qt = quarterlyTax(p, rates, { slabRate: 0.3 });
  ok('four schedule rows', qt.rows.length === 4);
  near('Q1: tax so far is on 100 of intraday at slab + cess', qt.rows[0].cumulative.taxSoFar, Math.round(100 * 0.3 * 1.04));
  near('Q2: short-term loss, nothing more to pay', qt.rows[1].instalment, 0);
  ok('Q3: long-term gains after set-off and exemption bring the first real instalment', qt.rows[2].instalment > 7000 && qt.rows[2].cumulative.taxSoFar === Math.round((60000 * 0.125 + 30) * 1.04));
  near('Q4: F&O adds its slab tax as the last instalment', qt.rows[3].instalment, qt.rows[3].cumulative.taxSoFar - qt.rows[2].cumulative.taxSoFar);
  ok('instalments sum to the year’s tax', Math.abs(qt.rows.reduce((s, r) => s + r.instalment, 0) - qt.rows[3].cumulative.taxSoFar) < 1);
  // a big loss in Q4 makes earlier tax refundable, never a negative instalment
  const lossLate = parseZerodhaTaxPnl(sheets);
  lossLate.quarters[3].totals.equityLongTerm = -500000;
  const q2 = quarterlyTax(lossLate, rates, { slabRate: 0.3 });
  ok('a later loss shows a refundable amount and no negative instalment', q2.rows[3].instalment === 0 && q2.rows[3].refundable > 0);
}

console.log(failures === 0 ? '\nAll broker tests passed.' : `\n${failures} broker test(s) FAILED.`);
process.exit(failures === 0 ? 0 : 1);
