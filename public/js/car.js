/**
 * Which car is cheaper to own: two cars (up to four), each a fuel and an ex-showroom price, then how far
 * you drive in a year and how long you keep it. The answer is each car's cost over those years, the
 * cheaper one in green, and one line on the difference and how long a dearer car takes to earn its extra
 * back. Everything else (city fuel prices, mileage, servicing, the road tax on the dealer's quote, resale)
 * has a default and sits under More options. Engine: engine/car.js; data: data/car_charges.json.
 * It lays the costs side by side; it does not tell anyone what to buy.
 */
import { inr, el, setChildren, debounce, beginPrompt, rupees, readRupees, groupAsTyped } from './util.js';
import { ownership, onRoad, FUELS } from '../engine/car.js';
import { resultLayout } from './result-layout.js';
import { setHandoff } from './handoff.js';
import { getProfile } from './profile-store.js';
import { salaryMonthly } from './budget-sync.js';
import { moreFold, emi } from './calculators.js';

const STORE = 'taxcompass.car.v2';
const SHORT = { petrol: 'Petrol', diesel: 'Diesel', hybrid: 'Hybrid', ev: 'Electric' };
const LETTERS = ['A', 'B', 'C', 'D'];
const KM = { min: 5000, max: 40000, step: 1000 };
const PERIODS = [3, 5, 7];
const months = (m) => { const t = Math.round(m), y = Math.floor(t / 12), r = t % 12; return [y ? `${y} year${y > 1 ? 's' : ''}` : '', r ? `${r} month${r > 1 ? 's' : ''}` : ''].filter(Boolean).join(' ') || 'under a month'; };
const kmText = (n) => `${(Math.round(n / 1000) * 1000).toLocaleString('en-IN')} km`;
const newCar = (fuel) => ({ fuel, price: '', roadTaxPct: '', efficiency: '', maintenance: '', resale: '' });

