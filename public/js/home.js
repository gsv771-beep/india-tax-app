/**
 * The landing page is static HTML in index.html; this adds the two lines that depend on data: the
 * "rules as of" date from the tax file, and a returning visitor's one-line profile so they know every
 * tool is already set up for them.
 */
import { el, inr } from './util.js';
import { getProfile, onProfileChange } from './profile-store.js';
import { isEmptyProfile, profileSummary } from '../engine/profile.js';

export function initHome({ rates }) {
  const date = rates && rates._meta && rates._meta.compiled_on;
  if (date) document.querySelectorAll('[data-rules-date]').forEach((n) => { n.textContent = new Date(date).toLocaleDateString('en-IN', { day: 'numeric', month: 'long', year: 'numeric' }); });
  const line = document.getElementById('home-profile');
  if (!line) return;
  const paint = (p) => {
    if (isEmptyProfile(p)) { line.hidden = true; return; }
    line.replaceChildren('You are set up: ', el('strong', {}, profileSummary(p, inr)), '. Every tool starts from this; change it under ', el('a', { href: '#profile-panel', onclick: (e) => { e.preventDefault(); document.querySelector('.profile-toggle')?.click(); document.getElementById('profile-panel').scrollIntoView({ block: 'start', behavior: 'smooth' }); } }, 'Your profile'), '.');
    line.hidden = false;
  };
  paint(getProfile());
  onProfileChange(paint, 'home');
}
