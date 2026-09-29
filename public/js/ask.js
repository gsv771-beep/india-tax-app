/**
 * Ask TaxCompass: the chat panel and its mascot. Every answer comes from engine/ask.js on this page
 * (a glossary definition, or the calculator that answers the question with any amount filled in);
 * nothing typed here is sent anywhere or kept after the page closes.
 *
 * The mascot is a small compass with a face. Once a visit it offers a "Did you know?" worked example
 * from engine/tips.js; its link opens the calculator with the example's figures filled in.
 */
import { el, setChildren } from './util.js';
import { ask, SUGGESTIONS } from '../engine/ask.js';
import { tips } from '../engine/tips.js';
import { setHandoff } from './handoff.js';
import { countEvent, isPhone, syncCorner } from './feedback.js';

const TIP_INDEX = 'taxcompass.tip.v1';     // localStorage: which example comes next, across visits
const TIP_SEEN = 'taxcompass.tip-seen.v1'; // sessionStorage: the bubble has been shown this visit
const SVG = 'http://www.w3.org/2000/svg';

/** The mascot: a compass face whose needle is its nose. Animated in CSS, still under reduced motion. */
function mascot() {
  const s = (tag, attrs) => { const n = document.createElementNS(SVG, tag); for (const [k, v] of Object.entries(attrs)) n.setAttribute(k, v); return n; };
  const svg = s('svg', { viewBox: '0 0 64 64', class: 'mascot', 'aria-hidden': 'true', focusable: 'false' });
  svg.append(
    s('circle', { cx: 32, cy: 32, r: 30, class: 'm-rim' }),
    s('circle', { cx: 32, cy: 32, r: 24.5, class: 'm-face' }),
    ...[[32, 9.5, 32, 13], [54.5, 32, 51, 32], [32, 54.5, 32, 51], [9.5, 32, 13, 32]].map(([x1, y1, x2, y2]) => s('line', { x1, y1, x2, y2, class: 'm-tick' })),
    s('text', { x: 32, y: 21, class: 'm-n' }),
  );
  svg.lastChild.textContent = 'N';
  const eyes = s('g', { class: 'm-eyes' });
  eyes.append(s('ellipse', { cx: 24, cy: 30, rx: 2.6, ry: 3.2 }), s('ellipse', { cx: 40, cy: 30, rx: 2.6, ry: 3.2 }));
  const needle = s('g', { class: 'm-needle' });
  needle.append(s('path', { d: 'M32 29.5 L34.6 36 L32 37.2 L29.4 36 Z', class: 'm-needle-n' }), s('path', { d: 'M32 42.5 L34.6 36 L32 37.2 L29.4 36 Z', class: 'm-needle-s' }));
  svg.append(eyes, needle, s('path', { d: 'M25 44.5 Q32 49.5 39 44.5', class: 'm-smile' }), s('circle', { cx: 19.5, cy: 37, r: 2.4, class: 'm-cheek' }), s('circle', { cx: 44.5, cy: 37, r: 2.4, class: 'm-cheek' }));
  return svg;
}

function nextTip(list) {
  let i = 0;
  try { i = (+localStorage.getItem(TIP_INDEX) || 0) % list.length; localStorage.setItem(TIP_INDEX, String((i + 1) % list.length)); } catch {}
  return list[i];
}
const seenThisVisit = () => { try { return sessionStorage.getItem(TIP_SEEN) === '1'; } catch { return false; } };
const markSeen = () => { try { sessionStorage.setItem(TIP_SEEN, '1'); } catch {} };
const OPENED = 'taxcompass.ask-opened.v1';  // localStorage: this browser has opened Ask at least once
const everOpened = () => { try { return localStorage.getItem(OPENED) === '1'; } catch { return false; } };
const markOpened = () => { try { localStorage.setItem(OPENED, '1'); } catch {} };

