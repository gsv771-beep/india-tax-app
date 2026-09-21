/**
 * GET  /api/counter                -> { available, counts: { visits, comparisons, workbooks, calculations (comparisons included) }, calculators: { emi: n, ... } }
 * POST /api/counter { event }      -> increments one of: visit | compare | workbook | calc:<calculator>
 * Backed by D1 (binding `DB`). Without the binding, GET reports available:false and POST is a no-op.
 */
import { json, ensureSchema, bump } from '../_lib.js';

const EVENTS = { visit: 'visits', compare: 'comparisons', workbook: 'workbooks' };
const CALCS = ['salary', 'budget', 'emi', 'sip', 'home', 'compare', 'capital-gains', 'retirement', 'goal'];
const counterName = (event) => EVENTS[event] || (typeof event === 'string' && event.startsWith('calc:') && CALCS.includes(event.slice(5)) ? event : null);

export async function onRequestGet({ env }) {
  if (!env.DB) return json({ available: false });
  try {
    await ensureSchema(env.DB);
    const { results } = await env.DB.prepare('SELECT name, value FROM counters').all();
    const counts = { visits: 0, comparisons: 0, workbooks: 0, calculations: 0 };
    const calculators = {};
    for (const r of results || []) {
      if (r.name in counts) counts[r.name] = r.value;
      else if (r.name.startsWith('calc:')) { calculators[r.name.slice(5)] = r.value; counts.calculations += r.value; }
    }
    counts.calculations += counts.comparisons;   // one public number: a tax comparison is a calculation like any other
    return json({ available: true, counts, calculators });
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
