// Break-even, headroom and what-if on the tax engine, plus the tax workbook build.
// Run: node tests/tax-insights.test.mjs

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import ExcelJS from 'exceljs';
import { compareRegimes, DEFAULT_FLAGS } from '../public/js/tax-engine.js';
import { breakEven, headroom, whatIf, breakEvenCurve, taxDrivers, claimedOldRegime } from '../public/js/tax-insights.js';
import { buildTaxWorkbookBase64 } from '../public/js/tax-export.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const rates = JSON.parse(readFileSync(path.join(here, '../public/data/tax_rates.json'), 'utf8'));

let failures = 0;
const ok = (name, cond, detail = '') => { console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${detail ? ' (' + detail + ')' : ''}`); if (!cond) failures++; };
const near = (name, a, e, tol = 1) => ok(name, Math.abs(a - e) <= tol, `got ${Math.round(a)}, expected ${e}`);

// 15L salary, no deductions: new wins. Break-even says how much old-regime deductions are needed.
{
  const inputs = { salary: { gross: 1500000 } };
  const be = breakEven(inputs, rates);
  ok('15L no deductions: kind need', be.kind === 'need', be.kind);
  ok('extra is a positive rupee amount', be.extra > 100000 && be.extra < 1000000, String(be.extra));
  // verify: applying that much extra makes old <= new, and one rupee less does not
  const oi = be.cmp.old.income;
  const { computeTax } = await import('../public/js/tax-engine.js');
  const at = (d) => computeTax({ ...oi, slabIncome: oi.slabIncome - d }, rates, DEFAULT_FLAGS).total;
  ok('break-even amount flips the comparison', at(be.extra) <= be.cmp.new.tax.total && at(be.extra - 1) > be.cmp.new.tax.total, `${at(be.extra)} vs ${be.cmp.new.tax.total}`);
}

// Heavy old-regime deductions: old wins with a cushion.
{
  const inputs = { salary: { gross: 1800000, basicDa: 900000, hraReceived: 300000, rentPaid: 360000, city: 'Mumbai' }, deductions: { s80c: 150000, nps1b: 50000, healthSelf: 25000 }, houseProperty: { selfOccupiedInterest: 200000 } };
  const cmp = compareRegimes(inputs, rates);
  ok('heavy deductions: old wins', cmp.better === 'old');
  const be = breakEven(inputs, rates);
  ok('kind is cushion or always', be.kind === 'cushion' || be.kind === 'always', be.kind);
  if (be.kind === 'cushion') ok('cushion is less than claimed', be.cushion > 0 && be.cushion < be.claimed, `${be.cushion} of ${be.claimed}`);
}

// Self-occupied home-loan interest is one deduction, counted once in what the old regime claims
{
  const base = { salary: { gross: 1800000, basicDa: 720000 }, deductions: { s80c: 0 } };
  const withLoan = { ...base, houseProperty: { selfOccupiedInterest: 200000 } };
  const without = claimedOldRegime(compareRegimes(base, rates).old.income);
  const withIt = claimedOldRegime(compareRegimes(withLoan, rates).old.income);
  near('2 lakh of home-loan interest adds 2 lakh to what is claimed, not 4', withIt - without, 200000);
}

ok('no income: kind none', breakEven({}, rates).kind === 'none');

// Headroom
{
  const hr = headroom({ salary: { gross: 1500000, basicDa: 700000 }, employer: { npsContribution: 20000 }, deductions: { s80c: 50000, includeEpf: false } }, rates);
  const c80 = hr.items.find((i) => i.id === '80c');
  ok('80C room is 1L when EPF is not counted', c80 && c80.room === 100000, String(c80 && c80.room));
  const hrEpf = headroom({ salary: { gross: 1500000, basicDa: 700000 }, deductions: { s80c: 50000 } }, rates);
  near('80C room shrinks by the auto EPF (12% of 7L = 84,000)', hrEpf.items.find((i) => i.id === '80c').room, 16000, 1);
  ok('80C saving positive and old-only', c80.saving > 0 && c80.regime === 'old');
  const nps = hr.items.find((i) => i.id === 'nps1b');
  ok('NPS 1B room is 50k', nps && nps.room === 50000);
  const emp = hr.items.find((i) => i.id === 'emp_nps');
  near('employer NPS room new = 14% of basic minus contribution', emp.room, 0.14 * 700000 - 20000, 1);
  near('employer NPS room old (private) = 10% of basic minus contribution', emp.roomOld, 0.10 * 700000 - 20000, 1);
  ok('employer NPS saves in the new regime', emp.saving > 0);
  const full = headroom({ salary: { gross: 1500000 }, deductions: { s80c: 150000, nps1b: 50000, healthSelf: 25000, healthParents: 25000 } }, rates);
  ok('no room when everything is used', !full.items.find((i) => ['80c', 'nps1b', '80d'].includes(i.id)));
}

// What-if
{
  const w = whatIf({ salary: { gross: 1500000 } }, { s80c: 150000, nps1b: 50000 }, rates);
  ok('what-if reduces old tax', w.after.old.tax.total < w.before.old.tax.total);
  ok('what-if leaves new tax unchanged', w.after.new.tax.total === w.before.new.tax.total);
  near('invested total', w.invested, 200000, 0.01);
  ok('taxSaved matches difference', Math.abs(w.taxSaved - (w.before.old.tax.total - w.after.old.tax.total)) < 0.01);
  const capped = whatIf({ salary: { gross: 1500000 }, deductions: { s80c: 150000 } }, { s80c: 100000 }, rates);
  ok('what-if respects the 80C cap', capped.taxSaved === 0);
}

{
  const inputs = { salary: { gross: 1500000, basicDa: 700000 }, deductions: { s80c: 50000 } };
  const c = breakEvenCurve(inputs, rates);
  ok('curve has points and a crossing', c && c.points.length === 61 && c.crossing > c.current.x, c && String(c.crossing));
  ok('curve is non-increasing in deductions', c.points.every((p, i) => i === 0 || p[1] <= c.points[i - 1][1] + 0.01));
  ok('current point tax equals old total', Math.abs(c.current.y - compareRegimes(inputs, rates).old.tax.total) < 0.5);
  ok('crossing lies inside the x range', c.crossing <= c.xMax);
  ok('no income: curve is null', breakEvenCurve({}, rates) === null);
}

// Tax workbook
{
  const inputs = { salary: { gross: 1500000, basicDa: 700000 }, deductions: { s80c: 50000 } };
  const cmp = compareRegimes(inputs, rates);
  const b64 = await buildTaxWorkbookBase64(inputs, cmp, rates, DEFAULT_FLAGS, 'Asha Rao', ExcelJS);
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(Buffer.from(b64, 'base64'));
  ok('tax workbook sheets', wb.worksheets.map((w) => w.name).join() === 'Comparison,Working,Break-even,Inputs,Notes', wb.worksheets.map((w) => w.name).join());
  const wk = wb.getWorksheet('Working');
  let sawSlab = false, sawCess = false; wk.eachRow((row) => { const a = String(row.getCell(1).value || ''); if (a.includes('at 5% (')) sawSlab = true; if (/cess at 4%/i.test(a)) sawCess = true; });
  ok('working sheet has slab rows and a cess line', sawSlab && sawCess);
  const ws = wb.getWorksheet('Comparison');
  ok('verdict banner present', /regime/.test(String(ws.getCell('A4').value)) && ws.getCell('A4').fill?.fgColor?.argb === 'FF14532D');
  let totalRow = null;
  ws.eachRow((row, i) => { if (row.getCell(1).value === 'Total tax payable') totalRow = i; });
  ok('total tax row exists with rupee format', totalRow && /₹/.test(ws.getCell(`B${totalRow}`).numFmt || ''));
  near('total tax old matches engine', ws.getCell(`B${totalRow}`).value, cmp.old.tax.total, 0.5);
  near('total tax new matches engine', ws.getCell(`C${totalRow}`).value, cmp.new.tax.total, 0.5);
  const be = wb.getWorksheet('Break-even');
  ok('break-even sentence present', /regime/.test(String(be.getCell('A4').value)));
  ok('inputs sheet lists gross salary', wb.getWorksheet('Inputs').getCell('B5').value === 1500000);
}

// tax drivers: what adds tax and what cuts it, by taking each item out
{
  const inputs = { salary: { gross: 2400000, basicDa: 1000000, hraReceived: 400000, rentPaid: 480000, city: 'Mumbai' }, houseProperty: { selfOccupiedInterest: 200000 }, deductions: { s80c: 150000, nps1b: 50000, healthSelf: 25000 }, otherIncome: { depositInterest: 60000 } };
  const d = taxDrivers(inputs, rates);
  const cmp = compareRegimes(inputs, rates);
  ok('drivers: regime is the lower one', d.regime === (cmp.better === 'old' ? 'old' : 'new'));
  ok('drivers: salary is the biggest, and adds tax', d.items[0].id === 'salary' && d.items[0].effect > 0);
  const hra = d.items.find((i) => i.id === 'hra'), loan = d.items.find((i) => i.id === 'homeloan'), c = d.items.find((i) => i.id === '80c');
  ok('drivers: HRA, home loan and 80C cut old-regime tax and do nothing in the new', hra.old < 0 && hra.new === 0 && loan.old < 0 && loan.new === 0 && c.old < 0 && c.new === 0);
  ok('drivers: deposit interest adds tax in both', d.items.find((i) => i.id === 'other').old > 0 && d.items.find((i) => i.id === 'other').new > 0);
  const size = (it) => Math.max(Math.abs(it.old), Math.abs(it.new));
  ok('drivers: sorted by size in either regime', d.items.every((it, i) => i === 0 || size(d.items[i - 1]) >= size(it)));
  ok('drivers: items with no tax effect in either regime are dropped', d.items.every((it) => it.old !== 0 || it.new !== 0));
  // removing salary from a salary-only case takes the tax to zero, so its effect is the whole tax
  const solo = taxDrivers({ salary: { gross: 1500000 } }, rates);
  near('drivers: salary-only effect equals the total tax', solo.items[0].effect, compareRegimes({ salary: { gross: 1500000 } }, rates).new.tax.total, 1);
  ok('drivers: nothing entered -> no items', taxDrivers({}, rates).items.length === 0);
}

console.log(failures === 0 ? '\nAll tax insight tests passed.' : `\n${failures} test(s) FAILED.`);
process.exit(failures === 0 ? 0 : 1);
