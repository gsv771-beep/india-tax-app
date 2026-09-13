import { loadJSON } from './util.js';
import { initTax } from './tax-ui.js';
import { initCalculators } from './calculators.js';
import { initGlossary } from './glossary.js';
import { initSchemes } from './schemes.js';

const TABS = ['tax', 'calculators', 'schemes', 'glossary'];

function showTab(name) {
  const tab = TABS.includes(name) ? name : 'tax';
  for (const t of TABS) {
    document.getElementById(t).hidden = t !== tab;
  }
  document.querySelectorAll('.tabs a').forEach((a) => a.classList.toggle('active', a.dataset.tab === tab));
  window.scrollTo({ top: 0 });
}

function route() {
  showTab(location.hash.replace('#', ''));
}

// Some browsers change a focused number input's value on scroll-wheel. On a tax form that
// silently corrupts inputs, so blur the field instead and let the page scroll.
document.addEventListener('wheel', (e) => {
  const a = document.activeElement;
  if (a && a.type === 'number' && a.contains(e.target)) a.blur();
}, { passive: true });

async function boot() {
  const loading = document.getElementById('loading');
  try {
    const [rates, deductions, onboarding, formulas, glossary, schemes] = await Promise.all([
      loadJSON('data/tax_rates.json'),
      loadJSON('data/deductions.json'),
      loadJSON('data/onboarding_and_comparison.json'),
      loadJSON('data/formulas.json'),
      loadJSON('data/glossary.json'),
      loadJSON('data/schemes.json'),
    ]);
    const data = { rates, deductions, onboarding, formulas, glossary, schemes };

    initTax(data);
    initCalculators(data);
    initGlossary(data);
    initSchemes(data);

    const stamp = document.getElementById('data-stamp');
    if (stamp) stamp.textContent = `Small-savings rates: ${schemes._meta.rate_quarter_in_force}.`;

    loading.hidden = true;
    window.addEventListener('hashchange', route);
    route();
  } catch (err) {
    loading.className = 'notice error';
    loading.textContent = 'Could not load the app data. ' + err.message;
    console.error(err);
  }
}

boot();
