import { formatIndian } from './tax-engine.js';

export { formatIndian };

export function inr(n, { sign = false } = {}) {
  const v = Math.round(n || 0);
  const s = '₹' + formatIndian(Math.abs(v));
  if (v < 0) return '−' + s;
  return sign && v > 0 ? '+' + s : s;
}

export function pct(x, digits = 2) {
  return (x * 100).toFixed(digits) + '%';
}

export async function loadJSON(path) {
  const res = await fetch(path, { cache: 'no-cache' });
  if (!res.ok) throw new Error(`Failed to load ${path}: ${res.status}`);
  return res.json();
}

/** Tiny element builder: el('div', {class: 'x', onclick: fn}, [children]) */
export function el(tag, attrs = {}, children = []) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v == null || v === false) continue;
    if (k === 'class') node.className = v;
    else if (k === 'html') node.innerHTML = v;
    else if (k.startsWith('on') && typeof v === 'function') node.addEventListener(k.slice(2), v);
    else if (k === 'dataset') Object.assign(node.dataset, v);
    else if (v === true) node.setAttribute(k, '');
    else node.setAttribute(k, v);
  }
  for (const c of [].concat(children).flat(Infinity)) {
    if (c == null || c === false) continue;
    node.append(c.nodeType ? c : document.createTextNode(String(c)));
  }
  return node;
}

/** replaceChildren that drops null/false entries (the DOM would otherwise render them as the text "null"). */
export function setChildren(node, children) {
  node.replaceChildren(...[].concat(children).flat(Infinity).filter((c) => c != null && c !== false));
}

export function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

export function debounce(fn, ms = 150) {
  let t;
  return (...args) => { clearTimeout(t); t = setTimeout(() => fn(...args), ms); };
}

export function setPath(obj, path, value) {
  const parts = path.split('.');
  let cur = obj;
  for (let i = 0; i < parts.length - 1; i++) {
    cur[parts[i]] = cur[parts[i]] || {};
    cur = cur[parts[i]];
  }
  cur[parts[parts.length - 1]] = value;
}

const DISCLAIMERS = {
  tax: 'This is an estimate for information only and is not tax advice. Please consult your tax consultant or chartered accountant before taking any decision.',
  invest: 'Projections and historical returns are for information only and are not investment advice. Please consult a SEBI-registered investment adviser or your financial advisor before investing.',
  loan: 'This is an illustration for information only and is not financial advice. Please consult your bank or financial advisor before changing your loan, and your tax consultant or chartered accountant for the tax treatment of interest.',
};
/** Standard disclaimer block. kind: 'tax' | 'invest' | 'loan' | array of kinds */
export function disclaimer(kind = 'tax') {
  const kinds = [].concat(kind);
  return el('div', { class: 'disclaimer', role: 'note' }, [el('strong', {}, 'Please note. '), kinds.map((k) => DISCLAIMERS[k]).join(' ')]);
}

/**
 * Animate a formatted number in `node` from its previous value (remembered by `key`) to `text`.
 * Keeps any prefix/suffix (₹, %, "yrs"). Respects prefers-reduced-motion.
 */
const PREV = new Map();
const REDUCED = typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
export function animateNumber(node, key, text) {
  const m = String(text).match(/-?[\d,]+(?:\.\d+)?/);
  const target = m ? parseFloat(m[0].replace(/,/g, '')) : NaN;
  const prev = PREV.get(key);
  PREV.set(key, target);
  if (!m || REDUCED || prev == null || !Number.isFinite(prev) || prev === target) { node.textContent = text; return; }
  const decimals = (m[0].split('.')[1] || '').length;
  const before = text.slice(0, m.index), after = text.slice(m.index + m[0].length);
  const useIndian = /,/.test(m[0]) || Math.abs(target) >= 1000;
  const fmt = (v) => useIndian && decimals === 0 ? formatIndian(Math.round(v)) : v.toFixed(decimals);
  const t0 = performance.now(), dur = 420;
  const step = (t) => {
    const p = Math.min(1, (t - t0) / dur), e = 1 - Math.pow(1 - p, 3);
    node.textContent = before + fmt(prev + (target - prev) * e) + after;
    if (p < 1) requestAnimationFrame(step); else node.textContent = text;
  };
  requestAnimationFrame(step);
}

/**
 * After Reset a calculator stays blank, including the fields it would otherwise pre-fill from the
 * shared profile, until the user types something. The marker lives outside the calculator's own store
 * so clearing that store does not lose it.
 */
const BLANK_KEY = 'taxcompass.calc-blank.v1';
function blankSet() { try { return new Set(JSON.parse(localStorage.getItem(BLANK_KEY) || '[]')); } catch { return new Set(); } }
function saveBlank(set) { try { localStorage.setItem(BLANK_KEY, JSON.stringify([...set])); } catch {} }
export function isBlankAfterReset(calc) { return blankSet().has(calc); }
export function markBlankAfterReset(calc) { const s = blankSet(); s.add(calc); saveBlank(s); }
export function clearBlankAfterReset(calc) { const s = blankSet(); if (s.delete(calc)) saveBlank(s); }
/** The empty-state card a calculator shows until its key figure is entered. */
export function beginPrompt(text) {
  return el('div', { class: 'notice' }, [el('strong', {}, text), ' Nothing is worked out until it is in.']);
}

export function numberInput(label, attrs = {}) {
  const input = el('input', { type: 'number', ...attrs });
  return { wrap: el('label', {}, [label, input]), input };
}
