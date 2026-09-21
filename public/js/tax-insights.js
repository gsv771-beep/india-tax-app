/**
 * Break-even, headroom and what-if analysis on top of the tax engine.
 * Pure functions; tested in tests/tax-insights.test.mjs.
 */
import { computeTax, compareRegimes, mergeInputs, DEFAULT_FLAGS, AGE_BANDS, hasBusiness, businessIncome } from './tax-engine.js';

/** Old-regime total tax if slab income were `slabIncome`, everything else held. */
function taxAtSlab(income, slabIncome, rates, flags) {
  return computeTax({ ...income, slabIncome: Math.max(0, slabIncome) }, rates, flags).total;
}

/** Smallest x in [lo, hi] (integers) with pred(x) true, assuming pred is monotone false→true. Returns hi+1 if never true. */
function firstTrue(lo, hi, pred) {
  if (pred(lo)) return lo;
  if (!pred(hi)) return hi + 1;
  while (hi - lo > 1) { const mid = Math.floor((lo + hi) / 2); if (pred(mid)) hi = mid; else lo = mid; }
  return hi;
}

/** Deductions and exemptions the old regime is currently using (what could be "lost"). */
export function claimedOldRegime(oldIncome) {
  const lineIds = new Set(['hra', 'lta', 'professional_tax', 'hp_interest_sop']);
  const fromLines = oldIncome.lines.filter((l) => lineIds.has(l.id)).reduce((s, l) => s + Math.abs(l.amount), 0);
  return oldIncome.viaTotal + fromLines + Math.abs(oldIncome.hpLossSetOff || 0);
}

/**
 * How far the comparison is from flipping.
 *  kind 'need'      new wins; `extra` more old-regime deductions would make old win (or tie)
 *  kind 'impossible' new wins even if old-regime slab income were zero
 *  kind 'cushion'   old wins; it stays ahead until `cushion` of the claimed deductions are lost
 *  kind 'always'    old wins even with none of its deductions
 *  kind 'none'      no income entered
 */
export function breakEven(inputs, rates, flags = DEFAULT_FLAGS) {
  const cmp = compareRegimes(inputs, rates, flags);
  const oi = cmp.old.income;
  const target = cmp.new.tax.total;
  const oldTotal = cmp.old.tax.total;
  if (cmp.old.tax.totalIncome === 0 && cmp.new.tax.totalIncome === 0) return { kind: 'none', cmp };
  if (oldTotal > target) {
    if (taxAtSlab(oi, 0, rates, flags) > target) return { kind: 'impossible', cmp, gap: oldTotal - target };
    const extra = firstTrue(0, oi.slabIncome, (d) => taxAtSlab(oi, oi.slabIncome - d, rates, flags) <= target);
    return { kind: 'need', cmp, extra, gap: oldTotal - target };
  }
  const claimed = claimedOldRegime(oi);
  if (taxAtSlab(oi, oi.slabIncome + claimed, rates, flags) <= target) return { kind: 'always', cmp, claimed, margin: target - oldTotal };
  // largest r with tax still <= target  == firstTrue(r: tax > target) - 1
  const r = firstTrue(0, claimed, (x) => taxAtSlab(oi, oi.slabIncome + x, rates, flags) > target) - 1;
  return { kind: 'cushion', cmp, cushion: Math.max(0, r), claimed, margin: target - oldTotal };
}

/**
 * Unused room in the deductions a person can still act on this year, and what using it would save.
 * Old-regime items: 80C, 80CCD(1B), 80D. Both regimes: employer NPS (needs a salary restructure).
 */
