/**
 * Old-vs-new regime tax computation engine.
 *
 * Pure functions, no DOM. Works in the browser (ES module) and in Node for tests.
 * Rates come from data/tax_rates.json (passed in as `rates`), never hard-coded here,
 * except for a few structural rules that are the same in both regimes and documented
 * in docs/calculation_engine_spec.md.
 *
 * Order of operations follows docs/calculation_engine_spec.md section 1.
 *
 * Documented assumptions (see README "Engine assumptions"):
 *  A1. Marginal relief on the new-regime rebate is applied to slab-rate tax only.
 *      Special-rate tax (capital gains, lottery) is never reduced by the rebate or its relief.
 *  A2. For residents, unexhausted basic exemption is set against STCG (equity) first,
 *      then LTCG (equity, after the Rs 1.25L exemption), then other LTCG.
 *  A3. The 15% surcharge cap on dividend income is approximated by attributing slab tax
 *      to dividends in proportion to their share of slab income. Only matters above Rs 2 crore.
 *  A4. Marginal relief on surcharge is computed against the single threshold just below
 *      total income, treating the incremental income as slab income.
 *  A5. Employer contribution above the Rs 7.5L cap is added as a perquisite; the accretion
 *      on that excess (Rule 3B) is not modelled.
 *  A6. Final tax is rounded to the nearest rupee, not to the nearest Rs 10 (s.288B).
 */

export const AGE_BANDS = {
  below_60: 'below_60',
  senior: 'senior_60_to_79',
  super_senior: 'super_senior_80_plus',
};

export const DEFAULT_FLAGS = {
  // docs/VERIFY_BEFORE_LAUNCH.md item 2. Off until the Rules 2026 notification is confirmed.
  hraEightCityMetro: false,
  // docs/VERIFY_BEFORE_LAUNCH.md item 3. Pack models the old-regime rebate as a hard cliff.
  oldRegimeRebateMarginalRelief: false,
};

const METRO_4 = ['Delhi', 'Mumbai', 'Kolkata', 'Chennai'];
const METRO_8 = [...METRO_4, 'Bengaluru', 'Hyderabad', 'Pune', 'Ahmedabad'];

export function emptyInputs() {
  return {
    fy: 'FY2026-27',
    resident: true,
    ageBand: AGE_BANDS.below_60,
    incomeType: 'salary',    // 'salary' | 'business' | 'both': which income blocks apply
    hasBusinessIncome: false,
    salary: {
      gross: 0,          // gross salary or pension, before any deduction
      basicDa: 0,        // annual Basic + DA
      hraReceived: 0,
      rentPaid: 0,
      city: 'Other',
      ltaExempt: 0,      // LTA exemption actually claimable (fare, 2 in 4 years)
      conveyance: 0,     // conveyance allowance: fully taxable since 2018, part of gross; kept for the break-up
      variablePay: 0,    // bonus or performance pay inside gross; kept for the break-up
      professionalTax: 0,
    },
    employer: {
      npsContribution: 0,
      isGovernment: false,
      totalRetirementContribution: 0, // employer PF + superannuation + NPS combined
    },
    perquisites: {
      other: 0,          // any other taxable perquisite value (car, accommodation) - both regimes
    },
    houseProperty: {
      selfOccupiedInterest: 0,
      letOut: { rent: 0, municipalTax: 0, interest: 0 },
    },
    business: {
      income: 0,             // net income from books, used when receipts are 0 or presumptive is off with no receipts
      receipts: 0,           // gross receipts / turnover for the year
      kind: 'profession',    // 'profession' (44ADA) | 'business' (44AD)
      presumptive: true,     // deemed profit instead of books
      digitalSharePct: 100,  // 44AD: share of turnover received digitally (6% instead of 8%)
      expenses: 0,           // books: expenses to set against receipts when presumptive is off
      tdsDeducted: 0,        // TDS clients already deducted (194J etc.), credited against the tax
    },
    otherIncome: {
      savingsInterest: 0,
      depositInterest: 0, // FD / RD interest
      dividends: 0,
      other: 0,
    },
    capitalGains: {
      stcgEquity: 0,   // listed equity / equity MF, STT paid, held <= 12 months
      ltcgEquity: 0,   // listed equity / equity MF, held > 12 months (before Rs 1.25L exemption)
      ltcgOther: 0,    // other assets, 12.5% without indexation
      lottery: 0,      // lottery, online gaming, VDA at 30%
    },
    deductions: {
      includeEpf: true,      // count the employee's EPF share (12% of Basic + DA) in 80C automatically
      epfEmployee: 0,        // actual annual employee EPF/VPF contribution, if known; 0 = compute 12% of Basic + DA
      s80c: 0,               // other 80C items, excluding EPF
      nps1: 0,               // own NPS under 80CCD(1): 10% of salary for employees, 20% of income for others, within the 1.5L aggregate
      nps1b: 0,
      healthSelf: 0,
      healthParents: 0,
      parentsSenior: false,
      educationLoanInterest: 0,
      donations: 0,
      donationCategory: 'D', // A 100% no limit, B 50% no limit, C 100% with limit, D 50% with limit
      disability: 'none',    // none | self_40 | self_80 | dependant_40 | dependant_80
    },
  };
}

