// "Did you know?" examples: every figure is what the calculator shows when the link opens it. Run: node tests/tips.test.mjs
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { tips, sipValue, loanWithYearlyExtra } from '../public/engine/tips.js';
import { sipFV, simulateLoan, emi } from '../public/js/calculators.js';
import { quickAnswer } from '../public/js/quick-engine.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const rates = JSON.parse(readFileSync(path.join(here, '../public/data/tax_rates.json'), 'utf8'));
let failures = 0;
const ok = (name, cond, detail = '') => { console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${detail ? ' (' + detail + ')' : ''}`); if (!cond) failures++; };
const inr = (n) => `₹${Math.round(n).toLocaleString('en-IN')}`;

const list = tips(rates);
const by = Object.fromEntries(list.map((t) => [t.id, t]));
ok('five examples', list.length === 5, list.map((t) => t.id).join(', '));
ok('every example has a hook, a sentence and a site link', list.every((t) => t.hook && t.text && t.cta && t.href.startsWith('/')));
ok('no example has a broken number', list.every((t) => !/NaN|undefined|Infinity|null/.test(t.hook + t.text)));

// the arithmetic agrees with the calculators' own
ok('SIP maths is the SIP calculator\'s', Math.abs(sipValue(10000, 12, 10) - sipFV(10000, 12, 10).fv) < 1 && Math.abs(sipValue(10000, 12, 10, 10) - sipFV(10000, 12, 10, 10).fv) < 1);
{
  const mine = loanWithYearlyExtra(5e6, 8.5, 20, 100000), theirs = simulateLoan({ principal: 5e6, annualRatePct: 8.5, tenureMonths: 240, annualPrepay: 100000 });
  ok('loan maths is the EMI calculator\'s', mine.months === theirs.months && Math.abs(mine.interest - theirs.totalInterest) < 1, `${mine.months} vs ${theirs.months}`);
}

// ₹1 crore in 7 years
{
  const t = by['sip-crore'], v = t.handoff.values;
  const fv = sipFV(v.monthly, v.ratePct, v.years).fv;
  ok('1 crore: the SIP reaches ₹1 crore in 7 years at 12%', fv >= 1e7 && v.years === 7 && v.ratePct === 12, inr(fv));
  ok('1 crore: and ₹100 less a month does not', sipFV(v.monthly - 100, 12, 7).fv < 1e7);
  ok('1 crore: the sentence names the SIP the calculator is given', t.text.includes(inr(v.monthly)) && /not guaranteed/.test(t.text), t.text);
  ok('1 crore: hands the SIP calculator its figures, clean', t.handoff.to === 'sip' && v.fresh === true && v.stepUpPct === 0);
}

// a home loan closed 5 years early
{
  const t = by['loan-early'], v = t.handoff.values;
  const base = simulateLoan({ principal: v.principal, annualRatePct: v.ratePct, tenureMonths: v.years * 12 });
  const early = simulateLoan({ principal: v.principal, annualRatePct: v.ratePct, tenureMonths: v.years * 12, annualPrepay: v.annualPrepay, annualPrepayStartYear: 1, mode: 'reduce_tenure' });
  ok('loan: the yearly extra closes it within 15 years in the EMI calculator', early.months <= 180 && early.months > 168, `${early.months} months`);
  ok('loan: ₹5,000 less a year does not', simulateLoan({ principal: v.principal, annualRatePct: v.ratePct, tenureMonths: 240, annualPrepay: v.annualPrepay - 5000 }).months > 180);
  const saved = base.totalInterest - early.totalInterest;
  ok('loan: the interest saved is the calculator\'s, to a tenth of a lakh', t.text.includes(`₹${+(saved / 1e5).toFixed(1)} lakh`), `${inr(saved)} | ${t.text}`);
  ok('loan: the sentence names the extra and the EMI calculator gets it', t.text.includes(inr(v.annualPrepay)) && t.handoff.to === 'emi' && v.fresh === true);
  ok('loan: a ₹50 lakh, 20-year loan at 8.5% has the textbook EMI', Math.round(emi(v.principal, v.ratePct, v.years).emi) === 43391);
}

// the step-up SIP
{
  const t = by['step-up'], v = t.handoff.values;
  const flat = sipFV(v.monthly, v.ratePct, v.years).fv, stepped = sipFV(v.monthly, v.ratePct, v.years, v.stepUpPct).fv;
  ok('step-up: both figures are the SIP calculator\'s', t.text.includes(`₹${+(flat / 1e5).toFixed(1)} lakh`) && t.text.includes(`₹${+(stepped / 1e7).toFixed(2)} crore`), t.text);
  ok('step-up: hands over the 10% step-up', v.stepUpPct === 10 && t.handoff.to === 'sip');
}

// tax: no tax up to a CTC, and the regime at 18 lakh
{
  const t = by['zero-tax'], ctc = t.check.ctc;
  ok('zero tax: the CTC named pays no tax in the new regime', quickAnswer({ ctc }, rates).tax.new === 0, inr(ctc));
  ok('zero tax: ₹10,000 more does', quickAnswer({ ctc: ctc + 10000 }, rates).tax.new > 0);
  ok('zero tax: links the tax page with that CTC', t.href === `/tax?ctc=${ctc}` && !t.handoff);
  const r = by['regime-18'], a = quickAnswer({ ctc: 1800000 }, rates);
  ok('18L: the saving is the quick answer\'s', r.hook.includes(inr(a.saves)) && r.text.includes(inr(a.saves)) && r.href === '/tax?ctc=1800000');
}

ok('the list is computed once per rates object', tips(rates) === list);

console.log(failures ? `\n${failures} failure(s)` : '\nAll tip tests passed');
process.exit(failures ? 1 : 0);
