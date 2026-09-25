/**
 * Debt triage: list what you owe, say what you can add each month, and see which order clears it
 * fastest, what the card is really costing, and whether the next rupee should prepay or be invested.
 * Loans pre-fill from the profile. Engine: engine/debt.js.
 */
import { inr, el, setChildren, disclaimer, debounce, isBlankAfterReset, clearBlankAfterReset, beginPrompt } from './util.js';
import { debtPlan, compareMethods, prepayVsInvest, effectiveAnnual, TRIAGE_RULES } from '../engine/debt.js';
import { lineChart } from './charts.js';
import { getProfile } from './profile-store.js';
import { isEmptyProfile } from '../engine/profile.js';
import { attachSlider, enhanceMoneyInputs } from './amount-input.js';
import { calcExportCard } from './calc-export-card.js';
import { resultLayout } from './result-layout.js';

const STORE = 'taxcompass.debt.v1';
const LOAN_LABEL = { home: 'Home loan', car: 'Car loan', personal: 'Personal loan', education: 'Education loan', other: 'Loan' };
const KINDS = [['card', 'Credit card'], ['personal', 'Personal loan'], ['home', 'Home loan'], ['car', 'Car loan'], ['education', 'Education loan'], ['other', 'Something else']];
const TYPICAL = { card: 42, personal: 15, home: 8.5, car: 9.5, education: 10, other: 12 };

