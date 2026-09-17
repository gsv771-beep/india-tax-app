/**
 * Retirement: five figures in, one sentence out. Will the money last, and if not, how much more a
 * month closes the gap. Assumptions are folded away with plain defaults. A fair idea, not a plan.
 * Engine: engine/retirement.js.
 */
import { inr, el, setChildren, disclaimer, debounce, isBlankAfterReset, clearBlankAfterReset, beginPrompt } from './util.js';
import { retirement, buildPlan, drawPlan } from '../engine/retirement.js';
import { lineChart } from './charts.js';
import { getProfile, updateProfile } from './profile-store.js';
import { isEmptyProfile, INVESTMENT_BUCKETS } from '../engine/profile.js';
import { calcExportCard } from './calc-export-card.js';

const STORE = 'taxcompass.retirement.v1';
const SOURCE = 'calc:retirement';

export function renderRetirement({ schemes }) {
  const ss = schemes.small_savings_rates_q2_fy2026_27;
  const epfRate = ((schemes.schemes || []).find((x) => x.id === 'epf') || {}).rate || 8.25;
  const planRates = { epf: epfRate, ppf: ss.ppf.rate, scss: ss.scss.rate };
  const p = getProfile();
  const blank = isBlankAfterReset('retirement');
  let saved = {}; try { saved = JSON.parse(localStorage.getItem(STORE) || '{}'); } catch {}
  const fromProfile = {};
  if (!blank && !isEmptyProfile(p)) {
    if (p.person.age > 0) fromProfile.age = p.person.age;
    const held = INVESTMENT_BUCKETS.reduce((s, b) => s + (p.investments[b] || 0), 0);
    if (held > 0) fromProfile.saved = held;
    if (p.cashflow.monthlySurplus > 0) fromProfile.monthlyInvesting = p.cashflow.monthlySurplus;
    const g = p.horizon.goals.find((x) => /retire/i.test(x.name) && x.years > 0);
    if (g && p.person.age > 0) fromProfile.retireAt = p.person.age + g.years;
  }
  const st = { age: '', retireAt: 60, monthlyExpenses: '', saved: '', monthlyInvesting: '', expensesAfterPct: 80, inflationPct: 6, growBeforePct: 10, growAfterPct: 7, planUntil: 85, stepUpPct: 5, ...saved, ...fromProfile };
  const save = () => {
    clearBlankAfterReset('retirement');
    try { localStorage.setItem(STORE, JSON.stringify(st)); } catch {}
    if (+st.age > 0) updateProfile((d) => { d.person.age = Math.round(+st.age); const yrs = Math.round(+st.retireAt - +st.age); if (yrs > 0) { const g = d.horizon.goals.find((x) => /retire/i.test(x.name)); if (g) g.years = yrs; else d.horizon.goals.push({ name: 'Retirement', years: yrs, target: 0 }); } return d; }, SOURCE);
  };

  const out = el('div');
  let last = null;
  const exportCard = calcExportCard('retirement', () => last);
  const render = () => paint();
  const rerender = debounce(render, 80);
  const field = (key, label, attrs = {}, hint) => {
    const input = el('input', { type: 'number', min: attrs.min ?? 0, max: attrs.max, step: attrs.step || 1, value: st[key] === '' ? '' : st[key], placeholder: attrs.placeholder });
    input.addEventListener('input', () => { st[key] = input.value === '' ? '' : +input.value; save(); rerender(); });
    return el('label', {}, [label, hint ? el('small', {}, hint) : null, input]);
  };
  const inputs = el('div', { class: 'card inputs' }, [
    el('div', { class: 'opts', style: 'border-top:0;padding-top:0' }, [
      el('div', { class: 'opt-title' }, 'Five things'),
      el('div', { class: 'two' }, [field('age', 'Your age', { step: 1, max: 80, placeholder: 'e.g. 35' }), field('retireAt', 'Retire at', { step: 1, max: 80 })]),
      field('monthlyExpenses', 'What you spend a month today (₹)', { step: 5000, placeholder: 'e.g. 80000' }, 'the household, not just you'),
      field('saved', 'Saved and invested so far (₹)', { step: 100000, placeholder: 'e.g. 2500000' }, 'EPF, PPF, NPS, funds, deposits: everything meant for later'),
      field('monthlyInvesting', 'Going into savings each month (₹)', { step: 1000, placeholder: 'e.g. 40000' }, 'EPF included; it is savings too'),
    ]),
    el('details', { class: 'opts fold' }, [
      el('summary', {}, 'Assumptions (plain defaults; change what you know better)'),
      el('div', { class: 'two' }, [field('inflationPct', 'Prices rise each year (%)', { step: 0.5, max: 15 }), field('expensesAfterPct', 'Spending after retiring, as % of today', { step: 5, max: 150 }, 'no commute or EMI, more on health')]),
      el('div', { class: 'two' }, [field('growBeforePct', 'Savings grow at (%) until you retire', { step: 0.5, max: 20 }, 'a mix of EPF, PPF and equity funds has done about this'), field('growAfterPct', 'Savings grow at (%) after', { step: 0.5, max: 20 }, 'safer money, lower return')]),
      el('div', { class: 'two' }, [field('planUntil', 'Plan for money until age', { step: 1, max: 100 }), field('stepUpPct', 'Raise savings each year by (%)', { step: 1, max: 30 }, 'as your income grows')]),
    ]),
  ]);

  function paint() {
    if (!(+st.age > 0) || !(+st.monthlyExpenses > 0) || !(+st.retireAt > +st.age)) { setChildren(out, [beginPrompt('Enter your age, when you want to retire, and what you spend a month.')]); last = null; return; }
    const r = retirement(st);
    const epfMonthly = !isEmptyProfile(p) && p.income.basic > 0 ? Math.round(p.income.basic * 0.24 / 12) : 0;
    const build = buildPlan({ age: +st.age, monthly: (+st.monthlyInvesting || 0) + (r.gap > 0 ? r.gapSip : 0), epfMonthly, regime: p.tax.regime }, planRates);
    const drawCorpus = Math.max(r.corpusAtRetirement, r.corpusNeeded);   // plan the drawdown on the pot that actually lasts
    const draw = drawPlan({ corpus: drawCorpus, firstYearSpend: r.firstYearSpend, planUntil: r.planUntil, retireAt: r.retireAt }, planRates);
    const later = retirement({ ...st, retireAt: +st.retireAt + 2 });
    const hotter = retirement({ ...st, inflationPct: +st.inflationPct + 1 });
    last = { st: { ...st }, r, build, draw };
    const stat = (k, v, cls = '') => el('div', { class: 'stat ' + cls }, [el('div', { class: 'k' }, k), el('div', { class: 'v' }, v)]);
    const ok = r.gap <= 0;
    const ages = r.years.map((y) => y.age);
    const chart = lineChart({
      series: [{ name: 'Your savings', color: ok ? '#1d6b3d' : '#b7861c', area: true, points: r.years.map((y) => [y.age, y.corpus]) }, { name: 'Needed at retirement', color: '#8a948e', dash: true, points: [[r.retireAt, r.corpusNeeded]] }],
      xFormat: (x) => `Age ${Math.round(x)}`, xTipFormat: (x) => `At ${Math.round(x)}`, height: 240, ariaLabel: 'Savings by age, before and after retirement',
    });
    setChildren(out, [
      el('div', { class: 'stats' }, [
        stat(ok ? 'Your money lasts' : 'Your money runs out at', ok ? `past ${r.planUntil}` : `age ${r.shortfallAt}`, ok ? 'hi' : 'bad'),
        stat(`Saved by ${r.retireAt}`, inr(r.corpusAtRetirement)),
        stat(`Needed at ${r.retireAt}`, inr(r.corpusNeeded)),
        stat(ok ? `Left over at ${r.planUntil}` : 'Extra to save a month', ok ? inr(r.surplusAtEnd) : inr(r.gapSip), ok ? '' : 'hi'),
      ]),
      el('p', { class: 'explain' }, ok
        ? `On these numbers you reach ${r.retireAt} with about ${inr(r.corpusAtRetirement)}, spend ${inr(r.firstYearSpend / 12)} a month in the first year rising with prices, and still have ${inr(r.surplusAtEnd)} at ${r.planUntil}. Comfortable, with room for prices or health to surprise you.`
        : `On these numbers you reach ${r.retireAt} with about ${inr(r.corpusAtRetirement)} and need about ${inr(r.corpusNeeded)} to spend ${inr(r.firstYearSpend / 12)} a month rising with prices until ${r.planUntil}. The money runs out around ${r.shortfallAt}. Putting away ${inr(r.gapSip)} more a month from now closes the gap.`),
      el('div', { class: 'card', style: 'padding:12px 14px;margin-bottom:12px' }, [el('div', { class: 'viz-title' }, 'Savings by age'), chart]),
      el('ul', { class: 'levers' }, [
        el('li', {}, `Retire at ${+st.retireAt + 2} instead: the money ${later.gap <= 0 ? `lasts past ${later.planUntil} with ${inr(later.surplusAtEnd)} left` : `runs out at ${later.shortfallAt}; the gap falls to ${inr(later.gapSip)} a month`}.`),
        el('li', {}, `Prices rise ${+st.inflationPct + 1}% a year instead of ${st.inflationPct}%: ${hotter.gap <= 0 ? `still fine, ${inr(hotter.surplusAtEnd)} left at ${hotter.planUntil}` : `money runs out at ${hotter.shortfallAt}; gap ${inr(hotter.gapSip)} a month`}. Inflation moves this answer more than any fund choice.`),
      ]),
      el('div', { class: 'card next-steps' }, [
        el('h3', { style: 'margin-top:0' }, `How to build it: ${inr(build.reduce((s, b) => s + b.amount, 0))} a month${r.gap > 0 ? ` (what you save now plus the ${inr(r.gapSip)} extra)` : ''}`),
        el('div', { class: 'table-wrap' }, el('table', { class: 'compare' }, [
          el('thead', {}, el('tr', {}, [el('th', {}, 'Where'), el('th', {}, 'A month'), el('th', {}, 'Why')])),
          el('tbody', {}, build.map((b) => el('tr', {}, [el('td', {}, b.label), el('td', {}, inr(b.amount)), el('td', { class: 'small' }, b.why)]))),
        ])),
        el('p', { class: 'muted small' }, 'A rule of thumb with your numbers: the equity share is 110 minus your age, kept between 30% and 70%. Shift it if you know your own tolerance for a bad year; the order (EPF, NPS, equity, PPF) is what the tax rules reward.'),
      ]),
      el('div', { class: 'card next-steps' }, [
        el('h3', { style: 'margin-top:0' }, r.gap > 0 ? `At ${r.retireAt}, once you have closed the gap and reached ${inr(r.corpusNeeded)}: three buckets` : `At ${r.retireAt}, with ${inr(r.corpusAtRetirement)}: three buckets`),
        el('div', { class: 'table-wrap' }, el('table', { class: 'compare' }, [
          el('thead', {}, el('tr', {}, [el('th', {}, 'Bucket'), el('th', {}, 'Amount'), el('th', {}, 'Held in'), el('th', {}, 'Why')])),
          el('tbody', {}, draw.buckets.map((b) => el('tr', {}, [el('td', {}, b.label), el('td', {}, inr(b.amount)), el('td', { class: 'small' }, b.where), el('td', { class: 'small' }, b.why)]))),
        ])),
        el('ul', { class: 'levers' }, draw.rules.map((t) => el('li', {}, t))),
      ]),
      el('p', { class: 'muted small' }, 'A fair idea, not a plan. It assumes one growth rate for everything you save, prices rising steadily, and no big one-off costs. Tax at withdrawal is not modelled: EPF and PPF are tax-free, equity gains pay 12.5%, so the picture is a little rosy for equity-heavy savers. Check it once a year.'),
      el('div', { class: 'btn-row' }, [
        r.gap > 0 ? el('a', { class: 'btn', href: '/calculators/compare' }, 'Where should the extra savings go?') : null,
        el('a', { class: 'btn secondary', href: '/nps' }, 'How NPS fits in'),
      ]),
      disclaimer('invest'),
    ]);
  }
  paint();
  return el('div', { class: 'calc' }, [inputs, el('div', {}, [out, exportCard])]);
}
