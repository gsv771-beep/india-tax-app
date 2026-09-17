/**
 * Goal planner: pick what the money is for, say what it costs today, choose how much risk in percent
 * terms, and see the SIP. Child goals date themselves from the child's age; every child in the profile
 * gets a row. Engine: engine/goal.js and engine/mix.js.
 */
import { inr, el, setChildren, disclaimer, debounce, isBlankAfterReset, clearBlankAfterReset, beginPrompt } from './util.js';
import { GOAL_TYPES, goalType, goalPlan } from '../engine/goal.js';
import { equityCap } from '../engine/mix.js';
import { getProfile, updateProfile } from './profile-store.js';
import { isEmptyProfile } from '../engine/profile.js';
import { baseRates, loadMixRates } from './mix-rates.js';
import { mixControl } from './mix-control.js';
import { calcExportCard } from './calc-export-card.js';

const STORE = 'taxcompass.goal.v1';
const SOURCE = 'calc:goal';

export function renderGoal({ schemes }) {
  const p = getProfile();
  const blank = isBlankAfterReset('goal');
  let saved = {}; try { saved = JSON.parse(localStorage.getItem(STORE) || '{}'); } catch {}
  const st = { type: 'education', costToday: '', years: 10, childAge: '', atAge: '', daughterUnder10: false, equityPct: 50, inflationPct: '', equityRate: '', safeRate: '', ...saved };
  const kids = !blank && !isEmptyProfile(p) ? p.household.childrenAges.filter((a) => a >= 0) : [];
  if (st.childAge === '' && kids.length) st.childAge = kids[0];
  let rates = baseRates(schemes);
  const effRates = () => ({ ...rates, equity: st.equityRate === '' ? rates.equity : +st.equityRate, safe: st.safeRate === '' ? rates.safe : +st.safeRate });
  let dirty = false;
  const save = () => {
    dirty = true;
    clearBlankAfterReset('goal');
    try { localStorage.setItem(STORE, JSON.stringify(st)); } catch {}
  };
  const writeGoal = debounce((r) => updateProfile((d) => {
    const name = goalType(st.type).label;
    const g = d.horizon.goals.find((x) => x.name === name) || d.horizon.goals[0] || (d.horizon.goals[0] = { name, years: 0, target: 0 });
    g.name = name; g.years = r.years; g.target = Math.round(r.costThen);
    if (st.type !== 'fixed' && goalType(st.type).child && +st.childAge >= 0 && st.childAge !== '' && !d.household.childrenAges.length) d.household.childrenAges = [Math.round(+st.childAge)];
    return d;
  }, SOURCE), 300);

  const out = el('div');
  let last = null;
  const exportCard = calcExportCard('goal', () => last);
  const rerender = debounce(() => paint(), 80);
  const field = (key, label, attrs = {}, hint) => {
    const input = el('input', { type: 'number', min: attrs.min ?? 0, max: attrs.max, step: attrs.step || 1, value: st[key] === '' ? '' : st[key], placeholder: attrs.placeholder });
    input.addEventListener('input', () => { st[key] = input.value === '' ? '' : +input.value; save(); rerender(); });
    const small = el('small', {}, hint || '');
    return { node: el('label', {}, [el('span', { class: 'lbl' }, label), small, input]), input, small };
  };
  const typeSel = el('select', {}, GOAL_TYPES.map((t) => el('option', { value: t.id, selected: t.id === st.type }, t.label)));
  typeSel.addEventListener('change', () => { st.type = typeSel.value; st.inflationPct = ''; st.atAge = ''; save(); syncType(); paint(); });
  const F = {
    cost: field('costToday', goalType(st.type).costLabel, { step: 50000, placeholder: 'e.g. 2500000' }, goalType(st.type).costHint),
    years: field('years', 'In how many years', { step: 1, max: 50, min: 1 }),
    childAge: field('childAge', "Child's age now", { step: 1, max: 30, placeholder: 'e.g. 4' }, kids.length ? 'from your profile' : ''),
    atAge: field('atAge', 'Needed when the child is', { step: 1, max: 40, placeholder: String(goalType(st.type).atAge || '') }),
    inflation: field('inflationPct', 'It gets dearer each year by (%)', { step: 0.5, max: 20, placeholder: String(goalType(st.type).inflationPct) }, goalType(st.type).why),
    equityRate: field('equityRate', 'Equity returns (% a year)', { step: 0.1, max: 30, placeholder: String(rates.equity) }, rates.sources.equity),
    safeRate: field('safeRate', 'Safe money returns (% a year)', { step: 0.1, max: 15, placeholder: String(rates.safe) }, rates.sources.safe),
  };
  const daughter = el('input', { type: 'checkbox' }); daughter.checked = !!st.daughterUnder10;
  daughter.addEventListener('change', () => { st.daughterUnder10 = daughter.checked; save(); paint(); });
  const daughterRow = el('label', { class: 'check' }, [daughter, 'A daughter, under 10 (Sukanya Samriddhi is open to her)']);
  const childRow = el('div', { class: 'two' }, [F.childAge.node, F.atAge.node]);
  const mix = mixControl({ label: 'How much of it in equity', hint: 'the rest stays safe: PPF, deposits, debt funds', value: st.equityPct, cap: 100, rates: effRates(), onChange: (v) => { st.equityPct = v; save(); rerender(); } });
  const inputs = el('div', { class: 'card inputs' }, [
    el('label', {}, ['What is the money for?', typeSel]),
    childRow, daughterRow, F.years.node, F.cost.node,
    mix.node,
    el('details', { class: 'opts fold' }, [el('summary', {}, 'Assumptions (change what you know better)'), F.inflation.node, F.equityRate.node, F.safeRate.node]),
  ]);

  function syncType() {
    const t = goalType(st.type);
    F.cost.node.querySelector('.lbl').textContent = t.costLabel; F.cost.small.textContent = t.costHint;
    F.inflation.input.placeholder = String(t.inflationPct); F.inflation.small.textContent = t.why; F.inflation.input.value = st.inflationPct === '' ? '' : st.inflationPct;
    F.inflation.node.style.display = t.id === 'fixed' ? 'none' : '';
    F.atAge.input.placeholder = String(t.atAge || ''); F.atAge.input.value = st.atAge === '' ? '' : st.atAge;
    childRow.style.display = t.child ? '' : 'none';
    daughterRow.style.display = t.child ? '' : 'none';
    F.years.node.style.display = t.child ? 'none' : '';
  }
  const yearsOf = () => goalPlan({ ...st, atAge: st.atAge === '' ? undefined : st.atAge }, effRates()).years;

  function paint() {
    const t = goalType(st.type);
    const ready = +st.costToday > 0 && (t.child ? st.childAge !== '' && +st.childAge >= 0 : +st.years > 0);
    mix.update({ cap: equityCap(ready ? yearsOf() : 100), rates: effRates() });
    if (!ready) { setChildren(out, [beginPrompt(t.child ? "Enter the child's age and what it costs today." : 'Enter what it costs today and when you need it.')]); last = null; return; }
    const R = effRates();
    const o = { ...st, atAge: st.atAge === '' ? undefined : st.atAge, inflationPct: st.inflationPct === '' ? undefined : st.inflationPct };
    const r = goalPlan(o, R);
    if (r.years <= 0) { setChildren(out, [el('div', { class: 'notice warn' }, 'That date has already arrived; nothing to plan for.')]); last = null; return; }
    // every child in the profile, on the same plan
    const perChild = t.child && kids.length > 1 ? kids.map((age) => ({ age, plan: goalPlan({ ...o, childAge: age }, R) })) : null;
    last = { st: { ...st }, r, rates: R, perChild, typeLabel: t.label };
    if (dirty) writeGoal(r);
    const stat = (k, v, cls = '') => el('div', { class: 'stat ' + cls }, [el('div', { class: 'k' }, k), el('div', { class: 'v' }, v)]);
    setChildren(out, [
      el('div', { class: 'stats' }, [
        stat(t.id === 'fixed' ? 'You need' : `It will cost in ${r.years} years`, inr(r.costThen)),
        stat('SIP a month', inr(r.sip), 'hi'),
        stat('Or invest once, today', inr(r.lump)),
        r.equityPct > 0 ? stat('SIP if markets disappoint', inr(r.sipIfBad)) : stat(`Total you put in over ${r.years} years`, inr(r.invested)),
      ]),
      el('p', { class: 'explain' }, t.id === 'fixed'
        ? `${inr(r.costThen)} in ${r.years} years, at about ${r.returnPct}% a year from a ${r.equityPct}% equity mix, takes ${inr(r.sip)} a month or ${inr(r.lump)} today. If equity has a stretch like its worst 5 years, the SIP would have to be ${inr(r.sipIfBad)}.`
        : `${inr(r.costToday)} today becomes ${inr(r.costThen)} in ${r.years} years at ${r.inflationPct}% a year. At about ${r.returnPct}% from a ${r.equityPct}% equity mix that takes ${inr(r.sip)} a month, or ${inr(r.lump)} put away today. If equity has a stretch like its worst 5 years, the SIP would have to be ${inr(r.sipIfBad)}: plan nearer that if the date cannot move.`),
      r.capped ? el('div', { class: 'notice' }, `Equity is capped at ${r.cap}% here: money needed within ${r.years} years cannot wait out a bad market.`) : null,
      perChild ? el('div', { class: 'card', style: 'padding:12px 14px;margin-bottom:12px' }, [
        el('div', { class: 'viz-title' }, `Each child in your profile, same ${t.label.toLowerCase().replace("child's ", '')} at today’s cost`),
        el('div', { class: 'table-wrap' }, el('table', { class: 'compare' }, [
          el('thead', {}, el('tr', {}, [el('th', {}, 'Child'), el('th', {}, 'Years to go'), el('th', {}, 'Cost then'), el('th', {}, 'SIP a month')])),
          el('tbody', {}, [...perChild.map((c) => el('tr', {}, [el('td', {}, `Age ${c.age}`), el('td', {}, String(c.plan.years)), el('td', {}, inr(c.plan.costThen)), el('td', {}, inr(c.plan.sip))])),
            el('tr', { class: 'total' }, [el('td', {}, 'Together'), el('td', {}, ''), el('td', {}, inr(perChild.reduce((s, c) => s + c.plan.costThen, 0))), el('td', {}, inr(perChild.reduce((s, c) => s + c.plan.sip, 0)))])]),
        ])),
      ]) : null,
      el('div', { class: 'card next-steps' }, [
        el('h3', { style: 'margin-top:0' }, `Where the ${inr(r.sip)} goes`),
        el('div', { class: 'table-wrap' }, el('table', { class: 'compare' }, [
          el('thead', {}, el('tr', {}, [el('th', {}, 'Where'), el('th', {}, 'A month'), el('th', {}, 'Why')])),
          el('tbody', {}, r.where.lines.map((l) => el('tr', {}, [el('td', {}, l.label), el('td', {}, inr(l.amount)), el('td', { class: 'small' }, l.why)]))),
        ])),
        el('p', { class: 'muted small' }, r.where.rule),
      ]),
      el('p', { class: 'muted small' }, 'A fair idea, not a plan. Returns are what these categories have done, not a promise; costs rise unevenly; and the SIP assumes you never miss a month. Revisit it yearly, and whenever the child changes their mind about what to study.'),
      el('div', { class: 'btn-row' }, [
        el('a', { class: 'btn secondary', href: '/calculators/compare' }, 'Compare where the safe part earns most'),
        st.type === 'house' ? el('a', { class: 'btn secondary', href: '/calculators/home' }, 'What the house will really cost') : null,
      ]),
      disclaimer('invest'),
    ]);
  }
  syncType();
  paint();
  loadMixRates(schemes).then((r) => { rates = r; F.equityRate.input.placeholder = String(r.equity); F.equityRate.small.textContent = r.sources.equity; paint(); });
  return el('div', { class: 'calc' }, [inputs, el('div', {}, [out, exportCard])]);
}
