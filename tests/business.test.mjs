// Business and profession: presumptive income, 80GG, own NPS cap, TDS credit, advance tax. Run: node tests/business.test.mjs
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { compareRegimes, computeRegime, businessIncome, hasBusiness } from '../public/js/tax-engine.js';
import { advanceTaxSchedule, taxDrivers } from '../public/js/tax-insights.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const rates = JSON.parse(readFileSync(path.join(here, '../public/data/tax_rates.json'), 'utf8'));
let failures = 0;
const ok = (name, cond, detail = '') => { console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${detail ? ' (' + detail + ')' : ''}`); if (!cond) failures++; };
const near = (name, a, e, tol = 1) => ok(name, Math.abs(a - e) <= tol, `got ${Math.round(a)}, expected ${Math.round(e)}`);
const line = (r, id) => (r.income.lines.find((l) => l.id === id) || {}).amount;
const via = (r, id) => (r.income.via.find((v) => v.id === id) || {}).amount;

// 44ADA: a consultant with 30 L of receipts is taxed on 15 L
{
  const inputs = { incomeType: 'business', business: { receipts: 3000000, kind: 'profession', presumptive: true } };
  const r = computeRegime(inputs, 'new', rates);
  near('44ADA: income is 50% of receipts', line(r, 'business'), 1500000);
  near('44ADA: receipts shown, deemed expenses shown', line(r, 'business_receipts') + line(r, 'business_deemed'), 1500000);
  ok('44ADA: no standard deduction without salary', line(r, 'std_deduction') === undefined);
  const b = businessIncome({ business: { receipts: 8000000, kind: 'profession', presumptive: true, digitalSharePct: 100 } }, rates);
  ok('44ADA: above the 75 L digital limit a note says books are needed', /44ADA limit/.test(b.notes.join(' ')));
  ok('44ADA: 60 L with mostly cash is over the 50 L limit', /limit/.test(businessIncome({ business: { receipts: 6000000, kind: 'profession', presumptive: true, digitalSharePct: 50 } }, rates).notes.join(' ')));
  ok('hasBusiness follows the toggle, the old checkbox, or receipts', hasBusiness({ incomeType: 'both' }) && hasBusiness({ hasBusinessIncome: true }) && hasBusiness({ business: { receipts: 1 } }) && !hasBusiness({ incomeType: 'salary', business: { receipts: 0 } }));
}
// 44AD: a trader with 1 Cr turnover, 60% digital
{
  const b = businessIncome({ business: { receipts: 10000000, kind: 'business', presumptive: true, digitalSharePct: 60 } }, rates);
  near('44AD: 6% on the digital part, 8% on the rest', b.income, 10000000 * (0.6 * 0.06 + 0.4 * 0.08));
  ok('44AD: 2.5 Cr with 60% digital exceeds the 2 Cr limit', /44AD limit/.test(businessIncome({ business: { receipts: 25000000, kind: 'business', presumptive: true, digitalSharePct: 60 } }, rates).notes.join(' ')));
  ok('44AD: 2.5 Cr fully digital is within the 3 Cr limit', businessIncome({ business: { receipts: 25000000, kind: 'business', presumptive: true, digitalSharePct: 100 } }, rates).notes.length === 0);
}
// books: receipts less expenses
{
  const b = businessIncome({ business: { receipts: 3000000, kind: 'profession', presumptive: false, expenses: 1200000 } }, rates);
  near('books: receipts less expenses', b.income, 1800000);
  ok('books: expenses line present, no deemed line', b.lines.some((l) => l.id === 'business_expenses') && !b.lines.some((l) => l.id === 'business_deemed'));
  near('no receipts: the typed net income is used as before', businessIncome({ business: { income: 900000 } }, rates).income, 900000);
}
// 80GG: rent with no HRA, old regime, least of three
{
  const inputs = { incomeType: 'business', business: { receipts: 3000000, kind: 'profession', presumptive: true }, salary: { rentPaid: 300000 } };
  const o = computeRegime(inputs, 'old', rates), n = computeRegime(inputs, 'new', rates);
  // ATI = 15 L (no other VI-A): least of 60,000; 3,75,000; 3,00,000 - 1,50,000 = 1,50,000
  near('80GG: capped at 60,000 here', via(o, '80gg'), 60000);
  ok('80GG: not in the new regime', via(n, '80gg') === undefined);
  const small = computeRegime({ ...inputs, salary: { rentPaid: 120000 } }, 'old', rates);
  ok('80GG: rent less 10% of income binds when rent is low (1,20,000 - 1,50,000 < 0 -> nothing)', via(small, '80gg') === undefined);
  const withHra = computeRegime({ salary: { gross: 1500000, basicDa: 600000, hraReceived: 200000, rentPaid: 300000 } }, 'old', rates);
  ok('80GG: never alongside HRA', via(withHra, '80gg') === undefined && line(withHra, 'hra') < 0);
}
// own NPS under 80CCD(1): 20% of income for the self-employed, 10% of basic for employees, within 1.5 L
{
  const biz = computeRegime({ incomeType: 'business', business: { receipts: 2000000, kind: 'profession', presumptive: true }, deductions: { nps1: 300000 } }, 'old', rates);
  near('80CCD(1) self-employed: 20% of 10 L income = 2 L, then the 1.5 L aggregate bites', via(biz, '80c'), 150000);
  const bizSmall = computeRegime({ incomeType: 'business', business: { receipts: 2000000, kind: 'profession', presumptive: true }, deductions: { nps1: 100000 } }, 'old', rates);
  near('80CCD(1) self-employed: 1 L within cap is fully in 80C', via(bizSmall, '80c'), 100000);
  const emp = computeRegime({ salary: { gross: 1500000, basicDa: 600000 }, deductions: { nps1: 100000, includeEpf: false } }, 'old', rates);
  near('80CCD(1) employee: capped at 10% of Basic + DA = 60,000', via(emp, '80c'), 60000);
}
// TDS credit
{
  const cmp = compareRegimes({ incomeType: 'business', business: { receipts: 3000000, kind: 'profession', presumptive: true, tdsDeducted: 300000 } }, rates);
  const t = cmp.new.tax;
  ok('TDS: tax total is unchanged, net payable is total less TDS, refund when TDS exceeds it', t.tdsDeducted === 300000 && t.netPayable === Math.max(0, t.total - 300000) && t.refundDue === Math.max(0, 300000 - t.total));
  ok('TDS: business warning about regime switching appears', cmp.warnings.some((w) => /opt out of the new regime/.test(w)));
}
// advance tax
{
  const p = advanceTaxSchedule({ incomeType: 'business', business: { receipts: 3000000, kind: 'profession', presumptive: true } }, rates);
  ok('advance tax: presumptive profession pays once, by 15 March', p && p.presumptive && p.rows.length === 1 && p.rows[0].due === '15 March' && p.rows[0].instalment === p.net);
  const q = advanceTaxSchedule({ incomeType: 'business', business: { receipts: 3000000, kind: 'profession', presumptive: false, expenses: 500000 } }, rates);
  ok('advance tax: books -> four instalments at 15/45/75/100%', q && !q.presumptive && q.rows.length === 4 && q.rows[3].cumulative === q.net && q.rows.reduce((s, r) => s + r.instalment, 0) === q.net && Math.abs(q.rows[0].cumulative - 0.15 * q.net) <= 1);
  const both = advanceTaxSchedule({ incomeType: 'both', salary: { gross: 1500000 }, business: { receipts: 1000000, kind: 'profession', presumptive: true } }, rates);
  ok('advance tax: salary plus presumptive -> four instalments (salary is not presumptive)', both && !both.presumptive && both.rows.length === 4);
  ok('advance tax: nothing due under 10,000', advanceTaxSchedule({ incomeType: 'business', business: { receipts: 600000, kind: 'profession', presumptive: true } }, rates) === null);
  ok('advance tax: TDS already deducted reduces it', advanceTaxSchedule({ incomeType: 'business', business: { receipts: 3000000, kind: 'profession', presumptive: true, tdsDeducted: 50000 } }, rates).net === Math.max(0, p.total - 50000));
  ok('advance tax: resident senior with only interest income is exempt', advanceTaxSchedule({ ageBand: 'senior_60_to_79', otherIncome: { depositInterest: 2000000 } }, rates) === null);
}
// drivers know about business
{
  const d = taxDrivers({ incomeType: 'business', business: { receipts: 3000000, kind: 'profession', presumptive: true }, salary: { rentPaid: 300000 } }, rates);
  ok('drivers: professional receipts is the income line, 80GG the relief', d.items[0].id === 'business' && /receipts/i.test(d.items[0].label) && d.items.some((i) => i.id === 'hra' && /80GG/.test(i.label)));
}

console.log(failures ? `\n${failures} failure(s)` : '\nAll business tests passed');
process.exit(failures ? 1 : 0);
