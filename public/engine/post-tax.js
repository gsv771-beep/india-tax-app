/**
 * What you actually keep: the same rupee in different instruments, after tax, over a horizon.
 * Pure; the caller supplies the rates (small-savings from data/schemes.json, fund categories from
 * the AMFI-derived history, anything else typed by the user) so nothing here is a hard-coded return.
 *
 * postTax(instrument, { amount, years, slabRate, cess, ratePct, ltcgExemptionAvailable, regime, has80CRoom })
 *   -> { available, reason, pre, post, taxPaid, effPost, preTaxEquivalent, taxSavedNow, effAllIn, how }
 *
 * Tax models (1961 Act numbering; the 2025 Act keeps them):
 *   exempt        PPF, SSY: interest and maturity tax-free (EEE). EPF too, except interest on own
 *                 contributions above 2.5 lakh a year, which is taxable.
 *   slab_yearly   FD, RD, savings, NSC (accrual): interest taxed at slab every year as it accrues
 *   slab_exit     debt and money-market funds bought on or after 1 Apr 2023: gain taxed at slab when
 *                 redeemed, so the tax is deferred to the end
 *   equity        listed equity and equity funds, arbitrage funds: 20% if held 12 months or less,
 *                 12.5% above the 1,25,000 yearly exemption after that (s.111A / 112A)
 *   gold          gold funds and ETFs: slab within 12 months, 12.5% after (Finance (No. 2) Act 2024)
 *   nps           at 60: 60% of the corpus tax-free, 40% must buy an annuity taxed as income when paid
 */

/**
 * Risk, 1-5, for the risk-profile filter: 1 guaranteed or near-cash, 2 debt funds and arbitrage,
 * 3 hybrid and NPS, 4 large-cap and index equity and gold, 5 mid-cap, small-cap and sector funds.
 */
export const RISK_PROFILES = [
  { id: 'conservative', label: 'Conservative: capital must not fall', maxRisk: 2 },
  { id: 'moderate', label: 'Moderate: some equity through hybrids and NPS', maxRisk: 3 },
  { id: 'balanced', label: 'Balanced: broad equity funds and gold', maxRisk: 4 },
  { id: 'aggressive', label: 'Aggressive: mid and small caps too', maxRisk: 5 },
];

