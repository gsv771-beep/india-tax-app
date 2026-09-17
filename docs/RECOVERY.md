# Backup and recovery

If the site is defaced, the Cloudflare or GitHub account is taken over, or a bad deploy goes out,
this is how to get back to a working taxcompass.org. Read the "Where everything lives" table
first: the code is the easy part, the settings around it are what people forget.

## Where everything lives

| What | Where | Backed up by |
|---|---|---|
| All code, data files, tests, docs | GitHub `gsv771-beep/india-tax-app` (`main` = production, `dev` = staging) | GitHub itself, plus `npm run backup` bundles |
| Secrets: `BREVO_API_KEY`, `MAIL_FROM_EMAIL`, `MAIL_FROM_NAME`, `BREVO_LIST_ID`, `FEEDBACK_ADMIN_TOKEN` | Cloudflare Pages → Settings → Variables and Secrets (Production) | **You**: keep the values in a password manager. Cloudflare will not show a secret again. |
| Feedback rows, approvals, usage counters | Cloudflare D1 database `taxcompass` (id in `wrangler.toml`) | `npm run backup` when wrangler is logged in; otherwise dashboard export |
| Domain and DNS | Cloudflare registrar, zone `taxcompass.org` | Nothing to back up; just do not let the account lapse |
| Email sending and contacts | Brevo account | Brevo; export contacts from Brevo → Contacts → Export if you want a copy |
| Search Console / Bing | Google and Microsoft accounts | Re-verify with the DNS record after a rebuild |

## The routine (monthly, and before anything risky)

```bash
npm run backup
```

It writes `~/TaxCompass-backups/taxcompass-<date>.bundle`: one file holding every commit on every
branch. Keep the folder synced to OneDrive or Google Drive, or copy it to a USB stick; a backup on
the same laptop as the working copy is not a backup. The ten newest are kept.

To include the database, log wrangler in once (`npx wrangler login`, opens the browser); after that
the same command also writes `taxcompass-<date>-d1.sql`. Without it, export by hand: Cloudflare
dashboard → Storage & Databases → D1 → `taxcompass` → Export.

Two account settings matter more than any backup:

- **Two-factor authentication** on GitHub and on Cloudflare. Both are one-time, five minutes each.
- **Branch protection on `main`** (docs/ENVIRONMENTS.md, GitHub section), so a stolen laptop or
  token cannot push straight to production without the tests passing.

## Scenario 1: a bad deploy, or the site looks wrong

Nothing is lost; Cloudflare keeps every deployment.

1. Cloudflare → Workers & Pages → `india-tax-app` → Deployments.
2. Find the last good production deployment → ⋯ → **Rollback to this deployment**. Live in seconds.
3. Fix the code on `dev`, test, merge to `main` as usual; the next deploy replaces the rollback.

## Scenario 2: someone has pushed code you did not write

1. Roll back as in Scenario 1 so the live site is clean.
2. In GitHub: Settings → Security → revoke every personal access token and deploy key you do not
   recognise; change your password; turn on 2FA if it is off.
3. Reset the branches to the last commit that is yours (find it with `git log --format='%h %an %s'`):

   ```bash
   git fetch origin
   git checkout main && git reset --hard <good-commit> && git push --force origin main
   git checkout dev && git reset --hard <good-commit> && git push --force origin dev
   ```

4. Rotate every secret (Scenario 4). Assume anything in the dashboard was read.

## Scenario 3: the GitHub repository is gone or locked out

Rebuild it from the newest bundle:

```bash
git clone ~/TaxCompass-backups/taxcompass-<date>.bundle india-tax-app
cd india-tax-app
git checkout dev      # the bundle has every branch
```

Create a new empty repository on GitHub (any name), then:

```bash
git remote set-url origin https://github.com/<you>/<new-name>.git
git push --all origin
```

Then point Cloudflare Pages at the new repository: Workers & Pages → `india-tax-app` → Settings →
Builds & deployments → Source → connect the new repo, production branch `main`. If the Pages
project itself is gone, follow Scenario 5.

## Scenario 4: a secret may have leaked

Do all of these; each takes two minutes.

- **Brevo**: SMTP & API → API Keys → delete the old key, create a new one → paste it into Cloudflare
  Pages → Variables and Secrets → `BREVO_API_KEY` (Production) → Deployments → Retry deployment.
- **Feedback moderation**: set a new `FEEDBACK_ADMIN_TOKEN` the same way.
- **Cloudflare**: My Profile → API Tokens → revoke any token you do not recognise; change the
  password; check Members for anyone you did not add.
- **GitHub**: as in Scenario 2, step 2.
- The site itself holds no user accounts and no passwords, so there is nothing to tell users to change.

## Scenario 5: rebuild from nothing (new Cloudflare project)

Order matters; about 30 minutes.

1. **Code**: GitHub repository exists (Scenario 3 if not).
2. **Pages project**: Cloudflare → Workers & Pages → Create → Pages → Connect to Git → the
   repository. Framework preset *None*, build command empty, output directory `public`,
   production branch `main`. Deploy once; it will work without email or database.
3. **Database**: Storage & Databases → D1 → Create → name `taxcompass`. Copy its id into
   `wrangler.toml` (`database_id = ...`), commit and push; the binding comes from that file, not
   the dashboard. Import the newest `-d1.sql` backup: D1 → `taxcompass` → Console, paste, or
   `npx wrangler d1 execute taxcompass --remote --file=<backup>.sql`. Without a backup the
   tables are created empty on first use.
4. **Secrets**: Settings → Variables and Secrets → Production → add the five from the table above
   (values from your password manager; Brevo key from Brevo if you have to regenerate). Retry the
   deployment so they apply.
5. **Domain**: Custom domains → add `taxcompass.org` and `www.taxcompass.org`; Cloudflare writes
   the DNS records since the zone is on the same account. Check `public/js/env.js` and
   `functions/_env.js` still list these hosts as production (they do unless the domain changed).
6. **Zone settings** (docs/ENVIRONMENTS.md): Caching → Configuration → Browser Cache TTL →
   *Respect Existing Headers*; Preview branch alias for `dev` if you use staging.
7. **Search Console**: Settings → Ownership verification → the DNS TXT record still verifies if the
   zone is the same; otherwise add it again. Resubmit `https://taxcompass.org/sitemap.xml`.
8. **Check**: `https://taxcompass.org/robots.txt` allows crawling, a calculator loads, the feedback
   button sends, and the Excel email arrives. `curl -sI https://taxcompass.org/js/app.js` shows
   `Cache-Control: no-cache`.

## What is deliberately not backed up

- Visitors' own figures: they live only in each visitor's browser. There is nothing to recover and
  nothing to leak.
- Emailed workbooks: never stored.
