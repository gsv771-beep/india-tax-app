// "Did you know?" examples: every figure is what the calculator shows when the link opens it. Run: node tests/tips.test.mjs
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { tips, sipValue, loanSim } from '../public/engine/tips.js';
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
  for (const opts of [{ extra: 100000 }, { stepUpPct: 3 }, { stepUpPct: 7 }]) {
    const mine = loanSim(5e6, 8.5, 20, opts), theirs = simulateLoan({ principal: 5e6, annualRatePct: 8.5, tenureMonths: 240, annualPrepay: opts.extra || 0, stepUpPct: opts.stepUpPct || 0 });
    ok(`loan maths is the EMI calculator's (${JSON.stringify(opts)})`, mine.months === theirs.months && Math.abs(mine.interest - theirs.totalInterest) < 1, `${mine.months} vs ${theirs.months}`);
  }
}

// ₹1 crore in 10 years from ₹35,000 a month, raised every year
{
  const t = by['sip-crore'], v = t.handoff.values;
  const fv = sipFV(v.monthly, v.ratePct, v.years, v.stepUpPct).fv;
  ok('1 crore: ₹35,000 a month for 10 years at 12%', v.monthly === 35000 && v.years === 10 && v.ratePct === 12);
  ok('1 crore: with the yearly raise it reaches ₹1 crore in the SIP calculator', fv >= 1e7, `${v.stepUpPct}% -> ${inr(fv)}`);
  ok('1 crore: a raise one point smaller does not', sipFV(v.monthly, 12, 10, v.stepUpPct - 1).fv < 1e7);
  ok('1 crore: says what the flat SIP reaches, and that returns are not guaranteed', t.text.includes(`₹${+(sipFV(35000, 12, 10).fv / 1e5).toFixed(1)} lakh`) && t.text.includes(`${v.stepUpPct}% every year`) && /not guaranteed/.test(t.text), t.text);
  ok('1 crore: hands the SIP calculator its figures, clean', t.handoff.to === 'sip' && v.fresh === true);
}

// a home loan closed 5 years early by raising the EMI every year
{
  const t = by['loan-early'], v = t.handoff.values;
  const base = simulateLoan({ principal: v.principal, annualRatePct: v.ratePct, tenureMonths: v.years * 12 });
  const up = simulateLoan({ principal: v.principal, annualRatePct: v.ratePct, tenureMonths: v.years * 12, stepUpPct: v.stepUpPct });
  ok('loan: the step-up EMI closes it at least 5 years early in the EMI calculator', up.months <= 180, `${v.stepUpPct}% -> ${up.months} months`);
  ok('loan: a step-up one point smaller does not', simulateLoan({ principal: v.principal, annualRatePct: v.ratePct, tenureMonths: 240, stepUpPct: v.stepUpPct - 1 }).months > 180);
  const saved = base.totalInterest - up.totalInterest;
  ok('loan: the interest saved is the calculator\'s, to a tenth of a lakh', t.text.includes(`₹${+(saved / 1e5).toFixed(1)} lakh`), `${inr(saved)} | ${t.text}`);
  ok('loan: says how long it takes and where the EMI starts', t.text.includes(`${Math.floor(up.months / 12)} years`) && t.text.includes(inr(base.emi)));
  ok('loan: hands the EMI calculator the step-up, clean, with no prepayment', t.handoff.to === 'emi' && v.fresh === true && v.stepUpPct > 0 && !v.annualPrepay);
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