export function headroom(inputs, rates, flags = DEFAULT_FLAGS) {
  const inp = mergeInputs(inputs);
  const cmp = compareRegimes(inp, rates, flags);
  const oi = cmp.old.income, ni = cmp.new.income;
  const oldTotal = cmp.old.tax.total, newTotal = cmp.new.tax.total;
  const d = inp.deductions;
  const items = [];
  const oldItem = (id, label, room, schemesFilter) => {
    if (room <= 0) return;
    const usable = Math.min(room, oi.slabIncome);
    const after = taxAtSlab(oi, oi.slabIncome - usable, rates, flags);
    items.push({ id, label, regime: 'old', room, saving: oldTotal - after, oldAfter: after, flipsToOld: after < newTotal && oldTotal >= newTotal, schemesFilter });
  };
  const used80c = (oi.via.find((v) => v.id === '80c') || { amount: 0 }).amount;
  oldItem('80c', 'Section 80C investments beyond EPF (PPF, ELSS, NSC, SSY, life insurance, home loan principal, tuition)', 150000 - Math.min(used80c, 150000), null);
  oldItem('nps1b', 'Own NPS contribution under 80CCD(1B), over and above 80C', 50000 - Math.min(+d.nps1b || 0, 50000), 'nps');
  const selfCap = inp.ageBand !== AGE_BANDS.below_60 ? 50000 : 25000;
  const parentsCap = d.parentsSenior ? 50000 : 25000;
  oldItem('80d', 'Health insurance premium under 80D (self, family and parents)', (selfCap - Math.min(+d.healthSelf || 0, selfCap)) + (parentsCap - Math.min(+d.healthParents || 0, parentsCap)), null);

  const basicDa = +inp.salary.basicDa || 0, empNps = +inp.employer.npsContribution || 0;
  if ((+inp.salary.gross || 0) > 0 && basicDa > 0) {
    const roomNew = Math.max(0, 0.14 * basicDa - empNps);
    const roomOld = Math.max(0, (inp.employer.isGovernment ? 0.14 : 0.10) * basicDa - empNps);
    if (roomNew > 0 || roomOld > 0) {
      const newAfter = taxAtSlab(ni, ni.slabIncome - Math.min(roomNew, ni.slabIncome), rates, flags);
      const oldAfter = taxAtSlab(oi, oi.slabIncome - Math.min(roomOld, oi.slabIncome), rates, flags);
      items.push({ id: 'emp_nps', label: 'Employer NPS contribution under 80CCD(2), if your employer restructures your salary', regime: 'both', room: roomNew, roomOld, saving: newTotal - newAfter, savingOld: oldTotal - oldAfter, schemesFilter: 'nps' });
    }
  }
  return { items, cmp };
}

/**
 * Points for the break-even chart: old-regime tax as total old-regime deductions vary, with the new
 * regime's (unaffected) tax alongside. x = total deductions and exemptions claimed under the old regime.
 */
export function breakEvenCurve(inputs, rates, flags = DEFAULT_FLAGS, samples = 60) {
  const be = breakEven(inputs, rates, flags);
  if (be.kind === 'none') return null;
  const cmp = be.cmp, oi = cmp.old.income;
  const claimed = claimedOldRegime(oi);
  const newTax = cmp.new.tax.total;
  const ceiling = oi.slabIncome + claimed; // deductions cannot exceed the income they reduce
  let xMax = Math.max(claimed * 1.5, 250000);
  if (be.kind === 'need') xMax = Math.max(xMax, (claimed + be.extra) * 1.25);
  xMax = Math.min(Math.max(xMax, claimed + 50000), ceiling || xMax);
  const points = [];
  for (let i = 0; i <= samples; i++) {
    const d = (xMax * i) / samples;
    points.push([Math.round(d), taxAtSlab(oi, oi.slabIncome + claimed - d, rates, flags)]);
  }
  const crossing = be.kind === 'need' ? claimed + be.extra : be.kind === 'cushion' ? claimed - be.cushion : null;
  return { points, newTax, current: { x: claimed, y: cmp.old.tax.total }, crossing, xMax, kind: be.kind };
}

/** Steps for the income-to-tax waterfall of one regime. */
export function waterfallSteps(regimeResult) {
  const { income, tax } = regimeResult;
  const L = Object.fromEntries(income.lines.map((l) => [l.id, l.amount]));
  const grossSalary = (L.gross_salary || 0) + (L.perq_employer_excess || 0) + (L.perq_other || 0);
  const netSalary = L.net_salary || 0;
  const hpNav = L.hp_nav || 0, hpIncome = L.hp_income ?? 0;
  const other = (L.other_sources || 0) + (L.business || 0);
  const gross = grossSalary + hpNav + other;
  const steps = [{ label: 'Gross income', value: gross, kind: 'start' }];
  if (grossSalary - netSalary > 0) steps.push({ label: 'Salary exemptions and deductions', value: grossSalary - netSalary, kind: 'minus' });
  if (hpNav - hpIncome > 0) steps.push({ label: 'House property deductions', value: hpNav - hpIncome, kind: 'minus' });
  if (income.viaTotal > 0) steps.push({ label: 'Chapter VI-A deductions', value: income.viaTotal, kind: 'minus' });
  steps.push({ label: 'Taxable slab income', value: tax.slabIncome, kind: 'total' });
  steps.push({ label: 'Tax payable (incl. cess)', value: tax.total, kind: 'tax' });
  return { steps, gross };
}

