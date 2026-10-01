// Offer comparison: what two offers put in the bank. Run: node tests/offer.test.mjs
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { offerYear, compareOffers } from '../public/engine/offer.js';
import { quickAnswer } from '../public/js/quick-engine.js';
import { ask } from '../public/engine/ask.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const rates = JSON.parse(readFileSync(path.join(here, '../public/data/tax_rates.json'), 'utf8'));
const glossary = JSON.parse(readFileSync(path.join(here, '../public/data/glossary.json'), 'utf8'));
let failures = 0;
const ok = (name, cond, detail = '') => { console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${detail ? ' (' + detail + ')' : ''}`); if (!cond) failures++; };
const near = (name, a, e, tol = 1) => ok(name, Math.abs(a - e) <= tol, `got ${Math.round(a)}, expected ${Math.round(e)}`);

ok('no CTC, no answer', !!offerYear({ ctc: '' }, rates).error);

// a plain offer is the quick answer's figure, so the two pages never disagree
for (const ctc of [800000, 1800000, 3500000]) {
  const y = offerYear({ ctc }, rates), q = quickAnswer({ ctc }, rates);
  near(`${ctc / 1e5}L, nothing else: monthly in-hand equals the quick answer`, y.monthly, q.monthly.best);
  near(`${ctc / 1e5}L: the year's cash is twelve months of it`, y.cash, y.monthly * 12);
}

// variable pay: only what is expected to be paid arrives, and it is taxed with the salary
{
  const full = offerYear({ ctc: 2400000, variablePct: 20, payoutPct: 100 }, rates);
  const part = offerYear({ ctc: 2400000, variablePct: 20, payoutPct: 70 }, rates);
  near('20% variable at 70% payout: 1.44 lakh never arrives', part.variableShortfall, 144000);
  ok('less variable, less cash in the year', part.cash < full.cash, `${Math.round(part.cash)} < ${Math.round(full.cash)}`);
  ok('the month is the same either way, give or take the tax share', Math.abs(part.monthly - full.monthly) < 3000);
  const plain = offerYear({ ctc: 2400000 }, rates);
  ok('a CTC with 20% variable pays less each month than the same CTC all fixed', full.monthly < plain.monthly - 15000, `${Math.round(full.monthly)} vs ${Math.round(plain.monthly)}`);
}

// the joining bonus: year 1 only, taxed on top of the salary
{
  const y1 = offerYear({ ctc: 2000000, joiningBonus: 200000 }, rates, { year: 1 });
  const y2 = offerYear({ ctc: 2000000, joiningBonus: 200000 }, rates, { year: 2 });
  const none = offerYear({ ctc: 2000000 }, rates);
  ok('joining bonus in year 1 only', y1.joining === 200000 && y2.joining === 0);
  near('its tax is the extra tax it causes', y1.joiningTax, y1.tax - none.tax);
  // 20L CTC: about 18.4 lakh of salary, so the bonus lands in the new regime's 20% and 25% slabs, plus cess
  ok('at 20L it is taxed at the 20-25% slabs plus cess', y1.joiningTax / 200000 > 0.2 && y1.joiningTax / 200000 < 0.27, (y1.joiningTax / 200000).toFixed(3));
  near('year 1 cash is year 2 cash plus the bonus after its tax', y1.cash, y2.cash + 200000 - y1.joiningTax);
}

// PF outside the CTC is more saved for you, and gratuity is counted apart from cash
{
  const inside = offerYear({ ctc: 2000000 }, rates), outside = offerYear({ ctc: 2000000, pfInCtc: false }, rates);
  near('PF on top of the CTC: that much more is paid to you', outside.grossSalary - inside.grossSalary, outside.employerPfOutside);
  near('and the same is still saved for you', outside.retirement, inside.retirement);
}

// a hike lifts year 2
{
  const y2 = offerYear({ ctc: 2000000, hikePct: 10 }, rates, { year: 2 }), y1 = offerYear({ ctc: 2000000, hikePct: 10 }, rates, { year: 1 });
  ok('a 10% hike raises year 2 fixed pay by 10%', Math.abs(y2.fixedCtc / y1.fixedCtc - 1.1) < 1e-9 && y2.monthly > y1.monthly);
}

