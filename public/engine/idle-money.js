/**
 * Money sitting in a savings account, and what the same money would be worth, after tax, in the other
 * places spare cash is commonly kept: a sweep-in fixed deposit, a liquid fund, an arbitrage fund.
 * Pure (no DOM). Data: public/data/idle_money.json (typical rates with their dates, and the tax rules).
 *
 *   afterTax(optionId, input, data) -> { value, invested, earned, tax, gross }
 *   compare(input, data) -> { options: [...], base, best, years, invested, series }
 *
 * input: { amount, monthly, years, slabPct, oldRegime, ltcgExemptionUsed, rates: { optionId: pct } }
 *   amount: the money there today; monthly: more added at the end of each month; slabPct: the rate of
 *   income tax on the person's next rupee (0 to 30); oldRegime: the first ₹10,000 a year of
 *   savings-account interest is not taxed (80TTA); ltcgExemptionUsed: the ₹1.25 lakh a year of tax-free
 *   equity gains is already used by other investments.
 *
 * How each is taxed (cess on top of each):
 *   interest      added to income every year and taxed at the slab (the tax is taken from the balance)
 *   slab_at_exit  the whole gain taxed at the slab, once, when the money is taken out
 *   equity        when taken out: 20% on the gain from money put in within the last 12 months, 12.5% on
 *                 the rest above the yearly exemption
 * Nothing here says where money should go: it puts the figures side by side.
 */
const num = (v, d = 0) => (v === '' || v == null || !Number.isFinite(+v) ? d : +v);

export function optionById(data, id) { return data.options.find((o) => o.id === id) || null; }

/** The growth in one month at a yearly rate that compounds n times a year (a fund's return compounds once). */
function monthlyFactor(ratePct, perYear) {
  const n = Math.max(1, num(perYear, 1));
  return Math.pow(1 + num(ratePct) / 100 / n, n / 12);
}

export function afterTax(id, input, data) {
  const o = optionById(data, id);
  const t = data.tax, cess = 1 + num(t.cess_pct) / 100;
  const slab = Math.min(100, Math.max(0, num(input.slabPct))) / 100 * cess;
  const months = Math.max(0, Math.round(num(input.years) * 12));
  const amount = Math.max(0, num(input.amount)), monthly = Math.max(0, num(input.monthly));
  const f = monthlyFactor(input.rates?.[id] ?? o.rate_pct, o.compounding_per_year);
  const invested = amount + monthly * months;

  if (o.tax === 'interest') {
    // interest builds through the year; at each year's end (and at the end) the tax on it leaves the balance
    const exempt = id === 'savings' && input.oldRegime ? num(t.savings_interest_exempt_old_regime) : 0;
    let bal = amount, yearInterest = 0, gross = 0, tax = 0;
    for (let m = 1; m <= months; m++) {
      const i = bal * (f - 1);
      bal += i; yearInterest += i; gross += i;
      if (m % 12 === 0 || m === months) { const due = Math.max(0, yearInterest - exempt) * slab; bal -= due; tax += due; yearInterest = 0; }
      bal += monthly;
    }
    return { value: bal, invested, earned: bal - invested, tax, gross };
  }

  // funds: each sum put in grows untaxed until it is taken out, so every lot is followed to the end
  let value = 0, shortGain = 0, longGain = 0;
  const lot = (sum, held) => {
    if (!(sum > 0)) return;
    const v = sum * Math.pow(f, held);
    value += v;
    if (held <= num(t.equity_long_term_after_months, 12)) shortGain += v - sum; else longGain += v - sum;
  };
  lot(amount, months);
  for (let m = 1; m <= months; m++) lot(monthly, months - m);
  const gross = value - invested;
  let tax;
  if (o.tax === 'equity') {
    const exempt = input.ltcgExemptionUsed ? 0 : num(t.equity_ltcg_exempt_per_year);
    tax = (shortGain * num(t.equity_stcg_pct) / 100 + Math.max(0, longGain - exempt) * num(t.equity_ltcg_pct) / 100) * cess;
  } else tax = gross * slab;
  return { value: value - tax, invested, earned: gross - tax, tax, gross };
}

export function compare(input, data) {
  const years = Math.max(0, num(input.years, data.defaults.years));
  const amount = Math.max(0, num(input.amount)), monthly = Math.max(0, num(input.monthly));
  const run = { ...input, years, amount, monthly };
  const options = data.options.map((o) => {
    const r = afterTax(o.id, run, data);
    // the yearly rate the money really earned after tax, on the sum that was there from the start
    const lump = amount > 0 && years > 0 ? afterTax(o.id, { ...run, monthly: 0 }, data) : null;
    return { id: o.id, label: o.label, ratePct: num(input.rates?.[o.id], o.rate_pct), ...r, afterTaxPct: lump ? (Math.pow(lump.value / amount, 1 / years) - 1) * 100 : null };
  });
  const base = options.find((o) => o.id === 'savings');
  for (const o of options) o.extra = o.value - base.value;
  const invested = base.invested;
  if (!(invested > 0) || !(years > 0)) return { options, base, best: null, years, invested, series: [] };
  const best = options.reduce((a, b) => (b.value > a.value ? b : a));
  // each one's value if taken out at the end of every year, for the lines that part company
  const series = options.map((o) => ({ id: o.id, label: o.label, points: Array.from({ length: Math.ceil(years) + 1 }, (_, y) => [Math.min(y, years), afterTax(o.id, { ...run, years: Math.min(y, years) }, data).value]) }));
  return { options, base, best, years, invested, series };
}
