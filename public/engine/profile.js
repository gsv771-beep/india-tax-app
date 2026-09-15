/**
 * The shared financial profile: schema, defaults, migrations and adapters.
 *
 * Pure functions only - no DOM, no storage. Storage and the "Your profile" panel live in
 * public/js (Phase 1). Every tool reads from and writes to one profile object persisted under
 * PROFILE_KEY; the test fixtures in public/fixtures/profiles/ are plain profiles in this shape.
 *
 * Schema v1 (all amounts annual rupees unless stated):
 *   income:      ctc, basic, hra, otherAllowances, employerNps, employerPf, esop (annual perquisite value)
 *   tax:         fy, regime ('old' | 'new'), s80cUsed, s80dUsed, nps1bUsed, otherDeductions, ageBand
 *   location:    city, metro (bool), rentPaid, housing ('rent' | 'own')
 *   loans:       [{ type, outstanding, rate (% p.a.), remainingMonths, emi (monthly), propertyUse }]
 *   investments: corpus by bucket: equity, debt, epf, ppf, nps, fd, gold
 *   cashflow:    monthlySurplus, emergencyFund
 *   household:   dependents, childrenAges []
 *   horizon:     goals [{ name, years }]
 */

export const PROFILE_KEY = 'taxcompass.profile.v1';
export const SCHEMA_VERSION = 1;

export const LOAN_TYPES = ['home', 'car', 'personal', 'education', 'other'];
export const PROPERTY_USE = ['self_occupied', 'let_out', 'none'];
export const INVESTMENT_BUCKETS = ['equity', 'debt', 'epf', 'ppf', 'nps', 'fd', 'gold'];

export function emptyProfile() {
  return {
    schemaVersion: SCHEMA_VERSION,
    income: { ctc: 0, basic: 0, hra: 0, otherAllowances: 0, employerNps: 0, employerPf: 0, esop: 0 },
    tax: { fy: 'FY2026-27', regime: 'new', s80cUsed: 0, s80dUsed: 0, nps1bUsed: 0, otherDeductions: 0, ageBand: 'below_60' },
    location: { city: 'Other', metro: false, rentPaid: 0, housing: 'rent' },
    loans: [],
    investments: { equity: 0, debt: 0, epf: 0, ppf: 0, nps: 0, fd: 0, gold: 0 },
    cashflow: { monthlySurplus: 0, emergencyFund: 0 },
    household: { dependents: 0, childrenAges: [] },
    horizon: { goals: [] },
  };
}

/**
 * Bring any saved or imported object up to the current schema. Unknown keys are dropped,
 * missing keys take defaults, so a profile saved by an older version never breaks a newer app.
 * Add a step per version bump: MIGRATIONS[n] takes a v(n) profile and returns v(n+1).
 */
const MIGRATIONS = {
  // 1: (p) => ({ ...p, schemaVersion: 2, newSection: {...} }),
};

export function migrateProfile(raw) {
  let p = raw && typeof raw === 'object' ? { ...raw } : {};
  let v = Number(p.schemaVersion) || 1;
  while (v < SCHEMA_VERSION && MIGRATIONS[v]) { p = MIGRATIONS[v](p); v = Number(p.schemaVersion); }
  return normaliseProfile(p);
}

/** Deep-merge onto defaults, coerce numbers, drop unknown keys. */
export function normaliseProfile(p) {
  const base = emptyProfile();
  const num = (v, d = 0) => (Number.isFinite(+v) ? +v : d);
  const pick = (target, src) => {
    const out = { ...target };
    for (const k of Object.keys(target)) {
      if (src && src[k] !== undefined) out[k] = typeof target[k] === 'number' ? num(src[k], target[k]) : typeof target[k] === 'boolean' ? !!src[k] : src[k];
    }
    return out;
  };
  const out = {
    schemaVersion: SCHEMA_VERSION,
    income: pick(base.income, p.income),
    tax: pick(base.tax, p.tax),
    location: pick(base.location, p.location),
    loans: Array.isArray(p.loans) ? p.loans.map(normaliseLoan) : [],
    investments: pick(base.investments, p.investments),
    cashflow: pick(base.cashflow, p.cashflow),
    household: { dependents: num(p.household?.dependents), childrenAges: Array.isArray(p.household?.childrenAges) ? p.household.childrenAges.map((a) => num(a)) : [] },
    horizon: { goals: Array.isArray(p.horizon?.goals) ? p.horizon.goals.map((g) => ({ name: String(g?.name || 'Goal'), years: num(g?.years) })) : [] },
  };
  if (out.tax.regime !== 'old' && out.tax.regime !== 'new') out.tax.regime = 'new';
  if (out.location.housing !== 'own' && out.location.housing !== 'rent') out.location.housing = 'rent';
  return out;
}

