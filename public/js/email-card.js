/**
 * The "get this as an Excel workbook" card, shared by the tax page, the calculators, the budget and
 * the profile. Download is the first choice and asks for nothing: the file is built in the browser and
 * saved straight away. Emailing it to yourself (name, address and consent) stays one click further in.
 * opts: { title, intro, source, buildBase64: async (name) => string, fileName: (name) => string,
 *         sheetNames?: () => string[], buttonLabel?, downloadLabel? }
 */
import { el } from './util.js';

const PERSON_KEY = 'taxcompass.person.v1';

function loadPerson() {
  try { return JSON.parse(localStorage.getItem(PERSON_KEY) || 'null') || { name: '', email: '' }; } catch { return { name: '', email: '' }; }
}
function savePerson(p) { try { localStorage.setItem(PERSON_KEY, JSON.stringify(p)); } catch {} }

const MIME = { json: 'application/json', xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' };
/** Save base64 content as a file, without a round trip to any server. */
export function downloadBase64(base64, fileName) {
  const bin = atob(base64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  const ext = (/\.([a-z0-9]+)$/i.exec(fileName) || [])[1] || 'xlsx';
  const url = URL.createObjectURL(new Blob([bytes], { type: MIME[ext.toLowerCase()] || 'application/octet-stream' }));
  const a = el('a', { href: url, download: fileName, hidden: true });
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

const count = () => fetch('/api/counter', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ event: 'workbook' }) }).catch(() => {});

export function emailWorkbookCard(opts) {
  const person = loadPerson();
  const isProfile = opts.source === 'profile';
  const status = el('p', { class: 'muted', style: 'margin:8px 0 0', role: 'status' });

  // ---- download: one click ----
  const download = el('button', { type: 'button', class: 'btn' }, opts.downloadLabel || (isProfile ? 'Download my profile' : 'Download Excel'));
  download.addEventListener('click', async () => {
    download.disabled = true;
    try {
      status.textContent = 'Preparing the file…';
      const who = loadPerson().name || '';
      const base64 = await opts.buildBase64(who);
      downloadBase64(base64, opts.fileName(who));
      status.textContent = isProfile ? 'Saved. To use it on another device, open Your profile there and choose Restore from file.' : 'Saved to your downloads.';
      count();
    } catch (e) {
      status.textContent = e.message;
    } finally { download.disabled = false; }
  });

  // ---- email: optional, folded ----
  const name = el('input', { type: 'text', placeholder: 'Your name', maxlength: 80, autocomplete: 'name', value: person.name });
  const email = el('input', { type: 'email', placeholder: 'you@example.com', maxlength: 120, autocomplete: 'email', value: person.email });
  const consent = el('input', { type: 'checkbox' });
  const persist = () => savePerson({ name: name.value.trim(), email: email.value.trim() });
  name.addEventListener('input', persist); email.addEventListener('input', persist);
  const send = el('button', { type: 'button', class: 'btn secondary' }, opts.buttonLabel || 'Email me the Excel workbook');
  send.addEventListener('click', async () => {
    const who = name.value.trim(), to = email.value.trim();
    if (!who) { status.textContent = 'Please enter your name.'; name.focus(); return; }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(to)) { status.textContent = 'Please enter a valid email address.'; email.focus(); return; }
    if (!consent.checked) { status.textContent = 'Please tick the consent box so we can email you.'; return; }
    send.disabled = true;
    try {
      status.textContent = 'Preparing and sending…';
      const base64 = await opts.buildBase64(who);
      const res = await fetch('/api/send-workbook', {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ name: who, email: to, filename: opts.fileName(who), xlsxBase64: base64, source: opts.source, sheets: opts.sheetNames ? opts.sheetNames() : undefined }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || `Could not send (${res.status})`);
      status.textContent = `Sent to ${to}. Check your spam folder if it does not arrive in a few minutes.`;
      count();
    } catch (e) {
      status.textContent = /not configured|503/.test(e.message) ? 'Emailing is not switched on for this deployment yet. Download the file instead.' : e.message;
    } finally { send.disabled = false; }
  });

  return el('div', { class: 'card export' }, [
    el('h3', { style: 'margin-top:0' }, opts.title),
    el('p', { class: 'muted' }, opts.intro),
    el('div', { class: 'btn-row' }, [download]),
    el('details', { class: 'export-email' }, [
      el('summary', {}, isProfile ? 'Or email it to yourself' : 'Or email it to yourself, or to your CA'),
      el('div', { class: 'two' }, [el('label', {}, ['Name', name]), el('label', {}, ['Email', email])]),
      el('label', { class: 'check' }, [consent, `Email me this ${isProfile ? 'file' : 'workbook'}. I agree that TaxCompass may keep my name and email and contact me for feedback about the app. No third-party marketing.`]),
      el('div', { class: 'btn-row' }, [send]),
    ]),
    status,
  ]);
}
