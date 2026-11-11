/**
 * Put your idle money to work: the money sitting in a savings account, and what the same money would
 * be worth after tax in a sweep-in FD, a liquid fund or an arbitrage fund. One amount (typed or
 * dragged), how long it can stay, and the tax slab; the rates, money added each month and the two tax
 * switches sit under More options. Engine: engine/idle-money.js; data: data/idle_money.json (typical
 * rates with their dates). It lays the figures side by side with how quickly each pays back and how
 * safe it is; it names no fund or bank and does not say where the money should go.
 */
import { inr, inrShort, el, setChildren, debounce, beginPrompt, rupees, readRupees, groupAsTyped } from './util.js';
import { compare } from '../engine/idle-money.js';
import { resultLayout } from './result-layout.js';
import { getProfile } from './profile-store.js';
import { isEmptyProfile, toTaxInputs } from '../engine/profile.js';
import { compareRegimes, slabBreakdown } from './tax-engine.js';
import { moreFold } from './calculators.js';
import { lineChart } from './charts.js';

const STORE = 'taxcompass.idle-money.v1';
const AMOUNT = { min: 0, max: 5000000, step: 10000 };
const PERIODS = [1, 3, 5];
const SLABS = [0, 5, 10, 15, 20, 25, 30];
const COLOR = { savings: 'var(--car-a)', sweep: 'var(--car-b)', liquid: 'var(--car-c)', arbitrage: 'var(--car-d)' };
const TAXED = {
  interest: 'The interest is added to your income every year and taxed at your slab.',
  slab_at_exit: 'The gain is taxed at your slab, but only when you take the money out.',
  equity: 'Taxed like shares when you take the money out: 20% on gains from money put in during the last 12 months, 12.5% on the rest above ₹1.25 lakh a year.',
};

/** The slab a saved salary reaches in the regime it is taxed under, and whether that is the old regime. */
function fromProfile(rates) {
  try {
    const p = getProfile();
    if (!rates || isEmptyProfile(p)) return null;
    const r = compareRegimes(toTaxInputs(p), rates);
    const regime = p.tax.regime === 'old' || p.tax.regime === 'new' ? p.tax.regime : r.better === 'old' ? 'old' : 'new';
    const bands = regime === 'new' ? rates.slabs.new_regime.bands : rates.slabs.old_regime.below_60;
    const rows = slabBreakdown(r[regime].income.slabIncome, bands);
    if (!rows.length) return null;
    return { slabPct: Math.round(rows[rows.length - 1].rate * 100), oldRegime: regime === 'old' };
  } catch { return null; }
}

