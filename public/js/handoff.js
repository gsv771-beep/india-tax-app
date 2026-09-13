/**
 * Passing numbers between calculators ("use my take-home as budget income", "invest the left-over as a SIP").
 * A handoff is written before navigating and consumed once by the destination.
 */
import { el } from './util.js';

const KEY = 'taxcompass.handoff.v1';
const MAX_AGE_MS = 10 * 60 * 1000;

export function setHandoff(to, values, from) {
  try { localStorage.setItem(KEY, JSON.stringify({ to, values, from, at: Date.now() })); } catch {}
}

/** Returns { values, from } if a fresh handoff exists for `to`, and clears it. */
export function takeHandoff(to) {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return null;
    const h = JSON.parse(raw);
    if (h.to !== to || Date.now() - h.at > MAX_AGE_MS) return null;
    localStorage.removeItem(KEY);
    return { values: h.values, from: h.from };
  } catch { return null; }
}

const FROM_LABEL = {
  salary: ['your in-hand salary calculation', '/calculators/salary'],
  budget: ['your expenses and savings plan', '/calculators/budget'],
  emi: ['your EMI calculation', '/calculators/emi'],
};

/** A small note shown at the top of a calculator that was prefilled from another one. */
export function handoffNote(from, text) {
  const [label, href] = FROM_LABEL[from] || [from, '/calculators'];
  return el('div', { class: 'notice handoff' }, [text || 'Prefilled from ', el('a', { href }, label), '. You can change any figure.']);
}

/** Set an input's value and let the calculator react as if the user typed it. */
export function fill(input, value) {
  if (input == null || value == null) return;
  input.value = value;
  input.dispatchEvent(new Event(input.tagName === 'SELECT' ? 'change' : 'input', { bubbles: true }));
}