/** Re-run the comparison with extra old-regime deductions the user is considering. */
/**
 * What moves your tax most: each income source and each deduction or exemption, measured by
 * removing it and recomputing, under both regimes. `effect` is the rupees of tax the item is
 * responsible for: positive means it adds tax (income), negative means it cuts tax (a deduction).
 * Returns items sorted by size under the regime that is currently lower (`regime`).
 *   -> { regime, items: [{ id, label, kind: 'income'|'relief', amount, old, new, effect }] }
 */
export function taxDrivers(inputs, rates, flags = DEFAULT_FLAGS) {
  const inp = mergeInputs(inputs);
  const base = compareRegimes(inp, rates, flags);
  const regime = base.better === 'old' ? 'old' : 'new';
  const num = (v) => (Number.isFinite(+v) ? +v : 0);
  const sum = (...v) => v.reduce((s, x) => s + num(x), 0);
  const without = (mutate) => { const m = mergeInputs(inp); mutate(m); return compareRegimes(m, rates, flags); };
  const cand = [
    { id: 'salary', label: 'Salary', kind: 'income', amount: num(inp.salary.gross), mutate: (m) => { m.salary.gross = 0; m.salary.basicDa = 0; m.salary.hraReceived = 0; m.salary.rentPaid = 0; m.salary.ltaExempt = 0; m.salary.professionalTax = 0; m.deductions.includeEpf = false; m.deductions.epfEmployee = 0; } },
    { id: 'business', label: inp.business.kind === 'business' ? 'Business turnover' : 'Professional receipts', kind: 'income', amount: num(inp.business.receipts) || num(inp.business.income), mutate: (m) => { m.business.income = 0; m.business.receipts = 0; } },
    { id: 'rent', label: 'Rent from property', kind: 'income', amount: num(inp.houseProperty.letOut.rent), mutate: (m) => { m.houseProperty.letOut = { rent: 0, municipalTax: 0, interest: 0 }; } },
    { id: 'other', label: 'Interest, dividends and other income', kind: 'income', amount: sum(inp.otherIncome.savingsInterest, inp.otherIncome.depositInterest, inp.otherIncome.dividends, inp.otherIncome.other), mutate: (m) => { m.otherIncome = { savingsInterest: 0, depositInterest: 0, dividends: 0, other: 0 }; } },
    { id: 'capgains', label: 'Capital gains', kind: 'income', amount: sum(inp.capitalGains.stcgEquity, inp.capitalGains.ltcgEquity, inp.capitalGains.ltcgOther, inp.capitalGains.lottery), mutate: (m) => { m.capitalGains = { stcgEquity: 0, ltcgEquity: 0, ltcgOther: 0, lottery: 0 }; } },
    { id: 'hra', label: num(inp.salary.hraReceived) > 0 ? 'HRA exemption (rent paid)' : 'Rent paid (80GG)', kind: 'relief', amount: num(inp.salary.rentPaid), mutate: (m) => { m.salary.rentPaid = 0; } },
    { id: 'homeloan', label: 'Home loan interest, self-occupied (24(b))', kind: 'relief', amount: num(inp.houseProperty.selfOccupiedInterest), mutate: (m) => { m.houseProperty.selfOccupiedInterest = 0; } },
    { id: '80c', label: '80C (EPF, PPF, ELSS, insurance)', kind: 'relief', amount: num(inp.deductions.s80c) + (inp.deductions.includeEpf ? Math.max(num(inp.deductions.epfEmployee), 0.12 * num(inp.salary.basicDa)) : 0), mutate: (m) => { m.deductions.s80c = 0; m.deductions.includeEpf = false; m.deductions.epfEmployee = 0; } },
    { id: 'nps_employer', label: 'Employer NPS (80CCD(2))', kind: 'relief', amount: num(inp.employer.npsContribution), mutate: (m) => { m.employer.npsContribution = 0; } },
    { id: 'nps_own', label: 'Own NPS (80CCD(1) and (1B))', kind: 'relief', amount: num(inp.deductions.nps1b) + num(inp.deductions.nps1), mutate: (m) => { m.deductions.nps1b = 0; m.deductions.nps1 = 0; } },
    { id: '80d', label: 'Health insurance (80D)', kind: 'relief', amount: sum(inp.deductions.healthSelf, inp.deductions.healthParents), mutate: (m) => { m.deductions.healthSelf = 0; m.deductions.healthParents = 0; } },
    { id: '80e', label: 'Education loan interest (80E)', kind: 'relief', amount: num(inp.deductions.educationLoanInterest), mutate: (m) => { m.deductions.educationLoanInterest = 0; } },
    { id: '80g', label: 'Donations (80G)', kind: 'relief', amount: num(inp.deductions.donations), mutate: (m) => { m.deductions.donations = 0; } },
    { id: 'lta', label: 'LTA exemption', kind: 'relief', amount: num(inp.salary.ltaExempt), mutate: (m) => { m.salary.ltaExempt = 0; } },
  ].filter((c) => c.amount > 0);
  const items = cand.map((c) => {
    const w = without(c.mutate);
    // income: tax falls when removed, so effect = base - without; relief: tax rises, effect = -(without - base)
    const eff = (k) => base[k].tax.total - w[k].tax.total;
    const item = { id: c.id, label: c.label, kind: c.kind, amount: Math.round(c.amount), old: Math.round(eff('old')), new: Math.round(eff('new')) };
    item.effect = item[regime];
    return item;
  }).filter((it) => it.old !== 0 || it.new !== 0);
  const size = (it) => Math.max(Math.abs(it.old), Math.abs(it.new));   // biggest in either regime first: a deduction the new regime ignores is still a driver
  items.sort((a, b) => size(b) - size(a));
  return { regime, items };
}