// ---------- helpers ----------

const num = (v) => (Number.isFinite(+v) ? +v : 0);
const clamp0 = (v) => Math.max(0, v);

function slabTaxFor(income, bands) {
  let tax = 0;
  for (const b of bands) {
    if (income <= b.from - 1 && b.from > 0) break;
    const lower = b.from === 0 ? 0 : b.from - 1;
    const upper = b.to == null ? Infinity : b.to;
    if (income > lower) tax += (Math.min(income, upper) - lower) * b.rate;
  }
  return tax;
}

/** Slab-by-slab working: [{from, to, rate, amount, tax}] for the bands the income reaches. */
export function slabBreakdown(income, bands) {
  const rows = [];
  for (const b of bands) {
    const lower = b.from === 0 ? 0 : b.from - 1;
    const upper = b.to == null ? Infinity : b.to;
    if (income <= lower) break;
    const amount = Math.min(income, upper) - lower;
    rows.push({ from: lower, to: b.to, rate: b.rate, amount, tax: amount * b.rate });
  }
  return rows;
}

function bandsFor(regime, ageBand, rates) {
  if (regime === 'new') return rates.slabs.new_regime.bands;
  const old = rates.slabs.old_regime;
  if (ageBand === AGE_BANDS.super_senior) return old.super_senior_80_plus;
  if (ageBand === AGE_BANDS.senior) return old.senior_60_to_79;
  return old.below_60;
}

function basicExemptionFor(regime, ageBand, rates) {
  return bandsFor(regime, ageBand, rates)[0].to;
}

function isMetro(city, fy, flags) {
  const list = flags.hraEightCityMetro && fy === 'FY2026-27' ? METRO_8 : METRO_4;
  return list.includes(city);
}

function surchargeRate(totalIncome, regime, rates) {
  const table = regime === 'new' ? rates.surcharge.new_regime : rates.surcharge.old_regime;
  let rate = 0;
  let threshold = 0;
  for (const row of table) {
    if (totalIncome > row.income_above) {
      rate = row.rate;
      threshold = row.income_above;
    }
  }
  return { rate, threshold };
}

// ---------- step 1-5: income ----------

