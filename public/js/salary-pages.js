/**
 * /salary and /salary/<n>-lakh in the app. The edge already put the same HTML into #salary-ssr for a
 * first visit (functions/_middleware.js); on navigation inside the app it is rendered here, and the
 * interactive quick answer is mounted into the page for the reader's own deductions.
 */
import { salaryPageModel, salaryPageHtml, salaryIndexHtml } from '../engine/salary-page.js';
import { ctcFromSlug } from './routes.js';
import { mountQuick } from './quick.js';

export function showSalaryPage(sub, { rates }) {
  const root = document.getElementById('salary-ssr');
  if (!root || !rates) return;
  const ctc = ctcFromSlug(sub);
  const key = ctc ? `ctc:${ctc}` : 'index';
  if (root.dataset.shown !== key) {
    root.innerHTML = ctc ? salaryPageHtml(salaryPageModel(ctc, rates)) : salaryIndexHtml(rates);
    root.dataset.shown = key;
  }
  if (ctc) mountQuick(document.getElementById('salary-quick'), {
    rates, source: 'quick:salarypage', ctc, showLadder: false,
    salaryLink: { href: '/calculators/salary#detail', text: 'See the full payslip split →' },
    taxLink: { href: '/tax#detail', text: 'Every line of the tax, both regimes →' },
  });
}
