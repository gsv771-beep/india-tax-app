/**
 * Goals, kept simple: what it costs today, what it will cost when it arrives, and the SIP that gets
 * there at the mix of equity and safe money you choose. Child goals date themselves from the child's
 * age. Pure; rates come in from the page (engine/mix.js does the blend).
 *
 * goalPlan({ type, costToday, years | childAge, atAge, inflationPct, equityPct, daughterUnder10 }, rates)
 *   -> { costThen, returnPct, badReturnPct, sip, lump, sipIfBad, invested, todayValue, equityPct, cap, where[], years }
 */
import { equityCap, mixReturn } from './mix.js';

const num = (v) => (Number.isFinite(+v) ? +v : 0);

export const GOAL_TYPES = [
  { id: 'education', label: "Child's education", child: true, atAge: 18, inflationPct: 10, costLabel: 'What the course costs today (₹)', costHint: 'total fees for the degree you have in mind, at today’s prices', why: 'College fees in India have risen about 10% a year, well ahead of general inflation.' },
  { id: 'wedding', label: "Child's wedding", child: true, atAge: 25, inflationPct: 7, costLabel: 'What it would cost today (₹)', costHint: 'the wedding you would want at today’s prices', why: 'Wedding costs track a mix of gold, venues and services; about 7% a year is a fair middle.' },
  { id: 'house', label: 'House down payment', atAge: null, inflationPct: 6, costLabel: 'Down payment at today’s prices (₹)', costHint: 'usually 20-25% of the price; the home-buying tool works this out', why: 'City property has grown about 6% a year over long stretches, with flat years in between.' },
  { id: 'car', label: 'A car', atAge: null, inflationPct: 4, costLabel: 'On-road price today (₹)', costHint: '', why: 'Cars get dearer slowly; about 4% a year.' },
  { id: 'other', label: 'Something else', atAge: null, inflationPct: 6, costLabel: 'What it costs today (₹)', costHint: 'a holiday, a business, a sabbatical, anything', why: 'General inflation has averaged about 6%.' },
  { id: 'fixed', label: 'A fixed amount I need then', atAge: null, inflationPct: 0, costLabel: 'Amount you need on the day (₹)', costHint: 'already the future figure; no inflation is added', why: '' },
];

export const goalType = (id) => GOAL_TYPES.find((t) => t.id === id) || GOAL_TYPES[4];

/** SIP that reaches `target` in `years` at `ratePct`, instalment at the start of each month. */
export function requiredSip(target, ratePct, years) {
  const i = num(ratePct) / 12 / 100, n = Math.round(num(years) * 12);
  if (n <= 0) return 0;
  if (i === 0) return target / n;
  return (target * i) / ((Math.pow(1 + i, n) - 1) * (1 + i));
}

export function goalPlan(o, rates) {
  const t = goalType(o.type);
  const years = t.child && o.childAge != null && o.childAge !== '' ? Math.max(0, Math.round(num(o.atAge ?? t.atAge) - num(o.childAge))) : Math.max(0, Math.round(num(o.years)));
  const inflationPct = o.inflationPct != null && o.inflationPct !== '' ? num(o.inflationPct) : t.inflationPct;
  const costToday = Math.max(0, num(o.costToday));
  const costThen = t.id === 'fixed' ? costToday : costToday * Math.pow(1 + inflationPct / 100, years);
  const cap = equityCap(years);
  const equityPct = Math.min(cap, Math.max(0, num(o.equityPct)));
  const mix = mixReturn(equityPct, rates);
  const sip = requiredSip(costThen, mix.typical, years);
  const sipIfBad = requiredSip(costThen, mix.bad, years);
  const lump = years > 0 ? costThen / Math.pow(1 + mix.typical / 100, years) : costThen;
  const invested = sip * 12 * years;
  const todayValue = t.id === 'fixed' ? costThen / Math.pow(1 + (num(o.inflationPct) || 6) / 100, years) : costToday;
  return {
    type: t.id, years, costToday, costThen, inflationPct, cap, equityPct, capped: num(o.equityPct) > cap,
    returnPct: mix.typical, badReturnPct: mix.bad, sip, sipIfBad, lump, invested, todayValue,
    where: whereToPutIt({ years, equityPct, sip, type: t.id, daughterUnder10: !!o.daughterUnder10 }, rates),
  };
}

/** Where the monthly amount goes, as shares of the SIP, and the one rule that matters as the date nears. */
function whereToPutIt({ years, equityPct, sip, type, daughterUnder10 }, rates) {
  const lines = [];
  const equity = sip * equityPct / 100;
  let safe = sip - equity;
  if (daughterUnder10 && (type === 'education' || type === 'wedding') && safe > 0) {
    const ssy = Math.min(safe, 150000 / 12);
    lines.push({ id: 'ssy', label: 'Sukanya Samriddhi (SSY)', amount: ssy, why: `${rates.ssy}% tax-free and government-backed; open it before she turns 10, put in up to ₹1.5 lakh a year for 15 years, and it matures 21 years after opening. Half can be taken out at 18 for her education. The best safe rate anyone in India can get.` });
    safe -= ssy;
  }
  if (equity > 0) lines.push({ id: 'equity', label: 'Nifty 50 or flexi-cap index fund SIP', amount: equity, why: `Broad equity has returned about ${rates.equity}% a year over 5-year stretches, and about ${rates.equityWorst}% in the worst of them. It is for the part of the money you will not need for 5 years or more.` });
  if (safe > 0) lines.push({ id: 'safe', label: years >= 15 ? 'PPF' : years >= 3 ? 'Short-duration debt fund, or a recurring deposit' : 'Recurring deposit, or a liquid fund', amount: safe, why: years >= 15 ? `${rates.safe}% tax-free; 15-year lock, partial withdrawal from year 7. Fits a goal this far off.` : years >= 3 ? `About ${rates.safe}%; taxed at your slab, but reachable on the day you need it. PPF’s 15-year lock does not fit a goal this near.` : `Money needed within 3 years should not be in equity at all; a bad year is more likely than a good one to matter.` });
  const rule = years > 7
    ? 'Starting 7 years before the date, move a quarter of what is in equity to the safe side each year, so that with 3 years to go none of it is in equity. A market fall the year before the money is needed is the one thing this plan cannot survive.'
    : years >= 3 ? 'With under 7 years to go, keep equity small and move it to the safe side a slice at a time each year; with 3 years left, none.' : 'Under 3 years: keep it all safe and reachable.';
  return { lines, rule };
}
