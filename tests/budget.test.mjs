// Budget calculator maths and the email function's guard paths. No network calls.
// Run: node tests/budget.test.mjs

import { rdFV, summarise, workbookRows, CATEGORIES, defaultState, buildWorkbookBase64 } from '../public/js/budget.js';
import { onRequestPost, onRequestGet } from '../functions/api/send-workbook.js';
import ExcelJS from 'exceljs';

let failures = 0;
const near = (name, actual, expected, tol = 1) => { const ok = Math.abs(actual - expected) <= tol; console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}: got ${Math.round(actual)}, expected ${expected}`); if (!ok) failures++; };
const ok = (name, cond, detail = '') => { console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${detail ? ' (' + detail + ')' : ''}`); if (!cond) failures++; };

// Recurring deposit: Rs 1,000 a month at 6.7% for 5 years matures at about Rs 71,369 (post office RD table)
near('RD 1000/month 6.7% 5y', rdFV(1000, 6.7, 5).fv, 71369, 400);
near('RD invested', rdFV(1000, 6.7, 5).invested, 60000, 0.01);
near('RD zero rate', rdFV(1000, 0, 5).fv, 60000, 0.01);

ok('11 categories with Others last', CATEGORIES.length === 11 && CATEGORIES[10] === 'Others');

{
  const s = summarise({
    income: 100000,
    expenses: [
      { category: 'Rent / housing', amount: 25000 }, { category: 'Groceries & food', amount: 12000 }, { category: 'Rent / housing', amount: 3000 },
      { category: 'Made up', amount: 2000 }, { category: 'Petrol & transport', amount: '' },
    ],
    investments: [{ type: 'sip', name: 'A', amount: 10000, ratePct: 12, years: 10 }, { type: 'rd', name: 'B', amount: 5000, ratePct: 6.7, years: 5 }, { type: 'sip', amount: 0 }],
    person: {},
  });
  near('total expenses', s.totalExpenses, 42000, 0.01);
  near('total investments', s.totalInvestments, 15000, 0.01);
  near('surplus', s.surplus, 43000, 0.01);
  near('savings rate', s.savingsRate * 100, 58, 0.01);
  ok('categories merged and sorted', s.categories[0].category === 'Rent / housing' && s.categories[0].amount === 28000);
  ok('unknown category folds into Others', s.categories.find((c) => c.category === 'Others')?.amount === 2000);
  ok('empty amounts ignored', !s.categories.find((c) => c.category === 'Petrol & transport'));
  ok('investments projected', s.investments.length === 2 && s.investments[0].fv > 2300000 && s.investments[1].fv > 350000, `${Math.round(s.investments[0].fv)}, ${Math.round(s.investments[1].fv)}`);
  ok('not a deficit', s.deficit === false);
  const rows = workbookRows({ expenses: [], investments: [], person: { name: 'Test' } }, s);
  ok('workbook has four sheets of rows', rows.summary.length > 10 && rows.expenses.length === 1 && rows.investments.length === 3 && rows.notes.length === 5);
}
{
  const s = summarise({ income: 50000, expenses: [{ category: 'Rent / housing', amount: 40000 }], investments: [{ type: 'sip', amount: 20000, ratePct: 12, years: 5 }] });
  ok('deficit detected', s.deficit && s.surplus === -10000);
  near('savings rate counts investments only when in deficit', s.savingsRate * 100, 40, 0.01);
}
ok('default state has starter rows', defaultState().expenses.length === 5 && defaultState().investments.length === 1);

// Styled workbook: build it with the Node build of ExcelJS, read it back, check structure and formatting
{
  const state = {
    income: 100000, person: { name: 'Asha Rao', email: 'a@b.co' },
    expenses: [{ category: 'Rent / housing', note: 'flat', amount: 30000 }, { category: 'Groceries & food', amount: 12000 }],
    investments: [{ type: 'sip', name: 'Index fund', amount: 10000, ratePct: 12, years: 10 }, { type: 'rd', name: 'PO RD', amount: 5000, ratePct: 6.7, years: 5 }],
  };
  const s = summarise(state);
  const b64 = await buildWorkbookBase64(state, s, null, ExcelJS);
  ok('workbook base64 is non-trivial', b64.length > 5000, String(b64.length));
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(Buffer.from(b64, 'base64'));
  ok('four sheets in order', wb.worksheets.map((w) => w.name).join() === 'Summary,Expenses,Investments,Notes', wb.worksheets.map((w) => w.name).join());
  const sum = wb.getWorksheet('Summary');
  ok('summary title is bold green', sum.getCell('A1').font?.bold === true && sum.getCell('A1').font?.color?.argb === 'FF14532D');
  ok('summary header row has green fill and white text', sum.getCell('A4').fill?.fgColor?.argb === 'FF14532D' && sum.getCell('A4').font?.color?.argb === 'FFFFFFFF');
  ok('income cell uses rupee format', /₹/.test(sum.getCell('B5').numFmt || ''), sum.getCell('B5').numFmt);
  ok('share cell uses percent format', sum.getCell('D6').numFmt === '0.0%');
  ok('income value correct', sum.getCell('B5').value === 100000);
  ok('left-over row highlighted green', sum.getCell('A8').fill?.fgColor?.argb === 'FFE3F1E8');
  const exp = wb.getWorksheet('Expenses');
  ok('expenses header frozen', exp.views?.[0]?.state === 'frozen' && exp.views[0].ySplit === 1);
  ok('expenses total row present', exp.getCell('A4').value === 'Total' && exp.getCell('C4').value === 42000);
  const inv = wb.getWorksheet('Investments');
  ok('investment rate stored as fraction with percent format', inv.getCell('D2').value === 0.12 && inv.getCell('D2').numFmt === '0.0%');
  ok('investment projected value is a rounded number', Number.isInteger(inv.getCell('G2').value) && inv.getCell('G2').value > 2300000);
}

// email function guard paths
{
  const post = (body, env = {}) => onRequestPost({ request: new Request('http://x/api/send-workbook', { method: 'POST', body: JSON.stringify(body) }), env });
  let r = await post({ name: 'A', email: 'a@b.co', filename: 'x.xlsx', xlsxBase64: 'QUJD' });
  ok('unconfigured -> 503', r.status === 503);
  const env = { BREVO_API_KEY: 'k', MAIL_FROM_EMAIL: 'x@y.com' };
  r = await post({ name: '', email: 'a@b.co', xlsxBase64: 'QUJD' }, env); ok('missing name -> 400', r.status === 400);
  r = await post({ name: 'A', email: 'nope', xlsxBase64: 'QUJD' }, env); ok('bad email -> 400', r.status === 400);
  r = await post({ name: 'A', email: 'a@b.co', xlsxBase64: '' }, env); ok('missing data -> 400', r.status === 400);
  r = await post({ name: 'A', email: 'a@b.co', filename: 'x.exe', xlsxBase64: 'QUJD' }, env); ok('non-xlsx name -> 400', r.status === 400);
  r = await post({ name: 'A', email: 'a@b.co', filename: 'x.xlsx', xlsxBase64: 'Q'.repeat(1_600_000) }, env); ok('oversize -> 413', r.status === 413);
  ok('GET -> 405', onRequestGet().status === 405);
}

console.log(failures === 0 ? '\nAll budget tests passed.' : `\n${failures} test(s) FAILED.`);
process.exit(failures === 0 ? 0 : 1);
