/**
 * POST /api/feedback  { name, email?, rating?, message, page, publicOk?, website (honeypot, must be empty) }
 * Stores the feedback in D1 (binding `DB`) when available and emails it to you via Brevo when configured.
 * Works with either one; returns 503 only if neither is set up.
 * GET  /api/feedback  -> { available, rating: { average, count }, items: [{ name, rating, message, page, ts }] }
 * The items are the ones you approved on /api/feedback-admin; names are first name plus an initial.
 */
import { json, EMAIL_RE, escapeHtml, ensureSchema, brevoConfigured, brevoSend, brevoUpsertContact, displayName } from '../_lib.js';

export async function onRequestPost({ request, env }) {
  let body;
  try { body = await request.json(); } catch { return json({ error: 'Invalid JSON body.' }, 400); }
  if (body.website) return json({ ok: true }); // honeypot filled: pretend success, store nothing

  const name = String(body.name || '').trim().slice(0, 80);
  const email = String(body.email || '').trim().slice(0, 120);
  const message = String(body.message || '').trim().slice(0, 2000);
  const rating = Number.isInteger(+body.rating) && +body.rating >= 1 && +body.rating <= 5 ? +body.rating : null;
  const page = String(body.page || '').slice(0, 200);
  const publicOk = body.publicOk === true || body.publicOk === 1 ? 1 : 0;
  if (!name) return json({ error: 'Please tell us your name.' }, 400);
  if (message.length < 3) return json({ error: 'Please write a little more.' }, 400);
  if (email && !EMAIL_RE.test(email)) return json({ error: 'That email address does not look right. Leave it blank if you prefer.' }, 400);

  const hasDb = !!env.DB, hasMail = brevoConfigured(env);
  if (!hasDb && !hasMail) return json({ error: 'Feedback is not configured on this deployment yet.' }, 503);

  let stored = false, mailed = false;
  if (hasDb) {
    try {
      await ensureSchema(env.DB);
      await env.DB.prepare('INSERT INTO feedback (ts, name, email, rating, message, page, ua, public_ok) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
        .bind(new Date().toISOString(), name, email || null, rating, message, page, (request.headers.get('user-agent') || '').slice(0, 200), publicOk).run();
      stored = true;
    } catch { stored = false; }
  }
  if (hasMail) {
    try {
      const html = `<p><strong>${escapeHtml(name)}</strong>${email ? ` &lt;${escapeHtml(email)}&gt;` : ' (no email given)'}${rating ? ` · rated ${rating}/5` : ''}</p>
<p style="white-space:pre-wrap;border-left:3px solid #14532d;padding-left:12px">${escapeHtml(message)}</p>
<p style="color:#777;font-size:12px">Page: ${escapeHtml(page || '-')}<br>${publicOk ? 'Happy for it to be shown on the site.' : 'Did not agree to it being shown on the site.'}<br>${stored ? 'Stored; approve it for the public wall at /api/feedback-admin.' : 'Not stored (no database binding).'}</p>`;
      await brevoSend(env, { toEmail: env.MAIL_FROM_EMAIL, toName: env.MAIL_FROM_NAME || 'TaxCompass', subject: `TaxCompass feedback from ${name}${rating ? ` (${rating}/5)` : ''}`, html, replyTo: email ? { email, name } : undefined });
      mailed = true;
      if (email) { try { await brevoUpsertContact(env, { name, email, source: 'taxcompass-feedback' }); } catch { /* optional */ } }
    } catch { mailed = false; }
  }
  if (!stored && !mailed) return json({ error: 'Could not save your feedback right now. Please try again later.' }, 502);
  return json({ ok: true, stored, mailed });
}

export async function onRequestGet({ env }) {
  if (!env.DB) return json({ available: false });
  try {
    await ensureSchema(env.DB);
    const [{ results: agg }, { results: rows }] = await Promise.all([
      env.DB.prepare('SELECT COUNT(rating) AS count, AVG(rating) AS average FROM feedback WHERE rating IS NOT NULL').all(),
      env.DB.prepare('SELECT name, rating, message, page, ts FROM feedback WHERE approved = 1 ORDER BY ts DESC LIMIT 60').all(),
    ]);
    const a = (agg && agg[0]) || {};
    const body = {
      available: true,
      rating: { count: +a.count || 0, average: a.average ? +(+a.average).toFixed(1) : null },
      items: (rows || []).map((r) => ({ name: displayName(r.name), rating: r.rating, message: r.message, page: r.page, ts: r.ts })),
    };
    return new Response(JSON.stringify(body), { headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'public, max-age=300' } });
  } catch { return json({ available: false }); }
}
