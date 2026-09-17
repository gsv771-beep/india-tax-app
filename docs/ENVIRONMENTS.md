# Environments, branches and the merge gate

Three kinds of host, one rule: only `taxcompass.org` is production. Everything else is
non-production and must be impossible to mistake for the real thing or to index.

| Branch | Host | Purpose |
|---|---|---|
| `main` | https://taxcompass.org | Production. Never commit here directly; merge from `dev` by pull request once CI is green. |
| `dev` | https://staging.taxcompass.org | Staging. Feature branches merge here first. The monthly fund-data bot also commits here. |
| anything else | `https://<hash>.india-tax-app.pages.dev` | Automatic preview per branch push. |

## What the code does on every non-production host

Detection is by hostname, in three independent places that must stay in sync:
`public/index.html` (inline script), `public/js/env.js`, `functions/_env.js`.

1. **Banner.** A fixed red bar reading *STAGING — figures may be incorrect. Not for use.* is
   inserted before anything else renders. It has no close button.
2. **No indexing, three layers.**
   - `public/_headers` sends `X-Robots-Tag: noindex, nofollow` and `Cache-Control: no-store` for
     `*.pages.dev` and `staging.taxcompass.org`.
   - `functions/robots.txt.js` serves `Disallow: /` unless the hostname is production
     (production gets the static `public/robots.txt`). `tools/static-server.mjs` does the same locally.
   - The inline script adds `<meta name="robots" content="noindex, nofollow">` to the page.
3. **Dev tools.** A red **DEV** button at the bottom left opens the fixture loader
   (`public/js/devtools.js`). It is never loaded on production.

## One-time Cloudflare setup (dashboard; cannot be done from the repo)

Workers & Pages → `india-tax-app`:

1. **Settings → Builds & deployments → Branch control.**
   Production branch `main`. Preview branches: *All non-production branches*.
2. **Custom domains → Set up a custom domain.** Add `staging.taxcompass.org`. Cloudflare creates
   the DNS record. Then under **Preview deployments** (same Custom domains page, or
   *Settings → Domains → Preview aliases* depending on dashboard version) point the alias at the
   `dev` branch so `staging.taxcompass.org` always shows the latest `dev` deployment.
3. **Cache rule.** Cloudflare dashboard for the `taxcompass.org` zone → **Caching → Cache Rules →
   Create rule.** Name `Bypass cache on staging`. When incoming requests match:
   *Hostname equals `staging.taxcompass.org`*. Then: **Bypass cache**. Deploy.
   (`_headers` already sends `no-store` for the same host; the rule stops the edge from caching
   it anyway.)
4. **Variables and secrets.** Brevo and D1 settings are per-environment. Preview deployments
   share the Preview environment; if you want staging to send email, add the same variables
   under *Preview*. Leaving them unset is fine: the email button reports it is switched off.
   Add `FEEDBACK_ADMIN_TOKEN` (any 16+ character secret) to Production to use the feedback moderation
   page at `https://taxcompass.org/api/feedback-admin`; paste the token there once per browser session.

## One-time GitHub setup (repository settings; cannot be done from the repo)

Settings → Branches → **Add branch protection rule** (or *Rules → Rulesets* on newer GitHub):

- Branch name pattern: `main`
- Require a pull request before merging
- Require status checks to pass before merging → search for and add **`test`**
  (the job name in `.github/workflows/ci.yml`; it appears after the first CI run)
- Do not allow bypassing the above settings (tick this so it applies to admins too)

Repeat for `dev` if you want feature branches gated as well; recommended.

## Caching

There is no build step and no hashed filenames, so `public/_headers` forces browsers to revalidate
`/js/*`, `/engine/*` and `/css/*` on every load (ETag 304s). Without this, Cloudflare Pages' default
4-hour `max-age` let a browser pair a fresh `index.html` with a stale `calculators.js`, and a newly
added tab did nothing when clicked. Data files keep a 1-hour cache.

**Zone setting (one-time, dashboard):** the `taxcompass.org` zone's *Browser Cache TTL* defaults to 4 hours
and overrides any shorter header the site sends, which silently re-creates the stale-script problem on the
custom domain only. Set **Caching → Configuration → Browser Cache TTL → Respect Existing Headers**.

## Fixtures

Preview URLs are separate origins, so `localStorage` starts empty on every new branch. The
profiles in `public/fixtures/profiles/` are complete v1 profiles (schema in
`public/engine/profile.js`):

| File | What it is |
|---|---|
| `new-regime-15L.json` | ₹15L CTC, new regime, renting in Bengaluru, no loan |
| `old-regime-45L-homeloan.json` | ₹45L CTC, old regime, ₹60L outstanding home loan, two children |
| `1cr-esop.json` | ₹1cr CTC with a ₹25L ESOP component and employer NPS |
| `rebate-boundary.json` | Total income exactly ₹12,00,000 under the new regime: the s.87A cliff |

`npm run test:fixtures` checks each one adds up and that the boundary fixture is on the boundary.
Loading a fixture wipes every TaxCompass key in the browser first, then imports the profile
through the same path as the panel's Import button, so every tool pre-fills from it.

## Tests and the merge gate

`npm test` runs every engine test plus `tests/known-answers.test.mjs`, which holds the
product-owner-supplied expected values. Cases still marked `TODO` print the engine's current
value and are reported as pending, not failed; `npm run test:strict` makes them fail. Once every
value is filled in, switch the CI step to `npm run test:strict`.

## Day to day

```bash
git checkout dev && git pull
git checkout -b feature/whatever
# ...work, npm test...
git push -u origin feature/whatever      # preview URL appears in the Cloudflare deployment list
# open a PR into dev; merge when CI is green
# to release: open a PR dev -> main; merge when CI is green
```