export function computeIncome(inputsIn, regime, rates, flags = DEFAULT_FLAGS) {
  const inp = mergeInputs(inputsIn);
  const isNew = regime === 'new';
  const lines = [];
  const notes = [];
  let hraWorking = null;
  const push = (id, label, amount, extra = {}) => lines.push({ id, label, amount, ...extra });

  // --- 1.1 Salary ---
  const gross = num(inp.salary.gross);
  let salary = 0;
  if (gross > 0) {
    push('gross_salary', 'Gross salary / pension', gross);
    salary = gross;

    // perquisites (both regimes)
    const excessEmployer = clamp0(num(inp.employer.totalRetirementContribution) - 750000);
    if (excessEmployer > 0) {
      push('perq_employer_excess', 'Add: employer PF/NPS/superannuation above Rs 7.5L (perquisite)', excessEmployer);
      salary += excessEmployer;
      notes.push('Employer retirement contributions above Rs 7,50,000 are a taxable perquisite in both regimes.');
    }
    const perqOther = num(inp.perquisites.other);
    if (perqOther > 0) {
      push('perq_other', 'Add: other perquisites (car, accommodation etc.)', perqOther);
      salary += perqOther;
    }

    // exempt allowances (old regime only)
    let hraExempt = 0;
    if (num(inp.salary.hraReceived) > 0 || num(inp.salary.rentPaid) > 0) {
      const basicDa = num(inp.salary.basicDa);
      const metro = isMetro(inp.salary.city, inp.fy, flags);
      const pct = metro ? 0.5 : 0.4;
      const limbs = [
        { id: 'received', label: 'HRA actually received', value: num(inp.salary.hraReceived) },
        { id: 'salary_pct', label: `${Math.round(pct * 100)}% of Basic + DA (${metro ? 'metro' : 'non-metro'} city)`, value: pct * basicDa },
        { id: 'rent_excess', label: 'Rent paid minus 10% of Basic + DA', value: num(inp.salary.rentPaid) - 0.1 * basicDa },
      ];
      const least = Math.min(...limbs.map((l) => l.value));
      const exempt = num(inp.salary.hraReceived) > 0 && num(inp.salary.rentPaid) > 0 ? clamp0(least) : 0;
      hraWorking = { limbs, least, exempt, metro, pct, city: inp.salary.city, basicDa, appliesInRegime: !isNew, missing: num(inp.salary.hraReceived) > 0 && num(inp.salary.rentPaid) <= 0 ? 'rent' : num(inp.salary.rentPaid) > 0 && num(inp.salary.hraReceived) <= 0 ? 'hra' : null };
      if (!isNew) hraExempt = exempt;
    }
    push('hra', 'Less: HRA exemption', -hraExempt, { unavailableIn: 'new' });
    salary -= hraExempt;

    const lta = isNew ? 0 : num(inp.salary.ltaExempt);
    push('lta', 'Less: LTA exemption', -lta, { unavailableIn: 'new' });
    salary -= lta;

    // standard deduction
    const stdCap = isNew ? rates.standard_deductions.salary.new_regime : rates.standard_deductions.salary.old_regime;
    const std = Math.min(stdCap, salary);
    push('std_deduction', 'Less: standard deduction', -std);
    salary -= std;

    // professional tax (old regime only)
    const pt = isNew ? 0 : num(inp.salary.professionalTax);
    push('professional_tax', 'Less: professional tax', -pt, { unavailableIn: 'new' });
    salary -= pt;

    salary = clamp0(salary);
    // break-up of that gross, when the person gave one: information only, it does not change the tax
    const conveyance = num(inp.salary.conveyance), variablePay = num(inp.salary.variablePay);
    const basicForBreakup = num(inp.salary.basicDa);
    if (basicForBreakup > 0 || conveyance > 0 || variablePay > 0) {
      const named = basicForBreakup + num(inp.salary.hraReceived) + conveyance + variablePay;
      const parts = [basicForBreakup > 0 ? `Basic + DA ${fmtNum(basicForBreakup)}` : null, num(inp.salary.hraReceived) > 0 ? `HRA ${fmtNum(num(inp.salary.hraReceived))}` : null, conveyance > 0 ? `conveyance ${fmtNum(conveyance)}` : null, variablePay > 0 ? `variable pay ${fmtNum(variablePay)}` : null, gross - named > 0 ? `special allowance ${fmtNum(gross - named)}` : null].filter(Boolean);
      push('salary_breakup', `Of which: ${parts.join(', ')}`, 0, { info: true });
      if (named > gross) notes.push(`The salary components add up to Rs ${fmtNum(named)}, more than the gross salary of Rs ${fmtNum(gross)}. Raise the gross or reduce a component.`);
    }
    push('net_salary', 'Income from salary', salary, { subtotal: true });
  }

  // --- 1.2 House property ---
  const lo = inp.houseProperty.letOut;
  let hp = 0;
  let hpLossSetOff = 0;
  let hpLossCarried = 0;
  let hpLossExtinguished = 0;
  const rent = num(lo.rent);
  const sopInterest = num(inp.houseProperty.selfOccupiedInterest);
  if (rent > 0 || num(lo.interest) > 0 || sopInterest > 0) {
    const nav = clamp0(rent - num(lo.municipalTax));
    const stdHp = 0.3 * nav;
    const letOutIncome = nav - stdHp - num(lo.interest);
    if (rent > 0 || num(lo.interest) > 0) {
      push('hp_nav', 'Net annual value of let-out property', nav);
      push('hp_std', 'Less: 30% standard deduction', -stdHp);
      push('hp_interest_letout', 'Less: interest on let-out property (uncapped)', -num(lo.interest));
    }
    const sopDeduction = isNew ? 0 : Math.min(sopInterest, 200000);
    if (sopInterest > 0) {
      push('hp_interest_sop', 'Less: interest on self-occupied property (cap Rs 2L)', -sopDeduction, { unavailableIn: 'new' });
    }
    hp = letOutIncome - sopDeduction;
    if (hp < 0) {
      const loss = -hp;
      if (isNew) {
        hpLossExtinguished = loss;
        hp = 0;
        notes.push(`New regime: house property loss of Rs ${fmtNum(loss)} cannot be set off against salary and cannot be carried forward. It is extinguished.`);
      } else {
        hpLossSetOff = Math.min(loss, 200000);
        hpLossCarried = loss - hpLossSetOff;
        hp = -hpLossSetOff;
        if (hpLossCarried > 0) {
          notes.push(`Old regime: house property loss set off against other income is capped at Rs 2,00,000. Rs ${fmtNum(hpLossCarried)} is carried forward for up to 8 years.`);
        }
      }
    }
    push('hp_income', 'Income from house property', hp, { subtotal: true });
  }

  // --- 1.3 Business or profession ---
  const bz = businessIncome(inp, rates);
  for (const l of bz.lines) push(l.id, l.label, l.amount, l.extra || {});
  for (const n of bz.notes) notes.push(n);
  const business = bz.income;

  // --- 1.5 Other sources ---
  const savings = num(inp.otherIncome.savingsInterest);
  const deposits = num(inp.otherIncome.depositInterest);
  const dividends = num(inp.otherIncome.dividends);
  const otherMisc = num(inp.otherIncome.other);
  const otherSources = savings + deposits + dividends + otherMisc;
  if (otherSources !== 0) push('other_sources', 'Income from other sources', otherSources, { subtotal: true });

  // --- Gross total income (slab portion) ---
  let slabGti = clamp0(salary + hp + business + otherSources);
  push('gti', 'Gross total income (slab-rate)', slabGti, { subtotal: true });

  // --- 1.4 Capital gains buckets (kept separate) ---
  const cg = inp.capitalGains;
  const buckets = {
    stcgEquity: clamp0(num(cg.stcgEquity)),
    ltcgEquity: clamp0(num(cg.ltcgEquity) - rates.special_rate_income.capital_gains.ltcg_listed_equity_stt.annual_exemption),
    ltcgOther: clamp0(num(cg.ltcgOther)),
    lottery: clamp0(num(cg.lottery)),
  };
  if (num(cg.ltcgEquity) > 0) {
    push('ltcg_equity_exempt', 'LTCG on listed equity: first Rs 1,25,000 exempt', 0, { info: true });
  }

  // --- 4. Chapter VI-A ---
  const d = inp.deductions;
  const via = [];
  const addVia = (id, label, amount, extra = {}) => { if (amount > 0) via.push({ id, label, amount, ...extra }); };

  // both regimes
  const basicDa = num(inp.salary.basicDa);
  const empNps = num(inp.employer.npsContribution);
  if (empNps > 0 && gross > 0) {
    const pct = inp.employer.isGovernment || isNew ? 0.14 : 0.10;
    const cap = pct * basicDa;
    addVia('80ccd2', `80CCD(2) / s.124 employer NPS (cap ${Math.round(pct * 100)}% of Basic+DA)`, Math.min(empNps, cap));
    if (empNps > cap) notes.push(`Employer NPS of Rs ${fmtNum(empNps)} exceeds the ${Math.round(pct * 100)}% cap in the ${regime} regime; only Rs ${fmtNum(cap)} is deductible.`);
  }

  // Employee's own EPF share counts within 80C. Employer's share is exempt income, not a deduction.
  const epf = gross > 0 && d.includeEpf !== false ? (num(d.epfEmployee) > 0 ? num(d.epfEmployee) : 0.12 * basicDa) : 0;
  if (!isNew) {
    // own NPS under 80CCD(1) sits inside the same Rs 1.5L aggregate: 10% of Basic + DA for employees, 20% of gross total income for others
    const bi = rates.business_income || {};
    const nps1Cap = gross > 0 ? (bi.own_nps_80ccd1 ? bi.own_nps_80ccd1.cap_pct_of_salary_for_employees : 0.10) * basicDa : (bi.own_nps_80ccd1 ? bi.own_nps_80ccd1.cap_pct_of_gross_total_income_for_others : 0.20) * slabGti;
    const nps1 = Math.min(num(d.nps1), nps1Cap);
    if (num(d.nps1) > nps1Cap && nps1Cap >= 0) notes.push(`Own NPS under 80CCD(1) is capped at Rs ${fmtNum(nps1Cap)} (${gross > 0 ? '10% of Basic + DA' : '20% of gross total income'}); the rest is not deductible there.`);
    const s80c = Math.min(num(d.s80c) + epf + nps1, 150000);
    const parts = [epf > 0 ? `EPF ${fmtNum(epf)}` : null, nps1 > 0 ? `own NPS ${fmtNum(nps1)}` : null].filter(Boolean);
    addVia('80c', parts.length ? `80C / s.123 investments incl. ${parts.join(' and ')} (cap Rs 1.5L)` : '80C / s.123 investments (cap Rs 1.5L)', s80c, { epf, nps1 });
    addVia('80ccd1b', '80CCD(1B) / s.124 own NPS (cap Rs 50,000)', Math.min(num(d.nps1b), 50000));

    const selfSenior = inp.ageBand !== AGE_BANDS.below_60;
    const selfCap = selfSenior ? 50000 : 25000;
    const parentsCap = d.parentsSenior ? 50000 : 25000;
    addVia('80d', '80D / s.126 health insurance', Math.min(num(d.healthSelf), selfCap) + Math.min(num(d.healthParents), parentsCap));

    addVia('80e', '80E / s.129 education loan interest (uncapped)', num(d.educationLoanInterest));

    const don = num(d.donations);
    if (don > 0) {
      const rate = d.donationCategory === 'A' || d.donationCategory === 'C' ? 1 : 0.5;
      const limited = d.donationCategory === 'C' || d.donationCategory === 'D';
      const qualifying = limited ? Math.min(don, 0.1 * slabGti) : don;
      addVia('80g', `80G / s.133 donations (${Math.round(rate * 100)}%${limited ? ', within 10% of income' : ''})`, qualifying * rate);
    }

    if (inp.ageBand === AGE_BANDS.below_60) {
      addVia('80tta', '80TTA / s.153 savings interest (cap Rs 10,000)', Math.min(savings, 10000));
    } else {
      addVia('80ttb', '80TTB / s.153 deposit interest, seniors (cap Rs 50,000)', Math.min(savings + deposits, 50000));
    }

    const dis = d.disability;
    if (dis === 'self_40') addVia('80u', '80U / s.154 self disability', 75000);
    if (dis === 'self_80') addVia('80u', '80U / s.154 self severe disability', 125000);
    if (dis === 'dependant_40') addVia('80dd', '80DD / s.127 disabled dependant', 75000);
    if (dis === 'dependant_80') addVia('80dd', '80DD / s.127 severely disabled dependant', 125000);
  }

  // 80GG: rent paid with no HRA, old regime. Least of Rs 60,000; 25% of adjusted total income; rent less 10% of it.
  if (!isNew && num(inp.salary.rentPaid) > 0 && num(inp.salary.hraReceived) === 0) {
    const g = (rates.business_income || {}).rent_paid_no_hra || { cap_per_year: 60000, pct_of_adjusted_total_income: 0.25, rent_less_pct_of_adjusted_total_income: 0.10 };
    const ati = clamp0(slabGti - via.reduce((s, x) => s + x.amount, 0));
    const rent = num(inp.salary.rentPaid);
    const ded = Math.max(0, Math.min(g.cap_per_year, g.pct_of_adjusted_total_income * ati, rent - g.rent_less_pct_of_adjusted_total_income * ati));
    addVia('80gg', '80GG / s.134 rent paid, no HRA (least of three)', Math.round(ded));
  }

  // Chapter VI-A can never reduce slab income below zero and never touches special-rate income.
  let viaTotal = via.reduce((s, x) => s + x.amount, 0);
  if (viaTotal > slabGti) {
    notes.push(`Deductions of Rs ${fmtNum(viaTotal)} exceed slab-rate income; only Rs ${fmtNum(slabGti)} can be used.`);
    viaTotal = slabGti;
  }
  const slabIncome = slabGti - viaTotal;

  return {
    regime,
    lines,
    via,
    viaTotal,
    slabIncome,
    buckets,
    dividends,
    epfEmployee: epf,
    hraWorking,
    hpLossSetOff,
    hpLossCarried,
    hpLossExtinguished,
    notes,
    inputs: inp,
  };
}

