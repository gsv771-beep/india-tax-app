import { loadJSON } from './util.js';
import { initTax } from './tax-ui.js';
import { initCalculators, showCalc } from './calculators.js';
import { initGlossary } from './glossary.js';
import { initNps } from './nps.js';
import { initAbout } from './about.js';
import { initGlossaryTooltips } from './tooltips.js';
import { initFeedback, initCounter } from './feedback.js';
import { isProduction } from './env.js';

const SITE = 'TaxCompass India';
const PAGES = {
  tax: { title: 'Old vs new tax regime calculator', desc: 'Compare the old and new income tax regimes line by line for FY 2025-26 and FY 2026-27, see how far you are from the other regime winning, and what unused deductions would save.' },
  calculators: { title: 'Calculators', desc: 'EMI with step-up and prepayment, SIP, lumpsum, goal, capital gains, advance tax and a monthly expenses and savings planner, with historical mutual fund returns for context.' },
  nps: { title: 'NPS explained, with a corpus and pension projector', desc: 'How the National Pension System works, what your contributions could grow into, the lump sum and pension at 60, and its tax treatment in the old and new regimes.' },
  glossary: { title: 'Glossary of Indian tax and finance terms', desc: 'Plain-language definitions of about 150 Indian tax, mutual fund, loan and retirement terms.' },
  about: { title: 'About, sources and methodology', desc: 'How TaxCompass India computes its numbers, where the data comes from, how fresh it is, and what stays private.' },
};
const CALC_TITLES = {
  budget: 'Expenses and savings calculator', emi: 'EMI calculator with step-up and prepayment', sip: 'SIP calculator with step-up',
  lumpsum: 'Lumpsum calculator', goal: 'Goal planner', 'capital-gains': 'Capital gains tax calculator', 'advance-tax': 'Advance tax schedule and interest calculator',
  salary: 'In-hand salary calculator from CTC',
};
const ALIASES = { schemes: 'nps' };

function parsePath(pathname) {
  const parts = pathname.replace(/\/+$/, '').split('/').filter(Boolean);
  const first = ALIASES[parts[0]] || parts[0];
  const tab = PAGES[first] ? first : 'tax';
  return { tab, sub: parts[1] || null };
}

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

function setMeta(tab, sub) {
  const page = PAGES[tab];
  const title = tab === 'calculators' && CALC_TITLES[sub] ? CALC_TITLES[sub] : page.title;
  document.title = `${title} · ${SITE}`;
  const set = (sel, attr, val) => { const n = document.querySelector(sel); if (n) n.setAttribute(attr, val); };
  set('meta[name="description"]', 'content', page.desc);
  set('meta[property="og:title"]', 'content', `${title} · ${SITE}`);
  set('meta[property="og:description"]', 'content', page.desc);
  // canonical always points at the primary domain, even when viewed via the pages.dev address
  const url = 'https://taxcompass.org' + location.pathname;
  set('link[rel="canonical"]', 'href', url);
  set('meta[property="og:url"]', 'content', url);
}

export function navigate(path, replace = false) {
  history[replace ? 'replaceState' : 'pushState']({}, '', path);
  route();
  window.scrollTo({ top: 0 });
}

function route() {
  // Old links used hashes (#schemes?f=80c); turn them into paths once.
  const m = location.hash.match(/^#(tax|calculators|schemes|nps|glossary|about)(\?.*)?$/);
  if (m) history.replaceState({}, '', `/${ALIASES[m[1]] || m[1]}${m[2] || ''}`);
  const { tab, sub } = parsePath(location.pathname);
  if (location.pathname === '/' || location.pathname === '/index.html') history.replaceState({}, '', '/tax' + location.search);
  else if (location.pathname.startsWith('/schemes')) history.replaceState({}, '', '/nps');
  showTab(tab);
  setMeta(tab, sub);
  if (tab === 'calculators') showCalc(sub || 'emi');
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
  const loading = document.getElementById('loading');
  try {
    const [rates, deductions, onboarding, formulas, glossary, schemes, capgains] = await Promise.all([
      loadJSON('/data/tax_rates.json'),
      loadJSON('/data/deductions.json'),
      loadJSON('/data/onboarding_and_comparison.json'),
      loadJSON('/data/formulas.json'),
      loadJSON('/data/glossary.json'),
      loadJSON('/data/schemes.json'),
      loadJSON('/data/capital_gains.json'),
    ]);
    const data = { rates, deductions, onboarding, formulas, glossary, schemes, capgains };

    initGlossaryTooltips(glossary);
    initTax(data);
    initCalculators(data);
    initGlossary(data);
    initNps(data);
    initAbout(data);
    initFeedback();
    initCounter();

    loading.hidden = true;
    route();
    // Fixture loader and other dev-only controls: never on taxcompass.org.
    if (!isProduction()) import('./devtools.js').then((m) => m.initDevtools()).catch(() => {});
  } catch (err) {
    loading.className = 'notice error';
    loading.textContent = 'Could not load the app data. ' + err.message;
    console.error(err);
  }
}

boot();
