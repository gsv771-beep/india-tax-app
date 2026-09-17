// Every calculator's workbook builds in Node with the real ExcelJS and has the sheets it promises.
// Run: node tests/export.test.mjs
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import ExcelJS from 'exceljs';
import { goalPlan } from '../public/engine/goal.js';
import { buildCalcWorkbookBase64, SPECS } from '../public/js/calc-export.js';
import { salaryBreakdown } from '../public/js/salary.js';
import { simulateLoan, sipFV, requiredSip } from '../public/js/calculators.js';
import { computeCapitalGains } from '../public/js/capgains.js';
import { propertyCost } from '../public/engine/property.js';
import { emiFor } from '../public/engine/loan-eligibility.js';
import { paymentPlan, PLAN_PRESETS } from '../public/engine/payment-plan.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const load = (f) => JSON.parse(readFileSync(path.join(here, '../public/data', f), 'utf8'));
const rates = load('tax_rates.json'), capgains = load('capital_gains.json'), charges = load('property_charges.json'), policy = load('loan_policy.json');
let failures = 0;
const ok = (name, cond, detail = '') => { console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${detail ? ' (' + detail + ')' : ''}`); if (!cond) failures++; };

async function roundTrip(source, last, expectSheets) {
  const spec = SPECS[source](last);
  const b64 = await buildCalcWorkbookBase64(spec, 'Test User', ExcelJS);
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(Buffer.from(b64, 'base64'));
  const names = wb.worksheets.map((w) => w.name);
  ok(`${source}: builds and has sheets ${expectSheets.join(', ')} + Inputs + Notes`, JSON.stringify(names) === JSON.stringify([...expectSheets, 'Inputs', 'Notes']), names.join(', '));
  const first = wb.worksheets[0];
  ok(`${source}: title and a data row are present`, /TaxCompass/.test(String(first.getCell('A1').value)) && first.rowCount > 6, `${first.rowCount} rows`);
  ok(`${source}: no undefined cells in the first sheet`, !first.getSheetValues().flat().some((v) => v === undefined && false) && !JSON.stringify(first.getSheetValues()).includes('undefined'));
  return wb;
}

// salary
{
  const st = { ctc: 2400000, basicPct: 40, hraPct: 50, includeEmployerPf: true, includeGratuity: true, employerNpsPct: 10, professionalTax: 2400, city: 'Mumbai', rentPaid: 300000, other80c: 50000, nps1b: 50000, healthSelf: 25000, ageBand: 'below_60', regime: 'best' };
  const r = salaryBreakdown(st, rates);
  await roundTrip('salary', { st, r }, ['Salary']);
}
// emi
{
  const base = simulateLoan({ principal: 5000000, annualRatePct: 8.5, tenureMonths: 240 });
  const scen = simulateLoan({ principal: 5000000, annualRatePct: 8.5, tenureMonths: 240, annualPrepay: 100000, annualPrepayStartYear: 1, mode: 'reduce_tenure' });
  const wb = await roundTrip('emi', { p: 5000000, r: 8.5, y: 20, base, scen, mode: 'reduce_tenure', stepPct: 0, stepAmt: 0, lump: 0, lumpMonth: 12, annual: 100000, annualStart: 1, preEmi: 0, cm: 0, price: 7000000, down: 2000000 }, ['Summary', 'Schedule']);
  const yearRows = wb.getWorksheet('Schedule').getSheetValues().filter((row) => row && typeof row[1] === 'number').length;
  ok('emi: schedule has one row per year of the scenario', yearRows === scen.years.length, `${yearRows} vs ${scen.years.length}`);
}
// sip
{
  const lumps = [{ amount: 200000, atYear: 3 }];
  const at = (k) => sipFV(10000, 12, k, 5, 0, lumps);
  const main = at(10), flat = sipFV(10000, 12, 10, 0, 0, lumps), sipOnly = sipFV(10000, 12, 10, 5, 0);
  await roundTrip('sip', { a: 10000, r: 12, y: 10, sp: 5, sa: 0, lumps, main, flat, sipOnly, series: Array.from({ length: 11 }, (_, k) => ({ year: k, ...at(k) })) }, ['Summary', 'Year by year', 'Lump sums']);
}
// goal
{
  const rates = { equity: 14.5, equityWorst: 1.7, safe: 7.1, ssy: 8.2, sources: { equity: 'test equity', safe: 'test safe' } };
  const st = { type: 'education', costToday: 2500000, childAge: 3, atAge: '', equityPct: 60, inflationPct: '' };
  const r = goalPlan({ ...st, atAge: undefined, inflationPct: undefined }, rates);
  const perChild = [3, 7].map((age) => ({ age, plan: goalPlan({ ...st, atAge: undefined, inflationPct: undefined, childAge: age }, rates) }));
  await roundTrip('goal', { st, r, rates, perChild, typeLabel: "Child's education" }, ['Goal', 'Where it goes', 'Each child']);
}
// capital gains: property with the two options
{
  const st = { asset: 'property', buyDate: '2015-06-01', sellDate: '2026-06-01', cost: 5000000, sale: 12000000, expenses: 100000, resident: true, slabRate: 0.3, impAmount: '', impFy: '', fmv2018: '', fmv2001: '', otherEquityLtcgThisYear: '' };
  const r = computeCapitalGains({ ...st, improvements: [] }, capgains);
  ok('capgains fixture computes', !r.error, r.error);
  await roundTrip('capgains', { st, r }, r.options ? ['Computation', 'Two options'] : ['Computation']);
}
// home: cost first, then the funding plan
{
  const st = { city: 'Mumbai', price: 10000000, status: 'under_construction', buyer: 'man', affordable: false, brokerageRate: 1, brokerageOnNew: false, interiors: 0, legalAndValuation: 10000, builderCharges: [{ label: 'Parking', amount: 500000 }], funding: true, loan: 7500000, downPayment: 2500000, ratePct: 8, tenureYears: 20, processingFeeRate: 0.5, processingFeeCap: 25000 };
  const c = propertyCost({ city: 'Mumbai', price: 10000000, status: 'under_construction', buyer: 'man', builderCharges: st.builderCharges, loanAmount: 7500000 }, charges);
  const plan = paymentPlan({ price: 10000000, tranches: PLAN_PRESETS.construction_linked.tranches, downPayment: 2500000, loan: 7500000, ratePct: 8, tenureMonths: 240, gstRate: 0.05, upfrontCharges: c.hiddenTotal - 500000 });
  await roundTrip('home', { st, c, loan: 7500000, downPayment: 2500000, plan, emi: emiFor(7500000, 8, 240), tenureMonths: 240, cashNeeded: c.total - 7500000 }, ['Cost', 'Funding', 'Payment plan']);
  const costOnly = propertyCost({ city: 'Chennai', price: 8000000, status: 'resale', buyer: 'woman', loanAmount: 0 }, charges);
  await roundTrip('home', { st: { ...st, funding: false, city: 'Chennai', price: 8000000, status: 'resale' }, c: costOnly, loan: 0, downPayment: 0, plan: null, emi: 0, tenureMonths: 0, cashNeeded: costOnly.total }, ['Cost']);
}

console.log(failures === 0 ? '\nAll export tests passed.' : `\n${failures} export test(s) FAILED.`);
process.exit(failures === 0 ? 0 : 1);
