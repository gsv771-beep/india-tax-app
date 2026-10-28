/**
 * Buying a car, by fuel: petrol, diesel, strong hybrid and electric side by side. Type the ex-showroom
 * price of each version you are weighing (from the dealer's quote) and see the on-road price, what it
 * costs to run, the total over the years you will keep it, and how long a dearer one takes to earn its
 * extra back. Engine: engine/car.js; data: data/car_charges.json (road tax by city and fuel, with the
 * date and a confidence note). It lays the costs side by side; it does not tell anyone what to buy.
 */
import { inr, inrShort, el, setChildren, debounce, beginPrompt } from './util.js';
import { ownership, onRoad, FUELS, FUEL_LABEL } from '../engine/car.js';
import { resultLayout } from './result-layout.js';
import { setHandoff } from './handoff.js';
import { getProfile } from './profile-store.js';
import { salaryMonthly } from './budget-sync.js';
import { moreFold, emi } from './calculators.js';

const STORE = 'taxcompass.car.v1';
const months = (m) => { const t = Math.round(m), y = Math.floor(t / 12), r = t % 12; return [y ? `${y} year${y > 1 ? 's' : ''}` : '', r ? `${r} month${r > 1 ? 's' : ''}` : ''].filter(Boolean).join(' ') || 'under a month'; };

