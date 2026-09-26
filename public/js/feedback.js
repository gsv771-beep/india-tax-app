/**
 * Floating feedback button and panel. Anonymous: a message and an optional 1 to 5 rating; a first name
 * only if someone wants it shown with their words. No email, nothing that identifies the sender.
 * Posts to /api/feedback. Also the tiny usage counter shown on the tax page and in the footer.
 */
import { el, setChildren } from './util.js';

export function initFeedback() {
  const name = el('input', { type: 'text', placeholder: 'Optional', maxlength: 40, autocomplete: 'given-name' });
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
    el('label', {}, ['How useful was this?', stars]),
    el('label', {}, ['Your feedback', message]),
    el('label', {}, ['First name, if you want it shown with your words', name]),
    honey,
    el('label', { class: 'check' }, [publicOk, 'You may show this on the site']),
    el('p', { class: 'muted small' }, 'Anonymous: we keep your message, the rating and the page you were on, nothing else. Nothing is shown publicly unless you tick the box above.'),
    el('div', { class: 'btn-row' }, [send]),
    status,
  ]);
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    send.disabled = true; status.textContent = 'Sending…';
    try {
      const res = await fetch('/api/feedback', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name: name.value.trim(), rating, message: message.value.trim(), page: location.pathname, publicOk: publicOk.checked, website: honey.value }) });
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
  toggle.addEventListener('click', () => { panel.hidden = !panel.hidden; toggle.setAttribute('aria-expanded', String(!panel.hidden)); if (!panel.hidden) message.focus(); });
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
let counts = null;
const n = (x) => (x || 0).toLocaleString('en-IN');
/** The latest counts, once fetched: { counts: { visits, comparisons, workbooks, calculations }, calculators: { emi: n } } */
export function getCounts() { return counts; }
export async function initCounter() {
  countEvent('visit');
  try {
    const res = await fetch('/api/counter');
    const data = await res.json();
    if (!data.available) return;
    counts = data;
    const c = data.counts;
    // Two public numbers: reach (Cloudflare's request count since launch when the mirror is on, else our own
    // visit count) and calculations (the tax comparison counts as one of them).
    const reach = data.cf && data.cf.requests > 0 ? `${n(data.cf.requests)} requests served since ${new Date(data.cf.since).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })}` : `${n(c.visits)} visits so far`;
    const calcs = `${n(c.calculations)} calculations run so far`;
    document.querySelectorAll('[data-counter], [data-counter-calcs]').forEach((node) => { node.textContent = c.calculations >= 20 ? calcs : reach; node.hidden = false; });
    document.querySelectorAll('[data-counter-all]').forEach((node) => { node.textContent = c.calculations >= 20 ? `${reach} · ${n(c.calculations)} calculations` : reach; node.hidden = false; });
    window.dispatchEvent(new CustomEvent('counts', { detail: data }));
  } catch { /* counter is decorative */ }
}
