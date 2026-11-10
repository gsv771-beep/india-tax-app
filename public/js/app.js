// Loaded with the page: only what the landing card needs to turn a CTC into an answer. Every other
// page's code (the tax form, the calculators, the glossary, feedback) is fetched by loadRest() below,
// once the card is usable, or at once when the address asks for another page.
import { loadJSON } from './util.js';
import { PAGES, REMOVED, parsePath, metaFor, CALCS } from './routes.js';
import { initCounter } from './feedback.js';
import { mountQuick, detailFold } from './quick.js';
import { onProfileChange, getProfile } from './profile-store.js';
import { initThemeSwitch } from './theme.js';
import { ensureFresh, checkLiveBuild } from './fresh.js';
import { isProduction } from './env.js';

// Pages that load only when first visited (their code is not needed to show the tax page or the calculators).
const LAZY = {
  nps: (data) => import('./nps.js').then((m) => m.initNps(data)),
  glossary: (data) => import('./glossary.js').then((m) => m.initGlossary(data)),
  about: (data) => import('./about.js').then((m) => m.initAbout(data)),
};
const started = new Set();
let appData = null;   // every data file, once loadRest() has them
let mods = null;      // the modules loadRest() brings in: { calculators, ... }

// the landing page may already be on screen, shown by the page's own script (index.html)
let currentTab = document.querySelector('main > section.panel:not([hidden])')?.id || null;
/**
 * The calculators panel carries the index heading in its markup, so a direct link to one tool used to
 * show "What do you want to work out?" until the data arrived. Set the right heading, and a skeleton in
 * place of the index, before anything is loaded.
 */
function primeCalcHeading(tab, sub) {
  if (tab !== 'calculators') return;
  const title = document.getElementById('calc-title');
  const eyebrow = document.getElementById('calc-eyebrow');
  const intro = document.getElementById('calc-intro');
  const body = document.getElementById('calc-body');
  if (!title || !CALCS[sub]) return;
  eyebrow.textContent = 'Calculator';
  title.textContent = CALCS[sub].title;
  intro.textContent = CALCS[sub].desc;
  if (body && !body.firstChild) body.append(Object.assign(document.createElement('div'), { className: 'skeleton calc-skeleton' }));
}

