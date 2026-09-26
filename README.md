# TaxCompass India

A static web app for Indian individual taxpayers. No backend, no build step, no API keys.

- **Business and profession**: a Salary · Business or profession · Both toggle on the landing starter, the tax form and the profile. Business mode asks for receipts or turnover, profession or trade, and whether the presumptive scheme applies: 44ADA deems 50% of a professional's receipts as income, 44AD 8% of turnover (6% of the digitally received part), with the receipts limits and a note when books and audit are needed; otherwise receipts less expenses. Salary-only items switch off (standard deduction, HRA, EPF, employer NPS) and business ones on: 80GG for rent without HRA (least of three), own NPS under 80CCD(1) at 20% of income for the self-employed (10% of Basic for employees) within the ₹1.5 lakh, TDS clients deducted (194J) credited against the tax with net payable or refund, an advance-tax calendar (one payment by 15 March under presumptive, else 15/45/75/100%), the GST registration threshold, and an expenses checklist for those keeping books. "Both" shows every block and taxes the combined income. Rules in `tax_rates.json` → `business_income`; engine `businessIncome()`/`hasBusiness()` in `tax-engine.js`, `advanceTaxSchedule()` in `tax-insights.js`; profile schema v3 adds a `business` block; fixture `consultant-30L.json`.
- **Your money at a glance** on the landing page: from the profile's salary, one connected picture (income tax under your regime and what the other would save, take-home a month, after EMIs, free money, what investing it becomes in ten years at a chosen equity share with a bad-stretch figure, a rule-of-thumb home budget or your existing home loan, each goal's SIP, emergency-fund months), every line opening the tool that owns it. A new visitor picks Salary, Business or Both and types a CTC and/or a year's receipts; a starter profile is seeded (40% basic, 50% HRA, PF and gratuity; presumptive business). Engine `public/js/snapshot-engine.js`, page `public/js/snapshot.js`.
- **The quick answer** (`public/js/quick.js`, arithmetic in `public/js/quick-engine.js`) leads the landing page, `/tax` and `/calculators/salary`: type a CTC and see, as you type, the monthly in-hand pay and which regime saves how much, with both taxes as bars. "Could the old regime still win for you?" ticks rent (with city), self-occupied home-loan interest, 80C beyond PF, health cover and own NPS, and a meter shows the old-regime deductions counted (as the engine allows them, caps applied) against the point where the regimes cost the same. Before anything is typed, a table of common CTCs (₹6 lakh to ₹50 lakh) fills the page; a tap on a row uses it. On `/tax` and `/calculators/salary` the full calculator sits folded under it ("Get it exact"), opening on `#detail` links and remembered per page. The split behind a bare CTC is the in-hand calculator's (Basic 40% of CTC, HRA half of Basic, employer PF and gratuity inside the CTC, ₹2,400 professional tax), shown on the card with Basic editable, so the quick answer, the tax page and the salary page give the same figures (tests/quick.test.mjs checks this through the profile).
- **Salary pages** for search: `/salary` (every CTC in one table) and 41 pages at `/salary/<n>-lakh` or `/salary/<n>-crore` (₹3 lakh to ₹30 lakh by the lakh, then 32 lakh to ₹2 crore; the list is `SALARY_CTCS` in `public/js/routes.js`, and any other figure canonicalises to the index). Each leads with the answer in one sentence (in hand a month, which regime and by how much, the deductions at which the old one wins), then the month-by-month breakup, old vs new, the quick answer for the reader's own deductions, three or four questions with answers, and links to the neighbouring salaries. `public/engine/salary-page.js` writes the page as HTML with no DOM, so `functions/_middleware.js` renders it into the HTML a search engine fetches (with the answer as the meta description and the questions as FAQPage structured data) and the app renders the same on navigation. The CTCs in the quick answer's table link to their pages; the sitemap lists all of them.
- **Landing page** at `/`: "What you take home, and which tax regime wins.", the quick answer, then "What else this salary means" (the rest of the at-a-glance picture) and the other decisions as cards and links. The menu leads with "Tax & salary"; the other tools are under "More tools".
- **The tax form asks in steps**: your salary (gross, Basic + DA, age, year, residency), then "Do you have any of these?" (rent/HRA, home loan, 80C and NPS, health insurance, capital gains, other income, business income, other deductions and perks) and only the ticked groups appear; "Show every field" opens all of them. A topic ticks itself when a saved form, the profile or a fixture already fills one of its fields, and unticking clears the fields so a hidden number never shapes the result. The engine and the 39 inputs are unchanged.
- **The tax result reads top-down**: the saving in large type, the break-even sentence under it ("₹7,499 more in old-regime deductions before the old regime became cheaper"), then "Why?" with the two totals, then **Your biggest tax drivers**: each income source and each deduction ranked by what it does to your tax, found by taking it out and recomputing (`taxDrivers` in `public/js/tax-insights.js`), with items the lower regime ignores shown as "old regime only".
- **Decision-led calculators page**: `/calculators` opens an index of the questions the tools answer, grouped as money coming in, big commitments, money going out to work, and where it all has to end up; each card carries the person's own figure when the profile knows it ("About ₹1,98,350 a month on your figures"). The tabs still open a tool directly. `public/js/calc-index.js`.
- **Every result in four parts**: your answer (the figures and one plain sentence), why (what drives it), what to do next (one to three moves, each opening the tool that makes it), and the detailed working (tables, charts, schedules, assumptions) folded away, remembering per tool whether you opened it. Shared helper `public/js/result-layout.js`, used by every calculator, NPS and the tax page. The email-a-workbook card stays hidden until there is a result to send.
- **Reset and Start over**: on the tax and in-hand salary pages, Reset (in the full calculator) and "Start over" (in the quick answer) clear the page and the salary and deductions in the profile together, announced with Undo; loans, savings, goals, the city and professional tax are kept. Emptying the quick answer's CTC box clears the saved salary. Other calculators' Reset clears only their own inputs, as before.
- **Saved to your profile — Undo**: every profile change a person causes from a tool is announced with what changed ("CTC ₹18,00,000 → ₹31,00,000") and can be undone in one click; a burst of typing is one change, and writes nobody caused (a page loading) are not announced. `public/js/profile-undo.js`.
- **Drag lines and ₹ | % switches** (`public/js/amount-input.js`): a slider under the salary (tax form and in-hand calculator, up to ₹10 crore), the profile's CTC, receipts, Basic, variable pay, loan outstanding, holdings, monthly surplus and emergency fund, loan amount, rate and tenure (EMI), monthly SIP, return and years, property price and loan (home buying), and both NPS contributions, kept in sync with the typed number and growing its range if you type past it. Basic + DA is entered as a % of gross on the tax form by default (a typed rupee figure is kept by converting it to its %; ₹ is one click away), while employer NPS stays in rupees at zero until someone enters it; the tax form also takes conveyance allowance and variable pay and shows the special allowance as the balance, with the break-up echoed in the computation table; every rupee field shows its value comma-grouped as you type; on the NPS page a monthly Basic + DA field lets both contributions be entered as a % of it. The switch is remembered, and a %-mode field follows its base as it changes.
- **Shared profile**: one set of figures (pay structure, regime, city, loans, professional tax, home-loan interest when no loan is listed, what you hold, monthly surplus, household, goals) saved in the browser under `taxcompass.profile.v1` and read by every tool. The tax comparison, in-hand salary, EMI, SIP, goal and budget calculators pre-fill from it and write their edits back; the NPS projector pre-fills from it. A collapsible "Your profile" panel on every page edits it directly (it stays hidden until something is saved, opens closed and folds when you move to another page; the footer's "Restore a saved profile" link opens it on a fresh device), with "Save my profile" (the profile plus every calculator's inputs as one JSON file, downloaded straight away or emailed to you), "Restore from file", reset, a wipe link, and a visible "stays on this device" indicator. The schema is versioned with a migration hook (`public/engine/profile.js`), so older saved profiles keep working.
- **Tax comparison**: answer a short set of questions and see the old and new regimes computed line by line, side by side, with a provision-by-provision reference table. A break-even panel says how far the result is from flipping ("the old regime would win only with ₹X more in deductions"), what-if sliders show the effect of using the 80C, NPS and 80D room the user still has, and a headroom table links straight into the matching schemes. The comparison, break-even and inputs download as a formatted workbook.
- **Calculators**:
  - In-hand salary: CTC split into Basic, HRA, special allowance, employer PF, gratuity and optional employer NPS; then employee PF, professional tax and income tax under the lower (or a chosen) regime, down to the monthly take-home, with a waterfall and a hand-off into the full comparison.
  - Expenses and savings: monthly take-home income, expenses in ten fixed categories plus Others, SIP and recurring-deposit investments with projected values, a summary of where the income goes (charts and tables), and an Excel workbook to download.
  - EMI with step-up EMI (by a percentage or a fixed amount each year), a one-time lump sum prepayment and an extra payment every year (keep the EMI and finish sooner, or keep the tenure and pay less), a plain-English sentence explaining the outcome, a before-and-after comparison and a year-by-year schedule, plus an "invest instead of prepaying?" panel showing fund categories that historically beat the loan rate, lowest risk first.
  - SIP with step-up by percentage or amount, plus lump sums added today or at the end of any year (a bonus, a maturing deposit), followed by "what has historically delivered about X% a year?": fund categories whose typical rolling return sits near the return the user assumed, with the worst and best stretches, and the funds inside each category. This absorbed the old lumpsum calculator; `/calculators/lumpsum` redirects here.
  - Home buying, in two steps: first the true cost of a property in Mumbai, Delhi, Bengaluru, Hyderabad, Chennai, Kolkata or Pune (stamp duty by buyer and slab, registration, GST on under-construction, brokerage, free-form builder charges); then, if asked, how to fund it: the loan you want and the down payment (kept in sync with the price), rate and tenure, a phase-wise payment plan (construction-linked, time-linked, 10:85:5 or one payment) with your money going in first, the bank releasing stage by stage, GST on each demand and pre-EMI interest, and the EMI. No lender-eligibility model: you say what you are borrowing, with an RBI loan-to-value note if it looks high. Every rate in `data/property_charges.json` carries a source, a date and a confidence.
  - Capital gains: listed equity and equity funds (12 and 20 per cent, ₹1.25 lakh exemption, 31 January 2018 grandfathering), debt funds (slab after April 2023), property (lower of 12.5% and 20% with indexation for pre-23 July 2024 purchases, Cost Inflation Index table in `data/capital_gains.json`) and other assets, with a one-click push of the gain into the tax comparison.
  - Capital gains from a broker statement: upload a Zerodha Console Tax P&L workbook and the browser reads it (never uploaded; name, client ID and PAN skipped, only totals kept locally). Out come the heads for the year (short-term and long-term equity, intraday and F&O as business income, debt funds at slab), the set-offs, the tax, losses to carry forward, and what is worth doing before 31 March, with a one-click push into the tax comparison. Parser in `public/engine/brokers/zerodha.js`, tax layer in `public/engine/trading-tax.js`; `public/fixtures/zerodha-taxpnl-sample.xlsx` is a synthetic file in the same layout for testing. Other brokers: send a sample.
  - Compare investments: the same rupee in a savings account, liquid fund, FD, arbitrage fund, debt funds, NSC, PPF, EPF, SSY, NPS, balanced-advantage and aggressive-hybrid funds, ELSS, index, large-, flexi-, mid- and small-cap funds and gold, filtered by a risk profile (riskier options stay visible below the line), after tax, over your horizon and at your slab (the marginal rate from your profile). Shows what you keep, the after-tax return, the pre-tax equivalent (PPF's 7.1% is 10.3% to a 30% payer), tax saved on the way in under 80C in the old regime, and which instruments are locked or too volatile for the horizon. Guaranteed rates come from the quarterly small-savings notification in `data/schemes.json`; fund figures are the median rolling return of the category from AMFI history with the worst window shown; every rate is editable. Engine `public/engine/post-tax.js`.
  - In-hand salary: CTC split into Basic, HRA, conveyance allowance, variable pay (an amount or a % of CTC, part of the CTC or paid on top of it, once a year or every month) and special allowance as the balancing figure, then PF, professional tax and income tax. Variable pay paid once a year is kept out of the monthly figure, with the tax split in proportion to pay, so the monthly number is what actually lands.
  - The standalone insurance planner is retired for the focused launch; its engine and data remain in the repository for possible later restoration. Tax-related life-insurance and health-insurance deductions remain in the tax tools.
  - Debt triage: every card and loan in one place, cleared highest-rate-first or smallest-balance-first month by month, with the real annual cost of each (a card at 42% charged monthly is 51%), what the slower order costs, a warning when the minimums do not even cover the interest, and whether the next spare rupee should prepay or be invested (a home loan in the old regime really costs the rate less your slab). Engine `public/engine/debt.js`.
  - Retirement: five figures (age, retire at, monthly spending, saved so far, saving per month) and one sentence back: the money lasts past 85, or runs out at age X and this much more a month closes the gap. Risk is chosen in percent terms, not as a return: two sliders (equity share until retirement, equity share after), and the growth rate follows from the mix using two labelled rates (Large Cap funds' median 5-year rolling return from the AMFI history, and the notified PPF rate), with the equity category's worst 5-year window shown as a bad stretch. Year-by-year chart, three sensitivities (retire two years later, inflation a point higher, equity repeats its worst stretch), "how to build it" at the chosen equity share, and the three-bucket plan at retirement. Deliberately simple: no withdrawal tax; says so. Engines `public/engine/retirement.js`, `public/engine/mix.js`.
  - Goal planner: pick what the money is for (child's education or wedding, house down payment, car, anything, or a fixed sum), give today's cost, and get the cost when it arrives (education inflation 10%, wedding 7%, property 6%, editable), the SIP or one-time amount, the SIP if equity repeats its worst 5-year stretch, and where the money goes (SSY for a daughter under 10, index fund, PPF or short debt by horizon) with the glide rule as the date nears. Child goals date themselves from the child's age; every child in the profile gets a row. The same percent-terms risk slider as retirement, capped by horizon (0% under 3 years, 30% under 5, 50% under 7). Engine `public/engine/goal.js`.
  - All calculators remember their inputs in the browser.
- **Excel from every calculator**: in-hand salary, EMI, SIP, home buying, capital gains and the goal planner each have a "Save this" card, as do the tax comparison and budget. "Download Excel" builds the workbook in the browser and saves it at once, asking for nothing. One builder, `public/js/calc-export.js`, turns a small spec into a styled workbook with the calculator's sheets plus Inputs and Notes.
- **Stale-script guard**: no build step means no hashed filenames, so `npm run stamp` writes a content hash of every script and stylesheet into `index.html`, `public/js/version.js` and `public/js/manifest.json`; at boot `public/js/fresh.js` compares the page's stamp with the script's and, if they differ, re-fetches every file past the browser cache and reloads once. `npm test` restamps first and fails if the stamp is stale.
- **Backup and recovery**: `npm run backup` writes a git bundle of every branch (and, with wrangler logged in, a D1 export) to `~/TaxCompass-backups`; `docs/RECOVERY.md` is the runbook for rollback, a compromised account, leaked secrets, and rebuilding the Cloudflare project from nothing.
- **About page** with methodology, engine assumptions, data sources and dates, privacy and a feedback address.
- **Charts**, all inline SVG with hover tooltips (`public/js/charts.js`): the break-even curve on the tax page (old-regime tax against deductions claimed, with your position and the crossing point), an income-to-tax waterfall for each regime, loan balance and per-year principal/interest on the EMI page, growth curves on SIP, lumpsum and NPS. Text and grid colours come from CSS variables so they follow dark mode.
- **Shareable result card**: a 1080×1080 image of the regime verdict drawn on a canvas, with native share on phones and download elsewhere; the user chooses whether amounts appear.
- **Glossary tooltips** on terms in the comparison table and headroom list (`public/js/tooltips.js`), **animated numbers** when results change, **dark mode** following the device setting, a **trust line** under the verdict, and reduced-motion support.
- **Feedback button** on every page, anonymous (a message, 1 to 5 stars, an optional first name for the public wall and a "you may show this on the site" tick box; no email is asked for, one sent anyway is dropped, and no user agent is kept) posting to `functions/api/feedback.js`, which stores rows in Cloudflare D1 (binding `DB`) and emails them to you via Brevo; either alone is enough. **What people say**: approved feedback appears on the About page only after there are at least three substantive public comments or five ratings, so launch/test data never looks like social proof. You approve entries at `/api/feedback-admin` (a small page served by `functions/api/feedback-admin.js`), protected by the `FEEDBACK_ADMIN_TOKEN` secret (16+ characters) set in Cloudflare Pages -> Settings -> Variables and Secrets. The public read is `GET /api/feedback`, cached five minutes; emails never leave the database. **Usage counter** (`functions/api/counter.js`, same D1) still records visits, tax comparisons, downloaded workbooks and calculator runs for internal measurement, but launch-stage totals are not displayed publicly. Setup is in `docs/GO-LIVE.md` section 5a.
- **Installable on phones** as a web app: `public/manifest.webmanifest` plus icons generated by `tools/make-icons.mjs` (no image library needed). Chrome on Android and Safari on iOS offer "Add to Home Screen"; it opens full-screen with its own icon. There is deliberately no service worker, so users always get the latest code.
- **Real URLs** per section (`/tax`, `/calculators/emi`, `/nps`, `/glossary`, `/about`) with a title and description each (the route table is `public/js/routes.js`; `functions/_middleware.js` rewrites the `<title>`, description and Open Graph tags at the edge so shared links unfurl as the right page), `sitemap.xml`, `robots.txt` and a favicon. `public/_redirects` makes Cloudflare Pages serve `index.html` for every path; `tools/static-server.mjs` does the same locally.
- **NPS**: what the National Pension System is, a corpus and pension projector (contributions, step-up, return, annuity share and rate, with the taxable slice above 60% flagged), tax treatment in both regimes, investment choices, exit and withdrawal rules, and historical returns. Other government schemes were removed by decision; their data remains in `public/data/schemes.json` if ever wanted again.
- **Disclaimers** on the tax comparison, every calculator and the schemes tab asking users to consult their tax consultant or chartered accountant, or a SEBI-registered adviser, before acting.
- **Glossary**: about 150 India-specific terms, searchable by category.

All rates, rules and fund returns live in `public/data/*.json` and can be refreshed without touching code. Server-side code is limited to the edge middleware (per-page titles and the salary pages), the anonymous feedback and the usage counter; every calculation and every download runs in the browser.

## Project layout

```
public/                 the static site (deploy this folder)
  index.html
  css/style.css
  js/tax-engine.js      pure tax computation, no DOM; also used by the tests
  js/tax-ui.js          onboarding form + two-column comparison + break-even panel
  js/tax-insights.js    break-even, headroom and what-if maths on top of the engine
  js/tax-export.js      the tax comparison workbook
  js/save-card.js       the shared "save this as Excel" card: one Download button, nothing sent
  js/xlsx-style.js      shared ExcelJS loading and cell styling
  js/calc-export.js     one workbook builder + a spec per calculator
  js/calculators.js     EMI (with loan simulator), SIP with lump sums; lazy-loads the rest
  js/goal.js            goal planner (engine/goal.js, engine/mix.js; mix-control.js and mix-rates.js shared with retirement)
  js/home-buy.js        home buying: true cost + loan eligibility, reads the profile
  engine/property.js    stamp duty, registration, GST, the full bill (pure)
  engine/loan-eligibility.js  FOIR, LTV, tenure-by-age, score gate, levers (pure; tested, not used by the UI since eligibility was dropped)
  engine/payment-plan.js      phase-wise payment plan with pre-EMI interest (pure)
  js/budget.js          expenses and savings calculator, charts, Excel export
  js/funds.js           historical fund returns: category summaries, matching, panel
  vendor/exceljs.min.js  ExcelJS, for the styled Excel export
functions/api/send-workbook.js  dormant: emailed a workbook via Brevo; nothing on the site calls it now
  js/schemes.js         NPS and government schemes
  js/glossary.js
  js/data/*.json        rates, deductions, comparison rows, formulas, glossary, schemes, mf_returns
  _headers              security headers; noindex + no-store on non-production hosts
  engine/profile.js     shared financial profile: schema, defaults, migrations, adapters (pure)
  js/profile-store.js   the profile in localStorage; updateProfile(), onProfileChange()
  js/profile-panel.js   the "Your profile" panel: edit, export, import, reset, wipe
  fixtures/profiles/    test profiles for previews and staging
  js/env.js             production / staging / preview detection
  js/routes.js          route table: titles, descriptions, aliases, removed routes
functions/_middleware.js  per-route <head> rewrite at the edge (link previews)
  js/devtools.js        dev-only fixture loader (non-production hosts only)
functions/robots.txt.js  serves Disallow: / on every non-production host
tools/build-mf-returns.mjs  builds public/data/mf_returns.json from AMFI NAV history
tools/static-server.mjs     dependency-free local preview server
tests/                  regression tests for the tax engine, calculators, loan simulator, fund matching
tests/known-answers.test.mjs  owner-supplied expected values; TODO placeholders are pending, not failures
docs/                   the research pack: verification list, engine spec, corpus plan, scheme research
```

## Branches, staging and previews

`main` is production (taxcompass.org), `dev` is staging (staging.taxcompass.org), every other
branch gets a Cloudflare preview URL. Nothing is committed to `main` directly; CI (`npm test`)
must be green before a merge. Every non-production host shows a red STAGING banner, is served
`Disallow: /` from robots.txt and carries `noindex` headers, and has a DEV button that loads a test
profile from `public/fixtures/profiles/`. Details and the one-time dashboard steps:
`docs/ENVIRONMENTS.md`.

## Run locally

Requirements: Node.js 20 or later.

```bash
npm test      # all tests must pass before any deploy
npm run dev   # http://localhost:8788
```

## The mutual fund returns data

`public/data/mf_returns.json` holds, for every open-ended direct-growth plan with at least three years of history:

- point-to-point CAGR over 1, 3, 5 and 10 years;
- the median, worst and best **rolling** 3-year and 5-year returns, sampled monthly, which is what the app uses to describe a category, because it says what investors typically got over any such period rather than what the most recent period happened to deliver;
- the SEBI scheme category, normalised from AMFI's several historical spellings.

Source is AMFI's published NAV history, fetched through api.mfapi.in, a free community mirror. Funds that have stopped publishing NAVs (merged or wound up) are dropped, as are ETFs and any fund whose NAV series shows a unit-split artefact.

**The data is a snapshot, not a live feed.** The site never calls any fund API at runtime; it reads the JSON file that the build script produced, and every fund panel shows the "NAV as of" date. There are two ways to keep it fresh:

- By hand: `npm run build:funds`, then commit and push. The build makes a few thousand HTTP requests and caches raw responses in `.cache/mf/` (ignored by git), so a re-run after a failure is quick.
- Automatically: `.github/workflows/update-funds.yml` runs on GitHub on the 2nd of every month (and on demand from the Actions tab), rebuilds the file, runs the tests, and commits the change. Cloudflare Pages redeploys on that commit. This starts working as soon as the repository is on GitHub; nothing else to set up.

If the mirror goes away, point `getJSON` in the build script at AMFI's own NAV history download; the rest of the pipeline is unchanged.

### How matching works, and the line it stays behind

The calculators never rank funds by quality and never look at anything about the user beyond the return figure and horizon they typed. For a target of X% over N years the app:

1. computes each category's typical return (median across its funds of the median rolling 5-year return, or 3-year for horizons under 5 years);
2. shows the categories within 3 points of X%, nearest first, with risk level, worst window and best window;
3. inside a category, lists funds ordered by closeness to X%, with 3, 5 and 10-year returns and each fund's worst 3-year stretch;
4. warns when X% is above what any broad category has typically delivered.

This is descriptive historical information available identically to every visitor, which is where your data pack places the SEBI media carve-out. If you later add anything that takes the user's income, holdings or risk profile into account when choosing funds, get the SEBI investment-adviser question reviewed first. See `docs/corpus_sources_and_ingestion.md` section 4.

## No data collected

The site asks for nothing: no account, no name, no email. Workbooks and the profile file are built in the browser and downloaded; feedback is anonymous. `functions/api/send-workbook.js` (emailing a workbook through Brevo and saving the person as a contact) is still in the repository but nothing calls it; to bring emailing back, restore the email section of the card from git history (`public/js/email-card.js` before it became `save-card.js`) and re-read the DPDP Act 2023 note in that history first, because keeping names and emails brings the Act in.

## Deploy for free

The site is static apart from the optional email function. Any of these work with no server and no running cost:

### Cloudflare Pages (recommended)

1. Install Git (`winget install Git.Git`), create a free GitHub account, push this folder to a new repository:
   ```bash
   git init
   git add .
   git commit -m "Initial import"
   git branch -M main
   git remote add origin https://github.com/<you>/india-tax-app.git
   git push -u origin main
   ```
2. At dash.cloudflare.com go to **Workers & Pages**, **Create**, **Pages**, **Connect to Git**, pick the repository.
3. Build settings: framework preset **None**, build command **empty**, build output directory **`public`**.
4. The site is live at `https://india-tax-app.pages.dev`. Every push to `main` redeploys. Attach a custom domain under **Custom domains** at no extra cost.

Without Git: `npx wrangler login` then `npm run deploy` uploads `public/` directly.

### GitHub Pages, Netlify, Vercel

All work as-is. For GitHub Pages, set the Pages source to the `public` folder (or a branch containing it). Netlify: drag the `public` folder onto app.netlify.com/drop. Vercel: import the repo with output directory `public`.

## Editing the data

| What changes | When | Where |
|---|---|---|
| Mutual fund returns | Monthly | `npm run build:funds` |
| Small savings rates | Every quarter (end of March, June, September, December) | `public/data/schemes.json` under `small_savings_rates_*` and each scheme's `rate`; update `_meta.rate_quarter_in_force` |
| RBI floating rate bond coupon | 1 January and 1 July | `schemes.json`, `rbi_frsb` |
| EPF rate | Annually, around February or March | `schemes.json`, `epf` and `vpf` |
| Slabs, rebate, surcharge, standard deduction | Budget day, then again when the Finance Act is enacted | `public/data/tax_rates.json` |
| Stamp duty, registration, GST on property | Every quarter; state budgets and notifications change them at any time | `public/data/property_charges.json` (seven cities; keep `as_of`, `confidence` and `sources` current) |
| Lender conventions: FOIR bands, age cutoffs, score pricing, rates | Twice a year | `public/data/loan_policy.json` |
| Deduction limits and regime availability | Same | `public/data/deductions.json` |

After any data change run `npm test`.

## Feature flags

In `public/js/tax-engine.js`, `DEFAULT_FLAGS`:

- `hraEightCityMetro` (off): treat Bengaluru, Hyderabad, Pune and Ahmedabad as metro for HRA from FY 2026-27. Turn on only after the Income-tax Rules 2026 notification is confirmed. See `docs/VERIFY_BEFORE_LAUNCH.md` item 2.
- `oldRegimeRebateMarginalRelief` (off): the old-regime Rs 5 lakh rebate is modelled as a hard cliff, as the data pack recommends.

## Engine assumptions

Documented at the top of `public/js/tax-engine.js`. The ones worth knowing:

0. The employee's own EPF contribution is counted in 80C automatically at 12% of Basic + DA whenever there is salary income, unless switched off or replaced by the actual figure. The employer's share is exempt income, not a deduction, and is not added anywhere.

1. Marginal relief on the new-regime rebate is applied to slab-rate tax only; tax on capital gains and lottery is never reduced by the rebate.
2. For residents, unused basic exemption is set against STCG on equity first, then LTCG on equity, then other LTCG.
3. The 15% surcharge cap on dividend income is approximated in proportion to the dividend share of slab income. Only relevant above Rs 2 crore of income.
4. Employer contributions above Rs 7.5 lakh are added as a perquisite; the accretion on the excess is not modelled.
5. Final tax payable is rounded to the nearest Rs 10 under section 288B.

## Before launch

Read `docs/VERIFY_BEFORE_LAUNCH.md`. In particular:

- Confirm the new-regime surcharge cap of 25% and the old-regime rebate cliff against the consolidated Act PDF.
- Have counsel look at the disclaimer wording and the SEBI investment-adviser line for the fund panels.
- Decide how often you will actually rebuild the fund data and the quarterly small-savings rates, and put it in a calendar.
