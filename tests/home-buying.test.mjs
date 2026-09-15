// True cost of buying, home loan eligibility, and the SIP calculator's lump sums.
// Run: node tests/home-buying.test.mjs
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { propertyCost, stampDuty, registrationFee, gstOnPurchase, PROPERTY_CITIES } from '../public/engine/property.js';
import { loanEligibility, maxLoanByLtv, principalForEmi, emiFor, foirFor, scorePremiumBps } from '../public/engine/loan-eligibility.js';
import { sipFV, lumpsumFV } from '../public/js/calculators.js';
import { paymentPlan, PLAN_PRESETS, presetFor } from '../public/engine/payment-plan.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const charges = JSON.parse(readFileSync(path.join(here, '../public/data/property_charges.json'), 'utf8'));
const policy = JSON.parse(readFileSync(path.join(here, '../public/data/loan_policy.json'), 'utf8'));
let failures = 0;
const ok = (name, cond, detail = '') => { console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${detail ? ' (' + detail + ')' : ''}`); if (!cond) failures++; };
const near = (name, a, e, tol = 1) => ok(name, Math.abs(a - e) <= tol, `got ${Math.round(a)}, expected ${Math.round(e)}`);

// ---- data hygiene ----
ok('every supported city has charge data', PROPERTY_CITIES.every((c) => charges.cities[c]));
for (const c of PROPERTY_CITIES) {
  const sd = charges.cities[c].stamp_duty;
  ok(`${c}: stamp duty has a confidence and a source`, ['verified', 'corroborated', 'unverified'].includes(sd.confidence) && sd.sources.length > 0);
  ok(`${c}: registration has a rate`, charges.cities[c].registration.rate > 0);
}

// ---- stamp duty and registration, one crore of flat ----
const CR = 10000000;
near('Mumbai, man: 6% stamp duty', stampDuty('Mumbai', CR, 'man', charges).amount, 600000);
near('Mumbai, woman: 5%', stampDuty('Mumbai', CR, 'woman', charges).amount, 500000);
near('Mumbai registration capped at 30,000', registrationFee('Mumbai', CR, charges).amount, 30000);
near('Pune, man: 7%', stampDuty('Pune', CR, 'man', charges).amount, 700000);
near('Delhi, woman: 4%', stampDuty('Delhi', CR, 'woman', charges).amount, 400000);
near('Delhi, joint: 5%', stampDuty('Delhi', CR, 'joint', charges).amount, 500000);
near('Delhi registration 1% + 100', registrationFee('Delhi', CR, charges).amount, 100100);
near('Bengaluru above 45L: 5% + 12% of the duty = 5.6%', stampDuty('Bengaluru', CR, 'man', charges).amount, 560000);
near('Bengaluru 30L flat sits in the 3% slab', stampDuty('Bengaluru', 3000000, 'man', charges).amount, 3000000 * 0.03 * 1.12);
near('Bengaluru registration 2%', registrationFee('Bengaluru', CR, charges).amount, 200000);
near('Hyderabad: 4% + 1.5% transfer duty', stampDuty('Hyderabad', CR, 'man', charges).amount, 550000);
near('Hyderabad registration 0.5%', registrationFee('Hyderabad', CR, charges).amount, 50000);
near('Chennai: 7%', stampDuty('Chennai', CR, 'woman', charges).amount, 700000);
near('Chennai registration 4%', registrationFee('Chennai', CR, charges).amount, 400000);
near('Kolkata at exactly 1 crore: 6%', stampDuty('Kolkata', CR, 'man', charges).amount, 600000);
near('Kolkata above 1 crore: 7% on the whole value', stampDuty('Kolkata', CR + 1, 'man', charges).amount, (CR + 1) * 0.07, 1);
near('GST 5% under construction', gstOnPurchase(CR, 'under_construction', false, charges).amount, 500000);
near('GST 1% affordable', gstOnPurchase(4000000, 'under_construction', true, charges).amount, 40000);
near('No GST on resale', gstOnPurchase(CR, 'resale', false, charges).amount, 0);

// ---- the full bill ----
{
  const r = propertyCost({ city: 'Mumbai', price: CR, status: 'under_construction', buyer: 'man', builderCharges: [{ label: 'Parking', amount: 500000 }, { label: 'Clubhouse', amount: 200000 }], loanAmount: 7500000 }, charges);
  near('Mumbai 1cr under construction: statutory = stamp + reg + GST', r.statutory, 600000 + 30000 + 500000);
  near('builder charges summed', r.builder, 700000);
  ok('no brokerage on a builder sale by default', !r.lines.some((l) => l.id === 'brokerage'));
  near('processing fee capped at 25,000', r.lines.find((l) => l.id === 'processing_fee').amount, 25000);
  near('mortgage deed stamp 0.3% of 75L', r.lines.find((l) => l.id === 'mortgage_stamp').amount, 22500);
  near('total = price + everything else', r.total, CR + r.hiddenTotal);
  ok('hidden share is about 19% here', r.hiddenPct > 0.18 && r.hiddenPct < 0.20, String(r.hiddenPct));
  ok('TDS note appears at or above 50L', r.notes.some((n) => /TDS/.test(n)));
}
{
  const r = propertyCost({ city: 'Chennai', price: 8000000, status: 'resale', buyer: 'man', brokerageRate: 0.02 }, charges);
  near('Chennai resale: 11% statutory', r.statutory, 880000);
  near('2% brokerage on resale', r.lines.find((l) => l.id === 'brokerage').amount, 160000);
  ok('no GST line on resale', !r.lines.some((l) => l.id === 'gst'));
  ok('no loan lines without a loan', !r.lines.some((l) => l.kind === 'loan'));
}
ok('unverified stamp duty raises a warning', propertyCost({ city: 'Bengaluru', price: CR, loanAmount: 0 }, charges).warnings.length > 0);

// ---- eligibility building blocks ----
near('EMI 50L 8.5% 20y', emiFor(5000000, 8.5, 240), 43391.16, 0.01);
near('principalForEmi inverts emiFor', principalForEmi(43391.16, 8.5, 240), 5000000, 1);
near('LTV: 25L flat -> 90%', maxLoanByLtv(2500000, policy), 2250000);
near('LTV: 35L flat -> 30L cap beats 80% of 35L', maxLoanByLtv(3500000, policy), 3000000);
near('LTV: 50L flat -> 80%', maxLoanByLtv(5000000, policy), 4000000);
near('LTV: 1cr flat -> 75L cap beats 75% of 1cr', maxLoanByLtv(10000000, policy), 7500000);
near('LTV: 1.2cr flat -> 75%', maxLoanByLtv(12000000, policy), 9000000);
ok('FOIR rises with income', foirFor(40000, 'salaried', policy) < foirFor(80000, 'salaried', policy) && foirFor(80000, 'salaried', policy) < foirFor(200000, 'salaried', policy));
ok('self-employed FOIR is tighter', foirFor(200000, 'self_employed', policy) < foirFor(200000, 'salaried', policy));
ok('score premium: 780 -> 0, 720 -> 15, 660 -> 50, unknown -> 0', scorePremiumBps(780, policy) === 0 && scorePremiumBps(720, policy) === 15 && scorePremiumBps(660, policy) === 50 && scorePremiumBps(0, policy) === 0);

// ---- eligibility scenarios ----
{
  // 1.5L net, no EMIs, 32 years old, 20 years wanted, 8%: FOIR 60% -> max EMI 90,000
  const r = loanEligibility({ netMonthly: 150000, existingEmi: 0, creditScore: 780, age: 32, tenureYears: 20, ratePct: 8 }, policy);
  near('max EMI = 60% of 1.5L', r.maxEmi, 90000);
  near('max loan by FOIR', r.maxByFoir, principalForEmi(90000, 8, 240), 1);
  ok('no property: FOIR binds', r.binding === 'foir' && r.maxByLtv === null);
  ok('tenure allowed 28 years at 32 (ends by 60), used 20', r.tenure.allowedByAge === 28 && r.tenure.used === 20);
  ok('lever: take the full 28 years', r.levers.some((l) => l.id === 'longer_tenure' && l.gain > 0));
  ok('lever: co-applicant', r.levers.some((l) => l.id === 'co_applicant' && l.gain > 0));
}
{
  // Same person, 60L flat: LTV cap 48L is below FOIR capacity -> LTV binds
  const r = loanEligibility({ netMonthly: 150000, creditScore: 780, age: 32, tenureYears: 20, ratePct: 8, propertyPrice: 6000000 }, policy);
  near('LTV cap on 60L flat is 48L', r.maxByLtv, 4800000);
  ok('LTV binds', r.binding === 'ltv' && Math.abs(r.maxLoan - 4800000) < 1);
  ok('LTV lever is informational', r.levers.some((l) => l.id === 'ltv' && l.info));
}
{
  // Existing car EMI of 25,000 cuts capacity; clearing it is the top lever
  const base = loanEligibility({ netMonthly: 100000, existingEmi: 0, creditScore: 780, age: 30, tenureYears: 20, ratePct: 8 }, policy);
  const withCar = loanEligibility({ netMonthly: 100000, existingEmi: 25000, creditScore: 780, age: 30, tenureYears: 20, ratePct: 8 }, policy);
  near('max EMI = 55% of 1L - 25,000', withCar.maxEmi, 30000);
  near('clearing the EMI restores the base ceiling', withCar.levers.find((l) => l.id === 'clear_emis').gain, base.maxLoan - withCar.maxLoan, 1);
  ok('credit card outstanding counts at 5%', loanEligibility({ netMonthly: 100000, creditCardOutstanding: 200000, creditScore: 780, age: 30, tenureYears: 20, ratePct: 8 }, policy).existingEmi === 10000);
}
{
  // 48 years old, salaried, wants 25 years: only 12 allowed by a 60 cutoff
  const r = loanEligibility({ netMonthly: 200000, creditScore: 780, age: 48, tenureYears: 25, ratePct: 8 }, policy);
  ok('tenure capped at 12 years', r.tenure.allowedByAge === 12 && r.tenure.used === 12);
  ok('binding reported as tenure', r.binding === 'tenure');
  ok('lever: a lender allowing the loan to 70', r.levers.some((l) => l.id === 'later_cutoff' && l.gain > 0));
  near('override cutoff to 70 -> 22 years', loanEligibility({ netMonthly: 200000, creditScore: 780, age: 48, tenureYears: 25, ratePct: 8, overrides: { loanEndAge: 70 } }, policy).tenure.used, 22);
}
{
  const r = loanEligibility({ netMonthly: 200000, creditScore: 600, age: 30, tenureYears: 20, ratePct: 8 }, policy);
  ok('score below 650 is a refusal', r.rejected && r.maxLoan === 0 && r.binding === 'credit');
  const r2 = loanEligibility({ netMonthly: 200000, creditScore: 720, age: 30, tenureYears: 20, ratePct: 8 }, policy);
  ok('720 pays 0.15% more', Math.abs(r2.rate.effective - 8.15) < 1e-9);
  ok('lever: raise the score', r2.levers.some((l) => l.id === 'score' && l.gain > 0));
}
{
  const r = loanEligibility({ netMonthly: 150000, coApplicantMonthly: 80000, variablePayMonthly: 20000, creditScore: 780, age: 30, tenureYears: 20, ratePct: 8 }, policy);
  near('co-applicant counted in full, variable pay at half', r.income.counted, 150000 + 80000 + 10000);
  ok('gross basis switches the income used', loanEligibility({ netMonthly: 100000, grossMonthly: 130000, overrides: { incomeBasis: 'gross' }, creditScore: 780, age: 30, tenureYears: 20, ratePct: 8 }, policy).income.own === 130000);
  const want = loanEligibility({ netMonthly: 150000, creditScore: 780, age: 30, tenureYears: 20, ratePct: 8, loanWanted: 30000000 }, policy);
  ok('asking for more than the ceiling reports the shortfall', want.shortfall > 0 && Math.abs(want.loan - want.maxLoan) < 1);
}

// ---- SIP with lump sums ----
near('lump sum today, no SIP, compounds monthly at 1% for 120 months', sipFV(0, 12, 10, 0, 0, [{ amount: 1000000, atYear: 0 }]).fv, 1000000 * Math.pow(1.01, 120), 0.01);
ok('monthly compounding sits above the annual-CAGR lumpsum formula, as expected', sipFV(0, 12, 10, 0, 0, [{ amount: 1000000, atYear: 0 }]).fv > lumpsumFV(1000000, 12, 10).fv);
near('lump sum at end of year 10 of a 10-year plan is added uncompounded', sipFV(0, 12, 10, 0, 0, [{ amount: 500000, atYear: 10 }]).fv, 500000, 0.01);
near('lump sum at end of year 5 compounds 5 years', sipFV(0, 12, 10, 0, 0, [{ amount: 100000, atYear: 5 }]).fv, 100000 * Math.pow(1.01, 60), 0.01);
{
  const plain = sipFV(10000, 12, 10);
  const withLump = sipFV(10000, 12, 10, 0, 0, [{ amount: 200000, atYear: 3 }]);
  near('SIP + lump sum = SIP alone + lump sum alone', withLump.fv, plain.fv + 200000 * Math.pow(1.01, 84), 0.01);
  near('invested includes the lump sum', withLump.invested, plain.invested + 200000, 0.01);
  ok('lump sums beyond the horizon are ignored', sipFV(10000, 12, 10, 0, 0, [{ amount: 200000, atYear: 11 }]).fv === plain.fv);
  ok('sipFV without lump sums is unchanged', sipFV(10000, 12, 10).fv === plain.fv);
}

// ---- phase-wise payment plan ----
ok('every preset adds up to 100%', Object.values(PLAN_PRESETS).every((p) => Math.abs(p.tranches.reduce((s, t) => s + t.pct, 0) - 100) < 1e-9));
ok('preset follows the purchase type', presetFor('under_construction') === 'construction_linked' && presetFor('resale') === 'single' && presetFor('ready') === 'single');
{
  // 1cr under construction, 25L down, 75L loan, 8%, 20 years, 5% GST, 12L of charges up front
  const r = paymentPlan({ price: CR, tranches: PLAN_PRESETS.construction_linked.tranches, downPayment: 2500000, loan: 7500000, ratePct: 8, tenureMonths: 240, gstRate: 0.05, upfrontCharges: 1200000 });
  ok('ten stages, in month order', r.rows.length === 10 && r.rows.every((x, k) => k === 0 || x.month >= r.rows[k - 1].month));
  near('your money covers the first 2.5 stages', r.rows[0].fromBank + r.rows[1].fromBank, 0, 0.01);
  near('stage 3 is split: 5L you, 5L bank', r.rows[2].fromBank, 500000, 0.01);
  near('bank releases the whole loan by possession', r.loan, 7500000, 0.01);
  near('GST rides on every stage', r.gstTotal, 500000, 0.01);
  near('cash at booking = 10L stage + 50k GST + 12L charges', r.cashAtBooking, 1000000 + 50000 + 1200000, 0.01);
  ok('construction runs 36 months, EMI starts month 37', r.constructionMonths === 36 && r.emiStartMonth === 37);
  near('EMI on 75L at 8% for 20y', r.emi, 62733.01, 0.01);
  let expect = 0; for (let m = 0; m < 36; m++) expect += r.rows.filter((x) => x.month <= m).reduce((s, x) => s + x.fromBank, 0) * (8 / 1200);
  near('pre-EMI interest equals the month-by-month sum', r.preEmiTotal, expect, 0.01);
  ok('pre-EMI is well below a year of EMIs but not trivial', r.preEmiTotal > 500000 && r.preEmiTotal < 1200000, String(Math.round(r.preEmiTotal)));
  near('paid by you by possession = down + GST + charges + pre-EMI', r.youByPossession, 2500000 + 500000 + 1200000 + r.preEmiTotal, 0.01);
  ok('no warnings on a clean plan', r.warnings.length === 0, r.warnings.join('; '));
}
{
  const r = paymentPlan({ price: 8000000, tranches: PLAN_PRESETS.single.tranches, downPayment: 2000000, loan: 6000000, ratePct: 8.5, tenureMonths: 180, gstRate: 0, upfrontCharges: 600000 });
  ok('single stage: no pre-EMI, EMI from month 1', r.preEmiTotal === 0 && r.emiStartMonth === 1 && r.constructionMonths === 0);
  near('single stage: bank releases the full loan at once', r.rows[0].fromBank, 6000000, 0.01);
  near('single stage: you pay down payment + charges', r.rows[0].fromYou, 2600000, 0.01);
}
{
  const r = paymentPlan({ price: CR, tranches: PLAN_PRESETS.construction_linked.tranches, downPayment: 1000000, loan: 6000000, ratePct: 8, tenureMonths: 240, gstRate: 0.05, upfrontCharges: 0 });
  ok('down payment + loan short of the price is flagged and charged to you', r.shortfall > 0 && Math.abs(r.shortfall - 3000000) < 1 && r.warnings.some((w) => /short/.test(w)));
  const bad = paymentPlan({ price: CR, tranches: [{ label: 'a', pct: 60, month: 0 }, { label: 'b', pct: 30, month: 6 }], downPayment: 2500000, loan: 7500000, ratePct: 8, tenureMonths: 240 });
  ok('stages not adding to 100% are flagged', bad.warnings.some((w) => /100%/.test(w)) && Math.abs(bad.pctTotal - 90) < 1e-9);
}

console.log(failures === 0 ? '\nAll home-buying tests passed.' : `\n${failures} home-buying test(s) FAILED.`);
process.exit(failures === 0 ? 0 : 1);
