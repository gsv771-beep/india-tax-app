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

## 5a. Feedback storage and the usage counter (D1, five minutes)

The Feedback button and the "N comparisons run" counter store their data in Cloudflare D1, a free SQLite database. Until you connect one, the counter stays hidden and feedback is only emailed to you (if Brevo is set up).

1. In Cloudflare, left menu **Storage & Databases**, **D1 SQL Database**, **Create**. Name it `taxcompass`. Leave the location on automatic.
2. Open your Pages project, **Settings**, **Bindings**, **Add**, choose **D1 database**. Variable name must be exactly `DB`. Pick `taxcompass`. Save.
3. Push any commit, or retry the latest deployment, so the function picks up the binding. The tables create themselves on first use.
4. To read feedback: **Storage & Databases**, **D1**, `taxcompass`, **Explore data** (or the Console tab) and run `SELECT * FROM feedback ORDER BY id DESC;`. Counters are in `SELECT * FROM counters;`.

The free plan allows 100,000 writes and 5 million reads a day, far beyond what this needs. Each feedback message is also emailed to `MAIL_FROM_EMAIL` when Brevo is configured, with the sender's email set as reply-to if they gave one.

## 6. Before you share the link

- Open every tab on the live site on a phone and on a laptop. Try the tax comparison with your own numbers and check them against your last return or Form 16.
- Read `docs/VERIFY_BEFORE_LAUNCH.md` and settle at least the Tier 1 items, especially the 25% new-regime surcharge cap and the HRA eight-city question (the flag ships off).
- Have a CA or lawyer read the disclaimers, the SEBI wording around the fund panels, and the consent line on the email form. You are now storing names and emails, so the DPDP Act 2023 applies; keep the consent text truthful and delete a contact from Brevo if anyone asks.
- Decide who owns two recurring jobs: the small-savings rates (quarterly, end of March, June, September, December) in `public/data/schemes.json`, and Budget-day changes to `public/data/tax_rates.json` and `deductions.json`. The fund data updates itself monthly.
- Optional: in Cloudflare, **Security**, **WAF**, add a rate-limiting rule for `/api/send-workbook` (for example 5 requests per minute per IP) so nobody can burn through your 300 daily emails.

## 6a. Visitor statistics (two clicks, no cookies)

In the Cloudflare Pages project open the **Web Analytics** tab (or **Metrics**) and click **Enable**. Cloudflare injects its cookie-free beacon on every page and you get visits, top pages and countries. It identifies no individuals, which matches the privacy text on the About page. Nothing in the code needs to change.

## 6b. Search engines

The site has real URLs per section (`/tax`, `/calculators/emi`, `/schemes`, `/about`, and so on), a `sitemap.xml` and a `robots.txt`. To get indexed faster, sign in at https://search.google.com/search-console, add the site, verify it (the DNS or HTML-tag method both work), and submit `https://india-tax-app.pages.dev/sitemap.xml`. When you move to a custom domain, update the domain in `public/sitemap.xml`, `public/robots.txt` and the canonical link in `public/index.html`, and add the new domain in Search Console.

## 7. Custom domain: taxcompass.org (registered on Cloudflare, 13 Sep 2026)

The code uses `https://taxcompass.org` for the sitemap, robots, canonical links and the share card. Because the domain was bought through Cloudflare Registrar, its DNS is already on Cloudflare and there is no nameserver step.

1. **Attach the site.** Pages project, **Custom domains**, **Set up a custom domain**, type `taxcompass.org`, **Activate domain**. Repeat for `www.taxcompass.org`. Cloudflare adds the DNS records and issues HTTPS itself; it is usually active within a few minutes. The `india-tax-app.pages.dev` address keeps working alongside, and the canonical tags tell search engines that `.org` is the real one.
2. **The spare `taxcompass.biz` (GoDaddy).** Either let it lapse, or make it forward: the simplest way is to add it as another custom domain on the same Pages project (which needs its nameservers moved to Cloudflare: GoDaddy, the domain, DNS, Nameservers, Change, paste the two names Cloudflare shows after **Add a domain**). Both names then serve the site and the canonical links keep search results on `.org`.
4. **Search Console**: add `https://taxcompass.org/` as a new property (the DNS method now works since DNS is on Cloudflare) and submit `https://taxcompass.org/sitemap.xml`.
5. **Email from the domain (recommended, fixes the Gmail deliverability warning).** Cloudflare, the domain, **Email**, **Email Routing**, enable it and create `hello@taxcompass.org` forwarding to your Gmail. Then Brevo, **Senders, Domains & Dedicated IPs**, **Domains**, add `taxcompass.org`, and paste the records Brevo gives you into Cloudflare DNS (Cloudflare can do this automatically if you pick "authenticate with Cloudflare"). Add `hello@taxcompass.org` as a sender in Brevo, verify it via the forwarded email, then change `MAIL_FROM_EMAIL` in the Pages project to that address and redeploy.

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
