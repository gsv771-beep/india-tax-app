/**
 * The "how much risk" control, in percent terms: a slider from all-safe to all-equity, and under it the
 * return that mix has historically given, with a bad stretch alongside. Shared by the goal and
 * retirement pages. mixControl({ label, value, cap, rates, onChange }) -> { node, update({ value, cap, rates }) }
 */
import { el } from './util.js';
import { mixReturn, describeMix } from '../engine/mix.js';

export function mixControl({ label, hint, value, cap = 100, rates, onChange }) {
  const range = el('input', { type: 'range', min: 0, max: 100, step: 5, value });
  const val = el('span', { class: 'slider-val' });
  const desc = el('div', { class: 'mix-desc' });
  const node = el('div', { class: 'mix-ctl' }, [
    el('div', { class: 'slider-label' }, [label, hint ? el('small', {}, hint) : null]),
    el('div', { class: 'slider-ctl' }, [range, val]),
    desc,
  ]);
  let state = { value: +value, cap, rates };
  const paint = () => {
    const eff = Math.min(state.cap, state.value);
    const m = mixReturn(eff, state.rates);
    val.textContent = `${eff}% equity`;
    desc.replaceChildren(...[
      el('div', {}, [el('strong', {}, describeMix(eff)), `: about ${m.typical.toFixed(1)}% a year; ${m.bad.toFixed(1)}% in a bad stretch.`]),
      state.value > state.cap ? el('div', { class: 'small warn-text' }, `Capped at ${state.cap}% because the money is needed within ${state.cap === 0 ? '3' : state.cap === 30 ? '5' : '7'} years.`) : null,
      el('small', {}, `Equity ${state.rates.equity}% (${state.rates.sources.equity}); safe ${state.rates.safe}% (${state.rates.sources.safe}).`),
    ].filter(Boolean));
  };
  range.addEventListener('input', () => { state.value = +range.value; paint(); onChange(state.value); });
  paint();
  return { node, update(next) { state = { ...state, ...next }; if (next.value != null) range.value = next.value; paint(); } };
}
