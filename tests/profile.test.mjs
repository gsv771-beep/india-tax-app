// Shared profile: schema, migration, adapters to and from the tools, import guard.
// Run: node tests/profile.test.mjs
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import {
  emptyProfile, migrateProfile, normaliseProfile, parseProfileJSON, isEmptyProfile, profileSummary, ctcOf, emiFor,
  toTaxInputs, fromTaxInputs, toSalaryStore, fromSalaryStore, fromLoanInputs, SCHEMA_VERSION,
} from '../public/engine/profile.js';
import { salaryBreakdown } from '../public/js/salary.js';
import { computeRegime } from '../public/js/tax-engine.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const rates = JSON.parse(readFileSync(path.join(here, '../public/data/tax_rates.json'), 'utf8'));
let failures = 0;
const ok = (name, cond, detail = '') => { console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${detail ? ' (' + detail + ')' : ''}`); if (!cond) failures++; };
const near = (name, a, e, tol = 1) => ok(name, Math.abs(a - e) <= tol, `got ${a}, expected ${e}`);
const fixture = (f) => migrateProfile(JSON.parse(readFileSync(path.join(here, '../public/fixtures/profiles', f), 'utf8')));

// ---- schema and migration ----
{
  const e = emptyProfile();
  ok('empty profile is empty', isEmptyProfile(e));
  ok('empty profile has the current schema version', e.schemaVersion === SCHEMA_VERSION);
  const junk = migrateProfile({ income: { ctc: '1500000', basic: 'abc', bogus: 1 }, loans: [{ type: 'yacht', outstanding: 100, rate: 10, remainingMonths: 12 }], extra: true });
  ok('unknown keys are dropped', !('bogus' in junk.income) && !('extra' in junk));
  ok('numbers are coerced, garbage becomes 0', junk.income.ctc === 1500000 && junk.income.basic === 0);
  ok('unknown loan type falls back to other', junk.loans[0].type === 'other');
  near('missing EMI is derived', junk.loans[0].emi, emiFor(100, 10, 12), 0.01);
  ok('missing schemaVersion is treated as v1', migrateProfile({ tax: { regime: 'old' } }).tax.regime === 'old');
  ok('bad regime falls back to new', normaliseProfile({ tax: { regime: 'both' } }).tax.regime === 'new');
  ok('migration is idempotent', JSON.stringify(migrateProfile(junk)) === JSON.stringify(junk));
  // v1 -> v2: a profile saved before `person` existed comes up with defaults and keeps everything else
  const v1 = migrateProfile({ schemaVersion: 1, income: { ctc: 1500000, basic: 600000 }, tax: { regime: 'old' } });
  ok('v1 profile migrates to the current version', v1.schemaVersion === SCHEMA_VERSION);
  ok('v1 profile gains person defaults', v1.person.age === 0 && v1.person.creditScore === 0 && v1.person.employment === 'salaried');
  ok('v1 profile keeps its data', v1.income.ctc === 1500000 && v1.tax.regime === 'old');
  const bad = normaliseProfile({ person: { age: 250, creditScore: 12, employment: 'freelance' } });
  ok('person fields are clamped', bad.person.age === 100 && bad.person.creditScore === 300 && bad.person.employment === 'salaried');
  const v2 = migrateProfile({ schemaVersion: 2, person: { employment: 'self_employed' }, income: { ctc: 0 } });
  ok('v2 profile gains an empty business block', v2.schemaVersion === SCHEMA_VERSION && v2.business.receipts === 0 && v2.business.kind === 'profession' && v2.business.presumptive === true);
  const biz = normaliseProfile({ person: { employment: 'both' }, business: { receipts: 3000000, kind: 'business', presumptive: false, digitalSharePct: 140, expenses: 500000, tds: 20000 } });
  ok('business block normalises and \'both\' is a valid employment', biz.person.employment === 'both' && biz.business.receipts === 3000000 && biz.business.kind === 'business' && biz.business.presumptive === false && biz.business.digitalSharePct === 100 && biz.business.tds === 20000);
  const ti = toTaxInputs(biz);
  ok('toTaxInputs carries the toggle and the business block', ti.incomeType === 'both' && ti.business.receipts === 3000000 && ti.business.kind === 'business' && ti.business.presumptive === false && ti.business.tdsDeducted === 20000);
  const back = fromTaxInputs(emptyProfile(), { incomeType: 'business', business: { receipts: 1200000, kind: 'profession', presumptive: true, digitalSharePct: 100, expenses: 0, tdsDeducted: 90000 } });
  ok('fromTaxInputs writes employment and business back', back.person.employment === 'self_employed' && back.business.receipts === 1200000 && back.business.tds === 90000 && !isEmptyProfile(back));
}

// ---- import guard ----
{
  const threw = (t) => { try { parseProfileJSON(t); return null; } catch (e) { return e.message; } };
  ok('rejects non-JSON', /valid JSON/.test(threw('{nope')));
  ok('rejects an array', /not contain a profile/.test(threw('[1,2]')));
  ok('rejects an unrelated object', /does not look like/.test(threw('{"hello":1}')));
  ok('rejects a newer schema', /newer version/.test(threw(JSON.stringify({ schemaVersion: SCHEMA_VERSION + 1, income: {} }))));
  ok('accepts an exported profile with extra top-level fields', parseProfileJSON(JSON.stringify({ ...fixture('new-regime-15L.json'), exportedAt: 'x', app: 'y' })).income.ctc === 1500000);
}

// ---- tax form round trip ----
{
  const p = fixture('old-regime-45L-homeloan.json');
  const t = toTaxInputs(p);
  const back = fromTaxInputs(emptyProfile(), t);
  for (const k of ['basic', 'hra', 'otherAllowances', 'employerNps', 'employerPf']) ok(`tax round trip keeps income.${k}`, back.income[k] === p.income[k], `${back.income[k]} vs ${p.income[k]}`);
  ok('tax round trip keeps the CTC', back.income.ctc === p.income.ctc - p.income.gratuity - p.income.esop);
  ok('tax round trip keeps city and metro', back.location.city === 'Mumbai' && back.location.metro === true);
  ok('tax round trip keeps deductions', back.tax.s80cUsed === 50000 && back.tax.nps1bUsed === 50000 && back.tax.s80dUsed === 25000);
  ok('tax round trip does not invent a loan', back.loans.length === 0);
  ok('write-back never changes the regime', fromTaxInputs(p, t).tax.regime === 'old');
  // the engine agrees before and after
  { const q = fixture('new-regime-15L.json'); const tq = toTaxInputs(q); ok('engine result identical after round trip', computeRegime(toTaxInputs(fromTaxInputs(emptyProfile(), tq)), 'new', rates).tax.total === computeRegime(tq, 'new', rates).tax.total); }
  // gross is balanced into other allowances
  const bumped = fromTaxInputs(p, { ...t, salary: { ...t.salary, gross: t.salary.gross + 100000 } });
  ok('raising gross salary on the tax form raises other allowances by the same amount', bumped.income.otherAllowances === p.income.otherAllowances + 100000);
  ok('...and the CTC', bumped.income.ctc === p.income.ctc + 100000);
}

// ---- salary calculator round trip ----
{
  const p = fixture('1cr-esop.json');
  const st = { ...toSalaryStore(p), professionalTax: 2400, includeGratuity: false };
  const r = salaryBreakdown(st, rates);
  ok('salary store reproduces basic', Math.abs(r.basic - p.income.basic) < 1, String(r.basic));
  ok('salary store reproduces HRA', Math.abs(r.hra - p.income.hra) < 1);
  ok('salary store reproduces employer NPS', Math.abs(r.employerNps - p.income.employerNps) < 1);
  const back = fromSalaryStore(p, st, r);
  ok('salary write-back keeps the ESOP out of other allowances', back.income.esop === p.income.esop && Math.abs(back.income.otherAllowances - p.income.otherAllowances) < 1, String(back.income.otherAllowances));
  ok('salary write-back keeps the CTC', Math.abs(back.income.ctc - p.income.ctc) < 1, String(back.income.ctc));
  ok('salary write-back keeps the regime', back.tax.regime === 'new');
  ok('salary write-back keeps the rent', back.location.rentPaid === 600000 && back.location.housing === 'rent');
  ok('components still add up', Math.abs(ctcOf(back.income) - back.income.ctc) < 1);
}

// ---- EMI calculator write-back ----
{
  const p = fromLoanInputs(emptyProfile(), { principal: 5000000, ratePct: 8.5, years: 20 });
  ok('EMI write-back creates a loan when there is none', p.loans.length === 1 && p.loans[0].type === 'home');
  near('EMI write-back computes the EMI', p.loans[0].emi, 43391.16, 0.01);
  const q = fromLoanInputs(fixture('old-regime-45L-homeloan.json'), { principal: 5500000, ratePct: 8.5, years: 15 });
  ok('EMI write-back edits the existing first loan in place', q.loans.length === 1 && q.loans[0].outstanding === 5500000 && q.loans[0].propertyUse === 'self_occupied');
}

// ---- summary line ----
{
  const s = profileSummary(fixture('old-regime-45L-homeloan.json'), (n) => 'R' + n);
  ok('summary names CTC, regime, city, loans and surplus', /R4500000 CTC/.test(s) && /old regime/.test(s) && /Mumbai/.test(s) && /1 loan/.test(s) && /R60000\/month/.test(s), s);
  ok('empty summary explains itself', /Nothing saved yet/.test(profileSummary(emptyProfile())));
}

console.log(failures === 0 ? '\nAll profile tests passed.' : `\n${failures} profile test(s) FAILED.`);
process.exit(failures === 0 ? 0 : 1);
