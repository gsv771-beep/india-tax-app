// Idle money: a savings account against a sweep-in FD, a liquid fund and an arbitrage fund, after tax.
// Run: node tests/idle-money.test.mjs. The expected figures are worked out by hand from the rates and
// tax rules in public/data/idle_money.json.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { afterTax, compare, optionById } from '../public/engine/idle-money.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const data = JSON.parse(readFileSync(path.join(here, '../public/data/idle_money.json'), 'utf8'));
let failures = 0;
const ok = (name, cond, detail = '') => { console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${detail ? ' (' + detail + ')' : ''}`); if (!cond) failures++; };
const near = (name, a, e, tol = 1) => ok(name, Math.abs(a - e) <= tol, `got ${Math.round(a)}, expected ${Math.round(e)}`);

// ---- the data file holds together ----
ok('four places, the savings account first', data.options.map((o) => o.id).join() === 'savings,sweep,liquid,arbitrage');
ok('each has a rate, how it is taxed, how fast the money comes back and how safe it is', data.options.every((o) => o.rate_pct > 0 && o.rate_pct < 12 && ['interest', 'slab_at_exit', 'equity'].includes(o.tax) && o.rate_note && o.access && o.safety));
ok('the file is dated and sourced', /^\d{4}-\d{2}-\d{2}$/.test(data._meta.compiled_on) && data.sources.length >= 3);
ok('no fund or bank product is named as a pick', !/best|recommend|should (buy|invest)/i.test(JSON.stringify(data.options)));

// ---- ₹5 lakh for 3 years at the 30% slab (31.2% with cess), new regime ----
const A = { amount: 500000, years: 3, slabPct: 30 };
const T = 0.312;
{
  // savings account: 2.5% compounding quarterly is 2.5235% a year; the tax on each year's interest leaves the balance
  const e = Math.pow(1 + 0.025 / 4, 4) - 1;
  const s = afterTax('savings', A, data);
  near('savings account: ₹5,26,498 after tax', s.value, 500000 * Math.pow(1 + e * (1 - T), 3));
  near('... which is ₹5,26,498', s.value, 526498, 1);
  near('... tax paid is 31.2% of the interest', s.tax, s.gross * T, 0.5);
  // sweep-in FD: 6.25% compounding quarterly is 6.398% a year
  const e2 = Math.pow(1 + 0.0625 / 4, 4) - 1;
  near('sweep-in FD: ₹5,68,977 after tax', afterTax('sweep', A, data).value, 500000 * Math.pow(1 + e2 * (1 - T), 3));
  // liquid fund: 6% a year untaxed until it is taken out, then the whole gain at the slab
  const lg = 500000 * (Math.pow(1.06, 3) - 1);
  const l = afterTax('liquid', A, data);
  near('liquid fund: gain ₹95,508, tax ₹29,798, ₹5,65,709 after tax', l.value, 500000 + lg * (1 - T));
  near('... the gain before tax', l.gross, 95508);
  // arbitrage fund: 6.3% a year; the ₹1,00,579 gain after more than 12 months is inside the ₹1.25 lakh exemption
  const ag = 500000 * (Math.pow(1.063, 3) - 1);
  const a = afterTax('arbitrage', A, data);
  near('arbitrage fund: gain ₹1,00,579, no tax, ₹6,00,579', a.value, 500000 + ag);
  ok('... no tax inside the exemption', a.tax === 0);
  near('... with the exemption already used: 12.5% and cess on the whole gain', afterTax('arbitrage', { ...A, ltcgExemptionUsed: true }, data).value, 500000 + ag * (1 - 0.125 * 1.04));
}

// ---- compare: the extra over the savings account, and which is highest ----
{
  const r = compare(A, data);
  const by = Object.fromEntries(r.options.map((o) => [o.id, o]));
  // one year at the 20% slab turns the order: an arbitrage fund sold at 12 months pays 20%, and the deposit comes out highest
  ok('over one year at a 20% slab the sweep-in FD is the highest instead', compare({ amount: 1000000, years: 1, slabPct: 20 }, data).best.id === 'sweep');
  ok('the savings account is the base, with no extra', r.base.id === 'savings' && by.savings.extra === 0);
  near('the sweep-in FD ends ₹42,479 ahead of it', by.sweep.extra, 42479, 2);
  near('the liquid fund ₹39,212 ahead', by.liquid.extra, 39212, 2);
  near('the arbitrage fund ₹74,081 ahead', by.arbitrage.extra, 74081, 2);
  ok('the highest after tax is named (the arbitrage fund here)', r.best.id === 'arbitrage');
  near('after tax the savings account earned 1.74% a year', by.savings.afterTaxPct * 100, 173.6, 1);
  near('... and the sweep-in FD 4.40%', by.sweep.afterTaxPct * 100, 440.2, 1);
  ok('a line for each, from today to the end', r.series.length === 4 && r.series.every((s) => s.points.length === 4 && s.points[0][1] === 500000 && Math.abs(s.points[3][1] - by[s.id].value) < 0.01));
}

// ---- the rules at their edges ----
{
  // old regime: the first ₹10,000 of savings interest each year is not taxed (80TTA), FD interest is
  const e = Math.pow(1 + 0.025 / 4, 4) - 1;
  const y1 = 500000 * e;   // ₹12,618 in year one
  near('old regime, savings account, one year: only the interest above ₹10,000 is taxed', afterTax('savings', { ...A, years: 1, oldRegime: true }, data).value, 500000 + y1 - (y1 - 10000) * T);
  ok('... the sweep-in FD is taxed the same in both regimes', afterTax('sweep', { ...A, oldRegime: true }, data).value === afterTax('sweep', A, data).value);
  // exactly 12 months is still short-term for an arbitrage fund: 20% and cess
  const g = 500000 * 0.063;
  near('arbitrage fund taken out at 12 months: 20% and cess on the gain', afterTax('arbitrage', { ...A, years: 1 }, data).value, 500000 + g * (1 - 0.20 * 1.04));
  // no tax at a nil slab on interest or a liquid fund
  ok('at a nil slab, interest and a liquid fund keep everything', afterTax('savings', { ...A, slabPct: 0 }, data).tax === 0 && afterTax('liquid', { ...A, slabPct: 0 }, data).tax === 0);
  near('a rate typed in replaces the file’s', afterTax('liquid', { ...A, rates: { liquid: 7 } }, data).gross, 500000 * (Math.pow(1.07, 3) - 1));
  ok('nothing put in, nothing compared', compare({ amount: 0, years: 3, slabPct: 30 }, data).best === null);
}

// ---- money added each month ----
{
  const M = { amount: 0, monthly: 10000, years: 2, slabPct: 30 };
  const f = Math.pow(1.06, 1 / 12);
  let v = 0; for (let m = 1; m <= 24; m++) v += 10000 * Math.pow(f, 24 - m);
  const l = afterTax('liquid', M, data);
  near('liquid fund, ₹10,000 at the end of each month for 2 years: each sum grows for the months it was in', l.gross, v - 240000);
  near('... ₹2,40,000 put in', l.invested, 240000);
  // arbitrage: sums put in during the last 12 months are short-term (20%), the earlier ones long-term
  const fa = Math.pow(1.063, 1 / 12);
  let sg = 0, lgn = 0; for (let m = 1; m <= 24; m++) { const held = 24 - m, gain = 10000 * (Math.pow(fa, held) - 1); if (held <= 12) sg += gain; else lgn += gain; }
  const a = afterTax('arbitrage', { ...M, ltcgExemptionUsed: true }, data);
  near('arbitrage fund: recent sums at 20%, older ones at 12.5%, cess on both', a.tax, (sg * 0.20 + lgn * 0.125) * 1.04, 0.5);
  ok('the savings account also takes the monthly sums', afterTax('savings', M, data).invested === 240000 && afterTax('savings', M, data).value > 240000);
}

ok('a place not in the file is not found', optionById(data, 'shares') === null);
console.log(failures ? `\n${failures} failure(s)` : '\nAll idle-money tests passed');
process.exit(failures ? 1 : 0);
