/**
 * Tax on a year of trading, from a parsed broker statement (engine/brokers/*.js).
 * Pure; rates from data/tax_rates.json.
 *
 * tradingTax(parsed, rates, opts) -> heads, set-offs, tax, carry-forward, insights
 * opts: { deductCharges (bool: claim non-STT charges as expenses on transfer), slabRate (0-0.3, for business income), otherEquityLtcgThisYear }
 *
 * Heads and rules (1961 Act numbering; the 2025 Act keeps them):
 *   Equity STCG (s.111A)  20% - listed shares and equity funds held 12 months or less
 *   Equity LTCG (s.112A)  12.5% above the 1,25,000 yearly exemption; FMV grandfathering already applied by the broker
 *   Intraday              speculative business income, slab rate; loss set off only against speculative gains, carried 4 years
 *   F&O                   non-speculative business income, slab rate; loss set off against any income except salary, carried 8 years
 *   Debt funds bought on or after 1 Apr 2023: slab rate whatever the holding period
 *   Buyback (from 1 Oct 2024): proceeds are deemed dividend at slab; the cost becomes a capital loss (not modelled: shown as a note)
 *   Set-off (s.70/74): STCL against any capital gain; LTCL only against LTCG; net capital loss carried 8 years if the return is filed on time
 */

const num = (v) => (Number.isFinite(+v) ? +v : 0);

export function tradingTax(parsed, rates, opts = {}) {
  const t = parsed.totals;
  const cg = rates.special_rate_income.capital_gains;
  const stcgRate = cg.stcg_listed_equity_stt.rate, ltcgRate = cg.ltcg_listed_equity_stt.rate, exemption = cg.ltcg_listed_equity_stt.annual_exemption;
  const cess = rates.cess.rate;
  const slab = Math.max(0, Math.min(0.3, num(opts.slabRate)));
  const deduct = !!opts.deductCharges;

  // capital gains heads
  const stcgEquity = t.equityShortTerm + t.mfEquityShortTerm - (deduct ? parsed.charges.equityStcgOther : 0);
  const ltcgEquity = t.equityLongTerm + t.mfEquityLongTerm - (deduct ? parsed.charges.equityLtcgOther : 0);
  const debtSlab = t.mfDebtShortTerm + t.mfDebtLongTerm;   // slab-rate income, kept out of the set-off below

  // set-off inside the year: short-term loss can absorb long-term gain; long-term loss only long-term gain
  let stcg = stcgEquity, ltcg = ltcgEquity;
  const setOff = { stclAgainstLtcg: 0, ltclUnused: 0 };
  if (stcg < 0 && ltcg > 0) { const use = Math.min(-stcg, ltcg); setOff.stclAgainstLtcg = use; stcg += use; ltcg -= use; }
  const stclCarried = stcg < 0 ? -stcg : 0;
  const ltclCarried = ltcg < 0 ? -ltcg : 0;
  const stcgTaxable = Math.max(0, stcg);
  const otherLtcg = num(opts.otherEquityLtcgThisYear);
  const exemptionLeft = Math.max(0, exemption - otherLtcg);
  const ltcgExemptUsed = Math.min(Math.max(0, ltcg), exemptionLeft);
  const ltcgTaxable = Math.max(0, ltcg) - ltcgExemptUsed;

  const stcgTax = stcgTaxable * stcgRate, ltcgTax = ltcgTaxable * ltcgRate;
  const business = { intraday: t.equityIntraday, fno: t.fnoOptions + t.fnoFutures, debtSlab, currency: t.currency, commodity: t.commodity };
  const businessNet = Math.max(0, business.fno) + Math.max(0, business.intraday) + Math.max(0, debtSlab) + Math.max(0, business.currency) + Math.max(0, business.commodity);
  const businessTax = businessNet * slab;
  const total = Math.round((stcgTax + ltcgTax + businessTax) * (1 + cess));

  // insights, in the order a reader should see them
  const insights = [];
  if (stclCarried > 0) insights.push({ kind: 'loss', text: `Net short-term capital loss of ${fmt(stclCarried)}. It is not lost: set it off against any capital gain in this return (including gains on mutual funds or property), or carry it forward for eight years. Both need the return filed by the due date.` });
  if (ltclCarried > 0) insights.push({ kind: 'loss', text: `Net long-term capital loss of ${fmt(ltclCarried)}. It can be set off only against long-term gains, this year or in the next eight, if the return is filed on time.` });
  if (setOff.stclAgainstLtcg > 0) insights.push({ kind: 'info', text: `${fmt(setOff.stclAgainstLtcg)} of short-term loss has been set against long-term gains, which is what the return will do too.` });
  if (ltcg > 0 && ltcgExemptUsed < exemptionLeft) insights.push({ kind: 'tip', text: `${fmt(exemptionLeft - ltcgExemptUsed)} of this year’s ${fmt(exemption)} long-term exemption is unused. Booking that much long-term equity gain before 31 March costs nothing in tax and resets the cost of what you buy back.` });
  if (ltcg <= 0 && exemptionLeft > 0) insights.push({ kind: 'tip', text: `The ${fmt(exemption)} yearly exemption on long-term equity gains is unused this year; it does not carry over. If you hold anything with a long-term gain, booking up to that much before 31 March is tax-free.` });
  if (business.intraday < 0) insights.push({ kind: 'loss', text: `Intraday loss of ${fmt(-business.intraday)} is a speculative business loss: it can be set off only against speculative gains and carried forward four years. It cannot reduce salary or capital gains.` });
  if (business.fno < 0) insights.push({ kind: 'loss', text: `F&O loss of ${fmt(-business.fno)} is a non-speculative business loss: set it off against any income other than salary this year (including capital gains and interest), or carry it forward eight years. Reporting it requires the business schedule of the return and, above turnover limits, an audit.` });
  if (business.fno !== 0 || business.intraday !== 0) insights.push({ kind: 'info', text: 'F&O and intraday are business income, not capital gains: they are taxed at your slab rate, need ITR-3, and having business income restricts switching between the old and new regimes (once out of the new regime, you may return only once).' });
  if (t.equityBuyback > 0) insights.push({ kind: 'info', text: `Buyback proceeds of ${fmt(t.equityBuyback)}: from 1 October 2024 the whole amount received is taxed as dividend at your slab rate, and what you paid for those shares becomes a capital loss you can set off. Not included in the totals above.` });
  if (parsed.charges.other > 0) insights.push({ kind: 'info', text: `Charges other than STT came to ${fmt(parsed.charges.other)} (brokerage, exchange, GST, stamp duty). They can be claimed as expenses on transfer against capital gains${deduct ? ' and have been deducted above' : '; tick the option to deduct them'}. STT of ${fmt(parsed.charges.stt)} is never deductible.` });
  if (parsed.grandfathered > 0) insights.push({ kind: 'info', text: `${parsed.grandfathered} long-term exit${parsed.grandfathered > 1 ? 's' : ''} used the 31 January 2018 fair market value as cost (grandfathering); the broker’s taxable profit already reflects it.` });
  if (parsed.totals.mfAssumedEquity) insights.push({ kind: 'warn', text: 'Mutual fund redemptions were classified by holding period and treated as equity funds because the statement did not say. Debt fund units bought on or after 1 April 2023 are taxed at slab rate whatever the holding period; check the fund type.' });

  return {
    heads: { stcgEquity, ltcgEquity, ...business },
    setOff, stcgTaxable, ltcgTaxable, ltcgExemptUsed, exemptionLeft, stclCarried, ltclCarried,
    tax: { stcg: stcgTax, ltcg: ltcgTax, business: businessTax, cess: (stcgTax + ltcgTax + businessTax) * cess, total },
    rates: { stcg: stcgRate, ltcg: ltcgRate, exemption, slab },
    insights,
  };
}