export const INSTRUMENTS = [
  { id: 'savings', label: 'Savings account', group: 'Cash', risk: 1, tax: 'slab_yearly', lock: 'none', minYears: 0, rate: 'po_savings', note: 'Old regime: the first ₹10,000 of savings interest is deductible (80TTA).' },
  { id: 'liquid', label: 'Liquid or overnight fund', group: 'Debt fund', risk: 1, tax: 'slab_exit', lock: 'none (exit load in the first 7 days)', minYears: 0, category: 'Liquid' },
  { id: 'fd', label: 'Bank or post office fixed deposit', group: 'Guaranteed', risk: 1, tax: 'slab_yearly', lock: 'penalty on early break', minYears: 0, rate: 'po_td', note: 'Rate shown is the post office time deposit for the nearest tenure; bank FDs are within about half a point of it. Only the 5-year post office deposit qualifies for 80C.' },
  { id: 'arbitrage', label: 'Arbitrage fund', group: 'Equity-taxed', risk: 2, tax: 'equity', lock: 'none (exit load in the first 15-30 days)', minYears: 0, category: 'Arbitrage', note: 'A debt-like return with equity taxation: this is why it beats a liquid fund for a 30% payer holding over a year.' },
  { id: 'debt', label: 'Short-duration debt fund', group: 'Debt fund', risk: 2, tax: 'slab_exit', lock: 'none', minYears: 1, category: 'Short Duration' },
  { id: 'corporate', label: 'Corporate bond fund', group: 'Debt fund', risk: 2, tax: 'slab_exit', lock: 'none', minYears: 2, category: 'Corporate Bond' },
  { id: 'nsc', label: 'NSC (5 years)', group: 'Guaranteed', risk: 1, tax: 'slab_yearly', lock: '5 years', minYears: 5, rate: 'nsc_viii', eightyC: true, note: 'Interest of years 1-4 is deemed reinvested and qualifies for 80C; taxed at slab as it accrues.' },
  { id: 'ppf', label: 'PPF', group: 'Guaranteed', risk: 1, tax: 'exempt', lock: '15 years; partial withdrawal from year 7', minYears: 15, rate: 'ppf', eightyC: true, cap: 150000 },
  { id: 'epf', label: 'EPF / VPF', group: 'Guaranteed', risk: 1, tax: 'exempt', lock: 'until retirement or 2 months of unemployment', minYears: 5, rate: 'epf', eightyC: true, note: 'Interest on your own contributions above ₹2,50,000 a year is taxable. Withdrawal within 5 years of joining is taxable.' },
  { id: 'ssy', label: 'Sukanya Samriddhi (daughter under 10)', group: 'Guaranteed', risk: 1, tax: 'exempt', lock: '21 years from opening; 50% at 18 for education', minYears: 21, rate: 'ssy', eightyC: true, cap: 150000 },
  { id: 'nps', label: 'NPS', group: 'Retirement', risk: 3, tax: 'nps', lock: 'until 60', minYears: 10, category: 'nps_mix', nps1b: true, note: 'Return depends on your equity-debt mix; the default is a 50:50 blend of the historical asset-class figures. Employer contributions get 80CCD(2) in both regimes.' },
  { id: 'baf', label: 'Balanced advantage fund', group: 'Hybrid', risk: 3, tax: 'equity', lock: 'none', minYears: 3, volatile: true, category: 'Balanced Advantage', note: 'Moves between equity and debt; taxed as equity when it keeps 65% in equity, which most do.' },
  { id: 'hybrid', label: 'Aggressive hybrid fund', group: 'Hybrid', risk: 3, tax: 'equity', lock: 'none', minYears: 3, volatile: true, category: 'Aggressive Hybrid' },
  { id: 'elss', label: 'ELSS equity fund (80C)', group: 'Equity', risk: 4, tax: 'equity', lock: '3 years', minYears: 3, volatile: true, category: 'ELSS (Tax Saver)', eightyC: true, cap: 150000 },
  { id: 'index', label: 'Nifty index fund', group: 'Equity', risk: 4, tax: 'equity', lock: 'none', minYears: 3, volatile: true, category: 'Index Fund (Equity)' },
  { id: 'largecap', label: 'Large-cap fund', group: 'Equity', risk: 4, tax: 'equity', lock: 'none', minYears: 3, volatile: true, category: 'Large Cap' },
  { id: 'flexi', label: 'Flexi-cap equity fund', group: 'Equity', risk: 4, tax: 'equity', lock: 'none', minYears: 3, volatile: true, category: 'Flexi Cap' },
  { id: 'gold', label: 'Gold fund or ETF', group: 'Commodity', risk: 4, tax: 'gold', lock: 'none', minYears: 3, volatile: true, category: 'Gold / Silver' },
  { id: 'midcap', label: 'Mid-cap fund', group: 'Equity', risk: 5, tax: 'equity', lock: 'none', minYears: 5, volatile: true, category: 'Mid Cap', note: 'Bigger swings than the index: the worst rolling window matters more than the median.' },
  { id: 'smallcap', label: 'Small-cap fund', group: 'Equity', risk: 5, tax: 'equity', lock: 'none', minYears: 5, volatile: true, category: 'Small Cap', note: 'The widest range of outcomes of anything here; a bad five years is common.' },
];

const num = (v) => (Number.isFinite(+v) ? +v : 0);

