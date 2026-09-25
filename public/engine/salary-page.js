/**
 * The salary pages (/salary and /salary/<n>-lakh): what a CTC pays in hand, the tax in each regime,
 * and where the old regime starts to win, written out as HTML. Pure (no DOM), so the edge middleware
 * renders the same page into the HTML a search engine fetches, and the app renders it on navigation.
 * Every figure is the quick answer's (js/quick-engine.js), itself the in-hand calculator's arithmetic.
 */
import { quickAnswer } from '../js/quick-engine.js';
import { formatIndian } from '../js/tax-engine.js';
import { SALARY_CTCS, salarySlug, ctcWords } from '../js/routes.js';

const inr = (n) => '₹' + formatIndian(Math.round(n || 0));
const pct = (x) => `${(100 * x).toFixed(1)}%`;
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const link = (ctc) => `<a href="/salary/${salarySlug(ctc)}">${ctcWords(ctc)}</a>`;

/** Everything a salary page says, as numbers and sentences. */
export function salaryPageModel(ctc, rates) {
  const a = quickAnswer({ ctc }, rates);
  const w = ctcWords(ctc), p = a.pay;
  const t = { new: a.cmp.new.tax, old: a.cmp.old.tax };
  const i = SALARY_CTCS.indexOf(ctc);
  const nearby = SALARY_CTCS.slice(Math.max(0, i - 3), i + 4).filter((c) => c !== ctc);
  const noTax = t.new.total === 0 && t.old.total === 0;
  const verdict = noTax ? `There is no income tax at ${w} in either regime.`
    : a.better === 'new' ? `The new regime saves ${inr(a.saves)} a year${a.needed ? `, unless your old-regime deductions add up to more than ${inr(a.needed)}` : ''}.`
    : `The old regime saves ${inr(a.saves)} a year even with nothing but PF.`;
  const answer = `On a CTC of ${inr(ctc)} you take home about ${inr(a.monthly.best)} a month (${inr(a.inHand.best)} a year) under the ${a.better} regime, after ${inr(p.employeePf / 12)} PF, ${inr(p.professionalTax / 12)} professional tax and ${inr(a.tax[a.better] / 12)} income tax a month. ${verdict}`;

  const faq = [
    { q: `What is the in-hand salary on a ${w} CTC?`, a: `About ${inr(a.monthly.best)} a month under the ${a.better} regime: ${inr(p.grossSalary / 12)} of gross pay, less ${inr(p.employeePf / 12)} PF, ${inr(p.professionalTax / 12)} professional tax and ${inr(a.tax[a.better] / 12)} income tax. That assumes Basic at 40% of the CTC with employer PF and gratuity inside it; a larger Basic means more PF and a little less in hand.` },
    { q: `How much income tax is paid on a ${w} salary?`, a: noTax ? `None in either regime at this income.` : `${inr(t.new.total)} a year in the new regime (${inr(t.new.total / 12)} a month, ${pct(t.new.total / ctc)} of the CTC), and ${inr(t.old.total)} in the old regime with no deductions beyond PF. Both include the 4% health and education cess.` },
    { q: `Is the old or the new tax regime better for ${w}?`, a: noTax ? `Neither costs anything at this income, so the choice does not matter.` : a.better === 'new' ? `The new regime, by ${inr(a.saves)} a year, for most people. The old regime wins only when its deductions (the HRA exemption, 80C including your PF, home-loan interest, health insurance and your own NPS) add up to more than ${inr(a.needed)}.` : `The old regime, by ${inr(a.saves)} a year.` },
  ];
  if (t.new.total === 0 && t.new.rebate > 0) {
    const r = rates.rebate, sec = r.section || {};
    faq.push({ q: `Why is there no tax at ${w} in the new regime?`, a: `Taxable income works out to ${inr(t.new.totalIncome)} after the ${inr(p.grossSalary - t.new.totalIncome)} standard deduction. Up to ${inr(r.new_regime.total_income_threshold)} of taxable income, the rebate (section ${sec.act_2025 || '156'} of the Income-tax Act 2025, formerly ${sec.act_1961 || '87A'}) cancels the tax in the new regime.` });
  }

  return {
    ctc, w, slug: salarySlug(ctc), a, answer, faq, nearby,
    breakup: [
      ['Basic', p.basic], ['HRA', p.hra], ['Special allowance', p.special],
      ['Gross pay', p.grossSalary, 'sum'],
      ['Employer PF (in the CTC, not paid to you)', p.employerPf, 'muted'], ['Gratuity (in the CTC, paid when you leave)', p.gratuity, 'muted'],
      ['Your PF (12% of Basic)', -p.employeePf], ['Professional tax', -p.professionalTax], [`Income tax, ${a.better} regime`, -a.tax[a.better]],
      ['In hand', a.inHand.best, 'total'],
    ],
    regimes: [
      ['Taxable income', t.new.totalIncome, t.old.totalIncome],
      ['Income tax and cess, a year', t.new.total, t.old.total],
      ['Income tax, a month', t.new.total / 12, t.old.total / 12],
      ['In hand, a month', a.monthly.new, a.monthly.old],
    ],
  };
}

