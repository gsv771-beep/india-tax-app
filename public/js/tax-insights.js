/**
 * Break-even, headroom and what-if analysis on top of the tax engine.
 * Pure functions; tested in tests/tax-insights.test.mjs.
 */
import { computeTax, compareRegimes, mergeInputs, DEFAULT_FLAGS, AGE_BANDS } from './tax-engine.js';

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
  oldItem('80c', 'Section 80C investments (PPF, ELSS, EPF, NSC, SSY, life insurance, home loan principal, tuition)', 150000 - Math.min(+d.s80c || 0, 150000), '80c');
  oldItem('nps1b', 'Own NPS contribution under 80CCD(1B), over and above 80C', 50000 - Math.min(+d.nps1b || 0, 50000), 'pension');
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
      items.push({ id: 'emp_nps', label: 'Employer NPS contribution under 80CCD(2), if your employer restructures your salary', regime: 'both', room: roomNew, roomOld, saving: newTotal - newAfter, savingOld: oldTotal - oldAfter, schemesFilter: 'pension' });
    }
  }
  return { items, cmp };
}

/** Re-run the comparison with extra old-regime deductions the user is considering. */
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
