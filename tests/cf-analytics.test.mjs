// Cloudflare analytics mirror: syncs once a day, sums since launch, survives failures. Run: node tests/cf-analytics.test.mjs
import { cfTotals, fetchCfDaily, cfConfigured } from '../functions/_cf-analytics.js';
let failures = 0;
const ok = (name, cond, detail = '') => { console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${detail ? ' (' + detail + ')' : ''}`); if (!cond) failures++; };

/** In-memory stand-in for the two tables cfTotals touches. */
function fakeDb() {
  const daily = new Map(); const counters = new Map();
  const stmt = (sql) => ({
    _a: [], bind(...a) { this._a = a; return this; },
    async run() { return this.exec(); },
    async first() { return this.exec(); },
    exec() {
      if (/CREATE TABLE/.test(sql)) return {};
      if (/INSERT INTO cf_daily/.test(sql)) { const [date, requests, page_views, uniques] = this._a; daily.set(date, { requests, page_views, uniques }); return {}; }
      if (/INSERT INTO counters/.test(sql)) { counters.set('cf_synced_day', this._a[0]); return {}; }
      if (/FROM counters WHERE name = 'cf_synced_day'/.test(sql)) return counters.has('cf_synced_day') ? { value: counters.get('cf_synced_day') } : null;
      if (/SUM\(requests\)/.test(sql)) { const rows = [...daily.entries()]; return { requests: rows.reduce((s, [, r]) => s + r.requests, 0), pageViews: rows.reduce((s, [, r]) => s + r.page_views, 0), since: rows.map(([d]) => d).sort()[0] || null, days: rows.length }; }
      return {};
    },
  });
  return { prepare: stmt, async batch(stmts) { for (const s of stmts) s.exec(); return []; }, _daily: daily, _counters: counters };
}
const env = { CF_ZONE_ID: 'zone1', CF_API_TOKEN: 'tok' };
const groups = (days) => days.map(([date, requests, pageViews, uniques]) => ({ dimensions: { date }, sum: { requests, pageViews }, uniq: { uniques } }));
const fetchOk = (days) => async (url, init) => {
  const v = JSON.parse(init.body).variables;
  return new Response(JSON.stringify({ data: { viewer: { zones: [{ httpRequests1dGroups: groups(days.filter(([d]) => d >= v.since && d <= v.until)) }] } } }), { status: 200 });
};

ok('not configured -> null', await cfTotals({}, fakeDb()) === null && !cfConfigured({}));

{
  const db = fakeDb();
  const calls = [];
  const f = async (u, i) => { calls.push(JSON.parse(i.body).variables); return fetchOk([['2026-09-13', 100, 40, 10], ['2026-09-14', 200, 80, 20], ['2026-09-20', 300, 120, 30]])(u, i); };
  const now = new Date('2026-09-21T10:00:00Z');
  const t = await cfTotals(env, db, { now, fetchImpl: f });
  ok('first call syncs and sums every stored day', t && t.requests === 600 && t.pageViews === 240 && t.days === 3 && t.since === '2026-09-13', JSON.stringify(t));
  ok('asks for yesterday back, never before launch', calls[0].since === '2026-09-13' && calls[0].until === '2026-09-20', JSON.stringify(calls[0]));
  ok('remembers the day it synced', db._counters.get('cf_synced_day') === 20260921);
  await cfTotals(env, db, { now, fetchImpl: f });
  ok('same day: no second fetch', calls.length === 1);
  const t2 = await cfTotals(env, db, { now: new Date('2026-09-22T01:00:00Z'), fetchImpl: async (u, i) => { calls.push(1); return fetchOk([['2026-09-20', 350, 140, 30], ['2026-09-21', 50, 20, 5]])(u, i); } });
  ok('next day: re-fetches, later figures for a day replace earlier ones', calls.length === 2 && t2.requests === 100 + 200 + 350 + 50 && t2.days === 4, JSON.stringify(t2));
  const t3 = await cfTotals(env, db, { now: new Date('2026-09-23T01:00:00Z'), fetchImpl: async () => new Response('{"errors":[{"message":"nope"}]}', { status: 200 }) });
  ok('API failure keeps the stored totals', t3 && t3.requests === 700, JSON.stringify(t3));
}
{
  let err = null;
  try { await fetchCfDaily(env, '2026-09-13', '2026-09-20', async () => new Response('{"errors":[{"message":"authentication error"}]}', { status: 200 })); } catch (e) { err = e; }
  ok('fetchCfDaily surfaces API errors', err && /authentication error/.test(err.message));
}

console.log(failures ? `\n${failures} failure(s)` : '\nAll Cloudflare analytics tests passed');
process.exit(failures ? 1 : 0);