// ---------- step 6-12: tax ----------

/**
 * Core tax on a given slab income and special-rate buckets. Returns amounts before cess.
 * Used both for the actual computation and for the "at threshold" recomputation in
 * surcharge marginal relief.
 */
function taxCore(slabIncomeIn, bucketsIn, ctx) {
  const { regime, ageBand, resident, rates, flags, dividends } = ctx;
  const isNew = regime === 'new';
  const bands = bandsFor(regime, ageBand, rates);
  const buckets = { ...bucketsIn };
  const slabIncome = clamp0(slabIncomeIn);

  // A2: residents may set unexhausted basic exemption against capital gains.
  let exemptionAdj = 0;
  if (resident) {
    let unused = clamp0(basicExemptionFor(regime, ageBand, rates) - slabIncome);
    for (const k of ['stcgEquity', 'ltcgEquity', 'ltcgOther']) {
      const use = Math.min(unused, buckets[k]);
      buckets[k] -= use;
      unused -= use;
      exemptionAdj += use;
    }
  }

  const totalIncome = slabIncome + bucketsIn.stcgEquity + bucketsIn.ltcgEquity + bucketsIn.ltcgOther + bucketsIn.lottery;

  const slabTax = slabTaxFor(slabIncome, bands);
  const cgRates = rates.special_rate_income.capital_gains;
  const specialParts = {
    stcgEquity: buckets.stcgEquity * cgRates.stcg_listed_equity_stt.rate,
    ltcgEquity: buckets.ltcgEquity * cgRates.ltcg_listed_equity_stt.rate,
    ltcgOther: buckets.ltcgOther * cgRates.ltcg_other_assets.rate,
    lottery: buckets.lottery * rates.special_rate_income.other_s194_rates.lottery_crossword_race_card_game_gambling_betting,
  };
  const specialTax = Object.values(specialParts).reduce((a, b) => a + b, 0);

  // Rebate (resident individuals only, against slab tax only)
  const reb = isNew ? rates.rebate.new_regime : rates.rebate.old_regime;
  let rebate = 0;
  let rebateRelief = 0;
  if (resident) {
    if (totalIncome <= reb.total_income_threshold) {
      rebate = Math.min(slabTax, reb.max_rebate);
    } else if (isNew || flags.oldRegimeRebateMarginalRelief) {
      // A1: relief on slab tax only. Payable slab tax cannot exceed income above the threshold.
      const excess = totalIncome - reb.total_income_threshold;
      if (slabTax > excess) rebateRelief = slabTax - excess;
    }
  }
  const slabTaxAfterRebate = slabTax - rebate - rebateRelief;
  const taxBeforeSurcharge = slabTaxAfterRebate + specialTax;

  // Surcharge with bifurcation (15% cap on dividend + capital gains)
  const { rate: scRate, threshold: scThreshold } = surchargeRate(totalIncome, regime, rates);
  let surcharge = 0;
  if (scRate > 0) {
    const cappedRate = Math.min(scRate, rates.surcharge.cap_on_dividend_and_capital_gains.cap_rate);
    const cgTax = specialParts.stcgEquity + specialParts.ltcgEquity + specialParts.ltcgOther;
    // A3: dividend share of slab tax, proportional
    const divTax = slabIncome > 0 ? slabTaxAfterRebate * Math.min(1, dividends / slabIncome) : 0;
    const cappedBase = cgTax + divTax;
    const residualBase = taxBeforeSurcharge - cappedBase;
    surcharge = cappedBase * cappedRate + residualBase * scRate;
  }

  return {
    totalIncome, slabIncome, slabTax, specialTax, specialParts, exemptionAdj,
    rebate, rebateRelief, slabTaxAfterRebate, taxBeforeSurcharge,
    surcharge, scRate, scThreshold,
    bands, slabRows: slabBreakdown(slabIncome, bands),
    rebateRule: { threshold: reb.total_income_threshold, max: reb.max_rebate, marginalReliefAvailable: isNew || !!flags.oldRegimeRebateMarginalRelief, eligibleResident: !!resident },
  };
}