export function renderCar(appData, data) {
  let saved = {}; try { saved = JSON.parse(localStorage.getItem(STORE) || '{}'); } catch {}
  const st = {
    cityId: 'delhi', kmPerYear: data.defaults.km_per_month * 12, years: data.defaults.years,
    cars: [newCar('petrol'), newCar('ev')],
    otherCityPct: '', petrolPrice: '', dieselPrice: '', homeRate: '', publicPct: '',
    ...saved,
  };
  if (!Array.isArray(st.cars) || !st.cars.length) st.cars = [newCar('petrol'), newCar('ev')];
  const save = () => { try { localStorage.setItem(STORE, JSON.stringify(st)); } catch {} };
  const changed = () => { save(); rerender(); };
  const rerender = debounce(() => paint(), 80);
  const city = () => data.cities.find((c) => c.id === st.cityId) || null;
  // cars are named by their fuel; two of the same fuel are told apart by their letter
  const nameOf = (i) => {
    const f = st.cars[i].fuel;
    return st.cars.filter((c) => c.fuel === f).length > 1 ? `${SHORT[f]} (${LETTERS[i]})` : SHORT[f];
  };

  // ---- the cars: a fuel and a price each ----
  const pick = el('div', { class: 'car-pick' });
  const addBtn = el('button', { type: 'button', class: 'car-add' }, '+ Add a car');
  addBtn.addEventListener('click', () => {
    if (st.cars.length >= LETTERS.length) return;
    st.cars.push(newCar(FUELS.find((f) => !st.cars.some((c) => c.fuel === f)) || 'petrol'));
    drawCars(); drawMore(); changed();
    pick.querySelectorAll('.car-price')[st.cars.length - 1]?.focus();
  });
  function drawCars() {
    setChildren(pick, st.cars.map((car, i) => {
      const fuel = el('select', { class: 'car-fuel', 'aria-label': `Car ${LETTERS[i]}: fuel` }, FUELS.map((f) => el('option', { value: f, selected: f === car.fuel }, SHORT[f])));
      fuel.addEventListener('change', () => { car.fuel = fuel.value; drawMore(); changed(); });
      const price = el('input', { type: 'text', inputmode: 'numeric', autocomplete: 'off', class: 'car-price', 'data-echo': 'own', placeholder: i === 0 ? '10,00,000' : '14,00,000', 'aria-label': `Car ${LETTERS[i]}: ex-showroom price in rupees`, value: rupees(car.price) });
      groupAsTyped(price);
      price.addEventListener('input', () => { car.price = readRupees(price.value) || ''; changed(); });
      const remove = i >= 2 ? el('button', { type: 'button', class: 'car-remove', 'aria-label': `Remove car ${LETTERS[i]}` }, '×') : null;
      remove?.addEventListener('click', () => { st.cars.splice(i, 1); drawCars(); drawMore(); changed(); });
      return el('div', { class: 'car-slot' }, [
        el('div', { class: 'car-slot-name' }, [`Car ${LETTERS[i]}`, remove]),
        el('div', { class: 'car-box' }, [fuel, el('label', { class: 'car-price-row' }, [el('span', { 'aria-hidden': 'true' }, '₹'), price])]),
      ]);
    }));
    addBtn.hidden = st.cars.length >= LETTERS.length;
  }

  // ---- where, how far, how long ----
  const citySel = el('select', { class: 'car-city', 'aria-label': 'City' }, [...data.cities.map((c) => el('option', { value: c.id, selected: c.id === st.cityId }, c.label)), el('option', { value: 'other', selected: st.cityId === 'other' }, 'Another city')]);
  citySel.addEventListener('change', () => { st.cityId = citySel.value; drawMore(); changed(); });
  const otherPct = el('input', { type: 'number', min: 0, max: 25, step: 0.5, class: 'pct-input', placeholder: 'e.g. 10', value: st.otherCityPct });
  otherPct.addEventListener('input', () => { st.otherCityPct = otherPct.value === '' ? '' : +otherPct.value; changed(); });
  const otherRow = el('label', { class: 'car-other' }, [el('span', {}, ['Road tax in your city (%)', el('small', {}, 'from the dealer’s quote or your RTO')]), otherPct]);

  const kmOut = el('strong', { class: 'car-val' });
  const km = el('input', { type: 'range', class: 'car-range', min: KM.min, max: KM.max, step: KM.step, value: Math.min(KM.max, Math.max(KM.min, +st.kmPerYear || 12000)), 'aria-label': 'Driving a year, km' });
  const showKm = () => { kmOut.textContent = `${(+km.value).toLocaleString('en-IN')} km`; km.style.setProperty('--fill', `${(100 * (km.value - KM.min)) / (KM.max - KM.min)}%`); };
  km.addEventListener('input', () => { st.kmPerYear = +km.value; showKm(); changed(); });
  showKm();

  const periodBtns = PERIODS.map((y) => el('button', { type: 'button', 'aria-pressed': String(+st.years === y) }, `${y} years`));
  periodBtns.forEach((b, i) => b.addEventListener('click', () => { st.years = PERIODS[i]; periodBtns.forEach((x, j) => x.setAttribute('aria-pressed', String(i === j))); changed(); }));
  if (!PERIODS.includes(+st.years)) { st.years = 5; periodBtns[1].setAttribute('aria-pressed', 'true'); }

  // ---- More options: every figure that has a default ----
  const numField = (label, get, setv, attrs = {}, hint) => {
    const input = el('input', { type: 'number', min: 0, step: attrs.step || 1, max: attrs.max, value: get() ?? '', placeholder: attrs.placeholder || '', class: attrs.money ? '' : 'pct-input' });
    input.addEventListener('input', () => { setv(input.value === '' ? '' : +input.value); changed(); });
    return el('label', {}, [el('span', { class: 'lbl' }, label), hint ? el('small', {}, hint) : null, input]);
  };
  const more = el('div');
  function drawMore() {
    const c = city();
    otherRow.hidden = !!c;
    setChildren(more, [
      el('div', { class: 'two' }, [
        numField('Petrol (₹ a litre)', () => st.petrolPrice, (v) => { st.petrolPrice = v; }, { step: 0.5, placeholder: c ? String(c.fuel.petrol) : 'e.g. 105' }),
        numField('Diesel (₹ a litre)', () => st.dieselPrice, (v) => { st.dieselPrice = v; }, { step: 0.5, placeholder: c ? String(c.fuel.diesel) : 'e.g. 95' }),
      ]),
      el('div', { class: 'two' }, [
        numField('Home charging (₹ a kWh)', () => st.homeRate, (v) => { st.homeRate = v; }, { step: 0.5, placeholder: c ? String(c.electricity) : '7' }),
        numField('Charged at public chargers (%)', () => st.publicPct, (v) => { st.publicPct = v; }, { step: 5, max: 100, placeholder: String(data.defaults.public_charging_pct) }, `about ₹${data.defaults.public_charging_rate} a kWh`),
      ]),
      ...st.cars.map((car, i) => {
        const p = +car.price || 1000000, rate = c ? onRoad({ city: c, fuel: car.fuel, price: p }, data).pct : null;
        return el('div', { class: 'car-more' }, [
          el('div', { class: 'opt-title' }, `Car ${LETTERS[i]}: ${SHORT[car.fuel].toLowerCase()}`),
          el('div', { class: 'two' }, [
            numField(car.fuel === 'ev' ? 'Km a kWh' : 'Km a litre', () => car.efficiency, (v) => { car.efficiency = v; }, { step: 0.5, placeholder: String(data.defaults.efficiency[car.fuel]) }),
            numField('Service a year (₹)', () => car.maintenance, (v) => { car.maintenance = v; }, { step: 1000, money: true, placeholder: String(data.defaults.maintenance_per_year[car.fuel]) }),
          ]),
          el('div', { class: 'two' }, [
            numField('Road tax on your quote (%)', () => car.roadTaxPct, (v) => { car.roadTaxPct = v; }, { step: 0.25, max: 25, placeholder: rate != null ? String(rate) : '' }),
            numField('Sells for at the end (₹)', () => car.resale, (v) => { car.resale = v; }, { step: 10000, money: true, placeholder: 'not counted' }),
          ]),
        ]);
      }),
    ]);
  }
  const anyMore = [st.petrolPrice, st.dieselPrice, st.homeRate, st.publicPct].some((v) => v !== '' && v != null) || st.cars.some((c) => [c.roadTaxPct, c.efficiency, c.maintenance, c.resale].some((v) => v !== '' && v != null));

  const inputs = el('div', { class: 'card inputs car-form' }, [
    pick,
    addBtn,
    el('div', { class: 'car-row' }, [el('span', {}, 'City'), citySel]),
    otherRow,
    el('div', { class: 'car-row' }, [el('span', {}, 'Annual driving'), kmOut]),
    km,
    el('div', { class: 'car-ends' }, [el('span', {}, '5,000 km'), el('span', {}, '40,000 km')]),
    el('div', { class: 'car-row' }, el('span', {}, 'Ownership period')),
    el('div', { class: 'car-seg', role: 'group', 'aria-label': 'Ownership period' }, periodBtns),
    moreFold('Fuel prices, mileage, servicing, road tax from your quote, resale', anyMore, [more]),
  ]);
  drawCars(); drawMore();

  const out = el('div');
  function paint() {
    const input = { ...st, kmPerMonth: (+st.kmPerYear || 12000) / 12, cars: st.cars.map((c, i) => ({ ...c, id: LETTERS[i], name: nameOf(i) })) };
    const r = ownership(input, data);
    if (!r.options.length) { setChildren(out, [beginPrompt('Type the ex-showroom price of each car, from the brochure or the dealer’s quote.')]); return; }
    const c = r.city, many = r.options.length > 1, best = r.cheapest;
    const net = r.options.some((o) => o.resale > 0);
    const sorted = [...r.options].sort((a, b) => a.total - b.total);
    const gap = many ? sorted[1].total - best.total : 0;

    const cards = el('div', { class: 'car-results' }, r.options.map((o) => el('div', { class: 'car-result' + (many && o === best ? ' best' : '') }, [
      el('div', { class: 'k' }, o.name),
      el('div', { class: 'v' }, inr(o.total)),
      el('div', { class: 's' }, `${r.years}-year ${net && o.resale > 0 ? 'net ' : ''}cost`),
    ])));
    const verdict = !many ? `${inr(best.road.total)} on the road, then ${inr(best.run.total)} a month to run.`
      : gap < best.total * 0.01 ? `Within ${inr(gap)} of each other over ${r.years} years: on these figures, about the same.`
        : `The ${best.name.toLowerCase()} costs ${inr(gap)} less over ${r.years} years than the ${sorted[1].name.toLowerCase()}.`;
    const nameById = (id) => r.options.find((o) => o.id === id).name.toLowerCase();
    const payback = many ? r.payback.filter((p) => p.extra > 0).map((p) => {
      if (p.months == null) return `The ${nameById(p.id)} costs ${inr(p.extra)} more to buy and no less to run, so it never earns that back.`;
      const total = r.years * 12;
      const when = Math.abs(p.months - total) < 1 ? ', right at the end of the period' : p.months < total ? '' : `, longer than the ${r.years} years`;
      return `The ${nameById(p.id)} costs ${inr(p.extra)} more to buy and ${inr(p.savingPerMonth)} a month less to run: it earns that back in ${months(p.months)} (about ${kmText(p.km)})${when}.`;
    }) : [];

    const breakdown = el('div', { class: 'table-wrap' }, el('table', { class: 'compare' }, [
      el('thead', {}, el('tr', {}, [el('th', {}, ''), ...r.options.map((o) => el('th', {}, o.name))])),
      el('tbody', {}, [
        ['Ex-showroom', (o) => inr(o.road.exShowroom)],
        ['Road tax', (o) => `${inr(o.road.roadTax)} (${o.road.pct}%)`],
        ['Cess', (o) => (o.road.cess ? inr(o.road.cess) : '—')],
        ['Registration, plates, FASTag', (o) => inr(o.road.fees)],
        ['Insurance, first year', (o) => inr(o.road.insurance)],
        ['On the road', (o) => inr(o.road.total), 'total'],
        ['Fuel or charging a month', (o) => inr(o.run.energy)],
        ['Service and insurance a month', (o) => inr(o.run.service + o.run.insurance)],
        [`Sells for after ${r.years} years`, (o) => (o.resale ? `−${inr(o.resale)}` : 'not counted')],
        [`Over ${r.years} years`, (o) => inr(o.total), 'total'],
        ['A km, all in', (o) => `₹${o.perKm.toFixed(1)}`],
      ].map(([k, f, cls]) => el('tr', { class: cls || '' }, [el('td', {}, k), ...r.options.map((o) => el('td', {}, f(o)))]))),
    ]));
    // the loan and the pay: an EMI on the cheaper car against the take-home already saved
    const takeHome = appData?.rates ? salaryMonthly(getProfile(), appData.rates) : 0;
    const loan = Math.round(best.road.total * 0.8 / 10000) * 10000;
    const loanEmi = emi(loan, 9, 5).emi;
    setChildren(out, resultLayout({
      key: 'car',
      answer: [
        el('h3', { class: 'car-out-title' }, 'Your ownership cost comparison'),
        el('p', { class: 'muted small car-out-sub' }, 'Illustrative assumptions, not live vehicle prices or quotes'),
        cards,
        el('p', { class: 'explain' }, verdict),
        ...payback.map((t) => el('p', { class: 'muted small' }, t)),
      ],
      why: [
        breakdown,
        el('p', { class: 'muted small' }, `${(+st.kmPerYear || 12000).toLocaleString('en-IN')} km a year for ${r.years} years${c ? ` in ${c.label}` : ''}; fuel ${c ? `at ${c.label}’s prices of ${new Date(c.fuel.as_of).toLocaleDateString('en-IN', { day: 'numeric', month: 'long' })}` : 'at the prices you typed'}. On these figures; not a recommendation.`),
        c ? el('p', { class: 'muted small' }, [`Road tax for ${c.label} (${c.state}): ${c.confidence}. ${c.notes || ''} `, el('strong', {}, 'Your dealer’s quote lists the road tax: if it differs, type its rate under More options.')]) : el('p', { class: 'muted small' }, 'Road tax at the rate you typed.'),
        r.options.some((o) => o.road.tcs) ? el('p', { class: 'muted small' }, data.tcs.note) : null,
      ],
      next: [
        { label: `Plan the loan on the ${best.name.toLowerCase()}`, note: `An 80% loan of ${inr(loan)} over 5 years at 9% is about ${inr(loanEmi)} a month${takeHome > 0 ? `: ${Math.round(100 * loanEmi / takeHome)}% of your take-home` : ''}`, href: '/calculators/emi', onclick: () => setHandoff('emi', { principal: loan, ratePct: 9, years: 5, fresh: true, note: `an 80% loan on the ${best.name.toLowerCase()}` }, 'car'), primary: true },
        takeHome > 0 ? null : { label: 'See it against your take-home', note: 'Type your CTC once and the loan shows as a share of your pay', href: '/' },
      ],
      details: [
        el('ul', { class: 'muted small' }, [
          `Mileage unless you change it: ${FUELS.map((f) => `${SHORT[f].toLowerCase()} ${data.defaults.efficiency[f]} ${data.defaults.efficiency_units[f]}`).join(', ')}. ${data.defaults.efficiency_note}`,
          `Servicing a year: ${FUELS.map((f) => `${SHORT[f].toLowerCase()} ${inr(data.defaults.maintenance_per_year[f])}`).join(', ')}. ${data.defaults.maintenance_note}`,
          `Insurance: ${data.insurance.first_year_pct}% of the ex-showroom price in the first year (in the on-road price), ${data.insurance.renewal_pct}% a year after. ${data.fees.note}`,
          `Electric: ${100 - (+(st.publicPct === '' ? data.defaults.public_charging_pct : st.publicPct))}% charged at home, the rest at public fast chargers. ${data.defaults.public_charging_note}`,
          'Not counted unless you type it: what the car sells for later (the hardest part to predict, especially for electric cars). Never counted: tyres, a battery replacement, parking and tolls. Diesel cars cannot be driven in Delhi NCR after 10 years.',
        ].map((t) => el('li', {}, t))),
      ],
      detailsLabel: 'Show the assumptions',
    }));
  }
  paint();
  return el('div', { class: 'calc calc-wide car-calc' }, [inputs, out]);
}
