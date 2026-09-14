# Verify Before Launch

Every item below is something I could not confirm from primary text. They are ranked by what a wrong answer costs you. Nothing here is a guess dressed as a fact — where sources conflicted I have said so rather than picking silently.

**The single most efficient action:** fetch and read the official consolidated Act PDF —
`https://www.incometaxindia.gov.in/documents/d/guest/income_tax_act_2025_as_amended_by_fa_act_2026-pdf`
It closes items 1, 2, 3, 5 and 9 in one pass.

---

## Tier 1 — will produce wrong tax numbers for real users

| # | Item | Status | Where |
|---|---|---|---|
| 1 | **New-regime surcharge capped at 25%** | Four sources say 25%, one (CAalley) says 37% applies in both regimes. The 25% cap has been settled law since Finance Act 2023 and is almost certainly right, but no primary text was retrieved. Affects every user above Rs 5 crore. | `tax_rates.json → surcharge.new_regime_cap` |
| 2 | **HRA metro list expanding from 4 to 8 cities from FY 2026-27** (adding Bengaluru, Hyderabad, Pune, Ahmedabad at 50%) | Five-plus sources agree, but none cited a gazette notification number or the rule number in the Income-tax Rules 2026. Highest-impact single figure in the whole pack — it changes the HRA exemption for a huge share of urban salaried users. **Ship behind a feature flag.** | `deductions.json → HRA.metro_expansion_warning` |
| 3 | **Marginal relief on the OLD-regime Rs 5 lakh rebate** | No source asserts it exists; the ITD FAQ implies a hard cliff. Modelled here as a hard cliff. Needs a read of s.156. | `tax_rates.json → rebate.marginal_relief_old_regime` |
| 4 | **NPS: 80% lump sum permitted by PFRDA vs 60% exemption under tax law** | Corroborated by two sources that the 20% slice between 60% and 80% is taxable at slab rates, with no Budget 2026 amendment found. If wrong in either direction a retiree gets a nasty surprise. | `schemes.json → nps.CRITICAL_MISMATCH` |
| 5 | **Bifurcation mechanics for the 15% surcharge cap** on dividend and capital gains | The principle is verified; the step-by-step computation is not. Affects every high earner with mixed income. | `tax_rates.json → surcharge.cap_on_dividend_and_capital_gains` |
| 6 | **Transport allowance for specially-abled employees: Rs 15,000 / Rs 8,000 — per month or per year?** | Source does not say. Do not implement until resolved. | `deductions.json → perquisite_valuation` |

## Tier 2 — wrong in narrower cases, or wrong section citations

| # | Item | Status |
|---|---|---|
| 7 | **Debt mutual fund treatment** post-1 April 2023 | Single source. Verify against s.197 read with the specified-mutual-fund definition. |
| 8 | **Surcharge on unexplained income (s.195)** | The old s.115BBE carried a flat 25% surcharge giving ~78% effective. s.195 of the 2025 Act is SILENT on surcharge. **Do not hard-code 78%.** |
| 9 | **2025 Act section numbers for house property (24(b) → 26 or 22?), set-off (70/71/72 → 108/109/112 or 81/85?), other sources (57 → 61?), advance tax and interest (211/234A/B/C → 408/423/424/425?)** | Two credible mapping sources disagree on several. The *substance* is verified; only the *numbering* is thin. Resolve via the official CBDT mapping utility. |
| 10 | **STT rate increase from 1 April 2026** | Single source (an HDFC Securities note). Equity delivery and intraday STT not covered at all. |
| 11 | **TCS reduction effective date** | PIB is undated; KPMG says 1 October 2026. |
| 12 | **Buyback taxed as capital gains; SGB exemption restricted to original subscribers** | Both single-sourced to KPMG and both material. Confirm independently before coding. |
| 13 | **Retrenchment compensation Rs 5,00,000 ceiling** | Single source. |
| 14 | **Meal vouchers, employer gifts (Rs 5,000 vs Rs 15,000), employer medical loan (Rs 20,000 vs Rs 2 lakh)** in the new regime | Sources conflict on both availability and amounts. |
| 15 | **Updated-return window of 48 months; revised-return fee of Rs 5,000; filing deadline moved to 31 August for some self-employed** | Single-sourced procedural changes. |

## Explicitly rejected — do NOT use