export function postTax(inst, o) {
  const amount = num(o.amount), years = Math.max(1 / 12, num(o.years));
  const r = num(o.ratePct) / 100;
  const t = Math.max(0, Math.min(0.3, num(o.slabRate))) * (1 + num(o.cess));   // slab incl. cess
  const cess = num(o.cess);
  const exemption = num(o.ltcgExemption) || 125000;
  const pre = amount * Math.pow(1 + r, years);
  const gain = pre - amount;
  let post = pre, how = '';
  switch (inst.tax) {
    case 'exempt': post = pre; how = 'tax-free'; break;
    case 'slab_yearly': post = amount * Math.pow(1 + r * (1 - t), years); how = `interest taxed at ${pct(t)} every year`; break;
    case 'slab_exit': post = amount + gain * (1 - t); how = `gain taxed at ${pct(t)} on redemption`; break;
    case 'equity': {
      if (years <= 1) { post = pre - gain * 0.2 * (1 + cess); how = `short-term: 20% on the gain`; }
      else { const ex = o.ltcgExemptionAvailable === false ? 0 : exemption; const taxable = Math.max(0, gain - ex); post = pre - taxable * 0.125 * (1 + cess); how = taxable > 0 ? `long-term: 12.5% above the ${inr(ex)} yearly exemption` : `long-term: within the ${inr(ex)} yearly exemption, no tax`; }
      break;
    }
    case 'gold': { if (years <= 1) { post = amount + gain * (1 - t); how = `within 12 months: gain at ${pct(t)}`; } else { post = pre - gain * 0.125 * (1 + cess); how = 'after 12 months: 12.5% on the gain'; } break; }
    case 'nps': post = 0.6 * pre + 0.4 * pre * (1 - t); how = `60% tax-free at 60; 40% buys an annuity taxed at ${pct(t)} as it is paid`; break;
    default: post = pre;
  }
  const taxPaid = pre - post;
  const effPost = amount > 0 ? Math.pow(post / amount, 1 / years) - 1 : 0;
  const preTaxEquivalent = t < 1 ? effPost / (1 - t) : effPost;   // what a fully-taxed instrument would need to earn to match

  // Tax saved on the way in (old regime with room under 80C or 80CCD(1B)): reduces the real outlay.
  let taxSavedNow = 0;
  if (o.regime === 'old' && o.has80CRoom) {
    if (inst.eightyC) taxSavedNow = Math.min(amount, inst.cap || 150000) * t;
    if (inst.nps1b) taxSavedNow = Math.min(amount, 50000) * t;
  }
  const netOutlay = Math.max(1, amount - taxSavedNow);
  const effAllIn = amount > 0 ? Math.pow(post / netOutlay, 1 / years) - 1 : 0;

  const available = years >= inst.minYears;
  const reason = available ? '' : inst.volatile && inst.lock === 'none' ? `can fall sharply over short periods; not for a ${fmtYears(years)} horizon` : `locked for ${inst.lock}; not for a ${fmtYears(years)} horizon`;
  return { available, reason, pre, post, gain, taxPaid, effPost, preTaxEquivalent, taxSavedNow, effAllIn, how };
}

/**
 * All instruments for one question, sorted by what you keep. `inProfile` is false for anything riskier
 * than the chosen profile; those rows sort after the available in-profile ones, before locked ones.
 */
export function compareAll(o, ratesById) {
  const maxRisk = (RISK_PROFILES.find((r) => r.id === o.riskProfile) || RISK_PROFILES[2]).maxRisk;
  return INSTRUMENTS.map((inst) => {
    const ratePct = ratesById[inst.id];
    if (ratePct == null) return null;
    return { inst, ratePct, inProfile: inst.risk <= maxRisk, ...postTax(inst, { ...o, ratePct }) };
  }).filter(Boolean).sort((a, b) => {
    const tier = (x) => (!x.available ? 2 : x.inProfile ? 0 : 1);
    return tier(a) - tier(b) || b.post - a.post;
  });
}

/** Post office time deposit rate for the nearest tenure at or below the horizon. */
export function poTdRate(smallSavings, years) {
  const tiers = [[5, 'time_deposit_5yr'], [3, 'time_deposit_3yr'], [2, 'time_deposit_2yr'], [1, 'time_deposit_1yr']];
  for (const [y, key] of tiers) if (years >= y && smallSavings[key]) return smallSavings[key].rate;
  return smallSavings.time_deposit_1yr ? smallSavings.time_deposit_1yr.rate : null;
}

function pct(x) { return `${+(x * 100).toFixed(1)}%`; }
function inr(n) { return '₹' + Math.round(n).toLocaleString('en-IN'); }
function fmtYears(y) { return y < 1 ? `${Math.round(y * 12)}-month` : `${+y.toFixed(1)}-year`; }
