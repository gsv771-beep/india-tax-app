# Tax Calculation Engine — Order of Operations and Test Cases

Compiled 13 September 2026. Read alongside `tax_rates.json` and `deductions.json`.

Getting the *order* wrong is the most common way these calculators go silently wrong. The numbers below are individually correct in most published tools; the sequencing is where they break.

---

## 1. Canonical order of operations

Run this twice — once with `regime = "old"`, once with `regime = "new"` — and compare the final figures.

```
1.  GROSS TOTAL INCOME, head by head
    1.1  Salary
         + gross salary
         + perquisites (car, rent-free accommodation, employer contribution above Rs 7.5L,
           accretion on that excess)          <- APPLIES IN BOTH REGIMES
         - exempt allowances (HRA, LTA, duty allowances)   <- regime-dependent
         - standard deduction (75,000 new / 50,000 old)
         - professional tax, entertainment allowance        <- old regime only
    1.2  House property
         Net Annual Value = rent received (or expected rent) - municipal taxes paid
         - 30% of NAV                                       <- both regimes
         - interest u/s 24(b)                               <- see clamp in step 2
    1.3  Business or profession
    1.4  Capital gains, SEPARATED into special-rate buckets (do NOT merge into slab income)
    1.5  Other sources (interest, dividends, family pension less its deduction,
         lottery/VDA/gaming at special rates - also kept separate)

2.  APPLY THE HOUSE-PROPERTY LOSS CLAMP   <- the step most tools miss
    old regime: HP loss may be set off against other heads, capped at 200,000.
                Unabsorbed balance carries forward 8 years.
    new regime: HP loss may be set off ONLY against other house property income.
                Any residue is EXTINGUISHED - not set off, not carried forward.
    Implementation: clamp the let-out interest deduction to rental income in the new
    regime before it reaches gross total income.

3.  SET OFF BROUGHT-FORWARD LOSSES (per the table in deductions.json)

4.  CHAPTER VI-A DEDUCTIONS
    new regime: ONLY 80CCD(2)/s.124, 80CCH/s.125, 80JJAA/s.146
    old regime: the full set, each at its own cap, then the 80CCE aggregate cap of
                150,000 across 80C + 80CCC + 80CCD(1)
    Chapter VI-A deductions can never reduce income below zero, and can never be set
    against special-rate income.

5.  TOTAL INCOME = slab_income + special_rate_income buckets

6.  TAX ON SLAB INCOME using the applicable slab table
    (new regime: one table for all ages. old regime: pick by age band.)

7.  TAX ON SPECIAL-RATE INCOME, bucket by bucket
    STCG listed equity 20% | LTCG listed equity 12.5% on the excess over 125,000
    LTCG other 12.5% | grandfathered land/building: min(12.5% no-index, 20% indexed)
    lottery/VDA/gaming 30% | unexplained income 60%

8.  REBATE u/s 87A / s.156
    Eligibility: RESIDENT INDIVIDUAL only.
    Threshold test is on TOTAL INCOME (including special-rate income).
    But the rebate is allowed only against SLAB-RATE TAX.
    new: total income <= 1,200,000 -> rebate = min(slab_tax, 60,000)
    old: total income <=   500,000 -> rebate = min(slab_tax, 12,500)

9.  MARGINAL RELIEF ON REBATE (new regime only)
    if 1,200,000 < total_income < ~1,270,588:
        tax_before_surcharge = min(slab_tax + special_tax, total_income - 1,200,000)
    Derive the ceiling from the formula, do not hard-code it.

10. SURCHARGE
    Determine the band from TOTAL INCOME.
    Bifurcate: surcharge on dividend + 111A/196 + 112/197 + 112A/198 income is capped
    at 15%; surcharge on the residual at the full band rate. Sum the two.
    new regime: band rate never exceeds 25%.

11. MARGINAL RELIEF ON SURCHARGE, at each threshold crossed
    relief = (tax + surcharge at actual income)
           - (tax at the threshold)
           - (actual_income - threshold)
    Apply only if positive.

12. CESS: 4% of (tax + surcharge AFTER both marginal reliefs)

13. LESS: TDS, TCS, advance tax paid, relief u/s 89, foreign tax credit

14. ADD: interest under 234A/234B/234C (s.423/424/425)
```

---

## 2. Ten failure modes to guard against

