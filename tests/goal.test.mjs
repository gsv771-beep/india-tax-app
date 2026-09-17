// Goal planner and the equity/safe mix. Run: node tests/goal.test.mjs
import { equityCap, mixReturn, describeMix } from '../public/engine/mix.js';
import { GOAL_TYPES, goalPlan, requiredSip } from '../public/engine/goal.js';
import { buildPlan } from '../public/engine/retirement.js';
let failures = 0;
const ok = (name, cond, detail = '') => { console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${detail ? ' (' + detail + ')' : ''}`); if (!cond) failures++; };
const near = (name, a, e, tol = 1) => ok(name, Math.abs(a - e) <= tol, `got ${a}, expected ${e}`);
const rates = { equity: 14.5, equityWorst: 1.7, safe: 7.1, ssy: 8.2, sources: { equity: 'test', safe: 'test' } };

// mix
near('all safe earns the safe rate', mixReturn(0, rates).typical, 7.1, 0.01);
near('all equity earns the equity rate', mixReturn(100, rates).typical, 14.5, 0.01);
near('60/40 blends linearly', mixReturn(60, rates).typical, 0.6 * 14.5 + 0.4 * 7.1, 0.01);
near('bad stretch uses the worst equity window', mixReturn(60, rates).bad, 0.6 * 1.7 + 0.4 * 7.1, 0.01);
ok('mix is clamped to 0-100', mixReturn(140, rates).equityPct === 100 && mixReturn(-5, rates).equityPct === 0);
ok('caps: 0 under 3 years, 30 under 5, 50 under 7, free beyond', equityCap(2) === 0 && equityCap(4) === 30 && equityCap(6) === 50 && equityCap(10) === 100);
ok('labels read sensibly', /All safe/.test(describeMix(0)) && /Half/.test(describeMix(50)) && /All equity/.test(describeMix(100)));

// goal: child education from the child's age
{
  const r = goalPlan({ type: 'education', costToday: 2500000, childAge: 3, equityPct: 60 }, rates);
  ok('education runs to 18 by default', r.years === 15);
  near('cost then = today x 1.10^15', r.costThen, 2500000 * Math.pow(1.1, 15), 1);
  ok('equity share stays as chosen for a 15-year goal', r.equityPct === 60 && !r.capped);
  near('SIP inverts the annuity-due formula at the blended rate', r.sip, requiredSip(r.costThen, mixReturn(60, rates).typical, 15), 0.01);
  ok('a bad stretch needs a bigger SIP', r.sipIfBad > r.sip);
  ok('where: equity and PPF lines add up to the SIP', Math.abs(r.where.lines.reduce((s, l) => s + l.amount, 0) - r.sip) < 0.01 && r.where.lines.some((l) => l.id === 'equity') && r.where.lines.some((l) => l.label === 'PPF'));
  const g = goalPlan({ type: 'education', costToday: 2500000, childAge: 3, equityPct: 60, daughterUnder10: true }, rates);
  ok('a daughter under 10 gets an SSY line first, capped at 1.5 lakh a year', g.where.lines[0].id === 'ssy' && g.where.lines[0].amount <= 12500.01);
  ok('the goal date can be moved', goalPlan({ type: 'education', costToday: 1, childAge: 3, atAge: 21, equityPct: 0 }, rates).years === 18);
}
// short horizons cap equity
{
  const r = goalPlan({ type: 'car', costToday: 1000000, years: 2, equityPct: 80 }, rates);
  ok('2 years: equity capped to 0 and flagged', r.equityPct === 0 && r.capped && r.cap === 0);
  near('so the return is the safe rate', r.returnPct, 7.1, 0.01);
  ok('and only a safe line is suggested', r.where.lines.length === 1 && r.where.lines[0].id === 'safe');
  const m = goalPlan({ type: 'house', costToday: 2000000, years: 4, equityPct: 80 }, rates);
  ok('4 years: capped at 30', m.equityPct === 30 && m.capped);
}
// fixed amount: no inflation added
{
  const r = goalPlan({ type: 'fixed', costToday: 5000000, years: 15, equityPct: 50 }, rates);
  ok('fixed target is used as-is', r.costThen === 5000000);
  near("today's money at 6%", r.todayValue, 5000000 / Math.pow(1.06, 15), 1);
  near('one-time amount discounts at the blended rate', r.lump, 5000000 / Math.pow(1 + mixReturn(50, rates).typical / 100, 15), 1);
}
ok('every goal type has a label, a cost label and an inflation default', GOAL_TYPES.every((t) => t.label && t.costLabel && Number.isFinite(t.inflationPct)));
ok('inflation can be overridden', goalPlan({ type: 'education', costToday: 100, years: 10, inflationPct: 8, equityPct: 0 }, rates).inflationPct === 8);

// retirement build plan honours the chosen equity share
{
  const pr = { epf: 8.25, ppf: 7.1, scss: 8.2 };
  const plan = buildPlan({ age: 35, monthly: 60000, epfMonthly: 14400, regime: 'old', equityPct: 40 }, pr);
  near('40% of the whole monthly saving goes to equity when chosen', plan.find((b) => b.id === 'equity').amount, 24000, 1);
  ok('the why text says it was chosen', /you chose/.test(plan.find((b) => b.id === 'equity').why));
  ok('0% equity: no equity line', !buildPlan({ age: 35, monthly: 60000, epfMonthly: 0, regime: 'new', equityPct: 0 }, pr).some((b) => b.id === 'equity'));
  ok('without a choice the age rule still applies', /rule of thumb/.test(buildPlan({ age: 35, monthly: 60000, epfMonthly: 0, regime: 'new' }, pr).find((b) => b.id === 'equity').why));
}

console.log(failures ? `\n${failures} failure(s)` : '\nAll goal tests passed');
process.exit(failures ? 1 : 0);