function showTab(tab, sub) {
  for (const t of Object.keys(PAGES)) document.getElementById(t).hidden = t !== tab;
  // the menu leads with the everyday tools; the salary pages sit with Tax & salary, NPS with the rest
  const FRONT = ['budget', 'emi', 'sip'];
  const navTab = tab === 'calculators' && FRONT.includes(sub) ? sub : tab === 'salary' ? 'tax' : tab === 'nps' ? 'calculators' : tab;
  document.querySelectorAll('.tabs a').forEach((a) => a.classList.toggle('active', a.dataset.tab === navTab));
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
  if (gone) { const [p, h] = gone.split('#'); history.replaceState({}, '', p + location.search + (h ? `#${h}` : location.hash)); }
  if (location.pathname === '/index.html') history.replaceState({}, '', '/' + location.search);
  else if (location.pathname.startsWith('/schemes')) history.replaceState({}, '', '/nps');
  const { tab, sub } = parsePath(location.pathname);
  showTab(tab, sub);
  setMeta(location.pathname);
  primeCalcHeading(tab, sub);
  // The rest needs the data files; until they arrive the section heading and static form are already on screen.
  // (a link followed before then brings them in now; loadRest() routes again when it is done)
  if (!appData) { if (restWanted) loadRest(); return; }
  if (LAZY[tab] && !started.has(tab)) { started.add(tab); LAZY[tab](appData).catch((e) => console.error(e)); }
  if (tab === 'calculators') mods.calculators.showCalc(sub);
  if (tab === 'salary') import('./salary-pages.js').then((m) => m.showSalaryPage(sub, appData)).catch((e) => console.error(e));
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

/**
 * Tax & salary: the quick answer, then two folds under it, each closed until wanted: the payslip (the
 * in-hand calculator, which had its own page until it was merged here) and the full tax calculation.
 * The home page carries the same quick answer, linking here.
 */
function initQuick(rates) {
  const payslipBody = document.getElementById('tax-payslip');
  // the payslip and the full form are part of the rest of the site: opening either brings it in
  const slip = detailFold('payslip', payslipBody, { label: 'Your payslip, line by line', openLabel: 'Your payslip, line by line', hash: '#payslip', onOpen: () => { if (!payslip) payslipBody.replaceChildren(Object.assign(document.createElement('div'), { className: 'skeleton calc-skeleton' })); loadRest().then(() => payslip && payslip.show()); } });
  payslipBody.before(slip.button);
  const taxBody = document.getElementById('tax-detail');
  const fold = detailFold('tax', taxBody, { label: 'Full tax calculation, every deduction', openLabel: 'Full tax calculation, every deduction', onOpen: () => { loadRest(); } });
  taxBody.before(fold.button);
  // until there is an answer the page is the card alone; the full form shows only when asked for by
  // name (#detail: a business, or a link from elsewhere)
  const tax = document.getElementById('tax');
  const asked = () => tax.classList.toggle('show-detail', location.hash === '#detail' || location.hash === '#payslip');
  asked();
  tax.querySelector('.tax-business-link a')?.addEventListener('click', (e) => { e.preventDefault(); history.replaceState(history.state, '', '#detail'); asked(); fold.open(); });
  // a #payslip or #detail link to this page opens that fold under the quick answer
  window.addEventListener('routechange', (e) => {
    if (e.detail.tab !== 'tax') return;
    asked();
    if (location.hash === '#detail') fold.open();
    if (location.hash === '#payslip') slip.open();
  });
  mountQuick(document.getElementById('tax-quick'), {
    rates, source: 'quick:tax',
    salaryLink: { href: '#payslip', text: 'Your payslip, line by line →', onclick: (e) => { e.preventDefault(); slip.open(); } },
    taxLink: { href: '#detail', text: 'Every line of the tax, both regimes →', onclick: (e) => { e.preventDefault(); fold.open(); } },
  });
}

let payslip = null;       // the payslip calculator, once the rest has loaded
let restWanted = false;   // set once the landing card is up: from then on a link or a fold may ask for the rest
let rest = null;          // the one promise of everything beyond the landing card
let rates = null;
let earlyChange = null;   // a profile change made on the landing card before the rest was listening

/**
 * Everything beyond the landing card: the other data files and every other page's code. Asked for once
 * (idle time after the card is up, or at once when the address, a link or a fold needs it).
 */
function loadRest() {
  if (rest) return rest;
  rest = (async () => {
    const [deductions, onboarding, formulas, glossary, schemes, capgains, propertyCharges, loanPolicy,
      taxUi, calculators, tooltips, feedback, wall, budgetSync, undo, panel] = await Promise.all([
      loadJSON('/data/deductions.json'),
      loadJSON('/data/onboarding_and_comparison.json'),
      loadJSON('/data/formulas.json'),
      loadJSON('/data/glossary.json'),
      loadJSON('/data/schemes.json'),
      loadJSON('/data/capital_gains.json'),
      loadJSON('/data/property_charges.json'),
      loadJSON('/data/loan_policy.json'),
      import('./tax-ui.js'), import('./calculators.js'), import('./tooltips.js'), import('./feedback.js'),
      import('./feedback-wall.js'), import('./budget-sync.js'), import('./profile-undo.js'), import('./profile-panel.js'),
    ]);
    const data = { rates, deductions, onboarding, formulas, glossary, schemes, capgains, propertyCharges, loanPolicy };
    mods = { calculators };

    tooltips.initGlossaryTooltips(glossary);
    panel.initProfilePanel();
    undo.initProfileUndo();
    taxUi.initTax(data);
    payslip = calculators.mountPayslip(document.getElementById('tax-payslip'), data);
    const sync = budgetSync.initBudgetSync(data);
    if (earlyChange) sync.follow(getProfile(), earlyChange);
    calculators.initCalculators(data);
    feedback.initFeedback();
    wall.initFeedbackBadge();
    appData = data;
    document.body.classList.add('ready');
    // and, once the page is usable, check whether a whole stale copy (page and scripts together) is being served
    setTimeout(() => { checkLiveBuild().catch(() => {}); }, 1200);
    route();
    // Fixture loader and other dev-only controls: never on taxcompass.org.
    if (!isProduction()) import('./devtools.js').then((m) => m.initDevtools()).catch(() => {});
  })().catch((err) => { showLoadError(err); throw err; });
  rest.catch(() => {});
  return rest;
}

function showLoadError(err) {
  const notice = document.getElementById('loading');
  notice.hidden = false;
  notice.className = 'notice error';
  notice.textContent = 'Could not load the app data. ' + err.message;
  console.error(err);
}

async function boot() {
  // A fresh page with stale scripts is the one failure the site cannot explain to the user; check first.
  if (await ensureFresh()) return;
  // Show the right section at once; results fill in when the data arrives (a few tens of milliseconds on a warm cache).
  route();
  initThemeSwitch();
  try {
    rates = await loadJSON('/data/tax_rates.json');
    // 1. the landing card: usable as soon as the rates are in
    const off = onProfileChange((p, source) => { if (!appData) earlyChange = source; else off(); });
    initQuick(rates);
    initCounter();
    restWanted = true;
    // 2. the rest: now if this is not the plain landing page (another page, a fold named in the address,
    //    a figure passed in it), otherwise when the browser is next idle, so typing is not held up
    const { tab } = parsePath(location.pathname);
    const plainLanding = tab === 'tax' && !location.hash && !location.search;
    if (!plainLanding) loadRest();
    else if ('requestIdleCallback' in window) requestIdleCallback(() => loadRest(), { timeout: 1500 });
    else setTimeout(loadRest, 400);
  } catch (err) { showLoadError(err); }
}

boot();
