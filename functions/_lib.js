/**
 * Shared helpers for the Pages Functions: JSON responses, D1 schema, Brevo calls.
 * Everything here works without the optional bindings; callers check availability.
 */

export const json = (obj, status = 200) => new Response(JSON.stringify(obj), { status, headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' } });

export const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

export function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

/** Create the tables on first use. Cheap to call every time. */
export async function ensureSchema(db) {
  await db.batch([
    db.prepare('CREATE TABLE IF NOT EXISTS counters (name TEXT PRIMARY KEY, value INTEGER NOT NULL DEFAULT 0)'),
    db.prepare('CREATE TABLE IF NOT EXISTS feedback (id INTEGER PRIMARY KEY AUTOINCREMENT, ts TEXT NOT NULL, name TEXT NOT NULL, email TEXT, rating INTEGER, message TEXT NOT NULL, page TEXT, ua TEXT)'),
  ]);
}

export async function bump(db, name) {
  await db.prepare('INSERT INTO counters (name, value) VALUES (?, 1) ON CONFLICT(name) DO UPDATE SET value = value + 1').bind(name).run();
}

export function brevoConfigured(env) {
  return !!(env.BREVO_API_KEY && env.MAIL_FROM_EMAIL);
}

export async function brevoSend(env, { toEmail, toName, subject, html, attachment, replyTo }) {
  const body = {
    sender: { name: env.MAIL_FROM_NAME || 'TaxCompass India', email: env.MAIL_FROM_EMAIL },
    to: [{ email: toEmail, name: toName || toEmail }],
    subject, htmlContent: html,
  };
  if (attachment) body.attachment = [attachment];
  if (replyTo) body.replyTo = replyTo;
  const res = await fetch('https://api.brevo.com/v3/smtp/email', {
    method: 'POST', headers: { 'api-key': env.BREVO_API_KEY, 'content-type': 'application/json', accept: 'application/json' }, body: JSON.stringify(body),
  });
  if (!res.ok) { const t = await res.text().catch(() => ''); throw new Error(`Email provider error ${res.status}${t ? ': ' + t.slice(0, 200) : ''}`); }
}

export async function brevoUpsertContact(env, { name, email, source }) {
  const [first, ...rest] = String(name || '').split(/\s+/);
  const body = { email, attributes: { FIRSTNAME: first || '', LASTNAME: rest.join(' '), SOURCE: source }, updateEnabled: true };
  if (env.BREVO_LIST_ID) body.listIds = [Number(env.BREVO_LIST_ID)];
  const res = await fetch('https://api.brevo.com/v3/contacts', { method: 'POST', headers: { 'api-key': env.BREVO_API_KEY, 'content-type': 'application/json', accept: 'application/json' }, body: JSON.stringify(body) });
  if (!res.ok && res.status !== 204) throw new Error(`Contact save failed (${res.status})`);
}
