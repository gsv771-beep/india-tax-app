/**
 * Cloudflare zone analytics, mirrored into D1 so the site can show the dashboard's numbers without
 * exposing a token to the browser. Once a day (first request after midnight UTC) the last 14 days of
 * httpRequests1dGroups are fetched from the GraphQL API and upserted by date; totals are the sum of
 * every stored day since launch. Needs two secrets on the Pages project:
 *   CF_ZONE_ID    the zone id from the dashboard's Overview page (right-hand column)
 *   CF_API_TOKEN  an API token with "Analytics: Read" on that zone (My Profile -> API Tokens)
 * Without them, cfTotals() returns null and the site shows its own counter alone.
 */
const LAUNCH = '2026-09-13';
const GRAPHQL = 'https://api.cloudflare.com/client/v4/graphql';

export function cfConfigured(env) {
  return !!(env.CF_ZONE_ID && env.CF_API_TOKEN);
}

export async function ensureCfSchema(db) {
  await db.prepare('CREATE TABLE IF NOT EXISTS cf_daily (date TEXT PRIMARY KEY, requests INTEGER NOT NULL DEFAULT 0, page_views INTEGER NOT NULL DEFAULT 0, uniques INTEGER NOT NULL DEFAULT 0)').run();
}

const day = (d) => d.toISOString().slice(0, 10);

/** Fetch daily groups for [since, until] from the GraphQL API. Returns [{ date, requests, pageViews, uniques }]. */
export async function fetchCfDaily(env, since, until, fetchImpl = fetch) {
  const query = `query ($zone: String!, $since: Date!, $until: Date!) {
    viewer { zones(filter: { zoneTag: $zone }) {
      httpRequests1dGroups(limit: 400, filter: { date_geq: $since, date_leq: $until }, orderBy: [date_ASC]) {
        dimensions { date }
        sum { requests pageViews }
        uniq { uniques }
      } } } }`;
  const res = await fetchImpl(GRAPHQL, {
    method: 'POST',
    headers: { authorization: `Bearer ${env.CF_API_TOKEN}`, 'content-type': 'application/json' },
    body: JSON.stringify({ query, variables: { zone: env.CF_ZONE_ID, since, until } }),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok || (body.errors && body.errors.length)) throw new Error(`Cloudflare analytics: ${res.status} ${body.errors ? body.errors.map((e) => e.message).join('; ') : ''}`.trim());
  const groups = (((body.data || {}).viewer || {}).zones || [])[0]?.httpRequests1dGroups || [];
  return groups.map((g) => ({ date: g.dimensions.date, requests: +g.sum.requests || 0, pageViews: +g.sum.pageViews || 0, uniques: +g.uniq.uniques || 0 }));
}

/**
 * Sync if today has not been synced yet (a counters row remembers the day), then return totals:
 * { requests, pageViews, since, syncedDay } or null when not configured. Failures leave the stored
 * totals in place and never throw: the numbers are decorative.
 */
export async function cfTotals(env, db, { now = new Date(), fetchImpl = fetch } = {}) {
  if (!cfConfigured(env) || !db) return null;
  try {
    await ensureCfSchema(db);
    const today = Number(day(now).replace(/-/g, ''));
    const row = await db.prepare("SELECT value FROM counters WHERE name = 'cf_synced_day'").first().catch(() => null);
    if (!row || row.value < today) {
      const until = day(new Date(now.getTime() - 86400000));                       // yesterday: today's group is still filling
      const first = day(new Date(now.getTime() - 14 * 86400000));
      const since = first < LAUNCH ? LAUNCH : first;
      const days = await fetchCfDaily(env, since, until, fetchImpl);
      const stmts = days.map((d) => db.prepare('INSERT INTO cf_daily (date, requests, page_views, uniques) VALUES (?, ?, ?, ?) ON CONFLICT(date) DO UPDATE SET requests = excluded.requests, page_views = excluded.page_views, uniques = excluded.uniques').bind(d.date, d.requests, d.pageViews, d.uniques));
      stmts.push(db.prepare("INSERT INTO counters (name, value) VALUES ('cf_synced_day', ?) ON CONFLICT(name) DO UPDATE SET value = excluded.value").bind(today));
      await db.batch(stmts);
    }
    const t = await db.prepare('SELECT COALESCE(SUM(requests), 0) AS requests, COALESCE(SUM(page_views), 0) AS pageViews, MIN(date) AS since, COUNT(*) AS days FROM cf_daily').first();
    if (!t || !t.days) return null;
    return { requests: +t.requests, pageViews: +t.pageViews, since: t.since, days: +t.days };
  } catch {
    // keep whatever was stored before; a failed sync must not blank the footer
    try {
      const t = await db.prepare('SELECT COALESCE(SUM(requests), 0) AS requests, COALESCE(SUM(page_views), 0) AS pageViews, MIN(date) AS since, COUNT(*) AS days FROM cf_daily').first();
      return t && t.days ? { requests: +t.requests, pageViews: +t.pageViews, since: t.since, days: +t.days } : null;
    } catch { return null; }
  }
}
