/**
 * The theme switch in the header: Auto (follow the device), Light or Dark. The choice is applied by
 * the script in index.html's <head> (window.taxcompassTheme), so the page never draws in the wrong
 * theme first; this module only draws the button and its menu. The choice stays in this browser.
 */
import { el, setChildren } from './util.js';

const SVG = 'http://www.w3.org/2000/svg';
const ICONS = {
  light: 'M12 4V2M12 22v-2M4 12H2M22 12h-2M5.6 5.6 4.2 4.2M19.8 19.8l-1.4-1.4M5.6 18.4l-1.4 1.4M19.8 4.2l-1.4 1.4M12 7a5 5 0 1 0 0 10 5 5 0 0 0 0-10Z',
  dark: 'M20 14.5A8 8 0 0 1 9.5 4a8 8 0 1 0 10.5 10.5Z',
  auto: 'M12 3a9 9 0 1 0 0 18V3Zm0 0a9 9 0 0 1 0 18',
};
const LABEL = { auto: 'Auto', light: 'Light', dark: 'Dark' };
const NOTE = { auto: 'follows your device', light: '', dark: '' };

function icon(kind) {
  const svg = document.createElementNS(SVG, 'svg');
  svg.setAttribute('viewBox', '0 0 24 24'); svg.setAttribute('aria-hidden', 'true'); svg.setAttribute('class', 'theme-icon');
  const path = document.createElementNS(SVG, 'path');
  path.setAttribute('d', ICONS[kind]);
  svg.append(path);
  return svg;
}

export function initThemeSwitch() {
  const host = document.getElementById('theme-switch');
  const api = window.taxcompassTheme;
  if (!host || !api) return;
  const button = el('button', { type: 'button', class: 'theme-btn', 'aria-haspopup': 'true', 'aria-expanded': 'false' });
  const menu = el('div', { class: 'theme-menu', role: 'menu', hidden: true });
  const shown = () => document.documentElement.getAttribute('data-theme') === 'dark' ? 'dark' : 'light';
  const paint = () => {
    const choice = api.get();
    // the button shows what is on screen; its label says what was chosen
    setChildren(button, [icon(choice === 'auto' ? 'auto' : shown())]);
    button.setAttribute('aria-label', `Theme: ${LABEL[choice]}${choice === 'auto' ? `, ${shown()} now` : ''}`);
    button.title = button.getAttribute('aria-label');
    setChildren(menu, ['auto', 'light', 'dark'].map((k) => el('button', {
      type: 'button', role: 'menuitemradio', 'aria-checked': String(choice === k), class: 'theme-opt' + (choice === k ? ' on' : ''),
      onclick: () => { api.set(k); setOpen(false); button.focus(); },
    }, [icon(k), el('span', {}, LABEL[k]), NOTE[k] ? el('small', {}, NOTE[k]) : null])));
  };
  const setOpen = (v) => { menu.hidden = !v; button.setAttribute('aria-expanded', String(v)); if (v) menu.querySelector('.on')?.focus(); };
  button.addEventListener('click', () => setOpen(menu.hidden));
  document.addEventListener('click', (e) => { if (!menu.hidden && !host.contains(e.target)) setOpen(false); });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !menu.hidden) { setOpen(false); button.focus(); } });
  window.addEventListener('taxcompass:theme', paint);
  // on Auto the device can change under us (sunset, a quick-settings tap)
  window.matchMedia?.('(prefers-color-scheme: dark)').addEventListener?.('change', paint);
  host.append(button, menu);
  paint();
}