export function renderDebt() {
  const p = getProfile();
  const blank = isBlankAfterReset('debt');
  let saved = {}; try { saved = JSON.parse(localStorage.getItem(STORE) || '{}'); } catch {}
  let st = { debts: [], extra: '', method: 'avalanche', investReturnPct: 11, slabRate: 0.3, ...saved };
  if (!st.debts.length && !blank && !isEmptyProfile(p) && p.loans.length) {
    // keep the EMI and the term exactly as the profile holds them: a rounded EMI adds a month to the payoff
    st.debts = p.loans.filter((l) => l.outstanding > 0).map((l) => ({ name: LOAN_LABEL[l.type] || 'Loan', balance: Math.round(l.outstanding), ratePct: l.rate || TYPICAL[l.type] || 12, minPayment: l.emi > 0 ? Math.round(l.emi) : 0, exactPayment: l.emi || 0, monthsLeft: l.remainingMonths || 0, kind: l.type }));
  }
  if (!st.debts.length) st.debts = [{ name: 'Credit card', balance: '', ratePct: 42, minPayment: '', kind: 'card' }];
  const save = () => { clearBlankAfterReset('debt'); try { localStorage.setItem(STORE, JSON.stringify(st)); } catch {} };

  const out = el('div');
  let last = null;
  const exportCard = calcExportCard('debt', () => last);
  const rows = el('div', { class: 'debt-rows' });
  const rerender = debounce(() => paint(), 80);

  const buildRows = () => {
    setChildren(rows, st.debts.map((d, i) => {
      const num = (key, label, attrs = {}) => {
        const input = el('input', { type: 'number', min: 0, step: attrs.step || 1, value: d[key] === '' ? '' : d[key], placeholder: attrs.placeholder });
        input.addEventListener('input', () => { d[key] = input.value === '' ? '' : +input.value; if (key === 'minPayment') d.exactPayment = 0; save(); rerender(); });
        return el('label', {}, [label, attrs.hint ? el('small', {}, attrs.hint) : null, input]);
      };
      // each debt is a small card: what it is across the top, where it can be read in full, then its three figures
      const kind = el('select', { class: 'debt-kind', 'aria-label': `Debt ${i + 1}: what it is` }, KINDS.map(([v, t]) => el('option', { value: v, selected: v === d.kind }, t)));
      kind.addEventListener('change', () => { d.kind = kind.value; d.name = KINDS.find(([v]) => v === kind.value)[1]; if (!d.ratePct || TYPICAL[d.kind]) d.ratePct = TYPICAL[d.kind]; save(); buildRows(); paint(); });
      return el('div', { class: 'debt-row' }, [
        el('div', { class: 'debt-row-head' }, [
          kind,
          el('button', { type: 'button', class: 'debt-remove', 'aria-label': `Remove ${KINDS.find(([v]) => v === d.kind)?.[1] || 'this debt'}`, onclick: () => { st.debts.splice(i, 1); if (!st.debts.length) st.debts = [{ name: 'Credit card', balance: '', ratePct: 42, minPayment: '', kind: 'card' }]; save(); buildRows(); paint(); } }, 'Remove'),
        ]),
        el('div', { class: 'debt-row-fields' }, [
          num('balance', 'Outstanding (₹)', { step: 10000, placeholder: 'e.g. 200000' }),
          num('ratePct', 'Rate, % a year', { step: 0.5 }),
          num('minPayment', 'Paid a month (₹)', { step: 1000, placeholder: 'e.g. 10000', hint: 'minimum due or EMI' }),
        ]),
      ]);
    }));
    enhanceMoneyInputs(rows);
  };
  buildRows();

  const field = (key, label, attrs = {}, hint) => {
    let input;
    if (attrs.options) input = el('select', {}, attrs.options.map(([v, t]) => el('option', { value: v, selected: String(v) === String(st[key]) }, t)));
    else input = el('input', { type: 'number', min: 0, step: attrs.step || 1, value: st[key] === '' ? '' : st[key], placeholder: attrs.placeholder });
    input.addEventListener(attrs.options ? 'change' : 'input', () => { st[key] = attrs.options ? (isNaN(+input.value) ? input.value : +input.value) : input.value === '' ? '' : +input.value; save(); attrs.options ? paint() : rerender(); });
    const node = el('label', {}, [label, hint ? el('small', {}, hint) : null, input]);
    if (attrs.slider) attachSlider(input, { max: attrs.slider, step: attrs.step || 1 });
    return { node, input };
  };
  const extraF = field('extra', 'Spare money you can add each month (₹)', { step: 2500, slider: 500000, placeholder: 'e.g. 20000' }, 'on top of the minimums above');
  const inputs = el('div', { class: 'card inputs' }, [
    el('div', { class: 'opts', style: 'border-top:0;padding-top:0' }, [
      el('div', { class: 'opt-title' }, 'What you owe'),
      rows,
      el('button', { type: 'button', class: 'btn secondary small-btn', onclick: () => { st.debts.push({ name: 'Personal loan', balance: '', ratePct: 15, minPayment: '', kind: 'personal' }); save(); buildRows(); paint(); } }, '+ Add another'),
    ]),
    extraF.node,
    el('details', { class: 'opts fold' }, [
      el('summary', {}, 'For the prepay-or-invest question'),
      field('investReturnPct', 'What investing would earn (% a year)', { step: 0.5, max: 20 }, 'before tax').node,
      field('slabRate', 'Your tax slab', { options: [[0, 'Nil'], [0.05, '5%'], [0.1, '10%'], [0.15, '15%'], [0.2, '20%'], [0.25, '25%'], [0.3, '30%']] }).node,
    ]),
  ]);

  function paint() {
    const live = st.debts.filter((d) => +d.balance > 0);
    if (!live.length) { setChildren(out, [beginPrompt('Add what you owe and the minimum you pay on each.')]); last = null; return; }
    const debts = live.map((d) => ({ ...d, balance: +d.balance || 0, ratePct: +d.ratePct || 0, minPayment: +d.exactPayment > 0 ? +d.exactPayment : +d.minPayment || 0 }));
    const extra = +st.extra || 0;
    const cmp = compareMethods({ debts, extra });
    const chosen = st.method === 'snowball' ? cmp.snowball : cmp.avalanche;
    const total = debts.reduce((s, d) => s + d.balance, 0);
    const worst = debts.slice().sort((a, b) => b.ratePct - a.ratePct)[0];
    const regime = (p.tax && p.tax.regime) || 'new';
    const homeLoan = debts.find((d) => d.kind === 'home');
    const pv = prepayVsInvest({ loanRatePct: (homeLoan || worst).ratePct, investReturnPct: st.investReturnPct, slabRate: +st.slabRate, regime, kind: (homeLoan || worst).kind, interestDeductibleLeft: homeLoan ? 200000 : 0 });
    last = { st: { ...st }, debts, cmp, chosen, pv, total };
    const stat = (k, v, cls = '') => el('div', { class: 'stat ' + cls }, [el('div', { class: 'k' }, k), el('div', { class: 'v' }, v)]);
    const methodBtn = (id, label) => el('button', { type: 'button', class: 'seg' + (st.method === id ? ' on' : ''), onclick: () => { st.method = id; save(); paint(); } }, label);
    setChildren(out, resultLayout({
      key: 'debt',
      answer: [
        el('div', { class: 'stats' }, [
        stat('You owe', inr(total)),
        stat(chosen.impossible ? 'Never clears' : 'Debt-free in', chosen.impossible ? 'at this rate' : `${chosen.years} years`, chosen.impossible ? 'bad' : 'hi'),
        stat('Interest you will pay', inr(chosen.totalInterest)),
        stat('Pay this first', cmp.firstAvalanche || '—'),
      ]),
        chosen.impossible ? el('div', { class: 'notice warn' }, chosen.note) : null,
        el('p', { class: 'explain' }, chosen.impossible ? 'At these payments the debt never clears.' : `Debt-free in ${chosen.years} years: send every spare rupee to ${cmp.firstAvalanche} first.`),
      ],
      why: [
        el('p', { class: 'explain' }, chosen.impossible
        ? `The minimums do not cover the interest on ${inr(total)} of debt, so the balance grows every month. Raising what you pay, or moving the expensive balance to a cheaper loan, is the only way out.`
        : `Paying the minimums plus ${inr(extra)} a month, and rolling each cleared payment into the next debt, clears ${inr(total)} in ${chosen.years} years and costs ${inr(chosen.totalInterest)} in interest. Send the spare money to ${cmp.firstAvalanche} first: it is the most expensive.${cmp.saving > 0 ? ` Clearing smallest-first instead would cost ${inr(cmp.saving)} more${cmp.monthsSaved > 0 ? ` and take ${cmp.monthsSaved} months longer` : ''}.` : ''}`),
      ],
      next: [
        el('div', { class: 'card next-steps' }, [
        el('h3', { style: 'margin-top:0' }, pv.better === 'prepay' ? 'The next spare rupee: prepay' : pv.better === 'invest' ? 'The next spare rupee: invest' : 'The next spare rupee: either, they are close'),
        el('p', {}, pv.why),
        el('p', { class: 'muted small' }, `Prepaying earns ${pv.prepayRate}% for certain; investing is ${pv.investRate}% after tax and is not. Anything above about 15% should be cleared before a rupee is invested.`),
      ]),
        { label: 'What a prepayment does to one loan', note: 'Years and interest saved on a single loan', href: '/calculators/emi' },
        { label: 'Find the spare money', note: 'Expenses against take-home, and what is genuinely free', href: '/calculators/budget' },
      ],
      details: [
        el('div', { class: 'card', style: 'padding:12px 14px;margin-bottom:12px' }, [
        el('div', { class: 'viz-title' }, 'What you owe, month by month'),
        lineChart({
          series: [
            { name: 'Highest rate first', color: '#1d6b3d', area: true, points: cmp.avalanche.schedule.map((x) => [x.month, x.outstanding]) },
            { name: 'Smallest balance first', color: '#b7861c', dash: true, points: cmp.snowball.schedule.map((x) => [x.month, x.outstanding]) },
          ],
          xFormat: (x) => `Month ${Math.round(x)}`, xTipFormat: (x) => `Month ${Math.round(x)}`, height: 230, ariaLabel: 'Outstanding debt by month under each order',
        }),
      ]),
        el('div', { class: 'card next-steps' }, [
        el('h3', { style: 'margin-top:0' }, 'The order to clear them'),
        el('div', { class: 'seg-group', style: 'margin-bottom:10px' }, [methodBtn('avalanche', 'Highest rate first'), methodBtn('snowball', 'Smallest balance first')]),
        el('div', { class: 'table-wrap' }, el('table', { class: 'compare' }, [
          el('thead', {}, el('tr', {}, [el('th', {}, 'Debt'), el('th', {}, 'Outstanding'), el('th', {}, 'Rate'), el('th', {}, 'Really costs'), el('th', {}, 'Cleared in')])),
          el('tbody', {}, debts.slice().sort((a, b) => b.ratePct - a.ratePct).map((d) => {
            const freed = chosen.freedAt.find((f) => f.name === d.name);
            return el('tr', {}, [el('td', {}, d.name), el('td', {}, inr(d.balance)), el('td', {}, `${d.ratePct}%`), el('td', { class: d.ratePct >= 20 ? 'neg' : '' }, `${effectiveAnnual(d.ratePct).toFixed(1)}% a year`), el('td', {}, freed ? `month ${freed.month}` : '—')]);
          })),
        ])),
        el('p', { class: 'muted small' }, '"Really costs" is the rate compounded monthly, which is how these are actually charged: a card at 42% a year charged monthly costs 51%.'),
      ]),
        el('div', { class: 'card next-steps' }, [el('h3', { style: 'margin-top:0' }, 'Before any of this'), el('ul', { class: 'levers' }, TRIAGE_RULES.map((t) => el('li', {}, t)))]),
      ],
      foot: [
        disclaimer('invest'),
      ],
      detailsLabel: 'Show the payoff chart, the order and the rules',
    }));
  }
  paint();
  queueMicrotask(() => enhanceMoneyInputs(inputs));
  return el('div', { class: 'calc' }, [inputs, el('div', {}, [out, exportCard])]);
}
