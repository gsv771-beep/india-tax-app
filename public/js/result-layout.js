/**
 * Every result on the site in the same four parts, in the same order:
 *
 *   Your answer        the figures and one sentence that says what they mean
 *   Why                what drives the answer, in a few lines
 *   What to do next    one to three concrete moves, each a link into the tool that makes it
 *   Detailed working   tables, charts, schedules and assumptions, folded away until asked for
 *
 * Most people want the verdict; the people who want the working can open it, and the fold remembers
 * that they did, per tool. resultLayout returns an array of nodes for setChildren.
 *
 * next items are nodes, or { label, note, href, onclick, primary } for a plain action link.
 */
import { el } from './util.js';

const OPEN_KEY = 'taxcompass.details-open.v1';
function openState() { try { return JSON.parse(localStorage.getItem(OPEN_KEY) || '{}'); } catch { return {}; } }
/** Give an existing <details> the same remembered open state as the result folds. */
export function rememberFold(details, key) {
  if (!details) return;
  if (openState()[key]) details.open = true;
  details.addEventListener('toggle', () => rememberOpen(key, details.open));
}
function rememberOpen(key, open) {
  try { const s = openState(); if (open) s[key] = 1; else delete s[key]; localStorage.setItem(OPEN_KEY, JSON.stringify(s)); } catch {}
}

const list = (xs) => [].concat(xs || []).flat(Infinity).filter((x) => x != null && x !== false && x !== '');

function action(a) {
  if (!a || a.nodeType) return a;
  return el(a.href ? 'a' : 'button', {
    class: 'r-action' + (a.primary ? ' primary' : ''),
    href: a.href, type: a.href ? undefined : 'button',
    onclick: a.onclick,
  }, [el('strong', {}, a.label), a.note ? el('span', {}, a.note) : null]);
}

export function resultLayout({ key, answer, why, next, details, detailsLabel = 'Show the detailed working', foot }) {
  const a = list(answer), w = list(why), n = list(next).map(action), d = list(details);
  const out = [];
  if (a.length) out.push(el('div', { class: 'r-answer' }, a));
  if (w.length) out.push(el('section', { class: 'r-block r-why', 'aria-label': 'Why' }, [el('h3', { class: 'r-head' }, 'Why'), ...w]));
  if (n.length) {
    // plain action links sit in a grid; a richer node (a plan table, a card) takes the full width
    const links = n.filter((x) => x.classList && x.classList.contains('r-action'));
    const blocks = n.filter((x) => !(x.classList && x.classList.contains('r-action')));
    out.push(el('section', { class: 'r-block r-next', 'aria-label': 'What to do next' }, [
      el('h3', { class: 'r-head' }, 'What to do next'),
      ...blocks,
      links.length ? el('div', { class: 'r-actions' }, links) : null,
    ]));
  }
  if (d.length) {
    const fold = el('details', { class: 'r-details' }, [el('summary', {}, detailsLabel), el('div', { class: 'r-details-body' }, d)]);
    if (key && openState()[key]) fold.open = true;
    if (key) fold.addEventListener('toggle', () => rememberOpen(key, fold.open));
    out.push(fold);
  }
  out.push(...list(foot));
  return out;
}
