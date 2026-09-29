/**
 * Ask TaxCompass: the chat panel. Every answer comes from engine/ask.js on this page (a glossary
 * definition, or the calculator that answers the question with any amount filled in); nothing typed
 * here is sent anywhere or kept after the page closes. It sits beside the Feedback button.
 */
import { el, setChildren } from './util.js';
import { ask, SUGGESTIONS } from '../engine/ask.js';
import { countEvent } from './feedback.js';

export function initAsk({ glossary }) {
  const corner = document.querySelector('.fb');
  if (!corner) return;
  const fbPanel = corner.querySelector('.fb-panel');
  const fbToggle = corner.querySelector('.fb-toggle');

  const log = el('div', { class: 'ask-log', 'aria-live': 'polite' });
  const input = el('input', { type: 'text', maxlength: 200, placeholder: 'e.g. My CTC is 25 lakh. Old or new regime?', 'aria-label': 'Your question', autocomplete: 'off' });
  const send = el('button', { type: 'submit', class: 'btn' }, 'Ask');
  const form = el('form', { class: 'ask-form' }, [input, send]);
  const close = el('button', { type: 'button', class: 'icon-btn fb-close', 'aria-label': 'Close' }, '×');
  const panel = el('div', { class: 'fb-panel ask-panel card', hidden: true, role: 'dialog', 'aria-label': 'Ask TaxCompass' }, [
    el('div', { class: 'fb-head' }, [el('h3', { style: 'margin:0' }, 'Ask TaxCompass'), close]),
    el('p', { class: 'muted small ask-intro' }, 'Explains tax and money terms, and points you to the calculator that answers your question. It runs on this page: nothing you type is sent anywhere.'),
    log,
    form,
  ]);
  const toggle = el('button', { type: 'button', class: 'fb-toggle ask-toggle', 'aria-expanded': 'false' }, 'Ask');

  const bubble = (who, children) => el('div', { class: `ask-msg ask-${who}` }, children);
  const chips = () => el('div', { class: 'ask-chips' }, SUGGESTIONS.map((s) => el('button', { type: 'button', onclick: () => submit(s) }, s)));
  const answerNode = (r) => bubble('bot', [
    r.term ? el('strong', {}, r.term) : null,
    el('p', {}, r.text),
    r.links.length ? el('div', { class: 'ask-links' }, r.links.map((l) => el('a', {
      href: l.href, class: l.primary ? 'btn small-btn' : 'ask-link',
      ...(l.external ? { target: '_blank', rel: 'noopener' } : {}),
      onclick: () => { if (!l.external) setOpen(false); },
    }, l.label + (l.external ? ' ↗' : ' →')))) : null,
  ]);
  const greet = () => setChildren(log, [bubble('bot', [el('p', {}, 'Ask what a term means, or what you want to work out. For example:'), chips()])]);

  function submit(text) {
    const q = String(text || '').trim();
    if (!q) return;
    countEvent('ask');   // one anonymous tick per visit; the question itself never leaves the page
    log.append(bubble('you', [el('p', {}, q)]), answerNode(ask(q, { glossary })));
    input.value = '';
    // keep the conversation short: the latest six exchanges
    while (log.children.length > 13) log.children[1].remove();
    log.scrollTop = log.scrollHeight;
  }
  form.addEventListener('submit', (e) => { e.preventDefault(); submit(input.value); });

  function setOpen(v) {
    panel.hidden = !v;
    toggle.setAttribute('aria-expanded', String(v));
    if (v) {
      if (fbPanel) { fbPanel.hidden = true; fbToggle?.setAttribute('aria-expanded', 'false'); }
      if (!log.children.length) greet();
      setTimeout(() => input.focus(), 0);
    }
  }
  toggle.addEventListener('click', () => setOpen(panel.hidden));
  close.addEventListener('click', () => setOpen(false));
  fbToggle?.addEventListener('click', () => setOpen(false));
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !panel.hidden) setOpen(false); });

  corner.prepend(panel);
  corner.querySelector('.fb-row').prepend(toggle);
}