function normaliseLoan(l) {
  const num = (v) => (Number.isFinite(+v) ? +v : 0);
  const loan = {
    type: LOAN_TYPES.includes(l?.type) ? l.type : 'other',
    outstanding: num(l?.outstanding), rate: num(l?.rate), remainingMonths: Math.max(0, Math.round(num(l?.remainingMonths))),
    emi: num(l?.emi), propertyUse: PROPERTY_USE.includes(l?.propertyUse) ? l.propertyUse : 'none',
  };
  if (!loan.emi && loan.outstanding > 0 && loan.remainingMonths > 0) loan.emi = emiFor(loan.outstanding, loan.rate, loan.remainingMonths);
  return loan;
}

export function emiFor(P, annualRatePct, months) {
  const r = annualRatePct / 1200;
  if (months <= 0 || P <= 0) return 0;
  return r === 0 ? P / months : (P * r * Math.pow(1 + r, months)) / (Math.pow(1 + r, months) - 1);
}

/** Interest that falls in the next 12 months of a loan at its current EMI. */
export function nextYearInterest(loan) {
  const r = loan.rate / 1200;
  let bal = loan.outstanding, total = 0;
  for (let m = 0; m < Math.min(12, loan.remainingMonths) && bal > 0; m++) {
    const i = bal * r;
    total += i;
    bal -= Math.max(0, loan.emi - i);
  }
  return total;
}

/** Gross salary as the tax engine sees it: everything paid or taxed as salary, employer PF and gratuity excluded. */
export function grossSalaryOf(p) {
  const i = p.income;
  return i.basic + i.hra + i.otherAllowances + i.employerNps + i.esop;
}

/** Shape used by the old-vs-new comparison page (tax-engine.js `emptyInputs`). */
export function toTaxInputs(p) {
  const home = p.loans.filter((l) => l.type === 'home');
  const sop = home.filter((l) => l.propertyUse === 'self_occupied').reduce((s, l) => s + nextYearInterest(l), 0);
  const letOut = home.filter((l) => l.propertyUse === 'let_out').reduce((s, l) => s + nextYearInterest(l), 0);
  return {
    fy: p.tax.fy, resident: true, ageBand: p.tax.ageBand, hasBusinessIncome: false,
    salary: { gross: Math.round(grossSalaryOf(p)), basicDa: p.income.basic, hraReceived: p.income.hra, rentPaid: p.location.housing === 'rent' ? p.location.rentPaid : 0, city: p.location.city, ltaExempt: 0, professionalTax: 0 },
    employer: { npsContribution: p.income.employerNps, isGovernment: false, totalRetirementContribution: p.income.employerPf + p.income.employerNps },
    perquisites: { other: 0 },
    houseProperty: { selfOccupiedInterest: Math.round(sop), letOut: { rent: 0, municipalTax: 0, interest: Math.round(letOut) } },
    deductions: { includeEpf: true, epfEmployee: Math.round(0.12 * p.income.basic), s80c: p.tax.s80cUsed, nps1b: p.tax.nps1bUsed, healthSelf: p.tax.s80dUsed },
  };
}

/** Shape used by the in-hand salary calculator (salary.js). */
export function toSalaryStore(p) {
  const i = p.income;
  return {
    ctc: i.ctc, basicPct: i.ctc ? +(100 * i.basic / i.ctc).toFixed(2) : 40, hraPct: i.basic ? +(100 * i.hra / i.basic).toFixed(2) : 50,
    includeEmployerPf: i.employerPf > 0, includeGratuity: false, employerNpsPct: i.basic ? +(100 * i.employerNps / i.basic).toFixed(2) : 0,
    professionalTax: 0, city: p.location.city, rentPaid: p.location.housing === 'rent' ? p.location.rentPaid : 0,
    other80c: p.tax.s80cUsed, nps1b: p.tax.nps1bUsed, healthSelf: p.tax.s80dUsed, ageBand: p.tax.ageBand, regime: p.tax.regime,
  };
}
