// Writes a sample budget workbook so you can check the Excel formatting without using the site.
// Usage: node tools/make-sample-workbook.mjs [output.xlsx]
// (Charts are only embedded when the workbook is built in the browser; this sample has the tables.)
import { buildWorkbookBase64, summarise } from '../public/js/budget.js';
import ExcelJS from 'exceljs';
import { writeFileSync } from 'node:fs';

const out = process.argv[2] || 'taxcompass-budget-sample.xlsx';
const state = {
  income: 120000,
  person: { name: 'Sample User', email: 'sample@example.com' },
  expenses: [
    { category: 'Rent / housing', note: '2BHK', amount: 30000 },
    { category: 'Groceries & food', amount: 14000 },
    { category: 'Electricity & utilities', amount: 2500 },
    { category: 'Internet & phone', amount: 1200 },
    { category: 'Petrol & transport', amount: 5000 },
    { category: 'Education', note: 'school fees', amount: 8000 },
  ],
  investments: [
    { type: 'sip', name: 'Nifty 50 index fund', amount: 15000, ratePct: 12, years: 10 },
    { type: 'rd', name: 'Post office RD', amount: 5000, ratePct: 6.7, years: 5 },
  ],
};
const b64 = await buildWorkbookBase64(state, summarise(state), null, ExcelJS);
writeFileSync(out, Buffer.from(b64, 'base64'));
console.log(`Wrote ${out}`);
