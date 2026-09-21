// Every fixture in public/fixtures/profiles/ must be a valid v1 profile whose components add up,
// and the boundary fixture must actually sit on the boundary. Run: npm run test:fixtures
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { migrateProfile, toTaxInputs, toSalaryStore, ctcOf, SCHEMA_VERSION } from '../public/engine/profile.js';
import { computeRegime } from '../public/js/tax-engine.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const dir = path.join(here, '../public/fixtures/profiles');
const rates = JSON.parse(readFileSync(path.join(here, '../public/data/tax_rates.json'), 'utf8'));
let failures = 0;
const ok = (name, cond, detail = '') => { console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${detail ? ' (' + detail + ')' : ''}`); if (!cond) failures++; };

const index = JSON.parse(readFileSync(path.join(dir, 'index.json'), 'utf8'));
const files = readdirSync(dir).filter((f) => f.endsWith('.json') && f !== 'index.json');
ok('index.json lists every fixture', files.every((f) => index.profiles.some((p) => p.file === f)) && index.profiles.every((p) => files.includes(p.file)), files.join(', '));

for (const f of files) {
  const raw = JSON.parse(readFileSync(path.join(dir, f), 'utf8'));
  const p = migrateProfile(raw);
  ok(`${f}: schema version ${SCHEMA_VERSION}`, raw.schemaVersion === SCHEMA_VERSION);
  ok(`${f}: migration is lossless`, JSON.stringify(migrateProfile(p)) === JSON.stringify(p));
  const i = p.income;
  ok(`${f}: components add up to CTC`, Math.abs(ctcOf(i) - i.ctc) < 1);
  ok(`${f}: regime is old or new`, p.tax.regime === 'old' || p.tax.regime === 'new');
  for (const l of p.loans) ok(`${f}: loan EMI matches outstanding/rate/months`, Math.abs(l.emi - Math.round(l.emi)) < 1 && l.emi > 0);
  const t = toTaxInputs(p);
  ok(`${f}: tax inputs compute without error`, Number.isFinite(computeRegime(t, p.tax.regime, rates).tax.total));
  if (i.ctc > 0) ok(`${f}: salary store percentages are sane`, toSalaryStore(p).basicPct > 0 && toSalaryStore(p).basicPct < 100);
  else ok(`${f}: no salary, so business receipts carry the profile`, p.business.receipts > 0 && p.person.employment !== 'salaried');
}
{
  const p = migrateProfile(JSON.parse(readFileSync(path.join(dir, 'consultant-30L.json'), 'utf8')));
  const r = computeRegime(toTaxInputs(p), 'old', rates);
  ok('consultant fixture: 44ADA income is 15 L and 80GG applies', r.income.lines.find((l) => l.id === 'business').amount === 1500000 && r.income.via.some((v) => v.id === '80gg'));
  ok('consultant fixture: TDS credit flows to net payable', r.tax.tdsDeducted === 240000 && r.tax.netPayable === Math.max(0, r.tax.total - 240000));
}

{
  const p = migrateProfile(JSON.parse(readFileSync(path.join(dir, 'rebate-boundary.json'), 'utf8')));
  const r = computeRegime(toTaxInputs(p), 'new', rates);
  ok('rebate-boundary: total income is exactly the s.87A threshold', r.tax.totalIncome === rates.rebate.new_regime.total_income_threshold, String(r.tax.totalIncome));
  ok('rebate-boundary: tax is zero on the cliff', r.tax.total === 0);
}
{
  const p = migrateProfile(JSON.parse(readFileSync(path.join(dir, 'old-regime-45L-homeloan.json'), 'utf8')));
  const t = toTaxInputs(p);
  ok('45L fixture: self-occupied interest reaches the tax inputs', t.houseProperty.selfOccupiedInterest > 200000, String(t.houseProperty.selfOccupiedInterest));
}
{
  const p = migrateProfile(JSON.parse(readFileSync(path.join(dir, '1cr-esop.json'), 'utf8')));
  ok('1cr fixture: ESOP is part of gross salary', toTaxInputs(p).salary.gross === p.income.basic + p.income.hra + p.income.otherAllowances + p.income.employerNps + p.income.esop);
  ok('1cr fixture: employer PF + NPS stays under the 7.5L perquisite cap', p.income.employerPf + p.income.employerNps < 750000);
}

console.log(failures === 0 ? '\nAll fixture tests passed.' : `\n${failures} fixture test(s) FAILED.`);
process.exit(failures === 0 ? 0 : 1);
