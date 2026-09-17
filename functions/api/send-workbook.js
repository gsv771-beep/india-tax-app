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

const SOURCES = {
  tax: { subject: 'Your TaxCompass tax regime comparison', what: 'tax regime comparison' },
  budget: { subject: 'Your TaxCompass budget workbook', what: 'monthly budget workbook' },
  salary: { subject: 'Your TaxCompass in-hand salary workbook', what: 'in-hand salary breakdown' },
  emi: { subject: 'Your TaxCompass loan plan', what: 'EMI and prepayment plan' },
  sip: { subject: 'Your TaxCompass SIP projection', what: 'SIP projection' },
  goal: { subject: 'Your TaxCompass goal plan', what: 'goal plan' },
  capgains: { subject: 'Your TaxCompass capital gains working', what: 'capital gains working' },
  home: { subject: 'Your TaxCompass home-buying plan', what: 'home-buying cost and loan plan' },
  profile: { subject: 'Your TaxCompass profile', what: 'profile file', json: true },
};

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
  const source = SOURCES[body.source] ? body.source : 'budget';
  const sheetNames = Array.isArray(body.sheets) ? body.sheets.slice(0, 8).map((x) => String(x).slice(0, 40)).filter(Boolean) : [];
  if (!name) return json({ error: 'Name is required.' }, 400);
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)) return json({ error: 'A valid email address is required.' }, 400);
  if (!xlsxBase64 || !/^[A-Za-z0-9+/=]+$/.test(xlsxBase64)) return json({ error: 'Workbook data is missing.' }, 400);
  if (xlsxBase64.length > MAX_ATTACHMENT_BYTES) return json({ error: 'Workbook is too large to email.' }, 413);
  if (SOURCES[source].json ? !filename.endsWith('.json') : !filename.endsWith('.xlsx')) return json({ error: SOURCES[source].json ? 'The profile is sent as a .json file.' : 'Only .xlsx attachments are sent.' }, 400);

  const safeName = escapeHtml(name);
  const site = new URL(request.url).origin;
  const html = `<!doctype html><html><body style="margin:0;padding:0;background:#f4f6f3;font-family:Segoe UI,Roboto,Helvetica,Arial,sans-serif;color:#1c2321">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f4f6f3;padding:24px 0"><tr><td align="center">
<table role="presentation" width="560" cellpadding="0" cellspacing="0" style="max-width:560px;width:100%;background:#ffffff;border-radius:12px;overflow:hidden;border:1px solid #e3e8e0">
<tr><td style="background:#14532d;padding:18px 24px;color:#ffffff;font-size:18px;font-weight:700">&#8377; TaxCompass <span style="opacity:.8;font-weight:500">India</span></td></tr>
<tr><td style="padding:24px">
<p style="margin:0 0 12px;font-size:16px">Hi ${safeName},</p>
${source === 'profile' ? `<p style="margin:0 0 12px;line-height:1.5">Your TaxCompass profile is attached: the figures you entered and every calculator’s inputs, as one small file. To use it on another device, open <a href="${site}" style="color:#1d6b3d">${site.replace(/^https?:\/\//, '')}</a>, expand <strong>Your profile</strong> and choose <strong>Restore from file</strong>. Keep the file to yourself; it holds your financial figures.</p>` : source !== 'tax' && source !== 'budget' ? `<p style="margin:0 0 12px;line-height:1.5">Your ${SOURCES[source].what} is attached${sheetNames.length ? ` with these sheets: ${sheetNames.map(escapeHtml).join(', ')}` : ''}. The Inputs sheet lists every figure you entered and the Notes sheet the assumptions behind the numbers.</p>` : source === 'tax' ? `<p style="margin:0 0 12px;line-height:1.5">Your tax regime comparison is attached. It has four sheets:</p>
<ul style="margin:0 0 16px 18px;padding:0;line-height:1.6">
<li><strong>Comparison</strong>: old regime and new regime, line by line, with the total tax under each</li>
<li><strong>Break-even</strong>: how far the result is from flipping, and the unused deductions that could change it</li>
<li><strong>Inputs</strong>: every figure you entered, so your CA can check them</li>
<li><strong>Notes</strong>: the assumptions behind the numbers</li>
</ul>` : `<p style="margin:0 0 12px;line-height:1.5">Your monthly budget workbook is attached. It has four sheets:</p>
<ul style="margin:0 0 16px 18px;padding:0;line-height:1.6">
<li><strong>Summary</strong>: income, expenses, investments, what is left, and your expenses by category, with charts</li>
<li><strong>Expenses</strong>: every line you entered</li>
<li><strong>Investments</strong>: your SIPs and recurring deposits with projected values</li>
<li><strong>Notes</strong>: the assumptions behind the numbers</li>
</ul>`}
<p style="margin:0 0 16px;line-height:1.5">You can come back to <a href="${site}" style="color:#1d6b3d">${site.replace(/^https?:\/\//, '')}</a> any time; your entries are saved in your browser.</p>
<p style="margin:0 0 16px;line-height:1.5;color:#5c6763;font-size:13px">We may write to you once to ask what you thought of the app. Reply to this email if you would rather we did not.</p>
<p style="margin:0 0 16px;line-height:1.5">Gaurav, who builds TaxCompass &middot; <a href="https://www.linkedin.com/in/gauravsv/" style="color:#1d6b3d">LinkedIn</a></p>
<p style="margin:0;padding-top:12px;border-top:1px solid #e3e8e0;color:#5c6763;font-size:12px;line-height:1.5">Projections are illustrative and not guaranteed. Mutual fund investments are subject to market risk. This is not tax, legal or investment advice; please consult your chartered accountant or a SEBI-registered investment adviser before acting.</p>
</td></tr></table></td></tr></table></body></html>`;

  try {
    await sendViaBrevo(env, { toName: name, toEmail: email, subject: SOURCES[source].subject, html, filename, base64: xlsxBase64 });
  } catch (err) {
    return json({ error: err.message || 'The email provider rejected the message.' }, 502);
  }
  // Save the contact after the email succeeds. A failure here should not turn a delivered email into an error.
  let stored = false;
  try { await upsertBrevoContact(env, { name, email, source }); stored = true; } catch { stored = false; }
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

async function upsertBrevoContact(env, { name, email, source }) {
  const [first, ...rest] = name.split(/\s+/);
  const body = {
    email,
    attributes: { FIRSTNAME: first, LASTNAME: rest.join(' '), SOURCE: `taxcompass-${source}-workbook` },
    updateEnabled: true,
  };
  if (env.BREVO_LIST_ID) body.listIds = [Number(env.BREVO_LIST_ID)];
  const res = await fetch('https://api.brevo.com/v3/contacts', { method: 'POST', headers: HEADERS(env), body: JSON.stringify(body) });
  if (!res.ok && res.status !== 204) throw new Error(`Contact save failed (${res.status})`);
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
