/**
 * GET  /api/counter                -> { available, counts: { visits, comparisons, workbooks, calculations (comparisons included),
 *                                       answers, deeper, reverse, examples, hikes, pfInCtc, ... }, calculators: { emi: n, ... }, cf }
 * GET  /api/counter?days=30        -> the same, plus days: [{ day: 'YYYY-MM-DD' (IST), visits, answers, ..., calculations }], newest last
 * POST /api/counter { event }      -> adds one to: visit | compare | workbook | answer | deeper | want | example | hike | pfin | calc:<calculator>
 * Each event counts at most once per browser tab (js/feedback.js). Counts only: no cookies, no identifiers, nothing
 * typed. Backed by D1 (binding `DB`). Without the binding, GET reports available:false and POST is a no-op.
 *
 * The landing card's funnel: answer (an answer was shown), deeper (opened 'Get a more exact answer'), want (used the
 * reverse question), example (tapped the ₹15 lakh sample), hike (tried a hike), pfin (ticked 'CTC includes PF').
 */
import { json, ensureSchema, bump, istDay } from '../_lib.js';
import { cfTotals } from '../_cf-analytics.js';

const EVENTS = { visit: 'visits', compare: 'comparisons', workbook: 'workbooks', ask: 'asks', tip: 'tips', answer: 'answers', deeper: 'deeper', want: 'reverse', example: 'examples', hike: 'hikes', pfin: 'pfInCtc' };
const CALCS = ['salary', 'budget', 'emi', 'sip', 'home', 'compare', 'capital-gains', 'retirement', 'goal', 'insurance', 'debt', 'offer'];
const counterName = (event) => EVENTS[event] || (typeof event === 'string' && event.startsWith('calc:') && CALCS.includes(event.slice(5)) ? event : null);

export async function onRequestGet({ env, request }) {
  if (!env.DB) return json({ available: false });
  try {
    await ensureSchema(env.DB);
    const { results } = await env.DB.prepare('SELECT name, value FROM counters').all();
    const counts = { visits: 0, comparisons: 0, workbooks: 0, asks: 0, tips: 0, calculations: 0, answers: 0, deeper: 0, reverse: 0, examples: 0, hikes: 0, pfInCtc: 0 };
    const calculators = {};
    for (const r of results || []) {
      if (r.name in counts) counts[r.name] = r.value;
      else if (r.name.startsWith('calc:')) { calculators[r.name.slice(5)] = r.value; counts.calculations += r.value; }
    }
    counts.calculations += counts.comparisons;   // one public number: a tax comparison is a calculation like any other
    const cf = await cfTotals(env, env.DB);        // Cloudflare's own figures, mirrored daily; null until the secrets are set
    // ?days=N: the last N days (IST), one row each, so a change can be seen in the day it happened
    const n = Math.min(365, Math.max(0, Math.round(+(request ? new URL(request.url).searchParams.get('days') : 0) || 0)));
    let days;
    if (n > 0) {
      const since = istDay(Date.now() - (n - 1) * 86400000);
      const rows = (await env.DB.prepare('SELECT day, name, value FROM counter_days WHERE day >= ? ORDER BY day').bind(since).all()).results || [];
      const by = new Map();
      for (const r of rows) {
        const d = by.get(r.day) || { day: r.day, calculations: 0 };
        if (r.name.startsWith('calc:')) d.calculations += r.value; else d[r.name] = r.value;
        if (r.name === 'comparisons') d.calculations += r.value;
        by.set(r.day, d);
      }
      days = [...by.values()];
    }
    return json({ available: true, counts, calculators, cf, ...(days ? { days } : {}) });
  } catch (e) {
    return json({ available: false, error: 'counter unavailable' });
  }
}

export async function onRequestPost({ request, env }) {
  let body; try { body = await request.json(); } catch { return json({ error: 'Invalid JSON body.' }, 400); }
  const name = counterName(body.event);
  if (!name) return json({ error: 'Unknown event.' }, 400);
  if (!env.DB) return json({ ok: false, available: false });
  try { await ensureSchema(env.DB); await bump(env.DB, name); return json({ ok: true }); } catch { return json({ ok: false }); }
}
