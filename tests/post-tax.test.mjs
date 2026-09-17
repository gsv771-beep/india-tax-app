// What you keep after tax, instrument by instrument. Run: node tests/post-tax.test.mjs
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { INSTRUMENTS, postTax, compareAll, poTdRate } from '../public/engine/post-tax.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const schemes = JSON.parse(readFileSync(path.join(here, '../public/data/schemes.json'), 'utf8'));
let failures = 0;
const ok = (name, cond, detail = '') => { console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${detail ? ' (' + detail + ')' : ''}`); if (!cond) failures++; };
const near = (name, a, e, tol = 1) => ok(name, Math.abs(a - e) <= tol, `got ${a}, expected ${e}`);
const by = (id) => INSTRUMENTS.find((i) => i.id === id);
const base = { amount: 100000, years: 5, slabRate: 0.3, cess: 0.04, regime: 'new' };

// PPF is tax-free: post equals pre; the pre-tax equivalent at 31.2% is 7.1 / 0.688
{
  const r = postTax(by('ppf'), { ...base, years: 15, ratePct: 7.1 });
  near('PPF: post-tax value equals pre-tax', r.post, r.pre, 0.01);
  near('PPF: pre-tax equivalent of 7.1% for a 30% payer is about 10.3%', r.preTaxEquivalent * 100, 7.1 / (1 - 0.312), 0.01);
  ok('PPF: unavailable for a 5-year horizon', !postTax(by('ppf'), { ...base, ratePct: 7.1 }).available);
}
// FD: interest taxed yearly at slab incl. cess
{
  const r = postTax(by('fd'), { ...base, ratePct: 7.5 });
  near('FD: 7.5% at 31.2% keeps 5.16% a year', r.effPost * 100, 7.5 * (1 - 0.312), 0.01);
  near('FD: value after 5 years', r.post, 100000 * Math.pow(1 + 0.075 * 0.688, 5), 1);
  ok('FD: pre-tax equivalent is its own rate', Math.abs(r.preTaxEquivalent * 100 - 7.5) < 0.01);
}
// Debt fund: same rate as the FD but tax deferred to exit -> slightly more kept
{
  const fd = postTax(by('fd'), { ...base, ratePct: 7.5 });
  const df = postTax(by('debt'), { ...base, ratePct: 7.5 });
  ok('debt fund beats an FD at the same rate because tax is deferred', df.post > fd.post);
  near('debt fund: gain taxed once at exit', df.post, 100000 + (100000 * Math.pow(1.075, 5) - 100000) * 0.688, 1);
}
// Equity: short-term 20%, long-term 12.5% above the exemption
{
  const st = postTax(by('index'), { ...base, years: 1, ratePct: 12 });
  near('equity within a year: 20% + cess on the gain', st.post, 112000 - 12000 * 0.2 * 1.04, 0.01);
  const lt = postTax(by('index'), { ...base, years: 5, ratePct: 12 });
  const gain = 100000 * Math.pow(1.12, 5) - 100000;
  ok('equity over 5 years on 1 lakh: gain within the exemption, no tax', gain < 125000 && Math.abs(lt.post - lt.pre) < 0.01);
  const big = postTax(by('index'), { ...base, amount: 1000000, years: 5, ratePct: 12 });
  const bigGain = 1000000 * Math.pow(1.12, 5) - 1000000;
  near('equity over 5 years on 10 lakh: 12.5% above 1.25 lakh', big.post, 1000000 + bigGain - (bigGain - 125000) * 0.125 * 1.04, 1);
  const noEx = postTax(by('index'), { ...base, amount: 1000000, years: 5, ratePct: 12, ltcgExemptionAvailable: false });
  ok('exemption already used elsewhere: more tax', noEx.post < big.post);
}
// Arbitrage vs liquid: same 7% return, arbitrage held over a year wins for a 30% payer
{
  const liq = postTax(by('liquid'), { ...base, years: 2, ratePct: 7 });
  const arb = postTax(by('arbitrage'), { ...base, years: 2, ratePct: 7 });
  ok('arbitrage beats liquid after a year for a 30% payer', arb.post > liq.post);
  const liq6 = postTax(by('liquid'), { ...base, years: 0.5, ratePct: 7 });
  const arb6 = postTax(by('arbitrage'), { ...base, years: 0.5, ratePct: 7 });
  ok('at 6 months, arbitrage (20% STCG) still edges a liquid fund at 31.2%', arb6.post > liq6.post);
  const nil = postTax(by('liquid'), { ...base, years: 2, ratePct: 7, slabRate: 0 });
  ok('at nil slab a liquid fund keeps everything', Math.abs(nil.post - nil.pre) < 0.01);
}
// NPS: 60% tax-free, 40% annuity taxed
{
  const r = postTax(by('nps'), { ...base, years: 20, ratePct: 9 });
  near('NPS: post = 0.6 pre + 0.4 pre (1 - t)', r.post, 0.6 * r.pre + 0.4 * r.pre * 0.688, 1);
  ok('NPS: locked for a 5-year horizon', !postTax(by('nps'), { ...base, ratePct: 9 }).available);
}
// 80C tax saved on the way in (old regime)
{
  const withRoom = postTax(by('ppf'), { ...base, years: 15, ratePct: 7.1, regime: 'old', has80CRoom: true });
  near('80C: tax saved now on 1 lakh at 31.2%', withRoom.taxSavedNow, 31200);
  ok('80C: all-in return above the plain post-tax return', withRoom.effAllIn > withRoom.effPost);
  ok('80C: nothing saved in the new regime', postTax(by('ppf'), { ...base, years: 15, ratePct: 7.1, regime: 'new', has80CRoom: true }).taxSavedNow === 0);
  near('NPS 80CCD(1B): saving capped at 50,000 of contribution', postTax(by('nps'), { ...base, years: 20, ratePct: 9, regime: 'old', has80CRoom: true }).taxSavedNow, 50000 * 0.312, 0.01);
  near('ELSS: 80C saving capped at 1.5 lakh', postTax(by('elss'), { ...base, amount: 500000, years: 3, ratePct: 12, regime: 'old', has80CRoom: true }).taxSavedNow, 150000 * 0.312, 0.01);
}
// compareAll orders by what you keep, unavailable last
{
  const rates = { savings: 4, liquid: 6.8, fd: 7.5, arbitrage: 7, debt: 7.2, corporate: 7.4, nsc: 7.7, ppf: 7.1, epf: 8.25, ssy: 8.2, nps: 9, elss: 12, index: 12, flexi: 12, gold: 8 };
  const rows = compareAll({ ...base, years: 5 }, rates);
  ok('every instrument with a rate is listed', rows.length === INSTRUMENTS.length);
  ok('available rows first, then locked ones', rows.findIndex((r) => !r.available) > rows.filter((r) => r.available).length - 1);
  ok('available rows sorted by post-tax value', rows.filter((r) => r.available).every((r, i, a) => i === 0 || a[i - 1].post >= r.post));
  ok('PPF and SSY are locked at 5 years, EPF is not', rows.find((r) => r.inst.id === 'ppf').available === false && rows.find((r) => r.inst.id === 'epf').available === true);
}
// post office time deposit tiers
{
  const ss = schemes.small_savings_rates_q2_fy2026_27;
  ok('TD rate: 6 months uses the 1-year rate', poTdRate(ss, 0.5) === ss.time_deposit_1yr.rate);
  ok('TD rate: 4 years uses the 3-year rate', poTdRate(ss, 4) === ss.time_deposit_3yr.rate);
  ok('TD rate: 10 years uses the 5-year rate', poTdRate(ss, 10) === ss.time_deposit_5yr.rate);
}

console.log(failures === 0 ? '\nAll post-tax tests passed.' : `\n${failures} post-tax test(s) FAILED.`);
process.exit(failures === 0 ? 0 : 1);