/** The page body: served inside <div id="salary-ssr">. The interactive card mounts into #salary-quick. */
export function salaryPageHtml(m) {
  const money = (v) => (v < 0 ? `−${inr(-v)}` : inr(v));
  const row = ([k, v, cls]) => `<tr${cls ? ` class="${cls}"` : ''}><td>${esc(k)}</td><td>${money(v)}</td><td>${money(v / 12)}</td></tr>`;
  const better = m.a.better;
  return `
<div class="panel-head">
  <span class="eyebrow">In-hand salary · FY 2026-27</span>
  <h1>${esc(m.w)} salary: ${inr(m.a.monthly.best)} in hand a month</h1>
  <p class="sp-answer">${esc(m.answer)}</p>
  <p class="sp-nav"><a href="/salary">Every salary</a>${m.nearby.length ? ' · ' + m.nearby.map(link).join(' · ') : ''}</p>
</div>
<section class="card sp-block">
  <h2>The ${esc(m.w)} CTC, month by month</h2>
  <div class="table-wrap"><table class="compare sp-table">
    <thead><tr><th></th><th>A year</th><th>A month</th></tr></thead>
    <tbody>${m.breakup.map(row).join('')}</tbody>
  </table></div>
  <p class="muted small">Basic at 40% of the CTC, HRA half of Basic, employer PF and gratuity inside the CTC, ₹2,400 professional tax, age under 60. Change any of it below or in the <a href="/calculators/salary">in-hand salary calculator</a>.</p>
</section>
<section class="card sp-block">
  <h2>Old vs new regime at ${esc(m.w)}</h2>
  <div class="table-wrap"><table class="compare sp-table">
    <thead><tr><th></th><th${better === 'new' ? ' class="win"' : ''}>New regime</th><th${better === 'old' ? ' class="win"' : ''}>Old regime</th></tr></thead>
    <tbody>${m.regimes.map(([k, n, o]) => `<tr><td>${esc(k)}</td><td>${inr(n)}</td><td>${inr(o)}</td></tr>`).join('')}</tbody>
  </table></div>
  <p>${esc(m.faq[2].a)}</p>
</section>
<h2 class="sp-h2">Your own deductions</h2>
<div id="salary-quick" class="quick-slot"></div>
<section class="card sp-block sp-faq">
  <h2>Questions people ask about a ${esc(m.w)} salary</h2>
  ${m.faq.map((f) => `<h3>${esc(f.q)}</h3><p>${esc(f.a)}</p>`).join('\n  ')}
</section>
<p class="sp-nav">Other salaries: ${m.nearby.map(link).join(' · ')} · <a href="/salary">every salary from ₹3 lakh to ₹2 crore</a></p>`;
}

/** schema.org FAQPage for the page's questions, for the <head>. */
export function salaryJsonLd(m) {
  return { '@context': 'https://schema.org', '@type': 'FAQPage', mainEntity: m.faq.map((f) => ({ '@type': 'Question', name: f.q, acceptedAnswer: { '@type': 'Answer', text: f.a } })) };
}

/** /salary: every page in one table. */
export function salaryIndexHtml(rates) {
  const rows = SALARY_CTCS.map((ctc) => {
    const a = quickAnswer({ ctc }, rates);
    return `<tr><td><a href="/salary/${salarySlug(ctc)}">${ctcWords(ctc)}</a></td><td>${inr(a.monthly.best)}</td><td>${inr(a.tax.new)}</td><td>${inr(a.tax.old)}</td><td>${a.tax.new === 0 && a.tax.old === 0 ? 'no tax either way' : `${a.better}, by ${inr(a.saves)}`}</td></tr>`;
  }).join('');
  return `
<div class="panel-head">
  <span class="eyebrow">In-hand salary · FY 2026-27</span>
  <h1>In-hand salary for every CTC, ₹3 lakh to ₹2 crore</h1>
  <p class="sp-answer">What each CTC pays in hand a month, the income tax in each regime, and which one is cheaper with no deductions beyond PF. Open any salary for the full breakup and the deductions at which the old regime wins, or <a href="/">type your own CTC</a>.</p>
</div>
<div class="table-wrap"><table class="compare sp-table sp-index">
  <thead><tr><th>CTC</th><th>In hand a month</th><th>Tax, new regime</th><th>Tax, old regime</th><th>Cheaper regime</th></tr></thead>
  <tbody>${rows}</tbody>
</table></div>
<p class="muted small">Basic at 40% of the CTC, HRA half of Basic, employer PF and gratuity inside the CTC, ₹2,400 professional tax, age under 60, FY 2026-27. An estimate, not tax advice.</p>`;
}
