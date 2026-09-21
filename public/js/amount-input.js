/**
 * Two small additions to a number input, used across the calculators:
 *   attachSlider(input, { min, max, step })   a drag line under the field, kept in sync both ways;
 *                                             the top of the range grows if you type past it.
 *   pctToggle({ input, baseInput, base, defaultPct, name, hint })
 *                                             a ₹ | % switch: in % mode the field is worked out as a
 *                                             share of a base (Basic + DA as % of gross, employer NPS
 *                                             as % of Basic) and follows the base as it changes.
 * Both drive the original input and fire its 'input' event, so the page's own handlers run unchanged.
 */
import { el } from './util.js';

const nice = (v) => { const p = Math.pow(10, Math.floor(Math.log10(Math.max(1, v)))); return Math.ceil((v * 1.25) / p) * p; };

export function attachSlider(input, { min = 0, max, step }) {
  const range = el('input', { type: 'range', class: 'drag', min, max, step, value: input.value === '' ? min : input.value, tabindex: -1, 'aria-hidden': 'true' });
  const sync = () => {
    const v = input.value === '' ? +min : +input.value || 0;
    if (v > +range.max) range.max = nice(v);
    range.value = v;
  };
  range.addEventListener('input', () => { input.value = range.value; input.dispatchEvent(new Event('input', { bubbles: true })); });
  input.addEventListener('input', sync);
  input.addEventListener('change', sync);
  sync();
  input.after(range);
  return range;
}

export function pctToggle({ input, baseInput, base, defaultPct, name, hint, max = 100, defaultMode = 'inr' }) {
  const KEY = `taxcompass.pct.${name}`;
  let saved = null; try { saved = JSON.parse(localStorage.getItem(KEY) || 'null'); } catch {}
  let mode = saved ? (saved.mode === 'pct' ? 'pct' : 'inr') : defaultMode;
  // first visit in % mode with a rupee figure already typed: keep that figure by turning it into its %
  const baseNow = base ? base() : baseInput ? +baseInput.value || 0 : 0;
  const startPct = saved && saved.pct != null ? saved.pct : (!saved && mode === 'pct' && +input.value > 0 && baseNow > 0) ? Math.round((+input.value / baseNow) * 1000) / 10 : defaultPct;
  const pct = el('input', { type: 'number', min: 0, max, step: 0.1, value: startPct, class: 'pct-input', 'aria-label': 'percent' });
  const bR = el('button', { type: 'button', class: 'seg' }, '₹');
  const bP = el('button', { type: 'button', class: 'seg' }, '%');
  const note = el('small', { class: 'pct-note' });
  const row = el('div', { class: 'pct-row' }, [el('span', { class: 'seg-group', role: 'group', 'aria-label': 'Enter as rupees or percent' }, [bR, bP]), pct, note]);
  const baseValue = () => (base ? base() : baseInput ? +baseInput.value || 0 : 0);
  const persist = () => { try { localStorage.setItem(KEY, JSON.stringify({ mode, pct: +pct.value })); } catch {} };
  const apply = () => {
    const isPct = mode === 'pct';
    bR.classList.toggle('on', !isPct); bP.classList.toggle('on', isPct);
    bR.setAttribute('aria-pressed', String(!isPct)); bP.setAttribute('aria-pressed', String(isPct));
    pct.hidden = !isPct; input.readOnly = isPct; input.classList.toggle('derived', isPct);
    if (isPct) {
      const b = baseValue();
      note.textContent = b > 0 ? `${pct.value || 0}% of ${hint}` : `${hint} is empty, so this stays 0`;
      const v = Math.round(b * (+pct.value || 0) / 100);
      if (String(v) !== input.value) { input.value = v; input.dispatchEvent(new Event('input', { bubbles: true })); }
    } else note.textContent = '';
  };
  bR.addEventListener('click', () => { mode = 'inr'; persist(); apply(); });
  bP.addEventListener('click', () => { mode = 'pct'; persist(); apply(); });
  pct.addEventListener('input', () => { persist(); apply(); });
  if (baseInput) baseInput.addEventListener('input', () => { if (mode === 'pct') apply(); });
  input.after(row);
  apply();
  return { get mode() { return mode; }, refresh: apply, row };
}
