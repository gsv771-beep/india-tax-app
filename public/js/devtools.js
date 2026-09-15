/**
 * Dev-only controls, loaded by app.js on non-production hosts only (see env.js).
 * "Load fixture" drops a test profile from /fixtures/profiles/ into localStorage in one click,
 * because every preview URL is a fresh origin with empty storage.
 * Loading wipes every TaxCompass key first so no per-tool memory from a previous profile lingers.
 */
import { el, setChildren, loadJSON } from './util.js';
import { environmentName } from './env.js';
import { wipeEverything, importProfileJSON } from './profile-store.js';

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
      const res = await fetch('/fixtures/profiles/' + p.file, { cache: 'no-cache' });
      if (!res.ok) throw new Error(`${res.status} fetching ${p.file}`);
      const text = await res.text();
      wipeEverything();
      importProfileJSON(text, 'fixture');
      status.textContent = `Loaded ${p.file}. Reloading…`;
      setTimeout(() => location.reload(), 300);
    } catch (e) {
      status.textContent = 'Could not load: ' + e.message;
    }
  }
  function wipe() {
    wipeEverything();
    status.textContent = 'Wiped. Reloading…';
    setTimeout(() => location.reload(), 300);
  }

  document.body.append(el('div', { class: 'devtools' }, [panel, toggle]));
}
