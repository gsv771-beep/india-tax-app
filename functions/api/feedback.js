/**
 * POST /api/feedback  { name, email?, rating?, message, page, website (honeypot, must be empty) }
 * Stores the feedback in D1 (binding `DB`) when available and emails it to you via Brevo when configured.
 * Works with either one; returns 503 only if neither is set up.
 */
import { json, EMAIL_RE, escapeHtml, ensureSchema, brevoConfigured, brevoSend, brevoUpsertContact } from '../_lib.js';

export async function onRequestPost({ request, env }) {
  let body;
  try { body = await request.json(); } catch { return json({ error: 'Invalid JSON body.' }, 400); }
  if (body.website) return json({ ok: true }); // honeypot filled: pretend success, store nothing

  const name = String(body.name || '').trim().slice(0, 80);
  const email = String(body.email || '').trim().slice(0, 120);
  const message = String(body.message || '').trim().slice(0, 2000);
  const rating = Number.isInteger(+body.rating) && +body.rating >= 1 && +body.rating <= 5 ? +body.rating : null;
  const page = String(body.page || '').slice(0, 200);
  if (!name) return json({ error: 'Please tell us your name.' }, 400);
  if (message.length < 3) return json({ error: 'Please write a little more.' }, 400);
  if (email && !EMAIL_RE.test(email)) return json({ error: 'That email address does not look right. Leave it blank if you prefer.' }, 400);

  const hasDb = !!env.DB, hasMail = brevoConfigured(env);
  if (!hasDb && !hasMail) return json({ error: 'Feedback is not configured on this deployment yet.' }, 503);

  let stored = false, mailed = false;
  if (hasDb) {
    try {
      await ensureSchema(env.DB);
      await env.DB.prepare('INSERT INTO feedback (ts, name, email, rating, message, page, ua) VALUES (?, ?, ?, ?, ?, ?, ?)')
        .bind(new Date().toISOString(), name, email || null, rating, message, page, (request.headers.get('user-agent') || '').slice(0, 200)).run();
      stored = true;
    } catch { stored = false; }
  }
  if (hasMail) {
    try {
      const html = `<p><strong>${escapeHtml(name)}</strong>${email ? ` &lt;${escapeHtml(email)}&gt;` : ' (no email given)'}${rating ? ` · rated ${rating}/5` : ''}</p>
<p style="white-space:pre-wrap;border-left:3px solid #14532d;padding-left:12px">${escapeHtml(message)}</p>
<p style="color:#777;font-size:12px">Page: ${escapeHtml(page || '-')}<br>${stored ? 'Also stored in the D1 feedback table.' : 'Not stored (no database binding).'}</p>`;
      await brevoSend(env, { toEmail: env.MAIL_FROM_EMAIL, toName: env.MAIL_FROM_NAME || 'TaxCompass', subject: `TaxCompass feedback from ${name}${rating ? ` (${rating}/5)` : ''}`, html, replyTo: email ? { email, name } : undefined });
      mailed = true;
      if (email) { try { await brevoUpsertContact(env, { name, email, source: 'taxcompass-feedback' }); } catch { /* optional */ } }
    } catch { mailed = false; }
  }
  if (!stored && !mailed) return json({ error: 'Could not save your feedback right now. Please try again later.' }, 502);
  return json({ ok: true, stored, mailed });
}

export function onRequestGet() {
  return json({ error: 'Use POST.' }, 405);
}