| # | Failure | Why it bites |
|---|---|---|
| 1 | Applying the rebate to capital-gains tax | s.156(3) limits the rebate to slab-rate tax. A user at Rs 11L salary + Rs 1L STCG owes tax despite being "under Rs 12L". |
| 2 | Deducting let-out interest without the new-regime clamp | Over-credits the new regime, sometimes by lakhs. |
| 3 | Using a blanket 15% surcharge cap instead of a split-rate calculation | Under-states surcharge for high earners with mixed income. |
| 4 | Applying cess before marginal relief | Inflates tax at every threshold. Cess is always last. |
| 5 | Ignoring the 80CCD(2) 10% vs 14% asymmetry | Systematically under-states the new regime for private-sector employees. |
| 6 | Treating the Rs 7.5L employer-contribution cap as a deduction limit | It is an income *inclusion* threshold and applies in both regimes. Two independent gates. |
| 7 | Giving the old regime an age-based exemption in the new regime | The new regime is Rs 4L for an 85-year-old too. |
| 8 | Using FY 2024-25 slabs scraped from the ITD super-senior page | That page is stale. See `scraper_traps` in tax_rates.json. |
| 9 | Ignoring the FY 2026-27 car perquisite increase | Rs 1,800 to Rs 5,000/month is taxpayer-negative and applies in both regimes. |
| 10 | Letting the LLM do the arithmetic from retrieved prose | Rates must come from a structured, versioned table queried deterministically. A wrong slab rate is the most damaging error this product can make. |

---

## 3. Regression test cases

Compute these by hand once, lock them into your test suite, and never ship a build that fails them. Figures are before TDS credits.

| # | Scenario | Expected behaviour |
|---|---|---|
| T1 | Resident, 35, salary Rs 12,00,000, no deductions, new regime | Standard deduction Rs 75,000 → total income Rs 11,25,000 → slab tax Rs 52,500 → rebate wipes it → **tax = 0** |
| T2 | Resident, 35, total income exactly Rs 12,00,000 (after std deduction), new regime | Slab tax Rs 60,000 → rebate Rs 60,000 → **tax = 0** |
| T3 | Resident, 35, total income Rs 12,50,000, new regime | Slab tax Rs 67,500; marginal relief caps payable at Rs 50,000 → + 4% cess → **Rs 52,000** |
| T4 | Resident, 35, total income Rs 12,75,000, new regime | Relief no longer binds → Rs 71,250 + 4% → **Rs 74,100** |
| T5 | Resident, 35, salary Rs 10,00,000 + STCG Rs 1,00,000, new regime | Total income Rs 11,00,000 (under Rs 12L) but STCG tax of Rs 20,000 is **NOT** rebated. Slab tax on Rs 10,00,000 portion is rebated. **Verify the engine does not zero the STCG.** |
| T6 | Resident, 35, old regime, income Rs 51,00,000 | Marginal relief on surcharge: tax + surcharge after relief = **Rs 14,12,500**, then 4% cess |
| T7 | Resident, 82, total income Rs 5,00,000, old regime vs new | Old: nil (Rs 5L exemption). New: Rs 5,000 slab tax, rebated to nil. Both zero, for different reasons — check the engine reaches zero by the right path. |
| T8 | Private employee, Basic+DA Rs 20,00,000, employer NPS Rs 2,80,000 | Old regime: deduction capped at 10% = Rs 2,00,000. New regime: 14% = Rs 2,80,000. **Rs 80,000 difference.** |
| T9 | Let-out property, rent Rs 3,00,000, interest Rs 8,00,000, salary Rs 20,00,000 | Old: HP loss Rs 5,90,000 (after 30% std ded), set off against salary capped at Rs 2,00,000, balance carried forward. New: interest clamped to rental income; **zero set-off against salary, no carry-forward.** |
| T10 | NRI, total income Rs 11,00,000, new regime | **No rebate** — s.156 is resident-only. Tax is payable where a resident would pay nil. |

---

## 4. Architecture recommendations

**Store rates as versioned structured data, never as prose.** Every rate, threshold and cap should be a row keyed by `(financial_year, regime, parameter)`. The chatbot retrieves *explanations* from the corpus; the calculator retrieves *numbers* from this table. Never let the two paths cross.

**Model both "tax year" and "assessment year" vocabularies.** The 2025 Act replaced the previous-year/assessment-year pair with a single "tax year". Users will keep saying "AY" for years. You need both and a translation between them.

**Feature-flag every `unverified` item.** Specifically: the HRA 8-city expansion, the new-regime 25% surcharge cap, the transport allowance for specially-abled employees (per month or per year is unresolved), and the debt-mutual-fund treatment. Ship with the flag off and a "verify" task against the bare Act.

**Consider licensing the computation rather than building it.** Sandbox (by Quicko) sells tax-calculation APIs — salary, capital gains, F&O, foreign income, crypto — described as "coded as per latest income tax act, tested and verified by qualified accountants". Pricing is not published; there is a free trial and a cost calculator. Buying the calculator and building the corpus yourself is a defensible split: the calculator is a commodity where correctness is existential, and the corpus is where your product differentiates.