function fmt(n) { return '₹' + Math.round(Math.abs(n)).toLocaleString('en-IN'); }

/**
 * Quarter by quarter: what each quarter added, the tax on the year so far, and the advance-tax
 * instalment due after it. Capital gains are taxed as they arise: the tax on gains realised up to an
 * instalment date is due with that instalment (s.234C charges no interest on a shortfall caused by a
 * gain that arose after the previous instalment, provided it is paid in the next one). A later loss
 * can make earlier tax refundable; the schedule never goes negative, it just stops asking.
 */
export function quarterlyTax(parsed, rates, opts = {}) {
  const cum = { equityIntraday: 0, equityShortTerm: 0, equityLongTerm: 0, mfEquityShortTerm: 0, mfEquityLongTerm: 0, mfDebtShortTerm: 0, mfDebtLongTerm: 0, fnoOptions: 0, fnoFutures: 0, currency: 0, commodity: 0, equityBuyback: 0 };
  const cumCharges = { equityStcgOther: 0, equityLtcgOther: 0, stt: 0, other: 0 };
  let paid = 0;
  const rows = [];
  for (const q of parsed.quarters || []) {
    for (const k of ['equityIntraday', 'equityShortTerm', 'equityLongTerm', 'mfEquityShortTerm', 'mfEquityLongTerm', 'currency', 'commodity']) cum[k] += q.totals[k] || 0;
    cum.fnoOptions += q.totals.fno || 0;
    cum.mfDebtShortTerm += q.totals.mfDebt || 0;
    cumCharges.equityStcgOther += q.charges.equityStcgOther; cumCharges.equityLtcgOther += q.charges.equityLtcgOther;
    const r = tradingTax({ ...parsed, totals: { ...cum, mfAssumedEquity: parsed.totals.mfAssumedEquity }, charges: cumCharges, grandfathered: 0 }, rates, opts);
    const instalment = Math.max(0, r.tax.total - paid);
    rows.push({
      q: q.q, label: q.label, dueDate: q.dueDate, exits: q.exits,
      quarter: { stcg: q.totals.equityShortTerm + q.totals.mfEquityShortTerm, ltcg: q.totals.equityLongTerm + q.totals.mfEquityLongTerm, intraday: q.totals.equityIntraday, fno: q.totals.fno, other: (q.totals.currency || 0) + (q.totals.commodity || 0) + (q.totals.mfDebt || 0) },
      cumulative: { stcg: r.heads.stcgEquity, ltcg: r.heads.ltcgEquity, business: r.heads.intraday + r.heads.fno + r.heads.debtSlab + r.heads.currency + r.heads.commodity, taxSoFar: r.tax.total },
      instalment, refundable: Math.max(0, paid - r.tax.total),
    });
    paid = Math.max(paid, r.tax.total);
  }
  return { rows, totalPaid: paid, notes: [
    'Instalments fall due on 15 June, 15 September, 15 December and 15 March; a gain realised between 16 and 31 March is paid by 31 March. Gains realised in the last fortnight of a quarter technically belong to the next instalment.',
    'A loss later in the year can make tax already paid refundable; that comes back with the return, with interest under s.244A.',
    'This covers only the trading in this statement. Advance tax is on your whole income, so add salary TDS, interest, rent and other gains in the Tax comparison tab for the real instalment.',
  ] };
}