export function initAsk({ glossary, rates }) {
  const corner = document.querySelector('.fb');
  if (!corner) return;
  const fbPanel = corner.querySelector('.fb-panel');
  const fbToggle = corner.querySelector('.fb-feedback');

  let tipList = [];
  try { tipList = rates ? tips(rates) : []; } catch (e) { console.error(e); }
  let tip = tipList.length ? nextTip(tipList) : null;

  const log = el('div', { class: 'ask-log', 'aria-live': 'polite' });
  const input = el('input', { type: 'text', maxlength: 200, placeholder: 'e.g. My CTC is 25 lakh. Old or new regime?', 'aria-label': 'Your question', autocomplete: 'off' });
  const send = el('button', { type: 'submit', class: 'btn' }, 'Ask');
  const form = el('form', { class: 'ask-form' }, [input, send]);
  const close = el('button', { type: 'button', class: 'icon-btn fb-close', 'aria-label': 'Close' }, '×');
  const panel = el('div', { class: 'fb-panel ask-panel card', hidden: true, role: 'dialog', 'aria-label': 'Ask TaxCompass' }, [
    el('div', { class: 'fb-head' }, [el('div', { class: 'ask-title' }, [mascot(), el('h3', { style: 'margin:0' }, 'Ask TaxCompass')]), close]),
    el('p', { class: 'muted small ask-intro' }, 'Explains tax and money terms, and points you to the calculator that answers your question. It runs on this page: nothing you type is sent anywhere.'),
    log,
    form,
  ]);
  // Labelled until someone has opened it once; after that, on a phone, the mascot alone is enough.
  const toggle = el('button', { type: 'button', class: `fb-toggle ask-toggle${everOpened() ? '' : ' ask-labelled'}`, 'aria-expanded': 'false', 'aria-label': 'Ask TaxCompass' }, [
    mascot(),
    el('span', { class: 'ask-toggle-label', 'aria-hidden': 'true' }, [el('small', {}, 'Need help?'), el('span', {}, 'Ask TaxCompass')]),
  ]);

  // a worked example: a hook, one sentence, and a link that opens the calculator with its figures
  const tipLink = (t, onGo) => el('a', {
    href: t.href, class: 'btn small-btn',
    onclick: () => { if (t.handoff) setHandoff(t.handoff.to, t.handoff.values, 'tip'); countEvent('tip'); onGo(); },
  }, `${t.cta} →`);
  const tipCard = (t) => el('div', { class: 'ask-tip' }, [
    el('div', { class: 'ask-tip-kicker' }, 'Did you know?'),
    el('strong', {}, t.hook),
    el('p', {}, t.text),
    el('div', { class: 'ask-links' }, [
      tipLink(t, () => setOpen(false)),
      tipList.length > 1 ? el('button', { type: 'button', class: 'ask-link ask-more', onclick: (e) => { tip = nextTip(tipList); e.target.closest('.ask-tip').replaceWith(tipCard(tip)); } }, 'Another example') : null,
    ]),
  ]);

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
  const greet = () => setChildren(log, [
    tip ? bubble('bot', [tipCard(tip)]) : null,
    bubble('bot', [el('p', {}, 'Ask what a term means, or what you want to work out. For example:'), chips()]),
  ]);

  function submit(text) {
    const q = String(text || '').trim();
    if (!q) return;
    countEvent('ask');   // one anonymous tick per visit; the question itself never leaves the page
    log.append(bubble('you', [el('p', {}, q)]), answerNode(ask(q, { glossary })));
    input.value = '';
    // keep the conversation short: the greeting and the latest six exchanges
    while (log.children.length > 14) log.children[2].remove();
    log.scrollTop = log.scrollHeight;
  }
  form.addEventListener('submit', (e) => { e.preventDefault(); submit(input.value); });

  // ---- the teaser: once a visit, a few seconds in, the mascot offers the example ----
  const teaseClose = el('button', { type: 'button', class: 'icon-btn ask-tease-close', 'aria-label': 'Dismiss' }, '×');
  const tease = el('div', { class: 'ask-tease', hidden: true, role: 'status' });
  const hideTease = () => { tease.hidden = true; toggle.classList.remove('ask-waving'); };
  teaseClose.addEventListener('click', hideTease);
  function showTease() {
    if (!tip || seenThisVisit() || !panel.hidden || (fbPanel && !fbPanel.hidden)) return;
    // someone filling in a form is left alone
    if (document.activeElement && /^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement.tagName)) { setTimeout(showTease, 8000); return; }
    markSeen();
    setChildren(tease, [
      teaseClose,
      el('div', { class: 'ask-tip-kicker' }, 'Did you know?'),
      el('strong', {}, tip.hook),
      el('p', {}, tip.text),
      tipLink(tip, hideTease),
    ]);
    tease.hidden = false;
    toggle.classList.add('ask-waving');
    setTimeout(hideTease, 20000);
  }
  if (tip && !seenThisVisit()) setTimeout(showTease, 7000);

  function setOpen(v) {
    panel.hidden = !v;
    toggle.setAttribute('aria-expanded', String(v));
    if (!v && toggle.classList.contains('ask-labelled') && everOpened()) toggle.classList.remove('ask-labelled');
    if (v) {
      markOpened();
      hideTease();
      if (fbPanel) { fbPanel.hidden = true; fbToggle?.setAttribute('aria-expanded', 'false'); }
      if (!log.children.length) greet();
      // on a phone the keyboard would cover the example; it comes up when the box is tapped
      if (!isPhone()) setTimeout(() => input.focus(), 0);
    }
    syncCorner();
  }
  toggle.addEventListener('click', () => setOpen(panel.hidden));
  close.addEventListener('click', () => setOpen(false));
  window.addEventListener('taxcompass:feedback-open', () => { setOpen(false); hideTease(); });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') { if (!panel.hidden) setOpen(false); hideTease(); } });

  corner.prepend(panel, tease);
  corner.querySelector('.fb-row').append(toggle);
}
