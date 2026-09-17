/**
 * What people say: the feedback the owner has approved, with the overall rating. Reads GET /api/feedback
 * (cached five minutes at the edge). Renders nothing at all when the database is not bound or there is
 * nothing approved yet, so the section never sits empty.
 */
import { el, setChildren } from './util.js';
import { CALCS, PAGES } from './routes.js';

let cache = null;
export function loadWall() {
  if (!cache) cache = fetch('/api/feedback').then((r) => (r.ok ? r.json() : { available: false })).catch(() => ({ available: false }));
  return cache;
}

const stars = (n) => el('span', { class: 'stars-static', 'aria-label': `${n} out of 5` }, '★'.repeat(n) + '☆'.repeat(5 - n));
function pageLabel(path) {
  const m = /^\/calculators\/([a-z-]+)/.exec(path || '');
  if (m && CALCS[m[1]]) return CALCS[m[1]].title;
  const p = (path || '').replace(/^\//, '').split('/')[0];
  return PAGES[p] ? PAGES[p].title : '';
}

/** A card for the About page. Resolves to null when there is nothing to show. */
export async function feedbackWallCard() {
  const d = await loadWall();
  if (!d.available || (!d.items.length && !(d.rating.count >= 5))) return null;
  const head = d.rating.average != null && d.rating.count >= 5
    ? el('p', { class: 'wall-rating' }, [stars(Math.round(d.rating.average)), ` ${d.rating.average} out of 5 from ${d.rating.count} people who rated the site`])
    : null;
  const items = d.items.map((it) => el('blockquote', { class: 'wall-item' }, [
    el('p', {}, it.message),
    el('footer', {}, [el('strong', {}, it.name), it.rating ? [' · ', stars(it.rating)] : null, pageLabel(it.page) ? ` · on ${pageLabel(it.page)}` : '', ` · ${new Date(it.ts).toLocaleDateString('en-IN', { month: 'short', year: 'numeric' })}`]),
  ]));
  return el('div', { class: 'card about-section', id: 'what-people-say' }, [
    el('h2', { style: 'margin-top:0' }, 'What people say'),
    head,
    items.length ? el('div', { class: 'wall' }, items) : el('p', { class: 'muted' }, 'Feedback people have agreed to share will appear here.'),
    el('p', { class: 'muted small' }, 'Feedback shown here was sent through the Feedback button by people who ticked "you may show this on the site", with the first name and an initial. Ratings count everyone who gave one.'),
  ]);
}

/** Fills [data-feedback-badge] (footer) with the rating and a link to the wall. */
export async function initFeedbackBadge() {
  const nodes = document.querySelectorAll('[data-feedback-badge]');
  if (!nodes.length) return;
  const d = await loadWall();
  if (!d.available || d.rating.average == null || d.rating.count < 5) return;
  nodes.forEach((n) => { setChildren(n, [el('a', { href: '/about#what-people-say' }, `★ ${d.rating.average}/5 from ${d.rating.count} people`)]); n.hidden = false; });
}