// variable pay on top of the CTC: the fixed pay is the whole CTC, and the package is bigger
{
  const top = offerYear({ ctc: 2000000, variablePct: 20, variableOnTop: true }, rates), inside = offerYear({ ctc: 2000000, variablePct: 20 }, rates), plain = offerYear({ ctc: 2000000 }, rates);
  near('on top: the month is the all-fixed CTC\'s month, give or take the tax share', top.grossSalary, plain.grossSalary);
  ok('on top: more cash in the year than the same variable inside the CTC', top.cash > inside.cash + 300000, `${Math.round(top.cash)} vs ${Math.round(inside.cash)}`);
  ok('on top: the package is CTC plus the target', top.totalPackage === 2400000);
}

// retention bonus: the same money as a joining bonus, named for what it is
{
  const ret = offerYear({ ctc: 3600000, joiningBonus: 300000, bonusKind: 'retention' }, rates), join = offerYear({ ctc: 3600000, joiningBonus: 300000 }, rates);
  ok('a retention bonus is taxed like a joining bonus', ret.bonusKind === 'retention' && Math.abs(ret.cash - join.cash) < 1 && ret.bonusTax > 0);
}

// relocation: taxed as salary, unless reimbursed against bills
{
  const base = offerYear({ ctc: 3300000 }, rates);
  near('relocation against bills arrives in full', offerYear({ ctc: 3300000, relocation: 100000, relocationBills: true }, rates).cash - base.cash, 100000);
  const taxed = offerYear({ ctc: 3300000, relocation: 100000 }, rates).cash - base.cash;
  ok('a taxable relocation loses its slab rate', taxed > 60000 && taxed < 80000, Math.round(taxed));
  ok('relocation is year 1 only', offerYear({ ctc: 3300000, relocation: 100000 }, rates, { year: 2 }).relocation === 0);
}

// stock: taxed as salary when it vests, never counted as cash
{
  const s = offerYear({ ctc: 3300000, stockPerYear: 500000 }, rates), none = offerYear({ ctc: 3300000 }, rates);
  near('stock does not change the cash', s.cash, none.cash);
  ok('stock vesting at 33L is taxed at 30% plus cess, or close', s.stockTax / 500000 > 0.3 && s.stockTax / 500000 < 0.33, (s.stockTax / 500000).toFixed(3));
  near('cash with stock adds the stock after its tax', s.cashWithStock, s.cash + 500000 - s.stockTax);
  const r = compareOffers({ ctc: 3600000 }, { ctc: 3300000, stockPerYear: 500000 }, rates);
  ok('a lower CTC with stock: less cash, more with the stock', r.hasStock && r.diff.twoYears < 0 && r.diff.withStock > 0, `${Math.round(r.diff.twoYears)} / ${Math.round(r.diff.withStock)}`);
}

// the comparison: the trap the page exists for
{
  const r = compareOffers({ ctc: 2000000 }, { ctc: 2400000, variablePct: 20, payoutPct: 70, joiningBonus: 200000 }, rates);
  ok('a bigger CTC full of variable pay and a joining bonus pays less each month', r.diff.monthly < 0, Math.round(r.diff.monthly));
  ok('but more over two years', r.diff.twoYears > 0, Math.round(r.diff.twoYears));
  near('the two-year difference is the sum of the years', r.diff.twoYears, r.diff.y1 + r.diff.y2);
  ok('an error on either side is reported', !!compareOffers({ ctc: 2000000 }, { ctc: '' }, rates).error);
  ok('a Basic that breaks the split is reported', !!offerYear({ ctc: 1000000, basicPct: 95 }, rates).error);
}

// Ask sends offer questions here
for (const q of ['compare two job offers', 'offer A 25 lakh vs offer B 28 lakh which is better', 'should I accept this offer', 'is the joining bonus taxed', 'I am switching job']) {
  ok(`ask: "${q}" -> offer comparison`, ask(q, { glossary }).links[0]?.href === '/calculators/offer');
}
ok('ask: a salary on its own still goes to the tax page', ask('Ctc is 70 lakh', { glossary }).links[0]?.href === '/tax?ctc=7000000');

console.log(failures ? `\n${failures} failure(s)` : '\nAll offer tests passed');
process.exit(failures ? 1 : 0);