export function computeTax(income, rates, flags = DEFAULT_FLAGS) {
  const { regime, slabIncome, buckets, dividends, inputs } = income;
  const ctx = { regime, ageBand: inputs.ageBand, resident: inputs.resident, rates, flags, dividends };
  const core = taxCore(slabIncome, buckets, ctx);

  // Marginal relief on surcharge (A4)
  let surchargeRelief = 0;
  let surchargeReliefWorking = null;
  if (core.surcharge > 0 && core.scThreshold > 0) {
    const excess = core.totalIncome - core.scThreshold;
    const atThreshold = taxCore(slabIncome - excess, buckets, ctx);
    const actual = core.taxBeforeSurcharge + core.surcharge;
    const base = atThreshold.taxBeforeSurcharge + atThreshold.surcharge;
    const relief = actual - base - excess;
    if (relief > 0) surchargeRelief = relief;
    surchargeReliefWorking = { threshold: core.scThreshold, excessIncome: excess, taxAtThreshold: base, taxAtActual: actual, extraTax: actual - base, relief: Math.max(0, relief) };
  }

  const taxPlusSurcharge = core.taxBeforeSurcharge + core.surcharge - surchargeRelief;
  const cess = taxPlusSurcharge * rates.cess.rate;
  const total = Math.round(taxPlusSurcharge + cess); // A6
  // TDS clients or employers already deducted comes off what is left to pay; it never changes the tax itself
  const tdsDeducted = Math.round(clamp0(num(((income.inputs || {}).business || {}).tdsDeducted)));
  const netPayable = Math.max(0, total - tdsDeducted);
  const refundDue = Math.max(0, tdsDeducted - total);

  return {
    ...core,
    surchargeRelief,
    surchargeReliefWorking,
    taxPlusSurcharge,
    cess,
    total,
    tdsDeducted,
    netPayable,
    refundDue,
    effectiveRate: core.totalIncome > 0 ? total / core.totalIncome : 0,
  };
}

