# Going live: step by step

Everything below is free. Budget about an hour the first time. Steps 1 to 4 put the site online; step 5 switches on the email workbook; step 6 is the checklist before you share the link.

## 1. Install Git (one time)

Open PowerShell and run:

```powershell
winget install --id Git.Git -e --source winget
```

Close and reopen PowerShell, then set your identity (used on every commit):

```powershell
git config --global user.name "Your Name"
git config --global user.email "gsv771@gmail.com"
```

## 2. Create a GitHub account and an empty repository

1. Sign up at https://github.com (free).
2. Click the **+** at the top right, **New repository**.
3. Name it `india-tax-app`, leave it **Public** or **Private** (either works with Cloudflare), and do **not** tick "Add a README" or any other file. Click **Create repository**.
4. Keep the page open; you will need the URL it shows, which looks like `https://github.com/<your-username>/india-tax-app.git`.

## 3. Push the project to GitHub

In PowerShell:

```powershell
cd C:\Users\gsv77\Projects\india-tax-app
npm test
git init
git add .
git commit -m "TaxCompass India: initial release"
git branch -M main
git remote add origin https://github.com/<your-username>/india-tax-app.git
git push -u origin main
```

A browser window will ask you to sign in to GitHub the first time you push. `npm test` must print three "passed" lines before you continue.

What gets uploaded is controlled by `.gitignore`: `node_modules`, the `.cache` folder from the fund-data build, and any `.dev.vars` file stay on your machine. The fund data file and the spreadsheet library in `public/vendor` are uploaded, as they should be.

## 4. Deploy on Cloudflare Pages

1. Sign up at https://dash.cloudflare.com (free plan, no card needed).
2. In the left menu open **Workers & Pages**, click **Create**, choose the **Pages** tab, then **Connect to Git**.
3. Authorise Cloudflare to see your GitHub account and pick `india-tax-app`.
4. Build settings:
   - Project name: `india-tax-app` (this becomes the address `india-tax-app.pages.dev`; pick another name if it is taken)
   - Production branch: `main`
   - Framework preset: **None**
   - Build command: leave **empty**
   - Build output directory: `public`
5. Click **Save and Deploy**. The first deploy takes a minute or two. When it says Success, open the link. The whole site works at this point except the email button, which will say emailing is not switched on.

Every later `git push` to `main` redeploys automatically. The monthly fund-data workflow on GitHub commits to `main`, so it redeploys the site too.

## 5. Switch on the email workbook (Brevo)

1. Sign up at https://www.brevo.com (free plan: 300 emails a day, unlimited contacts).
2. **Verify a sender**: in Brevo go to your account menu, **Senders, Domains & Dedicated IPs**, **Senders**, **Add a sender**. Use an address you control (a Gmail address is fine to start). Click the verification link Brevo emails you.
3. **Create an API key**: account menu, **SMTP & API**, **API Keys** tab, **Generate a new API key**. Name it `taxcompass`. Copy the key now; it is shown once.
4. Optional but recommended: **Contacts**, **Lists**, **Add a list** named `TaxCompass feedback`. Open it and note the numeric id shown in the address bar or list header.
5. In Cloudflare, open your Pages project, **Settings**, **Variables and Secrets**, **Add**:
   - `BREVO_API_KEY` = the key from step 3. Choose type **Secret**.
   - `MAIL_FROM_EMAIL` = the sender address you verified.
   - `MAIL_FROM_NAME` = `TaxCompass India` (optional).
   - `BREVO_LIST_ID` = the list id (optional).
   Add each for **Production** (and Preview if offered).
6. Trigger a new deploy so the function picks up the settings: **Deployments**, **Retry deployment** on the latest one, or push any small change.
7. Test: open the live site, Calculators, Expenses & savings, enter a few numbers, fill in your own name and email, tick the box, click the button. The workbook should arrive within a minute, and your details should appear under **Contacts** in Brevo.

## 6. Before you share the link

- Open every tab on the live site on a phone and on a laptop. Try the tax comparison with your own numbers and check them against your last return or Form 16.
- Read `docs/VERIFY_BEFORE_LAUNCH.md` and settle at least the Tier 1 items, especially the 25% new-regime surcharge cap and the HRA eight-city question (the flag ships off).
- Have a CA or lawyer read the disclaimers, the SEBI wording around the fund panels, and the consent line on the email form. You are now storing names and emails, so the DPDP Act 2023 applies; keep the consent text truthful and delete a contact from Brevo if anyone asks.
- Decide who owns two recurring jobs: the small-savings rates (quarterly, end of March, June, September, December) in `public/data/schemes.json`, and Budget-day changes to `public/data/tax_rates.json` and `deductions.json`. The fund data updates itself monthly.
- Optional: in Cloudflare, **Security**, **WAF**, add a rate-limiting rule for `/api/send-workbook` (for example 5 requests per minute per IP) so nobody can burn through your 300 daily emails.

## 7. Custom domain (optional, later)

Buy a domain from any registrar (a `.in` costs a few hundred rupees a year). In the Pages project open **Custom domains**, **Set up a custom domain**, and follow the DNS instructions. Cloudflare issues the HTTPS certificate for free. If you buy the domain through Cloudflare Registrar the DNS step is automatic.

## 8. Making changes after launch

```powershell
cd C:\Users\gsv77\Projects\india-tax-app
# edit files, then:
npm test
git add .
git commit -m "Describe the change"
git push
```

Cloudflare redeploys within a minute of the push. To rebuild the fund data by hand at any time, run `npm run build:funds` before committing, or use **Actions**, **Update mutual fund returns**, **Run workflow** on GitHub.

## If something goes wrong

- Deploy failed on Cloudflare: open the failed deployment's log. The usual cause is a wrong output directory; it must be exactly `public`.
- Site loads but a tab is blank: open the browser console (F12). A 404 on a file under `data/` means it was not committed; run `git status` locally.
- Email button says "not switched on": one of `BREVO_API_KEY` or `MAIL_FROM_EMAIL` is missing, or you did not redeploy after adding them.
- Email button reports a provider error: the sender address is not verified in Brevo, or the API key was pasted with a space.
- Fund workflow failed on GitHub: open the run log under Actions. It usually means api.mfapi.in was down; run it again the next day.
