# TaxCompass India

A static web app for Indian individual taxpayers. No backend, no build step, no API keys.

- **Tax comparison**: answer a short set of questions and see the old and new regimes computed line by line, side by side, with a provision-by-provision reference table.
- **Calculators**:
  - Expenses and savings: monthly take-home income, expenses in ten fixed categories plus Others, SIP and recurring-deposit investments with projected values, a summary of where the income goes (charts and tables), and an Excel workbook emailed to the user in exchange for name and email.
  - EMI with step-up EMI (by a percentage or a fixed amount each year), a one-time lump sum prepayment and an extra payment every year (keep the EMI and finish sooner, or keep the tenure and pay less), a plain-English sentence explaining the outcome, a before-and-after comparison and a year-by-year schedule, plus an "invest instead of prepaying?" panel showing fund categories that historically beat the loan rate, lowest risk first.
  - SIP with step-up by percentage or amount, and lumpsum, each followed by "what has historically delivered about X% a year?": fund categories whose typical rolling return sits near the return the user assumed, with the worst and best stretches, and the funds inside each category.
  - Goal planner with inflation and real-return maths.
- **Schemes and NPS**: a filterable comparison table of government-backed schemes (type, issuer, rate, lock-in, 80C, tax on interest) with details folded under each row, post-tax return by slab, and NPS, APY and closed schemes in collapsible sections. Rates are for the quarter in force and labelled as such.
- **Disclaimers** on the tax comparison, every calculator and the schemes tab asking users to consult their tax consultant or chartered accountant, or a SEBI-registered adviser, before acting.
- **Glossary**: about 150 India-specific terms, searchable by category.

All rates, rules and fund returns live in `public/data/*.json` and can be refreshed without touching code. The only server-side code is one small function that emails the budget workbook; everything else runs in the browser, and the site works fully without that function (the email button then says so and points to the download).

## Project layout

```
public/                 the static site (deploy this folder)
  index.html
  css/style.css
  js/tax-engine.js      pure tax computation, no DOM; also used by the tests
  js/tax-ui.js          onboarding form + two-column comparison
  js/calculators.js     EMI (with loan simulator), SIP, lumpsum, goal
  js/budget.js          expenses and savings calculator, charts, Excel export
  js/funds.js           historical fund returns: category summaries, matching, panel
  vendor/xlsx.full.min.js  SheetJS, for the Excel export
functions/api/send-workbook.js  optional Cloudflare Pages Function that emails the workbook via Brevo
  js/schemes.js         NPS and government schemes
  js/glossary.js
  js/data/*.json        rates, deductions, comparison rows, formulas, glossary, schemes, mf_returns
  _headers              security headers (Cloudflare Pages / Netlify honour this file)
tools/build-mf-returns.mjs  builds public/data/mf_returns.json from AMFI NAV history
tools/static-server.mjs     dependency-free local preview server
tests/                  regression tests for the tax engine, calculators, loan simulator, fund matching
docs/                   the research pack: verification list, engine spec, corpus plan, scheme research
```

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

The workbook is built in the browser with SheetJS (vendored at `public/vendor/xlsx.full.min.js`, Apache-2.0) and is delivered **only by email**: the user gives a name and email, ticks a consent box, and `functions/api/send-workbook.js` (a Cloudflare Pages Function) sends it through Brevo and then saves the person as a **contact in your Brevo account** so you can ask for feedback later. To switch it on:

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
| Deduction limits and regime availability | Same | `public/data/deductions.json` |

After any data change run `npm test`.

## Feature flags

In `public/js/tax-engine.js`, `DEFAULT_FLAGS`:

- `hraEightCityMetro` (off): treat Bengaluru, Hyderabad, Pune and Ahmedabad as metro for HRA from FY 2026-27. Turn on only after the Income-tax Rules 2026 notification is confirmed. See `docs/VERIFY_BEFORE_LAUNCH.md` item 2.
- `oldRegimeRebateMarginalRelief` (off): the old-regime Rs 5 lakh rebate is modelled as a hard cliff, as the data pack recommends.

## Engine assumptions

Documented at the top of `public/js/tax-engine.js`. The ones worth knowing:

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
