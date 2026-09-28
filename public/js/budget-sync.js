/**
 * Keeps the Expenses and savings calculator's income in step with the salary, even while that page
 * is closed. A budget whose income came from the salary (incomeFrom 'salary') follows every change
 * to the CTC made anywhere on the site, and so does the "free each month" it writes to the profile.
 * A budget income the person typed themselves is never overwritten; the budget page offers the new
 * figure instead.
 */
import { onProfileChange, updateProfile } from './profile-store.js';
import { toSalaryStore, isEmptyProfile } from '../engine/profile.js';
import { salaryBreakdown } from '../engine/salary-split.js';

export const BUDGET_KEY = 'taxcompass.budget.v1';
export const SYNC_SOURCE = 'budget-sync';

/** The monthly in-hand the profile's salary implies, or 0 when there is no salary. */
export function salaryMonthly(p, rates) {
  if (!rates || isEmptyProfile(p) || !(p.income.ctc > 0)) return 0;
  const r = salaryBreakdown(toSalaryStore(p), rates);
  return !r.error && r.monthly > 0 ? Math.round(r.monthly) : 0;
}

/** Free each month after expenses, the figure the budget writes to the profile. */
const freeAfterExpenses = (st) => Math.max(0, Math.round((+st.income || 0) - (st.expenses || []).reduce((s, e) => s + (+e.amount || 0), 0)));

export function initBudgetSync({ rates }) {
  onProfileChange((p, source) => {
    if (source === 'calc:budget' || source === SYNC_SOURCE) return;
    let st; try { st = JSON.parse(localStorage.getItem(BUDGET_KEY) || 'null'); } catch { st = null; }
    if (!st || st.incomeFrom !== 'salary') return;
    const monthly = salaryMonthly(p, rates);
    if (monthly === Math.round(+st.income || 0)) return;
    st.income = monthly;
    try { localStorage.setItem(BUDGET_KEY, JSON.stringify(st)); } catch {}
    const free = monthly > 0 ? freeAfterExpenses(st) : 0;
    updateProfile((d) => { d.cashflow.monthlySurplus = free; return d; }, SYNC_SOURCE);
  });
}