/**
 * Convenience: full computation for one regime.
 */
export function computeRegime(inputs, regime, rates, flags = DEFAULT_FLAGS) {
  const income = computeIncome(inputs, regime, rates, flags);
  const tax = computeTax(income, rates, flags);
  return { income, tax };
}

/**
 * Both regimes side by side.
 */
export function compareRegimes(inputs, rates, flags = DEFAULT_FLAGS) {
  const oldR = computeRegime(inputs, 'old', rates, flags);
  const newR = computeRegime(inputs, 'new', rates, flags);
  const diff = oldR.tax.total - newR.tax.total;
  const warnings = [];
  const inp = oldR.income.inputs;
  if (hasBusiness(inp)) {
    warnings.push('You have business or professional income: you may opt out of the new regime only once, and return to it only once. After that the old regime is permanently unavailable. Form 10-IEA is required by the original due date.');
  }
  if (!inp.resident) {
    warnings.push('Non-residents do not get the s.87A / s.156 rebate in either regime.');
  }
  return {
    old: oldR,
    new: newR,
    better: diff > 0 ? 'new' : diff < 0 ? 'old' : 'same',
    saving: Math.abs(diff),
    warnings,
  };
}

// ---------- business or profession ----------

/** Whether the business blocks apply: the toggle, or the older checkbox, or receipts entered. */
export function hasBusiness(inp) {
  return inp.incomeType === 'business' || inp.incomeType === 'both' || !!inp.hasBusinessIncome || num((inp.business || {}).receipts) > 0;
}

