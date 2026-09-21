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
import { mixReturn } from '../engine/mix.js';
import { baseRates, loadMixRates } from './mix-rates.js';
import { mixControl } from './mix-control.js';
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
  const st = { age: '', retireAt: 60, monthlyExpenses: '', saved: '', monthlyInvesting: '', expensesAfterPct: 80, inflationPct: 6, equityBeforePct: 60, equityAfterPct: 30, equityRate: '', safeRate: '', planUntil: 85, stepUpPct: 5, ...saved, ...fromProfile };
  let rates = baseRates(schemes);
  const effRates = () => ({ ...rates, equity: st.equityRate === '' ? rates.equity : +st.equityRate, safe: st.safeRate === '' ? rates.safe : +st.safeRate });
  // the growth rates follow from the equity share and two labelled rates; nothing is typed in blind
  const growth = () => ({ before: mixReturn(st.equityBeforePct, effRates()), after: mixReturn(st.equityAfterPct, effRates()) });
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
  const mixBefore = mixControl({ label: 'Until you retire: how much of your savings in equity', hint: 'the rest in EPF, PPF, deposits, debt funds', value: st.equityBeforePct, rates: effRates(), onChange: (v) => { st.equityBeforePct = v; save(); rerender(); } });
  const mixAfter = mixControl({ label: 'After you retire: how much stays in equity', hint: 'a 25-year retirement still needs some growth', value: st.equityAfterPct, rates: effRates(), onChange: (v) => { st.equityAfterPct = v; save(); rerender(); } });
  const eqField = field('equityRate', 'Equity returns (% a year)', { step: 0.1, max: 30, placeholder: String(rates.equity) }, rates.sources.equity);
  const inputs = el('div', { class: 'card inputs' }, [
    el('div', { class: 'opts', style: 'border-top:0;padding-top:0' }, [
      el('div', { class: 'opt-title' }, 'Five things'),
      el('div', { class: 'two' }, [field('age', 'Your age', { step: 1, max: 80, placeholder: 'e.g. 35' }), field('retireAt', 'Retire at', { step: 1, max: 80 })]),
      field('monthlyExpenses', 'What you spend a month today (₹)', { step: 5000, placeholder: 'e.g. 80000' }, 'the household, not just you'),
      field('saved', 'Saved and invested so far (₹)', { step: 100000, placeholder: 'e.g. 2500000' }, 'EPF, PPF, NPS, funds, deposits: everything meant for later'),
      field('monthlyInvesting', 'Going into savings each month (₹)', { step: 1000, placeholder: 'e.g. 40000' }, 'EPF included; it is savings too'),
    ]),
    el('div', { class: 'opts' }, [el('div', { class: 'opt-title' }, 'How much risk'), mixBefore.node, mixAfter.node]),
    el('details', { class: 'opts fold' }, [
      el('summary', {}, 'Assumptions (plain defaults; change what you know better)'),
      el('div', { class: 'two' }, [field('inflationPct', 'Prices rise each year (%)', { step: 0.5, max: 15 }), field('expensesAfterPct', 'Spending after retiring, as % of today', { step: 5, max: 150 }, 'no commute or EMI, more on health')]),
      el('div', { class: 'two' }, [eqField, field('safeRate', 'Safe money returns (% a year)', { step: 0.1, max: 15, placeholder: String(rates.safe) }, rates.sources.safe)]),
      el('div', { class: 'two' }, [field('planUntil', 'Plan for money until age', { step: 1, max: 100 }), field('stepUpPct', 'Raise savings each year by (%)', { step: 1, max: 30 }, 'as your income grows')]),
    ]),
  ]);

  function paint() {
    if (!(+st.age > 0) || !(+st.monthlyExpenses > 0) || !(+st.retireAt > +st.age)) { setChildren(out, [beginPrompt('Enter your age, when you want to retire, and what you spend a month.')]); last = null; return; }
    const g = growth();
    mixBefore.update({ rates: effRates() }); mixAfter.update({ rates: effRates() });
    const st2 = { ...st, growBeforePct: g.before.typical, growAfterPct: g.after.typical };
    const r = retirement(st2);
    const epfMonthly = !isEmptyProfile(p) && p.income.basic > 0 ? Math.round(p.income.basic * 0.24 / 12) : 0;
    const build = buildPlan({ age: +st.age, monthly: (+st.monthlyInvesting || 0) + (r.gap > 0 ? r.gapSip : 0), epfMonthly, regime: p.tax.regime, equityPct: st.equityBeforePct, selfEmployed: p.person.employment !== 'salaried' }, planRates);
    const drawCorpus = Math.max(r.corpusAtRetirement, r.corpusNeeded);   // plan the drawdown on the pot that actually lasts
    const draw = drawPlan({ corpus: drawCorpus, firstYearSpend: r.firstYearSpend, planUntil: r.planUntil, retireAt: r.retireAt }, planRates);
    const later = retirement({ ...st2, retireAt: +st.retireAt + 2 });
    const hotter = retirement({ ...st2, inflationPct: +st.inflationPct + 1 });
    const rough = retirement({ ...st2, growBeforePct: g.before.bad });
    last = { st: { ...st2 }, r, build, draw, mix: { before: g.before, after: g.after, rates: effRates() } };
    const stat = (k, v, cls = '') => el('div', { class: 'stat ' + cls }, [el('div', { class: 'k' }, k), el('div', { class: 'v' }, v)]);
    const ok = r.gap <= 0;
    const ages = r.years.map((y) => y.age);
    const chart = lineChart({
      series: [{ name: 'Your savings', color: ok ? '#1d6b3d' : '#b7861c', area: true, points: r.years.map((y) => [y.age, y.corpus]) }],
      markers: [{ x: r.retireAt, y: r.corpusNeeded, label: `Needed at ${r.retireAt}: ${inr(r.corpusNeeded)}`, color: ok ? '#1d6b3d' : '#9b1c1c' }],
      vlines: [{ x: r.retireAt, label: 'Retire' }],
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
        st.equityBeforePct > 0 ? el('li', {}, `Equity has a stretch like its worst 5 years (${g.before.bad.toFixed(1)}% on your mix instead of ${g.before.typical.toFixed(1)}%): ${rough.gap <= 0 ? `still fine, ${inr(rough.surplusAtEnd)} left at ${rough.planUntil}` : `money runs out at ${rough.shortfallAt}; gap ${inr(rough.gapSip)} a month`}.`) : null,
      ]),
      el('div', { class: 'card next-steps' }, [
        el('h3', { style: 'margin-top:0' }, `How to build it: ${inr(build.reduce((s, b) => s + b.amount, 0))} a month${r.gap > 0 ? ` (what you save now plus the ${inr(r.gapSip)} extra)` : ''}`),
        el('div', { class: 'table-wrap' }, el('table', { class: 'compare' }, [
          el('thead', {}, el('tr', {}, [el('th', {}, 'Where'), el('th', {}, 'A month'), el('th', {}, 'Why')])),
          el('tbody', {}, build.map((b) => el('tr', {}, [el('td', {}, b.label), el('td', {}, inr(b.amount)), el('td', { class: 'small' }, b.why)]))),
        ])),
        el('p', { class: 'muted small' }, `The equity share is the ${st.equityBeforePct}% you chose above (a common rule of thumb is 110 minus your age); the order (EPF, NPS, equity, PPF) is what the tax rules reward.`),
      ]),
      el('div', { class: 'card next-steps' }, [
        el('h3', { style: 'margin-top:0' }, r.gap > 0 ? `At ${r.retireAt}, once you have closed the gap and reached ${inr(r.corpusNeeded)}: three buckets` : `At ${r.retireAt}, with ${inr(r.corpusAtRetirement)}: three buckets`),
        el('div', { class: 'table-wrap' }, el('table', { class: 'compare' }, [
          el('thead', {}, el('tr', {}, [el('th', {}, 'Bucket'), el('th', {}, 'Amount'), el('th', {}, 'Held in'), el('th', {}, 'Why')])),
          el('tbody', {}, draw.buckets.map((b) => el('tr', {}, [el('td', {}, b.label), el('td', {}, inr(b.amount)), el('td', { class: 'small' }, b.where), el('td', { class: 'small' }, b.why)]))),
        ])),
        el('ul', { class: 'levers' }, draw.rules.map((t) => el('li', {}, t))),
      ]),
      el('p', { class: 'muted small' }, `A fair idea, not a plan. Your ${st.equityBeforePct}% equity mix is taken to grow at about ${g.before.typical.toFixed(1)}% a year until you retire, and the ${st.equityAfterPct}% mix at ${g.after.typical.toFixed(1)}% after; prices rise steadily; no big one-off costs. Tax at withdrawal is not modelled: EPF and PPF are tax-free, equity gains pay 12.5%, so the picture is a little rosy for equity-heavy savers. Check it once a year.`),
      el('div', { class: 'btn-row' }, [
        r.gap > 0 ? el('a', { class: 'btn', href: '/calculators/compare' }, 'Where should the extra savings go?') : null,
        el('a', { class: 'btn secondary', href: '/nps' }, 'How NPS fits in'),
      ]),
      disclaimer('invest'),
    ]);
  }
  paint();
  loadMixRates(schemes).then((r) => { rates = r; eqField.querySelector('input').placeholder = String(r.equity); eqField.querySelector('small').textContent = r.sources.equity; paint(); });
  return el('div', { class: 'calc' }, [inputs, el('div', {}, [out, exportCard])]);
}
