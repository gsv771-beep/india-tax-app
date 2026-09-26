/**
 * "Saved to your profile — Undo". Tools write facts back to the shared profile as you work, which is
 * what lets every other tool start from your figures, and also how a figure typed in one place can
 * quietly change another. So every write a person causes is announced, says what changed, and can be
 * taken back with one click.
 *
 * A burst of writes from one tool (typing a salary digit by digit) is one change: undo restores the
 * profile as it was before the burst began. Writes nobody caused (a page loading, a profile being
 * restored) and edits made in the profile panel itself are not announced.
 */
import { getProfile, updateProfile } from './profile-store.js';
import { inr } from './util.js';
import { isEmptyProfile } from '../engine/profile.js';

const LABEL = {
  tax: 'the tax comparison', 'calc:salary': 'the in-hand salary calculator', 'calc:emi': 'the EMI calculator',
  'calc:home': 'the home-buying tool', 'calc:goal': 'the goal planner', 'calc:retirement': 'the retirement planner',
  snapshot: 'the home page', 'calc:budget': 'the budget',
  'quick:home': 'the home page', 'quick:tax': 'the tax page', 'quick:salary': 'the in-hand salary page', 'quick:salarypage': 'the salary page',
};
const QUIET = new Set(['panel', 'undo', 'wipe', 'import', 'fixture', 'unknown']);
const BURST_MS = 2500;        // writes closer together than this are one change
const USER_MS = 3000;         // a write this soon after a key or click was caused by the person
const SHOW_MS = 9000;

let lastInteraction = 0;
let before = null;            // the profile as it was before the current burst
let burstSource = null, burstEnd = 0;
let tracked = null;           // the profile as last seen, to diff against
let hideTimer = null;

function describe(a, b) {
  const out = [];
  if (a.income.ctc !== b.income.ctc) out.push(b.income.ctc ? `CTC ${a.income.ctc ? inr(a.income.ctc) + ' → ' : ''}${inr(b.income.ctc)}` : 'salary cleared');
  if ((a.business || {}).receipts !== (b.business || {}).receipts) out.push(`receipts ${inr((b.business || {}).receipts || 0)}`);
  if (a.tax.regime !== b.tax.regime) out.push(`${b.tax.regime} regime`);
  if (a.loans.length !== b.loans.length) out.push(b.loans.length > a.loans.length ? 'a loan added' : 'a loan removed');
  else if (JSON.stringify(a.loans) !== JSON.stringify(b.loans)) out.push('loan figures');
  if (a.horizon.goals.length !== b.horizon.goals.length) out.push(b.horizon.goals.length > a.horizon.goals.length ? 'a goal added' : 'a goal removed');
  else if (JSON.stringify(a.horizon.goals) !== JSON.stringify(b.horizon.goals)) out.push('a goal updated');
  if (a.person.age !== b.person.age) out.push(`age ${b.person.age}`);
  if (a.cashflow.monthlySurplus !== b.cashflow.monthlySurplus) out.push(`${inr(b.cashflow.monthlySurplus)} free each month`);
  if (a.location.city !== b.location.city || a.location.rentPaid !== b.location.rentPaid) out.push('home and rent');
  if (JSON.stringify(a.tax) !== JSON.stringify(b.tax) && a.tax.regime === b.tax.regime) out.push('deductions');
  return out;
}

function toastNode() {
  let t = document.getElementById('profile-toast');
  if (t) return t;
  t = document.createElement('div');
  t.id = 'profile-toast'; t.className = 'profile-toast'; t.setAttribute('role', 'status'); t.setAttribute('aria-live', 'polite'); t.hidden = true;
  document.body.append(t);
  return t;
}

function show(message, withUndo) {
  const t = toastNode();
  t.replaceChildren();
  const text = document.createElement('span'); text.textContent = message; t.append(text);
  if (withUndo) {
    const undo = document.createElement('button'); undo.type = 'button'; undo.className = 'toast-undo'; undo.textContent = 'Undo';
    undo.addEventListener('click', () => {
      const restore = before;
      before = null; burstSource = null;
      if (restore) updateProfile(() => restore, 'undo');
      show('Undone. Your profile is as it was.', false);
    });
    t.append(undo);
  }
  const close = document.createElement('button'); close.type = 'button'; close.className = 'toast-close'; close.setAttribute('aria-label', 'Dismiss'); close.textContent = '×';
  close.addEventListener('click', () => { t.hidden = true; });
  t.append(close);
  t.hidden = false;
  clearTimeout(hideTimer);
  hideTimer = setTimeout(() => { t.hidden = true; }, withUndo ? SHOW_MS : 3000);
}

export function initProfileUndo() {
  if (typeof window === 'undefined') return;
  tracked = getProfile();
  const mark = () => { lastInteraction = Date.now(); };
  ['input', 'change', 'click', 'keydown'].forEach((e) => document.addEventListener(e, mark, true));
  window.addEventListener('profilechange', (e) => {
    const src = e.detail.source;
    const next = getProfile();
    const prev = tracked;
    tracked = next;
    const reset = src.startsWith('reset:');
    if (QUIET.has(src) || !(LABEL[src] || reset)) { if (src !== 'undo') { before = null; burstSource = null; } return; }
    if (Date.now() - lastInteraction > USER_MS) return;            // nobody did this; a page loading did
    const now = Date.now();
    if (!(burstSource === src && now < burstEnd && before)) before = prev;   // a new change starts here
    burstSource = src; burstEnd = now + BURST_MS;
    const what = describe(before, next);
    if (!what.length) return;
    // a first figure typed into the quick answer overwrites nothing; the toast would only cover the answer
    if (src.startsWith('quick:') && isEmptyProfile(before)) return;
    if (reset) { show('Started over: your salary and deductions are cleared. Loans, savings and goals are kept.', true); return; }
    show(`Saved to your profile from ${LABEL[src]}: ${what.slice(0, 2).join(', ')}${what.length > 2 ? ' and more' : ''}.`, true);
  });
}