/**
 * Income from business or profession as lines for the computation table.
 * Presumptive: 44ADA deems 50% of a professional's receipts as income; 44AD deems 8% of turnover
 * (6% of the digitally received part). Otherwise receipts less expenses, or the net figure typed in.
 */
export function businessIncome(inp, rates) {
  const b = inp.business || {};
  const bi = (rates && rates.business_income) || {};
  const receipts = clamp0(num(b.receipts));
  const lines = [], notes = [];
  if (receipts <= 0) {
    const income = num(b.income);
    if (income !== 0) lines.push({ id: 'business', label: 'Business / professional income', amount: income, extra: { subtotal: true } });
    return { income, lines, notes, presumptive: false, receipts: 0 };
  }
  const presumptive = b.presumptive !== false;
  const isProfession = b.kind !== 'business';
  lines.push({ id: 'business_receipts', label: isProfession ? 'Professional receipts' : 'Business turnover', amount: receipts });
  let income;
  if (presumptive && isProfession) {
    const r = bi.presumptive_profession || { deemed_income_rate: 0.5, receipts_limit: 5000000, receipts_limit_if_digital: 7500000, digital_share_for_higher_limit: 0.95 };
    const digital = clamp0(Math.min(100, num(b.digitalSharePct))) / 100;
    const limit = digital >= r.digital_share_for_higher_limit ? r.receipts_limit_if_digital : r.receipts_limit;
    income = receipts * r.deemed_income_rate;
    lines.push({ id: 'business_deemed', label: `Less: deemed expenses under 44ADA (${Math.round((1 - r.deemed_income_rate) * 100)}% of receipts)`, amount: -(receipts - income) });
    if (receipts > limit) notes.push(`Receipts of Rs ${fmtNum(receipts)} exceed the 44ADA limit of Rs ${fmtNum(limit)}; the presumptive scheme is not available and books of account (and a tax audit) are needed. The figure here still uses 50%.`);
  } else if (presumptive) {
    const r = bi.presumptive_business || { deemed_rate: 0.08, deemed_rate_digital: 0.06, turnover_limit: 20000000, turnover_limit_if_digital: 30000000, digital_share_for_higher_limit: 0.95 };
    const digital = clamp0(Math.min(100, num(b.digitalSharePct))) / 100;
    const limit = digital >= r.digital_share_for_higher_limit ? r.turnover_limit_if_digital : r.turnover_limit;
    income = receipts * (digital * r.deemed_rate_digital + (1 - digital) * r.deemed_rate);
    lines.push({ id: 'business_deemed', label: `Less: deemed expenses under 44AD (income taken as ${Math.round(r.deemed_rate_digital * 100)}% of digital and ${Math.round(r.deemed_rate * 100)}% of other turnover)`, amount: -(receipts - income) });
    if (receipts > limit) notes.push(`Turnover of Rs ${fmtNum(receipts)} exceeds the 44AD limit of Rs ${fmtNum(limit)}; the presumptive scheme is not available and books of account (and a tax audit) are needed.`);
  } else {
    const expenses = clamp0(num(b.expenses));
    income = receipts - expenses;
    if (expenses > 0) lines.push({ id: 'business_expenses', label: 'Less: business expenses', amount: -expenses });
  }
  income = Math.round(income);
  lines.push({ id: 'business', label: isProfession ? 'Income from profession' : 'Income from business', amount: income, extra: { subtotal: true } });
  return { income, lines, notes, presumptive, receipts };
}

// ---------- utilities ----------

export function mergeInputs(partial) {
  const base = emptyInputs();
  const out = deepMerge(base, partial || {});
  return out;
}

function deepMerge(target, source) {
  const out = Array.isArray(target) ? [...target] : { ...target };
  for (const k of Object.keys(source || {})) {
    const sv = source[k];
    if (sv && typeof sv === 'object' && !Array.isArray(sv) && typeof out[k] === 'object' && out[k] !== null) {
      out[k] = deepMerge(out[k], sv);
    } else if (sv !== undefined) {
      out[k] = sv;
    }
  }
  return out;
}

export function fmtNum(n) {
  return formatIndian(Math.round(n));
}

/** Indian digit grouping: 12,34,567 */
export function formatIndian(n) {
  const neg = n < 0;
  const s = String(Math.abs(Math.round(n)));
  if (s.length <= 3) return (neg ? '-' : '') + s;
  const last3 = s.slice(-3);
  const rest = s.slice(0, -3).replace(/\B(?=(\d{2})+(?!\d))/g, ',');
  return (neg ? '-' : '') + rest + ',' + last3;
}
