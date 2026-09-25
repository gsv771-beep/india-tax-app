// The quick answer: CTC in, in-hand and regime out. Run: node tests/quick.test.mjs
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { quickAnswer, ladder, LADDER_CTCS } from '../public/js/quick-engine.js';
import { salaryBreakdown } from '../public/js/salary.js';
import { compareRegimes } from '../public/js/tax-engine.js';
import { emptyProfile, fromSalaryStore, toSalaryStore, toTaxInputs } from '../public/engine/profile.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const rates = JSON.parse(readFileSync(path.join(here, '../public/data/tax_rates.json'), 'utf8'));
let failures = 0;
const ok = (name, cond, detail = '') => { console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${detail ? ' (' + detail + ')' : ''}`); if (!cond) failures++; };
const near = (name, a, e, tol = 1) => ok(name, Math.abs(a - e) <= tol, `got ${Math.round(a)}, expected ${Math.round(e)}`);

ok('no CTC -> no answer', quickAnswer({ ctc: 0 }, rates) === null);

// agrees with the in-hand salary calculator at its own defaults, so the link from one to the other shows the same figure
{
  const a = quickAnswer({ ctc: 1800000 }, rates);
  const s = salaryBreakdown({ ctc: 1800000, basicPct: 40, hraPct: 50, conveyance: 0, variable: 0, variableInCtc: 'ctc', variableMonthly: 'yearly', includeEmployerPf: true, includeGratuity: true, employerNpsPct: 0, professionalTax: 2400, city: 'Other', rentPaid: 0, other80c: 0, nps1b: 0, healthSelf: 0, ageBand: 'below_60', regime: 'best' }, rates);
  near('18L: monthly in-hand equals the salary calculator', a.monthly.best, s.monthly);
  near('18L: new-regime tax equals the salary calculator', a.tax.new, s.cmp.new.tax.total);
  ok('18L with nothing but PF: the new regime wins', a.better === 'new' && a.saves > 0, `saves ${a.saves}`);
  near('18L: PF alone is what counts in the old regime', a.claimed.total, a.pay.employeePf);
  near('18L: 80C room is 1.5 lakh less PF', a.room80c, 150000 - a.pay.employeePf);
  ok('18L: a finish line exists above what is claimed', a.needed > a.claimed.total, `needed ${a.needed}`);
}

// the finish line is where the regimes cross: at it the old regime ties or wins, a little short of it new wins
{
  const base = quickAnswer({ ctc: 1800000 }, rates);
  const full = { homeLoanInterest: 200000, other80c: base.room80c, healthSelf: 25000, nps1b: 50000, city: 'Mumbai' };
  const capped = quickAnswer({ ctc: 1800000, ...full }, rates);
  near('every capped deduction but rent counts 4.25 lakh at 18L', capped.claimed.total, 425000);
  near('health cover above the 80D cap counts only the cap', quickAnswer({ ctc: 1800000, healthSelf: 200000 }, rates).claimed.health, 25000);
  // the rest has to come from the HRA exemption: rent minus 10% of Basic, in a metro
  const hraNeeded = base.needed - capped.claimed.total;
  const rentMonthly = Math.ceil((hraNeeded + 0.1 * base.pay.basic) / 12);
  const at = quickAnswer({ ctc: 1800000, ...full, rentMonthly }, rates);
  ok('deductions at the finish line: the old regime ties or wins', at.tax.old <= at.tax.new, `old ${at.tax.old} new ${at.tax.new}, claimed ${Math.round(at.claimed.total)} of ${Math.round(base.needed)}`);
  near('the finish line does not move as deductions are added', at.needed, base.needed, 2);
  const under = quickAnswer({ ctc: 1800000, ...full, rentMonthly: rentMonthly - 2000 }, rates);
  ok('24,000 a year short of it: the new regime still wins', under.better === 'new', `old ${under.tax.old} new ${under.tax.new}`);
}

// rent in a metro, a home loan and every deduction: the old regime wins at 18L
{
  const a = quickAnswer({ ctc: 1800000, rentMonthly: 25000, city: 'Mumbai', homeLoanInterest: 200000, other80c: 63600, healthSelf: 25000, nps1b: 50000 }, rates);
  ok('rent + home loan + full 80C, 80D and NPS: old regime wins', a.better === 'old', `old ${a.tax.old} new ${a.tax.new}`);
  ok('HRA exemption is counted for rent in a metro', a.claimed.hra > 0, `hra ${a.claimed.hra}`);
  ok('home-loan interest is capped at 2 lakh', quickAnswer({ ctc: 1800000, homeLoanInterest: 500000 }, rates).claimed.homeLoan === 200000);
  ok('rent alone does not flip 18L', quickAnswer({ ctc: 1800000, rentMonthly: 25000, city: 'Mumbai' }, rates).better === 'new');
}

// low incomes: no tax in either regime, and the answer says so rather than inventing a saving
{
  const a = quickAnswer({ ctc: 600000 }, rates);
  ok('6L: no tax either way', a.tax.new === 0 && a.tax.old === 0 && a.same);
  const b = quickAnswer({ ctc: 1200000 }, rates);
  ok('12L: no tax in the new regime after the rebate', b.tax.new === 0 && b.tax.old > 0 && b.better === 'new');
}

// a Basic share that breaks the split is reported, not computed
ok('Basic of 80% with PF and gratuity: components exceed CTC is reported', !!quickAnswer({ ctc: 1000000, basicPct: 80, hraPct: 50 }, rates).error);

// saved to the profile, the same figures give the same answer on the tax page and the salary page
{
  const q = { ctc: 1800000, rentMonthly: 25000, city: 'Mumbai', homeLoanInterest: 200000, other80c: 63600, healthSelf: 25000, nps1b: 50000 };
  const a = quickAnswer(q, rates);
  const p = fromSalaryStore(emptyProfile(), { ...a.store, regime: a.better }, a.pay);
  p.tax.homeLoanInterest = q.homeLoanInterest;
  const onTaxPage = compareRegimes(toTaxInputs(p), rates);
  near('tax page, old regime: same tax as the quick answer', onTaxPage.old.tax.total, a.tax.old);
  near('tax page, new regime: same tax as the quick answer', onTaxPage.new.tax.total, a.tax.new);
  const onSalaryPage = salaryBreakdown(toSalaryStore(p), rates);
  ok('salary page picks the same regime', onSalaryPage.regime === a.better, onSalaryPage.regime);
  near('salary page: same monthly in-hand', onSalaryPage.monthly, a.monthly.best);
  ok('professional tax defaults to 2,400 in a new profile', emptyProfile().tax.professionalTax === 2400);
}

// the table shown before anything is typed
{
  const rows = ladder(rates);
  ok('ladder has one row per common CTC', rows.length === LADDER_CTCS.length);
  ok('ladder in-hand rises with CTC', rows.every((r, i) => i === 0 || r.monthly > rows[i - 1].monthly));
  ok('ladder: the new regime is never dearer with nothing but PF', rows.every((r) => r.newTax <= r.oldTax));
  const r18 = rows.find((r) => r.ctc === 1800000);
  near('ladder row for 18L matches the answer for 18L', r18.monthly, quickAnswer({ ctc: 1800000 }, rates).monthly.best);
  near('ladder "old wins only above" is the same finish line as the meter', r18.oldNeeds, quickAnswer({ ctc: 1800000 }, rates).needed);
}

console.log(failures ? `\n${failures} failure(s)` : '\nAll quick-answer tests passed');
process.exit(failures ? 1 : 0);