export function renderCar(appData, data) {
  let saved = {}; try { saved = JSON.parse(localStorage.getItem(STORE) || '{}'); } catch {}
  const st = {
    cityId: 'delhi', kmPerMonth: data.defaults.km_per_month, years: data.defaults.years,
    prices: {}, roadTaxPct: {}, otherCityPct: '', petrolPrice: '', dieselPrice: '', homeRate: '', publicPct: '', publicRate: '',
    efficiency: {}, maintenance: {}, ...saved,
  };
  const save = () => { try { localStorage.setItem(STORE, JSON.stringify(st)); } catch {} };
  const out = el('div');
  const rerender = debounce(() => paint(), 80);
  const city = () => data.cities.find((c) => c.id === st.cityId) || null;

  // a number box bound to st[key] or st[group][key]
  const field = (label, get, setv, attrs = {}, hint) => {
    const input = el('input', { type: 'number', min: 0, step: attrs.step || 1, max: attrs.max, value: get() === '' || get() == null ? '' : get(), placeholder: attrs.placeholder || '' });
    input.addEventListener('input', () => { setv(input.value === '' ? '' : +input.value); save(); rerender(); });
    return { node: el('label', {}, [el('span', { class: 'lbl' }, label), hint ? el('small', {}, hint) : null, input]), input };
  };
  const at = (group, key) => [() => st[group][key], (v) => { st[group][key] = v; }];

  const citySel = el('select', {}, [...data.cities.map((c) => el('option', { value: c.id, selected: c.id === st.cityId }, c.label)), el('option', { value: 'other', selected: st.cityId === 'other' }, 'Another city')]);
  citySel.addEventListener('change', () => { st.cityId = citySel.value; save(); syncPlaceholders(); paint(); });
  const km = field('Driving a month (km)', () => st.kmPerMonth, (v) => { st.kmPerMonth = v; }, { step: 100, max: 20000 });
  const yrs = field('Keeping it for (years)', () => st.years, (v) => { st.years = v; }, { step: 1, max: 20 });
  const priceFields = FUELS.map((f) => field(`${FUEL_LABEL[f]}: ex-showroom price (₹)`, ...at('prices', f), { step: 10000, placeholder: 'blank to skip' }));

  // everything else has a default; the dealer's quote can replace the road tax
  const otherPct = field('Road tax in your city (%)', () => st.otherCityPct, (v) => { st.otherCityPct = v; }, { step: 0.5, max: 25, placeholder: 'e.g. 10' }, 'from the dealer’s quote or your RTO');
  const petrolP = field('Petrol (₹ a litre)', () => st.petrolPrice, (v) => { st.petrolPrice = v; }, { step: 0.5 });
  const dieselP = field('Diesel (₹ a litre)', () => st.dieselPrice, (v) => { st.dieselPrice = v; }, { step: 0.5 });
  const homeRate = field('Home charging (₹ a kWh)', () => st.homeRate, (v) => { st.homeRate = v; }, { step: 0.5 });
  const publicPct = field('Share charged at public fast chargers (%)', () => st.publicPct, (v) => { st.publicPct = v; }, { step: 5, max: 100, placeholder: String(data.defaults.public_charging_pct) }, `about ₹${data.defaults.public_charging_rate} a kWh`);
  const effFields = FUELS.map((f) => field(`${FUEL_LABEL[f]}: ${data.defaults.efficiency_units[f]}`, ...at('efficiency', f), { step: 0.5, placeholder: String(data.defaults.efficiency[f]) }));
  const maintFields = FUELS.map((f) => field(`${FUEL_LABEL[f]}: service a year (₹)`, ...at('maintenance', f), { step: 1000, placeholder: String(data.defaults.maintenance_per_year[f]) }));
  const taxFields = FUELS.map((f) => field(`${FUEL_LABEL[f]}: road tax from your quote (%)`, ...at('roadTaxPct', f), { step: 0.25, max: 25 }));
  const syncPlaceholders = () => {
    const c = city();
    petrolP.input.placeholder = c ? String(c.fuel.petrol) : 'e.g. 105';
    dieselP.input.placeholder = c ? String(c.fuel.diesel) : 'e.g. 95';
    homeRate.input.placeholder = c ? String(c.electricity) : '7';
    otherPct.node.hidden = !!c;
    FUELS.forEach((f, i) => { const pr = +st.prices[f] || 1000000; const r = c ? onRoad({ city: c, fuel: f, price: pr }, data).pct : null; taxFields[i].input.placeholder = r != null ? `${r} (${c.label})` : ''; });
  };

  const open = Object.values(st.roadTaxPct).some((v) => v !== '' && v != null) || [st.petrolPrice, st.dieselPrice, st.homeRate, st.publicPct, st.otherCityPct].some((v) => v !== '' && v != null);
  const inputs = el('div', { class: 'card inputs' }, [
    el('label', {}, [el('span', { class: 'lbl' }, 'City'), citySel]),
    el('div', { class: 'two' }, [km.node, yrs.node]),
    el('div', { class: 'opts' }, [el('div', { class: 'opt-title' }, 'The versions you are weighing'), ...priceFields.map((f) => f.node)]),
    otherPct.node,
    moreFold('Fuel prices, mileage, servicing, road tax from your quote', open, [
      el('div', { class: 'two' }, [petrolP.node, dieselP.node]),
      el('div', { class: 'two' }, [homeRate.node, publicPct.node]),
      el('div', { class: 'opt-title' }, 'Mileage'), ...effFields.map((f) => f.node),
      el('div', { class: 'opt-title' }, 'Servicing'), ...maintFields.map((f) => f.node),
      el('div', { class: 'opt-title' }, 'Road tax on your dealer’s quote'), el('p', { class: 'opt-help' }, 'The quote lists the road tax. Type its rate here and it replaces the estimate.'), ...taxFields.map((f) => f.node),
    ]),
  ]);
  syncPlaceholders();

  function paint() {
    syncPlaceholders();
    const r = ownership(st, data);
    if (!r.options.length) { setChildren(out, [beginPrompt('Type the ex-showroom price of at least one version: petrol, diesel, hybrid or electric. Two or more puts them side by side.')]); return; }
    const c = r.city, many = r.options.length > 1;
    const best = r.cheapest;
    const stat = (k, v, hi) => el('div', { class: 'stat' + (hi ? ' hi' : '') }, [el('div', { class: 'k' }, k), el('div', { class: 'v' }, v)]);
    const cmp = el('div', { class: 'table-wrap' }, el('table', { class: 'compare car-table' }, [
      el('thead', {}, el('tr', {}, [el('th', {}, ''), el('th', {}, 'On road'), el('th', {}, 'A month'), el('th', {}, `${r.years} years`), el('th', { class: 'car-km' }, 'A km')])),
      el('tbody', {}, r.options.map((o) => el('tr', { class: many && o === best ? 'total' : '' }, [
        el('td', {}, o.fuel === 'hybrid' ? 'Hybrid' : o.label), el('td', {}, inr(o.road.total)), el('td', {}, inr(o.run.total)), el('td', {}, inr(o.total)), el('td', { class: 'car-km' }, `₹${o.perKm.toFixed(1)}`),
      ]))),
    ]));
    const paybackLines = r.payback.map((p) => {
      const o = r.options.find((x) => x.fuel === p.fuel);
      if (p.savingPerMonth <= 0) return `The ${o.label.toLowerCase()} costs ${inr(p.extra)} more on the road and does not cost less to run, so it does not earn the difference back.`;
      const total = r.years * 12, kmText = `${Math.round(p.km / 100) * 100 > 0 ? (Math.round(p.km / 100) * 100).toLocaleString('en-IN') : 0} km`;
      const when = Math.abs(p.months - total) < 1 ? `, right at the end of the ${r.years} years you plan to keep it.` : p.months < total ? `, within the ${r.years} years.` : `, longer than the ${r.years} years you plan to keep it.`;
      return `The ${o.label.toLowerCase()} costs ${inr(p.extra)} more on the road than the ${FUEL_LABEL[p.against].toLowerCase()} and ${inr(p.savingPerMonth)} a month less to run: it earns that back in ${months(p.months)} (about ${kmText})${when}`;
    });
    const breakdown = el('div', { class: 'table-wrap' }, el('table', { class: 'compare' }, [
      el('thead', {}, el('tr', {}, [el('th', {}, ''), ...r.options.map((o) => el('th', {}, o.label))])),
      el('tbody', {}, [
        ['Ex-showroom', (o) => inr(o.road.exShowroom)],
        ['Road tax', (o) => `${inr(o.road.roadTax)} (${o.road.pct}%)`],
        ['Cess', (o) => (o.road.cess ? inr(o.road.cess) : '—')],
        ['Registration, plates, FASTag', (o) => inr(o.road.fees)],
        ['Insurance, first year', (o) => inr(o.road.insurance)],
        ['On the road', (o) => inr(o.road.total), 'total'],
        ['TCS, claimed back in your tax return', (o) => (o.road.tcs ? inr(o.road.tcs) : '—')],
      ].map(([k, f, cls]) => el('tr', { class: cls || '' }, [el('td', {}, k), ...r.options.map((o) => el('td', {}, f(o)))]))),
    ]));
    // the loan and the pay: an EMI on the cheaper-over-time car against the take-home already saved
    const takeHome = appData?.rates ? salaryMonthly(getProfile(), appData.rates) : 0;
    const loan = Math.round(best.road.total * 0.8 / 10000) * 10000;
    const loanEmi = emi(loan, 9, 5).emi;
    setChildren(out, resultLayout({
      key: 'car',
      answer: [
        el('div', { class: 'stats' }, many
          ? [stat(`Lowest over ${r.years} years`, `${best.label}: ${inr(best.total)}`, true), stat('A km, all in', `₹${best.perKm.toFixed(1)}`)]
          : [stat('On the road', inr(best.road.total), true), stat('Running a month', inr(best.run.total)), stat(`Over ${r.years} years`, inr(best.total))]),
        many ? cmp : null,
        ...paybackLines.map((t) => el('p', { class: 'explain' }, t)),
        el('p', { class: 'muted small' }, `${r.kmPerMonth.toLocaleString('en-IN')} km a month for ${r.years} years${c ? ` in ${c.label}` : ''}; fuel ${c ? `at ${c.label}’s ${c.fuel.as_of.split('-').reverse().slice(0, 2).join('/')} prices` : 'at the prices you typed'}. On these figures; not a recommendation.`),
      ],
      why: [
        breakdown,
        c ? el('p', { class: 'muted small' }, [`Road tax for ${c.label} (${c.state}), as at ${new Date(data._meta.compiled_on).toLocaleDateString('en-IN', { day: 'numeric', month: 'long', year: 'numeric' })}: ${c.confidence}. ${c.notes || ''} `, el('strong', {}, 'Your dealer’s quote lists the road tax: if it differs, type its rate under More options.')]) : el('p', { class: 'muted small' }, 'Road tax at the rate you typed.'),
        r.options.some((o) => o.road.tcs) ? el('p', { class: 'muted small' }, data.tcs.note) : null,
      ],
      next: [
        { label: `Plan the loan on the ${best.label.toLowerCase()}`, note: `An 80% loan of ${inr(loan)} over 5 years at 9% is about ${inr(loanEmi)} a month${takeHome > 0 ? `: ${Math.round(100 * loanEmi / takeHome)}% of your take-home` : ''}`, href: '/calculators/emi', onclick: () => setHandoff('emi', { principal: loan, ratePct: 9, years: 5, fresh: true, note: `an 80% loan on the ${best.label.toLowerCase()}` }, 'car'), primary: true },
        takeHome > 0 ? null : { label: 'See it against your take-home', note: 'Type your CTC once and the loan shows as a share of your pay', href: '/' },
      ],
      details: [
        el('ul', { class: 'muted small' }, [
          `Mileage: ${FUELS.map((f) => `${FUEL_LABEL[f].toLowerCase()} ${+(st.efficiency[f] || data.defaults.efficiency[f])} ${data.defaults.efficiency_units[f]}`).join(', ')}. ${data.defaults.efficiency_note}`,
          `Servicing a year: ${FUELS.map((f) => `${FUEL_LABEL[f].toLowerCase()} ${inr(+(st.maintenance[f] || data.defaults.maintenance_per_year[f]))}`).join(', ')}. ${data.defaults.maintenance_note}`,
          `Insurance: ${data.insurance.first_year_pct}% of the ex-showroom price in the first year (in the on-road price), ${data.insurance.renewal_pct}% a year after. ${data.fees.note}`,
          `Electric: ${100 - (+(st.publicPct === '' ? data.defaults.public_charging_pct : st.publicPct))}% charged at home, the rest at public fast chargers. ${data.defaults.public_charging_note}`,
          'Not counted: what the car sells for later (the hardest part to predict, especially for electric cars), tyres, a battery replacement, parking and tolls. Diesel cars cannot be driven in Delhi NCR after 10 years.',
        ].map((t) => el('li', {}, t))),
      ],
      detailsLabel: 'Show the assumptions',
    }));
  }
  paint();
  return el('div', { class: 'calc calc-wide' }, [inputs, out]);
}
