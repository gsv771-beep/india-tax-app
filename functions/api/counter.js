/**
 * GET  /api/counter                -> { available, counts: { visits, comparisons, workbooks } }
 * POST /api/counter { event }      -> increments one of: visit | compare | workbook
 * Backed by D1 (binding `DB`). Without the binding, GET reports available:false and POST is a no-op.
 */
import { json, ensureSchema, bump } from '../_lib.js';

const EVENTS = { visit: 'visits', compare: 'comparisons', workbook: 'workbooks' };

export async function onRequestGet({ env }) {
  if (!env.DB) return json({ available: false });
  try {
    await ensureSchema(env.DB);
    const { results } = await env.DB.prepare('SELECT name, value FROM counters').all();
    const counts = { visits: 0, comparisons: 0, workbooks: 0 };
    for (const r of results || []) if (r.name in counts) counts[r.name] = r.value;
    return json({ available: true, counts });
  } catch (e) {
    return json({ available: false, error: 'counter unavailable' });
  }
}

export async function onRequestPost({ request, env }) {
  let body; try { body = await request.json(); } catch { return json({ error: 'Invalid JSON body.' }, 400); }
  const name = EVENTS[body.event];
  if (!name) return json({ error: 'Unknown event.' }, 400);
  if (!env.DB) return json({ ok: false, available: false });
  try { await ensureSchema(env.DB); await bump(env.DB, name); return json({ ok: true }); } catch { return json({ ok: false }); }
}