| Claim | Why |
|---|---|
| **80TTB limit raised to Rs 1,00,000 for FY 2026-27** | Traces to pre-Budget *advocacy* commentary ("why the limit should be raised"), not enacted law. A dedicated AY 2026-27 source states it has not been raised. **Use Rs 50,000.** |
| **Standard deduction raised to Rs 1,00,000 in the new regime** | Pre-Budget speculation on ClearTax's page. It did not happen. **Use Rs 75,000.** |
| **New-regime slabs of 4/8/12/20/40 lakh with a 25% top rate** | A TaxGuru article publishing a table from the draft *Bill*, contradicting the enacted Act. |
| **LTA road travel capped at ~Rs 30/km** | Appears in *draft* rules only, not confirmed as notified. |
| **FY 2026-27 EPF rate** | **Not yet declared.** Historically announced Feb-Mar of the following year. Display the FY 2025-26 rate of 8.25% with its year label, and nothing for FY 2026-27. |

## Data-freshness obligations — build these before the UI

| What | Cadence | Why |
|---|---|---|
| **Small savings rates** (PPF, SSY, SCSS, NSC, KVP, MIS, TD, RD) | **Quarterly**, at the end of March, June, September and December | Notified quarterly by the Ministry of Finance. The Q3 FY 2026-27 notification is due around 30 September 2026 — days after this pack was compiled. A hard-coded rate is wrong within 90 days. |
| **RBI Floating Rate Savings Bonds coupon** | **Half-yearly**, 1 January and 1 July | Currently 8.05% for Jul-Dec 2026. Next reset 1 January 2027. |
| **EPF rate** | Annually, around Feb-Mar | Declared by the CBT for the year just ending. |
| **CBDT circulars and notifications** | Daily check for new items; weekly re-crawl of Tier 1 with hash comparison | CBDT amends pages in place without changing URLs or announcing it. |
| **Slabs and limits** | Annually, on Budget day (1 February) and again when the Finance Act is notified | Budget-day reporting is unreliable; wait for the enacted Act before changing a number. |

## Scraper traps

0. **incometaxindia.gov.in "Tax rates" page (`/w/tax-rates`), reviewed 8 Sep 2026**: note (b) under the new-regime rebate says the ₹60,000 rebate for AY 2026-27 applies where total income "does not exceed Rs. 7,00,000". That figure is stale (carried over from AY 2025-26); the limit is ₹12,00,000, which the same page's MCQ 10 confirms. The engine uses ₹12 lakh. The page's surcharge marginal-relief wording (tax plus surcharge not to exceed tax at the threshold by more than the income above it, at 50 lakh, 1, 2 and 5 crore) matches the engine and is locked by tests at each threshold.

Four live pages will feed you wrong data if you scrape them naively:

1. **incometax.gov.in's own "Super Senior Citizen — New Tax Regime" block** on `/help/individual/return-applicable-2` still shows FY 2024-25 slabs. The senior-citizen block on the *same page* is correct.
2. **A TaxGuru article on s.202** publishes a draft-Bill slab table contradicting the enacted Act.
3. **ClearTax's standard-deduction page** carries pre-Budget speculation as if it were fact.
4. **The ITD "Old vs New Regime FAQ"** still carries AY 2024-25 content and a Rs 50,000 standard deduction. Its switching *rules* are current; its *figures* are not.

## Legal and regulatory — get a human on these

| Item | Why it matters |
|---|---|
| **Bare Act text reproduction** | s.52(1)(q) exempts gazette material *except Acts*, and permits reproducing an Act only "together with any commentary thereon or any other original matter". Verbatim bare-text reproduction standing alone is prima facie infringement of Government copyright, which runs 60 years. Enforcement risk is near zero and the mitigation (ship commentary, which you want anyway) is cheap — but get Indian IP counsel to confirm rather than taking it from a research pass. |
| **SEBI Investment Adviser Regulations** | The line is personalisation. Explaining 80C and listing eligible instruments is education. Telling a specific user to put Rs 1.5 lakh into a named ELSS fund is investment advice requiring registration. Your NPS and schemes section is where this bites. |
| **DPDP Act 2023** | Not researched, outside the original brief, and probably your largest practical exposure. A tax chatbot ingesting income data is processing personal data at scale. |
| **Taxmann and other commercial corpora** | Subscriptions are seat licences for human research, not content licences. Ingesting them into a RAG index almost certainly breaches ToS and infringes editorial copyright. Do not scrape. |
