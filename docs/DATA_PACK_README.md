# Base Data Pack — India Tax & Personal Finance App

Compiled 13 September 2026. Everything your app needs as structured data, plus an honest account of what is solid and what is not.

---

## The one thing that changes your architecture

**The Income-tax Act, 2025 (Act 30 of 2025) came into force on 1 April 2026 and replaced the Income-tax Act, 1961.**

PIB states the rewrite was done "without altering the underlying tax policy". Finance Act 2026 changed **no slab, rate, surcharge, cess, rebate or standard deduction**. Every number in your calculator is identical for FY 2025-26 and FY 2026-27.

What *did* change: all 536 section numbers, the terminology ("tax year" replaces previous year and assessment year), the Rules, the ITR forms, STT, TCS and a set of procedural items.

The consequence for you: **two Acts are simultaneously in force and will be for six or more years.** FY 2025-26 is assessed under the 1961 Act; FY 2026-27 onward under the 2025 Act; the old Act also governs every pending and future proceeding relating to pre-2026 years. A user asking "what's the 80C limit?" may mean either — and will not know the question is ambiguous. Make the year a first-class filter everywhere, store both section vocabularies, and build the mapping as a query-expansion layer.

---

## What's in the pack

```
tax/
  tax_rates.json                   slabs, rebate, surcharge, cess, special rates,
                                   advance tax, interest, regime switching,
                                   full 1961→2025 section map
  deductions.json                  every deduction and exemption, old vs new regime,
                                   with limits, conditions and both section numbers
  onboarding_and_comparison.json   the question flow, and the row spec for your
                                   two-column comparison screen
  calculation_engine_spec.md       order of operations, 10 failure modes,
                                   10 regression test cases

calculators/
  formulas.json                    EMI with amortisation and prepayment, lumpsum,
                                   SIP, step-up SIP, SWP, XIRR, goal planning,
                                   post-tax return — each with a worked example

glossary/
  glossary.json                    ~150 India-specific terms across tax, mutual funds,
                                   equity, debt, retirement, insurance, real estate

schemes/
  schemes.json                     NPS, APY and every small-savings scheme —
                                   current rates, limits, tax treatment, exit rules
  RESEARCH_nps_and_govt_schemes.md full working notes with per-figure citations

corpus/
  corpus_sources_and_ingestion.md  where the legal text lives, whether you may use it,
                                   the regulatory line, and how to chunk and index it

VERIFY_BEFORE_LAUNCH.md            everything unconfirmed, ranked by what it costs you
```

Every file carries `confidence` markers: `verified` (primary source or 3+ independent), `corroborated` (multiple credible secondaries, no primary text), `unverified` (single source or sources conflict). Nothing was invented — where sources disagreed I recorded the disagreement rather than picking silently.

---

## Five findings worth acting on

**1. Employer NPS is the new regime's hidden advantage — and most calculators miss it.**
80CCD(2) survives in the new regime at **14% of Basic+DA for every employer**. In the old regime a private employer is capped at **10%**. On Rs 20 lakh of Basic+DA that is Rs 80,000 of deduction available only in the new regime. Any comparison engine that ignores this systematically understates the new regime.

**2. The house property loss trap will break a naive calculator.**
Let-out interest is deductible without limit in *both* regimes. But in the new regime, any resulting loss cannot be set off against salary and cannot be carried forward — it is simply extinguished. Subtract interest from total income without clamping it to rental income and you will over-credit the new regime, sometimes by lakhs. This is the most common modelling error in regime-comparison tools.

**3. The rebate does not cover capital gains.**
s.156(3) limits the rebate to slab-rate tax. A user at Rs 10 lakh salary plus Rs 1 lakh STCG has total income of Rs 11 lakh — under the Rs 12 lakh threshold — but still owes 20% on the STCG. Test case T5 in the engine spec exists specifically for this.

**4. incometaxindia.gov.in explicitly allows AI crawlers, and has an undocumented public API.**
Its robots.txt allow-lists `ClaudeBot`, `GPTBot` and `PerplexityBot` with empty Disallow entries, publishes a sitemap, and serves clean per-section HTML at `/w/section-{n}-{id}` complete with amendment footnotes. A Liferay headless REST endpoint responds unauthenticated at `/o/headless-delivery/v1.0/sites/20117/documents`. CBDT also publishes an **official 1961↔2025 section mapping utility** — the highest-leverage asset for your chatbot. Whether it exposes a bulk download is the one unknown worth ten minutes with DevTools open.

**5. The copyright position on bare Act text is not what most people assume.**
s.52(1)(q) exempts gazette material *except Acts*, and permits reproducing an Act only "together with any commentary thereon or any other original matter". Verbatim bare-text reproduction standing alone is prima facie infringement of Government copyright, which runs 60 years. Enforcement risk is near zero — no Indian court has enforced it against a bare-act publisher — but the mitigation happens to be the same thing as building a good product: never surface raw section text as the whole answer, always pair it with explanation, and ship your own editorial layer. That layer is simultaneously your legal cover and your own copyrightable asset.

---

## Suggested build order

1. **Calculator first, on `tax_rates.json` + `deductions.json`.** Run the ten regression tests in the engine spec before writing any UI. Get the arithmetic right while it is cheap to fix.
2. **Comparison screen from `onboarding_and_comparison.json`.** This is your differentiated feature — most Indian tax calculators give a single number, not a parameter-by-parameter split.
3. **Calculators and glossary.** Pure client-side work, no legal risk, immediate utility. Ship these early to have something live.
4. **Schemes section.** Data is ready; build the quarterly rate refresh *before* the UI or it will be wrong within 90 days.
5. **Chatbot last.** It is the hardest, the highest-risk and the one where a fluent wrong answer does real damage. Start with Tier 1 of the corpus only — the two Acts, the Rules, the official mapping and the transition FAQs — which covers roughly 90% of consumer queries.

---

## Two things I would not do

**Don't let the LLM do arithmetic on retrieved prose.** Rates, thresholds and limits belong in a structured, versioned table queried deterministically. The chatbot retrieves explanations; the calculator retrieves numbers; the paths never cross. A wrong slab rate is the most damaging error this product can make.

**Don't ship circular-based answers without human curation of the high-traffic subset.** CBDT maintains no machine-readable supersession graph. A superseded circular is fluent, official-looking, specific and wrong — the worst possible combination for a RAG system, and it sits on the site looking authoritative forever. Parsing "in supersession of" catches express supersession only, maybe 60%. Budget a tax professional to curate the top ~200 circulars by query volume. There is no purely automated answer here.

---

Read `VERIFY_BEFORE_LAUNCH.md` before any of it goes near a real user.