export function whatIf(inputs, extras, rates, flags = DEFAULT_FLAGS) {
  const inp = mergeInputs(inputs);
  const before = compareRegimes(inp, rates, flags);
  const mod = mergeInputs(inp);
  mod.deductions.s80c = (+mod.deductions.s80c || 0) + (extras.s80c || 0);
  mod.deductions.nps1b = (+mod.deductions.nps1b || 0) + (extras.nps1b || 0);
  mod.deductions.healthSelf = (+mod.deductions.healthSelf || 0) + (extras.health || 0);
  const after = compareRegimes(mod, rates, flags);
  const invested = (extras.s80c || 0) + (extras.nps1b || 0) + (extras.health || 0);
  return { before, after, invested, taxSaved: before.old.tax.total - after.old.tax.total };
}

/**
 * Advance tax calendar for the regime that is lower: who owes it, when, and how much. Presumptive
 * business or profession pays the whole amount by 15 March; everyone else pays 15/45/75/100%
 * cumulatively on 15 June, September, December and March. Nothing is due under Rs 10,000 of net
 * liability, and resident seniors without business income are exempt. Returns null when none is due.
 *   -> { regime, total, tds, net, presumptive, rows: [{ due, cumulativePct, cumulative, instalment }], note }
 */
export function advanceTaxSchedule(inputs, rates, flags = DEFAULT_FLAGS) {
  const inp = mergeInputs(inputs);
  const cmp = compareRegimes(inp, rates, flags);
  const regime = cmp.better === 'old' ? 'old' : 'new';
  const t = cmp[regime].tax;
  const at = rates.advance_tax;
  const net = t.netPayable != null ? t.netPayable : t.total;
  const seniorNoBusiness = inp.resident && inp.ageBand !== AGE_BANDS.below_60 && !hasBusiness(inp);
  if (net < (at.liability_threshold || 10000) || seniorNoBusiness) return null;
  const bz = businessIncome(inp, rates);
  const presumptive = hasBusiness(inp) && bz.presumptive && num(inp.salary.gross) === 0;
  const rows = presumptive
    ? [{ due: at.presumptive_taxation.due, cumulativePct: 1, cumulative: net, instalment: net }]
    : at.instalments.map((i, k, arr) => { const cumulative = Math.round(net * i.cumulative_pct); const prev = k ? Math.round(net * arr[k - 1].cumulative_pct) : 0; return { due: i.due, cumulativePct: i.cumulative_pct, cumulative, instalment: cumulative - prev }; });
  return {
    regime, total: t.total, tds: t.tdsDeducted || 0, net, presumptive, rows,
    note: presumptive ? 'Under the presumptive scheme the whole year’s advance tax is one payment by 15 March; paying later costs 1% a month interest (234B/234C).' : 'Pay each instalment by its date; a shortfall costs 1% a month simple interest (234C), and paying less than 90% by 31 March adds 234B interest from April. Salary TDS counts as paid; add capital gains as they arise.',
  };
}
const num = (v) => (Number.isFinite(+v) ? +v : 0);
