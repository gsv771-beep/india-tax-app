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
import { el, formatIndian } from './util.js';

/**
 * A live, comma-grouped echo of what is typed: number inputs cannot show 12,00,000 themselves, and a
 * bare 1200000 is easy to mistype by a zero. The echo sits under the field and reads the Indian way.
 * Attached automatically by attachSlider, and by enhanceMoneyInputs for every other rupee field.
 */
export function attachAmountEcho(input, { prefix = '₹' } = {}) {
  if (input.dataset.echo) return null;
  input.dataset.echo = '1';
  const echo = el('div', { class: 'amount-echo', 'aria-hidden': 'true' });
  const paint = () => { const v = input.value; echo.textContent = v === '' || !Number.isFinite(+v) ? '' : prefix + formatIndian(Math.round(+v)); };
  input.addEventListener('input', paint);
  input.addEventListener('change', paint);
  paint();
  input.after(echo);
  return echo;
}

/** Every rupee field under `root` gets the echo: a number input whose own label mentions the rupee sign. */
export function enhanceMoneyInputs(root) {
  if (!root) return;
  for (const input of root.querySelectorAll('input[type=number]:not([data-echo]):not(.pct-input)')) {
    const label = input.closest('label');
    const text = label ? label.textContent : '';
    // a rupee field is one whose own label says so; the percentage box that may sit beside it is not one
    if (/₹/.test(text)) attachAmountEcho(input);
  }
}

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
  attachAmountEcho(input);
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
