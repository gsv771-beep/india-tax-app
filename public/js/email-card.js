/**
 * The "email me this as an Excel workbook" card, shared by the budget and tax pages.
 * opts: { title, intro, source, buildBase64: async (name) => string, fileName: (name) => string, sheetNames?: () => string[] }
 */
import { el } from './util.js';

const PERSON_KEY = 'taxcompass.person.v1';

function loadPerson() {
  try { return JSON.parse(localStorage.getItem(PERSON_KEY) || 'null') || { name: '', email: '' }; } catch { return { name: '', email: '' }; }
}
function savePerson(p) { try { localStorage.setItem(PERSON_KEY, JSON.stringify(p)); } catch {} }

export function emailWorkbookCard(opts) {
  const person = loadPerson();
  const name = el('input', { type: 'text', placeholder: 'Your name', maxlength: 80, autocomplete: 'name', value: person.name });
  const email = el('input', { type: 'email', placeholder: 'you@example.com', maxlength: 120, autocomplete: 'email', value: person.email });
  const consent = el('input', { type: 'checkbox' });
  const status = el('p', { class: 'muted', style: 'margin:8px 0 0' });
  const persist = () => savePerson({ name: name.value.trim(), email: email.value.trim() });
  name.addEventListener('input', persist); email.addEventListener('input', persist);

  const send = el('button', { type: 'button', class: 'btn' }, opts.buttonLabel || 'Email me the Excel workbook');
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
      fetch('/api/counter', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ event: 'workbook' }) }).catch(() => {});
    } catch (e) {
      status.textContent = /not configured|503/.test(e.message) ? 'Emailing is not switched on for this deployment yet. Please try again later.' : e.message;
    } finally { send.disabled = false; }
  });

  return el('div', { class: 'card export' }, [
    el('h3', { style: 'margin-top:0' }, opts.title),
    el('p', { class: 'muted' }, opts.intro),
    el('div', { class: 'two' }, [el('label', {}, ['Name', name]), el('label', {}, ['Email', email])]),
    el('label', { class: 'check' }, [consent, `Email me this ${opts.source === 'profile' ? 'file' : 'workbook'}. I agree that TaxCompass may keep my name and email and contact me for feedback about the app. No third-party marketing.`]),
    el('div', { class: 'btn-row' }, [send]),
    status,
  ]);
}
