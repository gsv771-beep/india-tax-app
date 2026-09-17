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
    db.prepare('CREATE TABLE IF NOT EXISTS feedback (id INTEGER PRIMARY KEY AUTOINCREMENT, ts TEXT NOT NULL, name TEXT NOT NULL, email TEXT, rating INTEGER, message TEXT NOT NULL, page TEXT, ua TEXT, public_ok INTEGER NOT NULL DEFAULT 0, approved INTEGER NOT NULL DEFAULT 0)'),
  ]);
  // Databases created before the public wall: add the two columns once. SQLite has no IF NOT EXISTS for columns.
  for (const col of ['public_ok', 'approved']) {
    try { await db.prepare(`ALTER TABLE feedback ADD COLUMN ${col} INTEGER NOT NULL DEFAULT 0`).run(); } catch { /* already there */ }
  }
}

/** First name plus the initial of the last: what the public wall shows. */
export function displayName(name) {
  const parts = String(name || '').trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return 'Anonymous';
  return parts.length === 1 ? parts[0] : `${parts[0]} ${parts[parts.length - 1][0].toUpperCase()}.`;
}

/** Constant-time-ish token check for the admin endpoint. */
export function adminAuthorised(request, env) {
  const want = String(env.FEEDBACK_ADMIN_TOKEN || '');
  if (want.length < 16) return false;
  const got = (request.headers.get('authorization') || '').replace(/^Bearer\s+/i, '');
  if (got.length !== want.length) return false;
  let diff = 0;
  for (let i = 0; i < want.length; i++) diff |= want.charCodeAt(i) ^ got.charCodeAt(i);
  return diff === 0;
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
