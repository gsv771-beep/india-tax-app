import { loadJSON } from './util.js';
import { PAGES, REMOVED, parsePath, metaFor } from './routes.js';
import { initTax } from './tax-ui.js';
import { initCalculators, showCalc } from './calculators.js';
import { initGlossaryTooltips } from './tooltips.js';
import { initFeedback, initCounter } from './feedback.js';
import { initFeedbackBadge } from './feedback-wall.js';
import { initHome } from './home.js';
import { initSnapshot } from './snapshot.js';
import { ensureFresh } from './fresh.js';
import { isProduction } from './env.js';
import { initProfilePanel } from './profile-panel.js';

// Pages that load only when first visited (their code is not needed to show the tax page or the calculators).
const LAZY = {
  nps: (data) => import('./nps.js').then((m) => m.initNps(data)),
  glossary: (data) => import('./glossary.js').then((m) => m.initGlossary(data)),
  about: (data) => import('./about.js').then((m) => m.initAbout(data)),
};
const started = new Set();
let appData = null;

let currentTab = null;
function showTab(tab) {
  for (const t of Object.keys(PAGES)) document.getElementById(t).hidden = t !== tab;
  document.querySelectorAll('.tabs a').forEach((a) => a.classList.toggle('active', a.dataset.tab === tab));
  if (tab !== currentTab) {
    const panel = document.getElementById(tab);
    panel.classList.remove('enter'); void panel.offsetWidth; panel.classList.add('enter');
    currentTab = tab;
  }
}

function setMeta(pathname) {
  const m = metaFor(pathname);
  document.title = m.title;
  const set = (sel, attr, val) => { const n = document.querySelector(sel); if (n) n.setAttribute(attr, val); };
  set('meta[name="description"]', 'content', m.desc);
  set('meta[property="og:title"]', 'content', m.title);
  set('meta[property="og:description"]', 'content', m.desc);
  // canonical always points at the primary domain, even when viewed via the pages.dev address
  set('link[rel="canonical"]', 'href', m.url);
  set('meta[property="og:url"]', 'content', m.url);
}

export function navigate(path, replace = false) {
  history[replace ? 'replaceState' : 'pushState']({}, '', path);
  window.dispatchEvent(new CustomEvent('taxcompass:navigate', { detail: { path } }));
  route();
  window.scrollTo({ top: 0 });
}

function route() {
  // Old links used hashes (#schemes?f=80c); turn them into paths once.
  const m = location.hash.match(/^#(tax|calculators|schemes|nps|glossary|about)(\?.*)?$/);
  if (m) history.replaceState({}, '', `/${m[1] === 'schemes' ? 'nps' : m[1]}${m[2] || ''}`);
  const gone = REMOVED[location.pathname.replace(/\/+$/, '')];
  if (gone) history.replaceState({}, '', gone + location.search);
  if (location.pathname === '/index.html') history.replaceState({}, '', '/' + location.search);
  else if (location.pathname.startsWith('/schemes')) history.replaceState({}, '', '/nps');
  const { tab, sub } = parsePath(location.pathname);
  showTab(tab);
  setMeta(location.pathname);
  // The rest needs the data files; until they arrive the section heading and static form are already on screen.
  if (!appData) return;
  if (LAZY[tab] && !started.has(tab)) { started.add(tab); LAZY[tab](appData).catch((e) => console.error(e)); }
  if (tab === 'calculators') showCalc(sub);
  window.dispatchEvent(new CustomEvent('routechange', { detail: { tab, sub } }));
}

// Same-site links are handled without a page load.
document.addEventListener('click', (e) => {
  const a = e.target.closest('a[href]');
  if (!a || e.defaultPrevented || e.metaKey || e.ctrlKey || e.shiftKey || a.target === '_blank') return;
  const href = a.getAttribute('href');
  if (!href.startsWith('/') || href.startsWith('//')) return;
  e.preventDefault();
  navigate(href);
});
window.addEventListener('popstate', route);

// Some browsers change a focused number input's value on scroll-wheel. On a tax form that
// silently corrupts inputs, so blur the field instead and let the page scroll.
document.addEventListener('wheel', (e) => {
  const a = document.activeElement;
  if (a && a.type === 'number' && a.contains(e.target)) a.blur();
}, { passive: true });

async function boot() {
  // A fresh page with stale scripts is the one failure the site cannot explain to the user; check first.
  if (await ensureFresh()) return;
  // Show the right section at once; results fill in when the data arrives (a few tens of milliseconds on a warm cache).
  route();
  try {
    const [rates, deductions, onboarding, formulas, glossary, schemes, capgains, propertyCharges, loanPolicy] = await Promise.all([
      loadJSON('/data/tax_rates.json'),
      loadJSON('/data/deductions.json'),
      loadJSON('/data/onboarding_and_comparison.json'),
      loadJSON('/data/formulas.json'),
      loadJSON('/data/glossary.json'),
      loadJSON('/data/schemes.json'),
      loadJSON('/data/capital_gains.json'),
      loadJSON('/data/property_charges.json'),
      loadJSON('/data/loan_policy.json'),
    ]);
    appData = { rates, deductions, onboarding, formulas, glossary, schemes, capgains, propertyCharges, loanPolicy };

    initGlossaryTooltips(glossary);
    initProfilePanel();
    initHome(appData);
    initSnapshot(appData);
    initTax(appData);
    initCalculators(appData);
    initFeedback();
    initCounter();
    initFeedbackBadge();
    document.body.classList.add('ready');
    route();
    // Fixture loader and other dev-only controls: never on taxcompass.org.
    if (!isProduction()) import('./devtools.js').then((m) => m.initDevtools()).catch(() => {});
  } catch (err) {
    const notice = document.getElementById('loading');
    notice.hidden = false;
    notice.className = 'notice error';
    notice.textContent = 'Could not load the app data. ' + err.message;
    console.error(err);
  }
}

boot();
