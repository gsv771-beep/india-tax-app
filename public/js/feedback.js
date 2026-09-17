/**
 * Floating feedback button and panel. Name and message required; email optional; a 1 to 5 rating.
 * Posts to /api/feedback. Also the tiny usage counter shown on the tax page and in the footer.
 */
import { el, setChildren } from './util.js';

export function initFeedback() {
  const name = el('input', { type: 'text', placeholder: 'Your name', maxlength: 80, autocomplete: 'name', required: true });
  const email = el('input', { type: 'email', placeholder: 'Email (optional, only if you want a reply)', maxlength: 120, autocomplete: 'email' });
  const message = el('textarea', { rows: 4, maxlength: 2000, placeholder: 'What worked, what did not, what is wrong or missing?', required: true });
  const honey = el('input', { type: 'text', name: 'website', tabindex: -1, autocomplete: 'off', style: 'position:absolute;left:-9999px;width:1px;height:1px;opacity:0' });
  const publicOk = el('input', { type: 'checkbox' });
  const status = el('p', { class: 'muted small', style: 'margin:6px 0 0' });
  let rating = 0;
  const stars = el('div', { class: 'stars', role: 'radiogroup', 'aria-label': 'Rating' });
  const drawStars = () => setChildren(stars, [1, 2, 3, 4, 5].map((n) => el('button', { type: 'button', class: n <= rating ? 'on' : '', role: 'radio', 'aria-checked': String(n === rating), 'aria-label': `${n} out of 5`, onclick: () => { rating = n; drawStars(); } }, '★')));
  drawStars();

  const send = el('button', { type: 'submit', class: 'btn' }, 'Send feedback');
  const form = el('form', { class: 'fb-form' }, [
    el('label', {}, ['Name', name]),
    el('label', {}, ['Email', email]),
    el('label', {}, ['How useful was this?', stars]),
    el('label', {}, ['Your feedback', message]),
    honey,
    el('label', { class: 'check' }, [publicOk, 'You may show this on the site, with my first name']),
    el('p', { class: 'muted small' }, 'We keep your name and message to improve the site. Your email is kept only if you give it, and only to reply. Nothing is shown publicly unless you tick the box above.'),
    el('div', { class: 'btn-row' }, [send]),
    status,
  ]);
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    send.disabled = true; status.textContent = 'Sending…';
    try {
      const res = await fetch('/api/feedback', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name: name.value.trim(), email: email.value.trim(), rating, message: message.value.trim(), page: location.pathname, publicOk: publicOk.checked, website: honey.value }) });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || `Could not send (${res.status})`);
      status.textContent = 'Thank you. Your feedback has been received.';
      message.value = ''; rating = 0; publicOk.checked = false; drawStars();
      setTimeout(() => { panel.hidden = true; status.textContent = ''; }, 1800);
    } catch (err) {
      status.textContent = /not configured|503/.test(err.message) ? 'Feedback is not switched on for this deployment yet.' : err.message;
    } finally { send.disabled = false; }
  });

  const close = el('button', { type: 'button', class: 'icon-btn fb-close', 'aria-label': 'Close' }, '×');
  const panel = el('div', { class: 'fb-panel card', hidden: true, role: 'dialog', 'aria-label': 'Send feedback' }, [
    el('div', { class: 'fb-head' }, [el('h3', { style: 'margin:0' }, 'Tell us what you think'), close]),
    form,
  ]);
  const toggle = el('button', { type: 'button', class: 'fb-toggle', 'aria-expanded': 'false' }, 'Feedback');
  toggle.addEventListener('click', () => { panel.hidden = !panel.hidden; toggle.setAttribute('aria-expanded', String(!panel.hidden)); if (!panel.hidden) name.focus(); });
  close.addEventListener('click', () => { panel.hidden = true; toggle.setAttribute('aria-expanded', 'false'); });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !panel.hidden) { panel.hidden = true; toggle.setAttribute('aria-expanded', 'false'); } });
  document.body.append(el('div', { class: 'fb' }, [panel, toggle]));
}

// ---------- usage counter ----------
const SESSION = 'taxcompass.session.v1';
function once(flag) {
  try { const s = JSON.parse(sessionStorage.getItem(SESSION) || '{}'); if (s[flag]) return false; s[flag] = 1; sessionStorage.setItem(SESSION, JSON.stringify(s)); return true; } catch { return true; }
}
export function countEvent(event) {
  if (!once(event)) return;
  fetch('/api/counter', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ event }), keepalive: true }).catch(() => {});
}
export async function initCounter() {
  countEvent('visit');
  try {
    const res = await fetch('/api/counter');
    const data = await res.json();
    if (!data.available) return;
    const n = data.counts.comparisons || 0;
    const v = data.counts.visits || 0;
    document.querySelectorAll('[data-counter]').forEach((node) => {
      node.textContent = n >= 20 ? `${n.toLocaleString('en-IN')} comparisons run so far` : `${v.toLocaleString('en-IN')} visits so far`;
      node.hidden = false;
    });
  } catch { /* counter is decorative */ }
}