export function renderIdleMoney(appData, data) {
  let saved = {}; try { saved = JSON.parse(localStorage.getItem(STORE) || '{}'); } catch {}
  const mine = fromProfile(appData?.rates);
  const st = { amount: '', monthly: '', years: data.defaults.years, slabPct: mine ? mine.slabPct : data.defaults.slab_pct, oldRegime: mine ? mine.oldRegime : false, ltcgExemptionUsed: false, rates: {}, ...saved };
  if (!PERIODS.includes(+st.years)) st.years = data.defaults.years;
  if (!SLABS.includes(+st.slabPct)) st.slabPct = data.defaults.slab_pct;
  const save = () => { try { localStorage.setItem(STORE, JSON.stringify(st)); } catch {} };
  const rerender = debounce(() => paint(), 80);
  const changed = () => { save(); rerender(); };

  // ---- the money: typed or dragged ----
  const amount = el('input', { type: 'text', inputmode: 'numeric', autocomplete: 'off', class: 'idle-amount', 'data-echo': 'own', placeholder: '5,00,000', 'aria-label': 'Money in your savings account that you do not need this month, in rupees', value: rupees(st.amount) });
  groupAsTyped(amount);
  const drag = el('input', { type: 'range', class: 'tc-range', min: AMOUNT.min, max: AMOUNT.max, step: AMOUNT.step, value: Math.min(AMOUNT.max, +st.amount || 0), 'aria-label': 'Money in your savings account, drag to set' });
  const fill = () => drag.style.setProperty('--fill', `${(100 * Math.min(AMOUNT.max, +st.amount || 0)) / AMOUNT.max}%`);
  amount.addEventListener('input', () => { st.amount = readRupees(amount.value) || ''; drag.value = Math.min(AMOUNT.max, +st.amount || 0); fill(); changed(); });
  drag.addEventListener('input', () => { st.amount = +drag.value || ''; amount.value = rupees(st.amount); fill(); changed(); });
  fill();

  // ---- how long, and the slab ----
  const periodBtns = PERIODS.map((y) => el('button', { type: 'button', 'aria-pressed': String(+st.years === y) }, `${y} year${y > 1 ? 's' : ''}`));
  periodBtns.forEach((b, i) => b.addEventListener('click', () => { st.years = PERIODS[i]; periodBtns.forEach((x, j) => x.setAttribute('aria-pressed', String(i === j))); changed(); }));
  const slabSel = el('select', { class: 'car-city', 'aria-label': 'Your tax slab' }, SLABS.map((s) => el('option', { value: s, selected: s === +st.slabPct }, s ? `${s}%` : 'Nil')));
  slabSel.addEventListener('change', () => { st.slabPct = +slabSel.value; changed(); });

  // ---- More options: money added each month, each rate, and the two tax switches ----
  const numField = (label, get, setv, attrs = {}, hint) => {
    const input = el('input', { type: 'number', min: 0, step: attrs.step || 1, max: attrs.max, value: get() ?? '', placeholder: attrs.placeholder || '', 'data-echo': attrs.money ? null : 'own' });
    input.addEventListener('input', () => { setv(input.value === '' ? '' : +input.value); changed(); });
    return el('label', {}, [el('span', { class: 'lbl' }, label), hint ? el('small', {}, hint) : null, input]);
  };
  const check = (label, key, hint) => {
    const input = el('input', { type: 'checkbox' }); input.checked = !!st[key];
    input.addEventListener('change', () => { st[key] = input.checked; changed(); });
    return el('label', { class: 'check idle-check' }, [input, el('span', {}, [label, hint ? el('small', {}, hint) : null])]);
  };
  const anyMore = +st.monthly > 0 || Object.values(st.rates || {}).some((v) => v !== '' && v != null) || st.ltcgExemptionUsed;
  const more = moreFold('Money added each month, the rate for each, tax details', anyMore, [
    numField('Added each month (₹)', () => st.monthly, (v) => { st.monthly = v; }, { step: 1000, money: true, placeholder: '0' }, 'what piles up in the account on top of it'),
    el('div', { class: 'opt-title' }, 'Rate assumed, % a year'),
    el('div', { class: 'two' }, data.options.map((o) => numField(o.label, () => st.rates[o.id], (v) => { st.rates[o.id] = v; }, { step: 0.05, max: 15, placeholder: String(o.rate_pct) }))),
    check('I am taxed under the old regime', 'oldRegime', 'the first ₹10,000 a year of savings-account interest is then tax-free (80TTA)'),
    check('My ₹1.25 lakh a year of tax-free equity gains is already used', 'ltcgExemptionUsed', 'by shares or equity funds sold in the same year; it matters only for the arbitrage fund'),
  ]);

  const inputs = el('div', { class: 'card inputs car-form idle-form' }, [
    el('label', { class: 'idle-amount-row' }, [el('span', { class: 'idle-amount-k' }, 'Money sitting in your savings account'), el('span', { class: 'idle-amount-box' }, [el('span', { 'aria-hidden': 'true' }, '₹'), amount])]),
    drag,
    el('div', { class: 'car-ends' }, [el('span', {}, 'What you do not need this month'), el('span', {}, '₹50 lakh')]),
    el('div', { class: 'car-row' }, el('span', {}, 'It can stay for')),
    el('div', { class: 'car-seg', role: 'group', 'aria-label': 'How long the money can stay' }, periodBtns),
    el('div', { class: 'car-row' }, [el('span', {}, ['Your tax slab', mine ? el('small', { class: 'idle-from' }, ' from your saved salary') : null]), slabSel]),
    more,
  ]);

  const out = el('div');
  function paint() {
    const r = compare(st, data);
    if (!r.best) { setChildren(out, [beginPrompt('Type or drag the amount that sits in your savings account beyond what you spend in a month.')]); return; }
    const yrs = `${r.years} year${r.years > 1 ? 's' : ''}`;
    const others = r.options.filter((o) => o !== r.base);
    const ahead = r.best !== r.base;
    const by = (o) => data.options.find((x) => x.id === o.id);

    const cards = el('div', { class: 'car-results idle-results' }, r.options.map((o) => el('div', { class: 'car-result' + (ahead && o === r.best ? ' best' : '') }, [
      el('div', { class: 'k' }, o.label),
      el('div', { class: 'v' }, inr(o.value)),
      el('div', { class: 's' }, o === r.base ? `${inr(o.earned)} earned` : o.extra >= 0 ? `${inr(o.extra)} more` : `${inr(-o.extra)} less`),
    ])));
    const verdict = ahead
      ? `Left in the savings account, ${inrShort(r.invested)} earns ${inr(r.base.earned)} in ${yrs} after tax. In the ${r.best.label.toLowerCase()}, the highest here, it earns ${inr(r.best.earned)}: ${inr(r.best.extra)} more.`
      : `On these rates and your slab, none of the three ends ahead of the savings account over ${yrs}.`;

    const chart = el('div', { class: 'car-be-chart' }, [
      el('div', { class: 'viz-title' }, 'What it would be worth if taken out, after tax'),
      lineChart({ series: r.series.map((s, i) => ({ name: s.label, color: COLOR[s.id], dash: i >= 2, points: s.points })), yFromMin: true, height: 220, xFormat: (x) => `Yr ${Math.round(x)}`, xTipFormat: (x) => (Math.round(x) ? `After ${Math.round(x)} year${Math.round(x) > 1 ? 's' : ''}` : 'Today'), ariaLabel: 'The money after tax in each place, year by year' }),
    ]);

    // what each one is: the rate used, what is left of it after tax, how it is taxed, how fast it pays back, how safe
    const about = el('div', { class: 'idle-about' }, r.options.map((o) => {
      const d = by(o);
      return el('div', { class: 'idle-about-item' }, [
        el('div', { class: 'idle-about-head' }, [el('i', { style: `background:${COLOR[o.id]}`, 'aria-hidden': 'true' }), el('b', {}, o.label), el('span', {}, `${+o.ratePct.toFixed(2)}% a year${o.afterTaxPct != null ? `, ${o.afterTaxPct.toFixed(2)}% after tax` : ''}`)]),
        el('dl', {}, [
          el('dt', {}, 'Rate'), el('dd', {}, st.rates[o.id] !== '' && st.rates[o.id] != null ? 'The rate you typed.' : d.rate_note),
          el('dt', {}, 'Tax'), el('dd', {}, `${TAXED[d.tax]} Here: ${inr(o.tax)} of tax on ${inr(o.gross)}.`),
          el('dt', {}, 'Getting it back'), el('dd', {}, d.access),
          el('dt', {}, 'Safety'), el('dd', {}, d.safety),
        ]),
      ]);
    }));

    setChildren(out, resultLayout({
      key: 'idle-money',
      answer: [
        ahead ? el('div', { class: 'idle-hero' }, [
          el('div', { class: 'quick-k' }, `Up to this much more in ${yrs}, after tax`),
          el('div', { class: 'quick-v' }, inr(r.best.extra)),
        ]) : null,
        el('p', { class: 'explain' }, verdict),
        el('h3', { class: 'car-out-title' }, `Worth after ${yrs}`),
        el('p', { class: 'muted small car-out-sub' }, 'After tax, at typical rates today: not offers, and not promises.'),
        cards,
        chart,
        el('p', { class: 'muted small' }, 'A higher figure is not a safer one. What each of these is, how fast the money comes back and what can go wrong are under “Why this answer”.'),
      ],
      why: [
        about,
        el('p', { class: 'muted small' }, `Tax at a ${+st.slabPct}% slab${st.oldRegime ? ', old regime' : ''}, with 4% cess. ${data.tax.note}`),
      ],
      next: [
        { label: 'Find what you can spare each month', note: 'Your take-home against your expenses, and what is free at the end of the month', href: '/calculators/budget', primary: true },
        { label: 'Money you will not need for five years or more', note: 'What a monthly SIP could grow into', href: '/calculators/sip' },
      ],
      details: [
        el('ul', { class: 'muted small' }, [
          `Rates as compiled on ${new Date(data._meta.compiled_on).toLocaleDateString('en-IN', { day: 'numeric', month: 'long', year: 'numeric' })}. ${data._meta.caution}`,
          'Bank interest is taken as compounding every quarter, with the tax on each year’s interest paid out of the balance. A fund’s return is taken as steady through the year; real returns move, and an arbitrage fund’s move most.',
          `An arbitrage fund taken out at exactly 12 months is still taxed at 20%; a day later the rate is 12.5%.${+st.monthly > 0 ? ' Money added each month goes in at the end of the month.' : ''}`,
          `Not covered: ${data._meta.not_covered}`,
          'This compares what the same money would be worth. It does not name a bank or a fund, and it is not advice on where to keep yours: keep what you may need at short notice where you can reach it.',
          ...data.sources,
        ].map((t) => el('li', {}, t))),
      ],
      detailsLabel: 'Show the assumptions and sources',
    }));
  }
  paint();
  return el('div', { class: 'calc calc-wide car-calc idle-calc' }, [inputs, out]);
}
