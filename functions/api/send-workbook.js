/**
 * Cloudflare Pages Function: POST /api/send-workbook
 * Emails the budget workbook (built in the browser) to the address the user typed, and saves
 * the person as a contact in your Brevo account so you can follow up for feedback.
 *
 * Provider: Brevo (free tier: 300 emails a day, unlimited contacts, single verified sender).
 *
 * Environment variables (Cloudflare Pages -> Settings -> Variables and Secrets):
 *   BREVO_API_KEY     required, mark as secret
 *   MAIL_FROM_EMAIL   required, a sender you have verified in Brevo
 *   MAIL_FROM_NAME    optional, default "TaxCompass India"
 *   BREVO_LIST_ID     optional, numeric id of a Brevo contact list to add people to
 *
 * Privacy: the user ticks a consent box saying their name and email may be kept and used to
 * contact them for feedback. Nothing else is stored; the workbook itself is not retained.
 */

const MAX_ATTACHMENT_BYTES = 1_500_000; // base64 length cap (~1.1 MB decoded)
const json = (obj, status = 200) => new Response(JSON.stringify(obj), { status, headers: { 'content-type': 'application/json; charset=utf-8' } });

export async function onRequestPost({ request, env }) {
  if (!env.BREVO_API_KEY || !env.MAIL_FROM_EMAIL) {
    return json({ error: 'Email is not configured on this deployment (BREVO_API_KEY / MAIL_FROM_EMAIL missing).' }, 503);
  }
  let body;
  try { body = await request.json(); } catch { return json({ error: 'Invalid JSON body.' }, 400); }

  const name = String(body.name || '').trim().slice(0, 80);
  const email = String(body.email || '').trim().slice(0, 120);
  const filename = String(body.filename || 'budget.xlsx').replace(/[^a-z0-9._-]/gi, '-').slice(0, 100) || 'budget.xlsx';
  const xlsxBase64 = String(body.xlsxBase64 || '');
  if (!name) return json({ error: 'Name is required.' }, 400);
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)) return json({ error: 'A valid email address is required.' }, 400);
  if (!xlsxBase64 || !/^[A-Za-z0-9+/=]+$/.test(xlsxBase64)) return json({ error: 'Workbook data is missing.' }, 400);
  if (xlsxBase64.length > MAX_ATTACHMENT_BYTES) return json({ error: 'Workbook is too large to email.' }, 413);
  if (!filename.endsWith('.xlsx')) return json({ error: 'Only .xlsx attachments are sent.' }, 400);

  const safeName = escapeHtml(name);
  const html = `<p>Hi ${safeName},</p>
<p>Your monthly budget workbook from TaxCompass India is attached. It contains your income and expense summary, expenses by category, and projections for your SIP and recurring deposit investments.</p>
<p>We may write to you once to ask what you thought of the app. Reply to this email if you would rather we did not.</p>
<p style="color:#555;font-size:13px">Projections are illustrative and not guaranteed. Mutual fund investments are subject to market risk. This is not tax, legal or investment advice; please consult your chartered accountant or a SEBI-registered investment adviser before acting.</p>`;

  try {
    await sendViaBrevo(env, { toName: name, toEmail: email, subject: 'Your TaxCompass budget workbook', html, filename, base64: xlsxBase64 });
  } catch (err) {
    return json({ error: err.message || 'The email provider rejected the message.' }, 502);
  }
  // Save the contact after the email succeeds. A failure here should not turn a delivered email into an error.
  let stored = false;
  try { await upsertBrevoContact(env, { name, email }); stored = true; } catch { stored = false; }
  return json({ ok: true, stored });
}

export function onRequestGet() {
  return json({ error: 'Use POST with {name, email, filename, xlsxBase64}.' }, 405);
}

const HEADERS = (env) => ({ 'api-key': env.BREVO_API_KEY, 'content-type': 'application/json', accept: 'application/json' });

async function sendViaBrevo(env, m) {
  const res = await fetch('https://api.brevo.com/v3/smtp/email', {
    method: 'POST',
    headers: HEADERS(env),
    body: JSON.stringify({
      sender: { name: env.MAIL_FROM_NAME || 'TaxCompass India', email: env.MAIL_FROM_EMAIL },
      to: [{ email: m.toEmail, name: m.toName }],
      subject: m.subject,
      htmlContent: m.html,
      attachment: [{ name: m.filename, content: m.base64 }],
    }),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`Email provider error ${res.status}${text ? ': ' + text.slice(0, 200) : ''}`);
  }
}

async function upsertBrevoContact(env, { name, email }) {
  const [first, ...rest] = name.split(/\s+/);
  const body = {
    email,
    attributes: { FIRSTNAME: first, LASTNAME: rest.join(' '), SOURCE: 'taxcompass-budget-workbook' },
    updateEnabled: true,
  };
  if (env.BREVO_LIST_ID) body.listIds = [Number(env.BREVO_LIST_ID)];
  const res = await fetch('https://api.brevo.com/v3/contacts', { method: 'POST', headers: HEADERS(env), body: JSON.stringify(body) });
  if (!res.ok && res.status !== 204) throw new Error(`Contact save failed (${res.status})`);
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
