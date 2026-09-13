/**
 * Glossary tooltips: wraps known terms in labels with a dotted underline; hover, focus or tap
 * shows the glossary definition. One floating tip element for the whole page.
 */
import { el } from './util.js';

let DEFS = new Map();
// order matters: longer, more specific patterns first
const PATTERNS = [
  [/\b80CCD\(1B\)/g, 'Section 80CCD(1B)'], [/\b80CCD\(2\)/g, 'Section 80CCD(2)'], [/\b80TTA\b|\b80TTB\b/g, 'Section 80TTA / 80TTB'],
  [/\b80C\b/g, 'Section 80C'], [/\b80D\b/g, 'Section 80D'], [/\b24\(b\)/g, 'Section 24(b)'],
  [/marginal relief/gi, 'Marginal Relief'], [/standard deduction/gi, 'Standard Deduction'], [/\brebate\b/gi, 'Rebate under Section 87A / 156'],
  [/\bsurcharge\b/gi, 'Surcharge'], [/\bcess\b/gi, 'Health and Education Cess'], [/\bHRA\b/g, 'HRA'], [/\bLTA\b/g, 'LTA / LTC'],
  [/\bperquisites?\b/gi, 'Perquisite'], [/gross total income/gi, 'Gross Total Income'], [/\btotal income\b/gi, 'Total Income'],
  [/chapter vi-a/gi, 'Chapter VI-A'], [/net annual value/gi, 'Net Annual Value'], [/\bSTCG\b/g, 'Short-Term Capital Gain (STCG)'], [/\bLTCG\b/g, 'Long-Term Capital Gain (LTCG)'],
  [/\bset[- ]off\b/gi, 'Set-off'], [/carried? forward/gi, 'Carry Forward'], [/\bNPS\b/g, 'NPS'], [/\bEPF\b/g, 'EPF'], [/\bPPF\b/g, 'PPF'], [/\bELSS\b/g, 'ELSS'],
];

export function initGlossaryTooltips(glossary) {
  DEFS = new Map(glossary.terms.map((t) => [t.term, t.def]));
  const tip = el('div', { class: 'gl-tip', role: 'tooltip', hidden: true });
  document.body.append(tip);
  let current = null;
  const show = (target) => {
    const term = target.dataset.term;
    const def = DEFS.get(term);
    if (!def) return;
    tip.replaceChildren(el('strong', {}, term), document.createTextNode(' ' + def));
    tip.hidden = false;
    const r = target.getBoundingClientRect();
    const w = Math.min(340, window.innerWidth - 24);
    tip.style.width = w + 'px';
    let left = r.left + window.scrollX + r.width / 2 - w / 2;
    left = Math.max(12 + window.scrollX, Math.min(left, window.scrollX + window.innerWidth - w - 12));
    tip.style.left = left + 'px';
    const above = r.top > 160;
    tip.style.top = (above ? r.top + window.scrollY - tip.offsetHeight - 10 : r.bottom + window.scrollY + 10) + 'px';
    current = target;
  };
  const hide = () => { tip.hidden = true; current = null; };
  document.addEventListener('mouseover', (e) => { const t = e.target.closest('.gl'); if (t) show(t); });
  document.addEventListener('mouseout', (e) => { if (e.target.closest && e.target.closest('.gl') && !(e.relatedTarget && e.relatedTarget.closest && e.relatedTarget.closest('.gl-tip'))) hide(); });
  document.addEventListener('focusin', (e) => { const t = e.target.closest && e.target.closest('.gl'); if (t) show(t); });
  document.addEventListener('focusout', (e) => { if (e.target.closest && e.target.closest('.gl')) hide(); });
  document.addEventListener('click', (e) => { const t = e.target.closest && e.target.closest('.gl'); if (t) { e.preventDefault(); current === t ? hide() : show(t); } else if (!e.target.closest('.gl-tip')) hide(); });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') hide(); });
  window.addEventListener('scroll', hide, { passive: true });
}

/** Return a DocumentFragment of `text` with glossary terms wrapped. */
export function termify(text) {
  const frag = document.createDocumentFragment();
  if (!DEFS.size || typeof text !== 'string') { frag.append(document.createTextNode(String(text))); return frag; }
  // find all matches, keep non-overlapping earliest/longest
  const found = [];
  for (const [re, term] of PATTERNS) {
    if (!DEFS.has(term)) continue;
    re.lastIndex = 0;
    let m;
    while ((m = re.exec(text))) found.push({ start: m.index, end: m.index + m[0].length, term, text: m[0] });
  }
  found.sort((a, b) => a.start - b.start || b.end - a.end);
  let pos = 0;
  for (const f of found) {
    if (f.start < pos) continue;
    if (f.start > pos) frag.append(document.createTextNode(text.slice(pos, f.start)));
    frag.append(el('abbr', { class: 'gl', tabindex: 0, 'data-term': f.term, title: '' }, f.text));
    pos = f.end;
  }
  if (pos < text.length) frag.append(document.createTextNode(text.slice(pos)));
  return frag;
}
