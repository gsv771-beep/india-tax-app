// Capital gains rules. Run: node tests/capgains.test.mjs
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { computeCapitalGains, monthsBetween, fyOf } from '../public/js/capgains.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const data = JSON.parse(readFileSync(path.join(here, '../public/data/capital_gains.json'), 'utf8'));

let failures = 0;
const ok = (name, cond, detail = '') => { console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${detail ? ' (' + detail + ')' : ''}`); if (!cond) failures++; };
const near = (name, a, e, tol = 1) => ok(name, Math.abs(a - e) <= tol, `got ${Math.round(a)}, expected ${e}`);
const cg = (o) => computeCapitalGains(o, data);

ok('months: 1 Jan 2020 to 1 Jan 2021 is 12', monthsBetween(Date.UTC(2020, 0, 1), Date.UTC(2021, 0, 1)) === 12);
ok('months: 15 Mar to 14 Mar next year is 11', monthsBetween(Date.UTC(2020, 2, 15), Date.UTC(2021, 2, 14)) === 11);
ok('fy of 31 Mar 2026 is 2025-26', fyOf(Date.UTC(2026, 2, 31)) === '2025-26');
ok('fy of 1 Apr 2026 is 2026-27', fyOf(Date.UTC(2026, 3, 1)) === '2026-27');

// Equity LTCG: 5L -> 9L over 6 years: gain 4L, exemption 1.25L, 12.5% on 2.75L = 34,375, cess 1,375 -> 35,750
{
  const r = cg({ asset: 'equity', buyDate: '2020-01-01', sellDate: '2026-06-01', cost: 500000, sale: 900000 });
  ok('equity LT classification', r.longTerm && r.classification === 'Long-term');
  near('equity LT exemption used', r.exemptionUsed, 125000, 0.01);
  near('equity LT taxable gain', r.taxableGain, 275000, 0.01);
  near('equity LT total tax', r.total, 35750, 1);
}
// Equity STCG 20%
{
  const r = cg({ asset: 'equity', buyDate: '2026-01-10', sellDate: '2026-08-10', cost: 100000, sale: 150000 });
  ok('equity ST classification', !r.longTerm);
  near('equity ST tax 20% + cess', r.total, 50000 * 0.20 * 1.04, 1);
}
// Equity exactly 12 months is still short-term; 12 months + 1 day is long-term
ok('equity 12 months exactly is ST', !cg({ asset: 'equity', buyDate: '2025-06-01', sellDate: '2026-06-01', cost: 1, sale: 2 }).longTerm);
ok('equity 12 months + 1 day is LT', cg({ asset: 'equity', buyDate: '2025-06-01', sellDate: '2026-06-02', cost: 1, sale: 2 }).longTerm);
// Grandfathering: bought 2015 at 1L, FMV Jan 2018 3L, sold 5L -> cost 3L, gain 2L
{
  const r = cg({ asset: 'equity', buyDate: '2015-05-01', sellDate: '2026-05-01', cost: 100000, fmv2018: 300000, sale: 500000 });
  near('grandfathered gain', r.gain, 200000, 0.01);
}
// Exemption shared across the year
{
  const r = cg({ asset: 'equity', buyDate: '2020-01-01', sellDate: '2026-06-01', cost: 500000, sale: 900000, otherEquityLtcgThisYear: 100000 });
  near('exemption remaining after other gains', r.exemptionUsed, 25000, 0.01);
}
// Sale before 23 July 2024 uses old rates and 1L exemption
{
  const r = cg({ asset: 'equity', buyDate: '2020-01-01', sellDate: '2024-06-01', cost: 500000, sale: 900000 });
  near('pre-cutover equity LTCG at 10% over 1L', r.tax, 300000 * 0.10, 0.01);
}
// Property with indexation option: FY 2015-16 cost 50L, FY 2025-26 sale 1.2Cr
{
  const r = cg({ asset: 'property', buyDate: '2015-06-01', sellDate: '2026-03-01', cost: 5000000, sale: 12000000, resident: true });
  ok('property LT', r.longTerm && r.options);
  near('indexed cost 50L x 376/254', r.options.indexed.indexedCost, 5000000 * 376 / 254, 1);
  near('plain tax 12.5% of 70L', r.options.plain.tax, 875000, 0.01);
  near('indexed tax 20% of indexed gain', r.options.indexed.tax, (12000000 - 5000000 * 376 / 254) * 0.20, 1);
  ok('lower option chosen (plain here)', r.options.chosen === 'plain' && Math.abs(r.tax - 875000) < 0.01);
}
// Property where indexation wins: bought FY 2005-06 at 20L, sold FY 2025-26 at 70L
{
  const r = cg({ asset: 'property', buyDate: '2005-06-01', sellDate: '2026-03-01', cost: 2000000, sale: 7000000, resident: true });
  const indexedGain = 7000000 - 2000000 * 376 / 117;
  ok('indexation chosen when cheaper', r.options.chosen === 'indexed', `${r.options.plain.tax} vs ${r.options.indexed.tax}`);
  near('indexed tax', r.tax, indexedGain * 0.20, 1);
}
// Property acquired after 23 July 2024: no indexed option
ok('post-cutover property has no indexed option', cg({ asset: 'property', buyDate: '2024-08-01', sellDate: '2026-09-01', cost: 5000000, sale: 6000000, resident: true }).options === null);
// Non-resident: no indexed option
ok('non-resident has no indexed option', cg({ asset: 'property', buyDate: '2015-06-01', sellDate: '2026-03-01', cost: 5000000, sale: 12000000, resident: false }).options === null);
// Property short-term at slab
{
  const r = cg({ asset: 'property', buyDate: '2025-01-01', sellDate: '2026-06-01', cost: 5000000, sale: 5500000, slabRate: 0.30 });
  ok('property ST at slab', !r.longTerm && Math.abs(r.tax - 500000 * 0.30) < 0.01);
}
// Sale in FY 2026-27 falls back to the latest CII and says so
{
  const r = cg({ asset: 'property', buyDate: '2015-06-01', sellDate: '2026-09-01', cost: 5000000, sale: 12000000, resident: true });
  ok('CII fallback note present for FY 2026-27', r.notes.some((n) => /Cost Inflation Index for FY 2026-27/.test(n)));
}
// Debt MF bought after 1 Apr 2023: slab always
{
  const r = cg({ asset: 'debt_mf', buyDate: '2023-06-01', sellDate: '2026-08-01', cost: 100000, sale: 120000, slabRate: 0.30 });
  ok('debt MF post-2023 slab always', r.slabAlways && Math.abs(r.tax - 20000 * 0.30) < 0.01);
}
// Debt MF bought before 2023, held > 24 months: 12.5%
{
  const r = cg({ asset: 'debt_mf', buyDate: '2022-01-01', sellDate: '2026-08-01', cost: 100000, sale: 120000, slabRate: 0.30 });
  ok('debt MF pre-2023 long-term at 12.5%', r.longTerm && Math.abs(r.tax - 20000 * 0.125) < 0.01);
}
// Gold long-term 12.5%, short-term slab
ok('gold LT 12.5%', Math.abs(cg({ asset: 'other', buyDate: '2020-01-01', sellDate: '2026-01-01', cost: 100000, sale: 160000 }).tax - 60000 * 0.125) < 0.01);
ok('gold ST at slab', Math.abs(cg({ asset: 'other', buyDate: '2025-01-01', sellDate: '2026-01-01', cost: 100000, sale: 160000, slabRate: 0.20 }).tax - 60000 * 0.20) < 0.01);
// Loss
{
  const r = cg({ asset: 'equity', buyDate: '2020-01-01', sellDate: '2026-06-01', cost: 900000, sale: 500000 });
  ok('loss gives zero tax and a set-off note', r.total === 0 && r.loss === 400000 && r.notes.some((n) => /set off/.test(n)));
}
ok('sale before purchase is an error', !!cg({ asset: 'equity', buyDate: '2026-06-01', sellDate: '2026-01-01', cost: 1, sale: 2 }).error);

console.log(failures === 0 ? '\nAll capital gains tests passed.' : `\n${failures} test(s) FAILED.`);
process.exit(failures === 0 ? 0 : 1);
