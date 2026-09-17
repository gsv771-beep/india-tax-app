# TaxCompass India

A static web app for Indian individual taxpayers. No backend, no build step, no API keys.

- **Shared profile**: one set of figures (pay structure, regime, city, loans, what you hold, monthly surplus, household, goals) saved in the browser under `taxcompass.profile.v1` and read by every tool. The tax comparison, in-hand salary, EMI, SIP, goal and budget calculators pre-fill from it and write their edits back; the NPS projector pre-fills from it. A collapsible "Your profile" panel on every page edits it directly (it opens closed and folds when you move to another page), with "Email me my profile" (the profile plus every calculator's inputs as one JSON file, sent to you only), "Restore from file", reset, a wipe link, and a visible "stays on this device" indicator. The schema is versioned with a migration hook (`public/engine/profile.js`), so older saved profiles keep working.
- **Tax comparison**: answer a short set of questions and see the old and new regimes computed line by line, side by side, with a provision-by-provision reference table. A break-even panel says how far the result is from flipping ("the old regime would win only with ₹X more in deductions"), what-if sliders show the effect of using the 80C, NPS and 80D room the user still has, and a headroom table links straight into the matching schemes. The comparison, break-even and inputs can be emailed as a formatted workbook.
- **Calculators**:
  - In-hand salary: CTC split into Basic, HRA, special allowance, employer PF, gratuity and optional employer NPS; then employee PF, professional tax and income tax under the lower (or a chosen) regime, down to the monthly take-home, with a waterfall and a hand-off into the full comparison.
  - Expenses and savings: monthly take-home income, expenses in ten fixed categories plus Others, SIP and recurring-deposit investments with projected values, a summary of where the income goes (charts and tables), and an Excel workbook emailed to the user in exchange for name and email.
  - EMI with step-up EMI (by a percentage or a fixed amount each year), a one-time lump sum prepayment and an extra payment every year (keep the EMI and finish sooner, or keep the tenure and pay less), a plain-English sentence explaining the outcome, a before-and-after comparison and a year-by-year schedule, plus an "invest instead of prepaying?" panel showing fund categories that historically beat the loan rate, lowest risk first.
  - SIP with step-up by percentage or amount, plus lump sums added today or at the end of any year (a bonus, a maturing deposit), followed by "what has historically delivered about X% a year?": fund categories whose typical rolling return sits near the return the user assumed, with the worst and best stretches, and the funds inside each category. This absorbed the old lumpsum calculator; `/calculators/lumpsum` redirects here.
  - Home buying, in two steps: first the true cost of a property in Mumbai, Delhi, Bengaluru, Hyderabad, Chennai, Kolkata or Pune (stamp duty by buyer and slab, registration, GST on under-construction, brokerage, free-form builder charges); then, if asked, how to fund it: the loan you want and the down payment (kept in sync with the price), rate and tenure, a phase-wise payment plan (construction-linked, time-linked, 10:85:5 or one payment) with your money going in first, the bank releasing stage by stage, GST on each demand and pre-EMI interest, and the EMI. No lender-eligibility model: you say what you are borrowing, with an RBI loan-to-value note if it looks high. Every rate in `data/property_charges.json` carries a source, a date and a confidence.
  - Capital gains: listed equity and equity funds (12 and 20 per cent, ₹1.25 lakh exemption, 31 January 2018 grandfathering), debt funds (slab after April 2023), property (lower of 12.5% and 20% with indexation for pre-23 July 2024 purchases, Cost Inflation Index table in `data/capital_gains.json`) and other assets, with a one-click push of the gain into the tax comparison.
  - Capital gains from a broker statement: upload a Zerodha Console Tax P&L workbook and the browser reads it (never uploaded; name, client ID and PAN skipped, only totals kept locally). Out come the heads for the year (short-term and long-term equity, intraday and F&O as business income, debt funds at slab), the set-offs, the tax, losses to carry forward, and what is worth doing before 31 March, with a one-click push into the tax comparison. Parser in `public/engine/brokers/zerodha.js`, tax layer in `public/engine/trading-tax.js`; `public/fixtures/zerodha-taxpnl-sample.xlsx` is a synthetic file in the same layout for testing. Other brokers: send a sample.
  - Compare investments: the same rupee in a savings account, liquid fund, FD, arbitrage fund, debt funds, NSC, PPF, EPF, SSY, NPS, balanced-advantage and aggressive-hybrid funds, ELSS, index, large-, flexi-, mid- and small-cap funds and gold, filtered by a risk profile (riskier options stay visible below the line), after tax, over your horizon and at your slab (the marginal rate from your profile). Shows what you keep, the after-tax return, the pre-tax equivalent (PPF's 7.1% is 10.3% to a 30% payer), tax saved on the way in under 80C in the old regime, and which instruments are locked or too volatile for the horizon. Guaranteed rates come from the quarterly small-savings notification in `data/schemes.json`; fund figures are the median rolling return of the category from AMFI history with the worst window shown; every rate is editable. Engine `public/engine/post-tax.js`.
  - Retirement: five figures (age, retire at, monthly spending, saved so far, saving per month) and one sentence back: the money lasts past 85, or runs out at age X and this much more a month closes the gap. Risk is chosen in percent terms, not as a return: two sliders (equity share until retirement, equity share after), and the growth rate follows from the mix using two labelled rates (Large Cap funds' median 5-year rolling return from the AMFI history, and the notified PPF rate), with the equity category's worst 5-year window shown as a bad stretch. Year-by-year chart, three sensitivities (retire two years later, inflation a point higher, equity repeats its worst stretch), "how to build it" at the chosen equity share, and the three-bucket plan at retirement. Deliberately simple: no withdrawal tax; says so. Engines `public/engine/retirement.js`, `public/engine/mix.js`.
  - Goal planner: pick what the money is for (child's education or wedding, house down payment, car, anything, or a fixed sum), give today's cost, and get the cost when it arrives (education inflation 10%, wedding 7%, property 6%, editable), the SIP or one-time amount, the SIP if equity repeats its worst 5-year stretch, and where the money goes (SSY for a daughter under 10, index fund, PPF or short debt by horizon) with the glide rule as the date nears. Child goals date themselves from the child's age; every child in the profile gets a row. The same percent-terms risk slider as retirement, capped by horizon (0% under 3 years, 30% under 5, 50% under 7). Engine `public/engine/goal.js`.
  - All calculators remember their inputs in the browser.
- **Excel by email from every calculator**: in-hand salary, EMI, SIP, home buying, capital gains and the goal planner each have an "Email me the workbook" card (the tax comparison and budget already did). One builder, `public/js/calc-export.js`, turns a small spec into a styled workbook with the calculator's sheets plus Inputs and Notes; `functions/api/send-workbook.js` accepts each source and describes the attached sheets in the email.
- **About page** with methodology, engine assumptions, data sources and dates, privacy and a feedback address.
- **Charts**, all inline SVG with hover tooltips (`public/js/charts.js`): the break-even curve on the tax page (old-regime tax against deductions claimed, with your position and the crossing point), an income-to-tax waterfall for each regime, loan balance and per-year principal/interest on the EMI page, growth curves on SIP, lumpsum and NPS. Text and grid colours come from CSS variables so they follow dark mode.
- **Shareable result card**: a 1080×1080 image of the regime verdict drawn on a canvas, with native share on phones and download elsewhere; the user chooses whether amounts appear.
- **Glossary tooltips** on terms in the comparison table and headroom list (`public/js/tooltips.js`), **animated numbers** when results change, **dark mode** following the device setting, a **trust line** under the verdict, and reduced-motion support.
- **Feedback button** on every page (name and message required, email optional, 1 to 5 stars, a "you may show this on the site" tick box) posting to `functions/api/feedback.js`, which stores rows in Cloudflare D1 (binding `DB`) and emails them to you via Brevo; either alone is enough. **What people say**: the feedback you approve appears on the About page (first name plus an initial, stars, the page it was about) with the average rating across everyone who rated, and a `★ 4.6/5 from 23 people` badge in the footer once five people have rated. You approve entries at `/api/feedback-admin` (a small page served by `functions/api/feedback-admin.js`), protected by the `FEEDBACK_ADMIN_TOKEN` secret (16+ characters) set in Cloudflare Pages -> Settings -> Variables and Secrets. The public read is `GET /api/feedback`, cached five minutes; emails never leave the database. **Usage counter** (`functions/api/counter.js`, same D1) shown on the tax page and footer once the database is bound; it counts visits, comparisons and emailed workbooks, one per browser session, and stores numbers only. Setup is in `docs/GO-LIVE.md` section 5a.
- **Installable on phones** as a web app: `public/manifest.webmanifest` plus icons generated by `tools/make-icons.mjs` (no image library needed). Chrome on Android and Safari on iOS offer "Add to Home Screen"; it opens full-screen with its own icon. There is deliberately no service worker, so users always get the latest code.
- **Real URLs** per section (`/tax`, `/calculators/emi`, `/nps`, `/glossary`, `/about`) with a title and description each (the route table is `public/js/routes.js`; `functions/_middleware.js` rewrites the `<title>`, description and Open Graph tags at the edge so shared links unfurl as the right page), `sitemap.xml`, `robots.txt` and a favicon. `public/_redirects` makes Cloudflare Pages serve `index.html` for every path; `tools/static-server.mjs` does the same locally.
- **NPS**: what the National Pension System is, a corpus and pension projector (contributions, step-up, return, annuity share and rate, with the taxable slice above 60% flagged), tax treatment in both regimes, investment choices, exit and withdrawal rules, and historical returns. Other government schemes were removed by decision; their data remains in `public/data/schemes.json` if ever wanted again.
- **Disclaimers** on the tax comparison, every calculator and the schemes tab asking users to consult their tax consultant or chartered accountant, or a SEBI-registered adviser, before acting.
- **Glossary**: about 150 India-specific terms, searchable by category.

All rates, rules and fund returns live in `public/data/*.json` and can be refreshed without touching code. The only server-side code is one small function that emails the budget workbook; everything else runs in the browser, and the site works fully without that function (the email button then says so and points to the download).

## Project layout

```
public/                 the static site (deploy this folder)
  index.html
  css/style.css
  js/tax-engine.js      pure tax computation, no DOM; also used by the tests
  js/tax-ui.js          onboarding form + two-column comparison + break-even panel
  js/tax-insights.js    break-even, headroom and what-if maths on top of the engine
  js/tax-export.js      the tax comparison workbook
  js/email-card.js      the shared "email me this workbook" form
  js/xlsx-style.js      shared ExcelJS loading and cell styling
  js/calc-export.js     one workbook builder + a spec per calculator, and the email card factory
  js/calculators.js     EMI (with loan simulator), SIP with lump sums; lazy-loads the rest
  js/goal.js            goal planner (engine/goal.js, engine/mix.js; mix-control.js and mix-rates.js shared with retirement)
  js/home-buy.js        home buying: true cost + loan eligibility, reads the profile
  engine/property.js    stamp duty, registration, GST, the full bill (pure)
  engine/loan-eligibility.js  FOIR, LTV, tenure-by-age, score gate, levers (pure; tested, not used by the UI since eligibility was dropped)
  engine/payment-plan.js      phase-wise payment plan with pre-EMI interest (pure)
  js/budget.js          expenses and savings calculator, charts, Excel export
  js/funds.js           historical fund returns: category summaries, matching, panel
  vendor/exceljs.min.js  ExcelJS, for the styled Excel export
functions/api/send-workbook.js  optional Cloudflare Pages Function that emails the workbook via Brevo
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

## Emailing the budget workbook and collecting contacts

The workbook is built in the browser with ExcelJS (vendored at `public/vendor/exceljs.min.js`, MIT), with styled headers, rupee and percentage formats, banded rows, frozen headers and the two charts embedded as images and is delivered **only by email**: the user gives a name and email, ticks a consent box, and `functions/api/send-workbook.js` (a Cloudflare Pages Function) sends it through Brevo and then saves the person as a **contact in your Brevo account** so you can ask for feedback later. To switch it on:

1. Create a free Brevo account (300 emails a day, unlimited contacts on the free plan). Verify a sender address under **Senders**, create an API key under **SMTP & API**, and optionally create a contact list under **Contacts** and note its numeric id.
2. In the Cloudflare Pages project, **Settings**, **Variables and Secrets**, add `BREVO_API_KEY` (secret), `MAIL_FROM_EMAIL` (the verified sender), and optionally `MAIL_FROM_NAME` and `BREVO_LIST_ID`.
3. Redeploy once. Contacts appear in Brevo with the attributes FIRSTNAME, LASTNAME and SOURCE = `taxcompass-budget-workbook`; export them from there whenever you want.

Because you are now keeping names and emails, the DPDP Act 2023 applies in full: the consent text on the form says what is kept and why (feedback about the app, no third-party marketing); keep it accurate, honour any request to be removed (delete the contact in Brevo), and have counsel review it with the other disclaimers. The workbook itself is never stored.

On GitHub Pages or Netlify drag-and-drop the function does not exist and the email button says emailing is not switched on; there is deliberately no download alternative.

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
5. Tax is rounded to the nearest rupee, not the nearest ten.

## Before launch

Read `docs/VERIFY_BEFORE_LAUNCH.md`. In particular:

- Confirm the new-regime surcharge cap of 25% and the old-regime rebate cliff against the consolidated Act PDF.
- Have counsel look at the disclaimer wording and the SEBI investment-adviser line for the fund panels.
- Decide how often you will actually rebuild the fund data and the quarterly small-savings rates, and put it in a calendar.
