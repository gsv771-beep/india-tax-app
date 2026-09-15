/**
 * Dev-only controls, loaded by app.js on non-production hosts only (see env.js).
 * "Load fixture" drops a test profile from /fixtures/profiles/ into localStorage in one click,
 * because every preview URL is a fresh origin with empty storage.
 * Until the shared profile store lands (Phase 1) the fixture is also projected onto the
 * existing per-tool stores so the tax comparison and salary pages pick it up immediately.
 */
import { el, setChildren, loadJSON } from './util.js';
import { environmentName } from './env.js';
import { PROFILE_KEY, migrateProfile, toTaxInputs, toSalaryStore } from '../engine/profile.js';

export async function initDevtools() {
  let index;
  try { index = await loadJSON('/fixtures/profiles/index.json'); } catch { return; }

  const list = el('div', { class: 'devtools-list' });
  const status = el('div', { class: 'devtools-status' });
  const panel = el('div', { class: 'devtools-panel', hidden: true }, [
    el('div', { class: 'devtools-title' }, `Dev tools · ${environmentName()}`),
    el('p', { class: 'small muted' }, 'Load a test profile into this browser. Replaces whatever is saved here.'),
    list, status,
    el('button', { type: 'button', class: 'btn secondary', onclick: wipe }, 'Wipe all saved data'),
  ]);
  const toggle = el('button', { type: 'button', class: 'devtools-toggle', 'aria-expanded': 'false', 'aria-controls': 'devtools-panel', title: 'Dev tools (non-production only)' }, 'DEV');
  panel.id = 'devtools-panel';
  toggle.addEventListener('click', () => { panel.hidden = !panel.hidden; toggle.setAttribute('aria-expanded', String(!panel.hidden)); });

  setChildren(list, index.profiles.map((p) => el('button', { type: 'button', class: 'btn', onclick: () => load(p) }, p.label)));

  async function load(p) {
    status.textContent = 'Loading…';
    try {
      const raw = await loadJSON('/fixtures/profiles/' + p.file);
      const profile = migrateProfile(raw);
      localStorage.setItem(PROFILE_KEY, JSON.stringify(profile));
      localStorage.setItem('taxcompass.inputs.v1', JSON.stringify(toTaxInputs(profile)));
      localStorage.setItem('taxcompass.salary.v1', JSON.stringify(toSalaryStore(profile)));
      status.textContent = `Loaded ${p.file}. Reloading…`;
      setTimeout(() => location.reload(), 300);
    } catch (e) {
      status.textContent = 'Could not load: ' + e.message;
    }
  }
  function wipe() {
    for (const k of Object.keys(localStorage)) if (k.startsWith('taxcompass.')) localStorage.removeItem(k);
    status.textContent = 'Wiped. Reloading…';
    setTimeout(() => location.reload(), 300);
  }

  document.body.append(el('div', { class: 'devtools' }, [panel, toggle]));
}
